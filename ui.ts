/**
 * srt/ui.ts — SRT 예매 매크로 서버
 *
 * 개발:     npm run srt-ui       → API 서버(3001) + Vite dev 서버(3002) 동시 실행
 * 배포(웹): npm run srt-ui:build  → React 앱 빌드 (srt/ui/dist/)
 *          npm run srt-ui:serve  → API + 정적 파일 서빙 (3001 단일 서버)
 * 배포(Electron): srt/electron/main.ts가 startServer()를 직접 import해서
 *          같은 프로세스 안에서 API 서버를 구동한다 (자동 브라우저 오픈 없이).
 */

import { createServer, type Server } from "http";
import { spawn, exec, type ChildProcess } from "child_process";
import { EventEmitter } from "events";
import { createReadStream, existsSync, writeFileSync, unlinkSync } from "fs";
import { join, extname } from "path";
import { fileURLToPath } from "url";
import { isDiscordConfigured, sendDiscordTest } from "./discord.ts";
import { saveWebhookUrl } from "./webhookConfig.ts";
import { buildMacroCliArgs, type StartMacroPayload } from "./macroArgs.ts";

const DEFAULT_PORT = 3001;

const MIME: Record<string, string> = {
  ".html": "text/html",
  ".js":   "application/javascript",
  ".css":  "text/css",
  ".svg":  "image/svg+xml",
  ".ico":  "image/x-icon",
};

// ── 매크로 spawn 전략 ─────────────────────────────────────────────────────────
/** CLI 인수 배열(`--dep 수서 --arr 부산 ...`)을 받아 매크로 자식 프로세스를 띄운다. */
export type SpawnMacro = (cliArgs: string[]) => ChildProcess;

/** 기본 전략 — 개발 모드: `npm run srt -- <cliArgs>` (현재까지의 동작과 동일) */
const defaultSpawnMacro: SpawnMacro = (cliArgs) =>
  spawn("npm", ["run", "srt", "--", ...cliArgs], {
    cwd: process.cwd(),
    stdio: ["pipe", "pipe", "pipe"],
  });

export interface StartServerOptions {
  /** API 서버 포트 (기본 3001) */
  port?: number;
  /** 매크로 자식 프로세스 spawn 전략 주입 (Electron 모드에서 tsx 직접 실행으로 교체) */
  spawnMacro?: SpawnMacro;
  /** 서버가 뜨면 자동으로 브라우저를 여는지 (Electron은 자체 BrowserWindow를 쓰므로 false) */
  openBrowser?: boolean;
  /**
   * ui/dist 정적 파일 위치 (절대경로). 미지정 시 `import.meta.dirname/ui/dist`로 폴백 —
   * CLI 단독 실행(tsx ui.ts)에서는 정확하지만, Electron 모드처럼 esbuild가 이 파일을
   * ../electron/main.ts와 하나의 번들로 합치면 import.meta.dirname이 번들 자신의
   * 위치(dist-electron/)를 가리키게 돼 ui/dist를 못 찾는다 — 그 경우 호출부(main.ts)가
   * 정확한 경로를 명시적으로 넘겨야 한다.
   */
  distDir?: string;
  /**
   * 정적 파일 서빙(dist/) 모드 여부. 미지정 시 `NODE_ENV === "production"`으로 폴백 —
   * CLI(`ui:serve`)는 그 값으로 실행되므로 정확하다. 하지만 Electron 앱은 Finder에서
   * 더블클릭 실행되면 터미널 환경변수를 전혀 상속받지 않고, ui.ts는 ESM이라
   * import 시점(정적 import 호이스팅)에 이미 이 값이 평가돼 main.ts가 나중에
   * process.env.NODE_ENV를 설정해도 반영되지 않는다 — 그래서 Electron 모드는
   * 반드시 명시적으로 true를 넘겨야 한다.
   */
  isServe?: boolean;
  /**
   * 실제로 바인딩된 포트를 기록할 파일 경로 (선호 포트가 이미 사용 중이어서
   * listen(0)으로 랜덤 포트에 뜬 경우, vite dev 서버의 프록시가 이 파일을 읽어
   * 실제 포트를 찾아가게 한다). CLI 단독 실행(dev 모드)에서만 지정 — Electron/serve
   * 모드는 단일 서버라 프록시 자체가 없으므로 불필요.
   */
  portFile?: string;
}

// ── 프로세스 상태 ─────────────────────────────────────────────────────────────
let currentProcess: ChildProcess | null = null;
const logEmitter = new EventEmitter();

function broadcast(type: "log" | "status", payload: string) {
  logEmitter.emit("event", { type, payload });
}

function killCurrent() {
  if (!currentProcess) return;
  currentProcess.kill("SIGTERM");
  currentProcess = null;
  broadcast("log", "[UI] 매크로 중지됨");
  broadcast("status", "stopped");
}

/** 실행 중인 매크로 자식 프로세스가 있으면 종료한다 (Electron 종료 시 호출). */
export function stopMacro(): void {
  killCurrent();
}

// ── HTTP API 서버 생성 및 구동 ─────────────────────────────────────────────────
export function startServer(opts: StartServerOptions = {}): Server {
  const PORT = opts.port ?? DEFAULT_PORT;
  const spawnMacro = opts.spawnMacro ?? defaultSpawnMacro;
  const openBrowser = opts.openBrowser ?? true;
  const DIST = opts.distDir ?? join(import.meta.dirname, "ui/dist");
  const IS_SERVE = opts.isServe ?? (process.env.NODE_ENV === "production");

  const server = createServer((req, res) => {
    const path = req.url?.split("?")[0];

    // GET /events → SSE
    if (req.method === "GET" && path === "/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive",
      });
      res.write(": connected\n\n");

      const send = (event: { type: string; payload: string }) => {
        res.write(`data: ${JSON.stringify(event)}\n\n`);
      };
      logEmitter.on("event", send);
      req.on("close", () => logEmitter.off("event", send));
      return;
    }

    // POST /start → 매크로 실행
    if (req.method === "POST" && path === "/start") {
      let body = "";
      req.on("data", c => body += c);
      req.on("end", () => {
        const p = JSON.parse(body) as StartMacroPayload;

        if (currentProcess) killCurrent();

        const cliArgs = buildMacroCliArgs(p);

        broadcast("log", `[UI] 매크로 실행: ${cliArgs.join(" ")}`);

        currentProcess = spawnMacro(cliArgs);
        currentProcess.stdout?.on("data", d => broadcast("log", d.toString().trimEnd()));
        currentProcess.stderr?.on("data", d => broadcast("log", d.toString().trimEnd()));
        currentProcess.on("close", code => {
          broadcast("log", `[UI] 프로세스 종료 (코드: ${code})`);
          broadcast("status", "stopped");
          currentProcess = null;
        });

        broadcast("status", "running");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
      return;
    }

    // POST /stop → 매크로 중지
    if (req.method === "POST" && path === "/stop") {
      killCurrent();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // POST /enter → stdin에 줄바꿈 전송 (waitEnter 응답)
    if (req.method === "POST" && path === "/enter") {
      if (currentProcess?.stdin) currentProcess.stdin.write("\n");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }

    // GET /discord-webhook → 설정 여부만 반환 (URL 값 자체는 응답에 포함하지 않음 — 시크릿 노출 방지)
    if (req.method === "GET" && path === "/discord-webhook") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ configured: isDiscordConfigured() }));
      return;
    }

    // POST /discord-webhook → 웹훅 URL 저장 (빈 문자열이면 설정 해제)
    if (req.method === "POST" && path === "/discord-webhook") {
      let body = "";
      req.on("data", c => body += c);
      req.on("end", () => {
        const { url } = JSON.parse(body) as { url: string };
        saveWebhookUrl(url);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
      return;
    }

    // POST /discord-webhook/test → 저장 여부와 무관하게 현재 입력값으로 즉시 테스트 전송
    if (req.method === "POST" && path === "/discord-webhook/test") {
      let body = "";
      req.on("data", c => body += c);
      req.on("end", async () => {
        const { url } = JSON.parse(body) as { url: string };
        const result = await sendDiscordTest(url);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      });
      return;
    }

    // 배포 모드: dist/ 정적 파일 서빙
    if (IS_SERVE && req.method === "GET") {
      const filePath = path === "/" || !path
        ? join(DIST, "index.html")
        : join(DIST, path);
      if (existsSync(filePath)) {
        const mime = MIME[extname(filePath)] ?? "application/octet-stream";
        res.writeHead(200, { "Content-Type": mime });
        createReadStream(filePath).pipe(res);
        return;
      }
      // SPA fallback: 파일이 없으면 index.html
      res.writeHead(200, { "Content-Type": "text/html" });
      createReadStream(join(DIST, "index.html")).pipe(res);
      return;
    }

    res.writeHead(404);
    res.end();
  });

  // 요청 포트가 이미 사용 중이면 EADDRINUSE로 프로세스 전체가 죽는다(Node 기본 동작) —
  // 선호 포트를 먼저 시도하고, 막혀 있으면 listen(0)으로 OS가 빈 포트를 원자적으로 배정하게 한다.
  server.on("listening", () => {
    const addr = server.address();
    const actualPort = addr && typeof addr === "object" ? addr.port : PORT;
    const openUrl = `http://localhost:${actualPort}`;
    console.log(`[API] ${openUrl}${IS_SERVE ? " (serve 모드)" : ""}`);

    if (opts.portFile) {
      writeFileSync(opts.portFile, String(actualPort));
      const cleanup = () => {
        try { unlinkSync(opts.portFile!); } catch { /* 이미 없으면 무시 */ }
      };
      process.once("exit", cleanup);
      process.once("SIGINT", () => { cleanup(); process.exit(); });
      process.once("SIGTERM", () => { cleanup(); process.exit(); });
    }

    // dev 모드(vite 프록시)는 vite의 server.open이 자체 포트로 여는 걸 담당하므로
    // 여기서는 serve 모드(단일 서버)일 때만 실제 바인딩된 URL을 연다.
    if (openBrowser && IS_SERVE) {
      setTimeout(() => exec(`open ${openUrl}`), 2000);
    }
  });

  server.once("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.log(`[API] 포트 ${PORT} 사용 중 — 빈 포트 자동 배정`);
      server.listen(0);
      return;
    }
    throw err;
  });

  server.listen(PORT);

  return server;
}

// ── CLI 단독 실행일 때만 자동 구동 ────────────────────────────────────────────
// Electron main.ts가 startServer()를 import해서 쓸 땐 이 분기를 타지 않는다.
function isMainModule(): boolean {
  return !!process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
}

if (isMainModule()) {
  startServer({ portFile: join(import.meta.dirname, ".ui-port") });
}
