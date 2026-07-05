/**
 * srt/electron/main.ts — Electron 메인 프로세스
 *
 * 역할: 기존 ui.ts의 HTTP/SSE 서버(startServer)를 같은 프로세스에서 그대로 구동하고,
 * 그 주소(http://localhost:3001)를 바라보는 BrowserWindow를 띄운다.
 * React UI(ui/dist)와 API 서버 코드는 손대지 않고 그대로 재사용한다.
 *
 * 매크로 본체(run_srt.ts 및 SrtSession/BookingFlow/WaitlistFlow 등 의존성 전체)는
 * 빌드 시점에 esbuild로 dist-electron/macro.mjs 하나로 번들된다 (electron:macro:build
 * 스크립트) — Playwright의 driver/bootstrap을 건드리는 게 아니라 우리 .ts 소스만
 * 번들하는 것이므로 문제 없다. Playwright/node-notifier는 external로 남겨 패키징된
 * node_modules(asarUnpack)에서 resolve한다. 이렇게 하면 런타임에 tsx/esbuild 자체가
 * 전혀 필요 없어져, 패키징한 node_modules의 esbuild 네이티브 바이너리가 빌드 플랫폼과
 * 다를 때(예: mac에서 패키징한 걸 Windows에 배포) 발생하던 크래시가 원천 제거된다.
 * Electron 바이너리 자체가 Node를 내장하므로 별도 Node.js 설치 없이
 * `process.execPath` + `ELECTRON_RUN_AS_NODE=1` 조합으로 자식 프로세스를 띄운다.
 *
 * 빌드: esbuild가 이 파일 + import한 ../ui.ts(둘 다 Playwright 미의존)를 함께
 *       하나의 ESM 번들로 묶어 dist-electron/main.mjs로 만든다 (electron:build 스크립트).
 *       CJS로 묶으면 ui.ts의 import.meta.dirname/url이 깨져서(esbuild가 빈 값으로 치환)
 *       ESM 포맷을 유지한다 — srt/package.json의 "type": "module"과도 일치.
 */

import { app, BrowserWindow } from "electron";
import { spawn, type ChildProcess } from "child_process";
import { join } from "path";
import { existsSync } from "fs";
import { startServer, stopMacro } from "../ui.ts";

const PORT = 3001;

// 이 파일(dist-electron/main.mjs)의 부모 = srt/ 워크스페이스 루트.
// ESM 번들이므로 __dirname 대신 import.meta.dirname 사용 (ui.ts와 동일 관례).
//
// 여기서 "asar 내부 경로"와 "실제 OS 파일시스템 경로"를 반드시 구분해야 한다:
// - 파일 "읽기"(fs.readFileSync 등)는 Electron이 patch한 fs 덕에 asar 내부 경로를
//   투명하게 읽을 수 있다 (ui/dist는 asarUnpack 대상이 아니라 asar 안에 그대로 있음).
// - 하지만 child_process.spawn의 cwd나 실행 파일 경로는 OS 레벨 동작이라 asar를
//   전혀 이해 못 한다 — asar "파일 자체"를 cwd로 쓰면 ENOTDIR로 죽는다.
//
// BUNDLE_DIR: 읽기 전용 asar 상대경로 (ui/dist 찾기용) — 패키징 여부 무관하게
//   import.meta.dirname 그대로 사용해도 안전 (파일 읽기는 asar 투명 지원).
const BUNDLE_DIR = join(import.meta.dirname, "..");

// SRT_ROOT: spawn(cwd)처럼 진짜 OS 파일시스템 경로가 필요한 곳.
// 개발 모드(비패키징): BUNDLE_DIR 그대로(= srt/, 실제 디렉토리).
// 패키징 모드: asarUnpack("dist-electron/macro.mjs","node_modules/**/*")로 언팩된 실제
//   파일이 Contents/Resources/app.asar.unpacked/ 아래에 있다 — 이게 진짜 SRT_ROOT다.
const SRT_ROOT = app.isPackaged
  ? join(process.resourcesPath, "app.asar.unpacked")
  : BUNDLE_DIR;

/** Electron 모드 전용 매크로 spawn 전략 — Electron 바이너리를 순수 Node로 재사용해
 *  빌드 시점에 번들된 macro.mjs를 직접 실행한다 (tsx/esbuild 런타임 의존 없음). */
function spawnMacroViaElectronNode(cliArgs: string[]): ChildProcess {
  // macro.mjs는 dist-electron/main.mjs와 항상 같은 디렉토리에 나란히 빌드된다.
  // 패키징 모드: main.mjs는 asar 내부에 있지만 macro.mjs는 asarUnpack 대상이라
  //   실제로는 app.asar.unpacked/dist-electron/ 아래에 존재 — spawn은 asar를
  //   이해 못 하므로 반드시 언팩된 경로를 가리켜야 한다.
  // 개발 모드: import.meta.dirname 자체가 이미 실제 디렉토리(dist-electron/)라
  //   asarUnpack 개념이 필요 없다.
  const macroEntry = app.isPackaged
    ? join(process.resourcesPath, "app.asar.unpacked", "dist-electron", "macro.mjs")
    : join(import.meta.dirname, "macro.mjs");

  return spawn(process.execPath, [macroEntry, ...cliArgs], {
    cwd: SRT_ROOT,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      SRT_DATA_DIR: app.getPath("userData"),
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
}

function createWindow(): void {
  const win = new BrowserWindow({
    width: 1180,
    height: 820,
    title: "SRT 예매 매크로",
    autoHideMenuBar: true,
  });
  win.loadURL(`http://localhost:${PORT}`);
}

app.whenReady().then(() => {
  // 세션 파일 등 로컬 상태 저장 위치 — config.ts가 이 값을 읽어 절대경로로 사용한다.
  process.env.SRT_DATA_DIR = app.getPath("userData");

  // 번들된 Chromium 리소스 — extraResources로 패키징 시 resources/ms-playwright에 위치.
  // 없으면(개발 모드) 시스템 전역 캐시(~/Library/Caches/ms-playwright 등)를 그대로 사용.
  const bundledBrowsersPath = join(process.resourcesPath, "ms-playwright");
  if (existsSync(bundledBrowsersPath)) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = bundledBrowsersPath;
  }

  const server = startServer({
    port: PORT,
    spawnMacro: spawnMacroViaElectronNode,
    openBrowser: false, // Electron이 자체 BrowserWindow로 띄우므로 CLI의 자동 브라우저 오픈은 끔
    // ui.ts가 esbuild로 이 파일과 하나의 번들(dist-electron/main.mjs)로 합쳐지면
    // ui.ts 내부의 import.meta.dirname이 번들 자신의 위치(dist-electron/)를 가리키게 돼
    // 기본 폴백(`<번들위치>/ui/dist`)이 틀어진다 — ui/dist는 asarUnpack 대상이 아니라
    // (읽기 전용이라 asar 내부에 있어도 무방) BUNDLE_DIR(asar 내부 경로) 기준으로 계산한다.
    // SRT_ROOT(언팩 경로)를 쓰면 안 됨 — ui/dist는 거기 존재하지 않는다.
    distDir: join(BUNDLE_DIR, "ui/dist"),
    // Finder에서 더블클릭 실행되면 NODE_ENV 등 터미널 환경변수를 전혀 상속받지 않고,
    // ui.ts는 ESM이라 import 시점에 이미 값이 굳어버려 여기서 process.env를 나중에
    // 설정해도 반영 안 됨 — Electron은 항상 정적 파일 서빙 모드이므로 명시적으로 true.
    isServe: true,
  });

  server.once("listening", createWindow);
});

app.on("before-quit", () => {
  stopMacro();
});

app.on("window-all-closed", () => {
  app.quit();
});
