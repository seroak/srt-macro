/**
 * srt/electron/main.ts — Electron 메인 프로세스
 *
 * 역할: 기존 ui.ts의 HTTP/SSE 서버(startServer)를 같은 프로세스에서 그대로 구동하고,
 * 그 주소(http://localhost:3001)를 바라보는 BrowserWindow를 띄운다.
 * React UI(ui/dist)와 API 서버 코드는 손대지 않고 그대로 재사용한다.
 *
 * 매크로 본체(run_srt.ts 및 SrtSession/BookingFlow/WaitlistFlow 등 의존성 전체)는
 * esbuild로 번들하지 않는다 — Playwright의 driver/bootstrap 스크립트가 번들러와
 * 궁합이 나쁘기로 알려져 있어서, .ts 소스와 node_modules를 패키지에 그대로 포함시키고
 * tsx로 직접 실행한다. Electron 바이너리 자체가 Node를 내장하므로 별도 Node.js 설치
 * 없이 `process.execPath` + `ELECTRON_RUN_AS_NODE=1` 조합으로 자식 프로세스를 띄운다.
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

// SRT_ROOT: spawn(cwd)·run_srt.ts 실행처럼 진짜 OS 파일시스템 경로가 필요한 곳.
// 개발 모드(비패키징): BUNDLE_DIR 그대로(= srt/, 실제 디렉토리).
// 패키징 모드: asarUnpack("*.ts","node_modules/**/*")로 언팩된 실제 파일이
//   Contents/Resources/app.asar.unpacked/ 아래에 있다(run_srt.ts, node_modules 모두
//   같은 레벨) — 이게 진짜 SRT_ROOT다.
const SRT_ROOT = app.isPackaged
  ? join(process.resourcesPath, "app.asar.unpacked")
  : BUNDLE_DIR;

// node_modules 위치: 개발 모드는 모노레포 루트(SRT_ROOT의 부모, 호이스팅),
// 패키징 모드는 electron-builder가 앱 자체 node_modules로 수집하므로 SRT_ROOT와 동일 레벨.
const NODE_MODULES_ROOT = app.isPackaged ? SRT_ROOT : join(SRT_ROOT, "..");

/** Electron 모드 전용 매크로 spawn 전략 — Electron 바이너리를 순수 Node로 재사용해 tsx 실행 */
function spawnMacroViaElectronNode(cliArgs: string[]): ChildProcess {
  const tsxCli = join(NODE_MODULES_ROOT, "node_modules", "tsx", "dist", "cli.mjs");
  const runSrt = join(SRT_ROOT, "run_srt.ts");

  return spawn(process.execPath, [tsxCli, runSrt, ...cliArgs], {
    cwd: SRT_ROOT,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      SRT_DATA_DIR: app.getPath("userData"),
    },
    stdio: ["pipe", "pipe", "pipe"],
  });
}

/**
 * port: 실제로 서버가 바인딩된 포트. 선호 포트(PORT=3001)가 이미 사용 중이면
 * ui.ts의 startServer()가 listen(0)으로 OS 배정 포트에 뜨므로, 하드코딩된 PORT가
 * 아니라 server.address()로 읽은 실제 포트를 열어야 한다 (안 그러면 빈 화면).
 */
function createWindow(port: number): void {
  const win = new BrowserWindow({
    width: 1180,
    height: 820,
    title: "SRT 예매 매크로",
    autoHideMenuBar: true,
  });
  win.loadURL(`http://localhost:${port}`);
}

// 단일 인스턴스 락 — 이미 실행 중인데 또 실행되면(재설치 후 재실행 등) 새 프로세스는
// 즉시 종료하고, 기존 실행 중인 인스턴스가 창을 포커스한다. 이게 없으면 두 프로세스가
// 동시에 API 서버 포트(3001)를 잡으려다 충돌하는 상황이 생긴다(신규 설치와 무관하게도
// 재현 가능했던 문제 — ui.ts의 listen(0) 폴백으로 크래시 자체는 막았지만, 앱을 두 번
// 띄우는 것 자체를 막는 게 사용자 경험상 더 낫다).
const gotLock = app.requestSingleInstanceLock();

if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    const win = BrowserWindow.getAllWindows()[0];
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

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

    server.once("listening", () => {
      const addr = server.address();
      const actualPort = addr && typeof addr === "object" ? addr.port : PORT;
      createWindow(actualPort);
    });
  });

  app.on("before-quit", () => {
    stopMacro();
  });

  app.on("window-all-closed", () => {
    app.quit();
  });
}
