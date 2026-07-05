// electron/main.ts
import { app, BrowserWindow } from "electron";
import { spawn as spawn2 } from "child_process";
import { join as join3 } from "path";
import { existsSync as existsSync4 } from "fs";

// ui.ts
import { createServer } from "http";
import { spawn, exec } from "child_process";
import { EventEmitter } from "events";
import { createReadStream, existsSync as existsSync3 } from "fs";
import { join as join2, extname } from "path";
import { fileURLToPath } from "url";

// discord.ts
import { existsSync as existsSync2, readFileSync as readFileSync2 } from "fs";
import { dirname, resolve } from "path";

// utils.ts
import * as readline from "readline";
var rl = readline.createInterface({ input: process.stdin, output: process.stdout });

// webhookConfig.ts
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";
var SRT_DATA_DIR = process.env.SRT_DATA_DIR;
var WEBHOOK_FILE = SRT_DATA_DIR ? join(SRT_DATA_DIR, "discord_webhook.txt") : "./discord_webhook.txt";
function getSavedWebhookUrl() {
  if (!existsSync(WEBHOOK_FILE)) return void 0;
  try {
    const content = readFileSync(WEBHOOK_FILE, "utf-8").trim();
    return content || void 0;
  } catch {
    return void 0;
  }
}
function saveWebhookUrl(url) {
  const trimmed = url.trim();
  if (!trimmed) {
    if (existsSync(WEBHOOK_FILE)) unlinkSync(WEBHOOK_FILE);
    return;
  }
  writeFileSync(WEBHOOK_FILE, trimmed, "utf-8");
}

// discord.ts
function findEnvFile() {
  const starts = [dirname(new URL(import.meta.url).pathname), process.cwd()];
  for (const start of starts) {
    let dir = start;
    while (true) {
      const candidate = resolve(dir, ".env");
      if (existsSync2(candidate)) return candidate;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return void 0;
}
function loadWebhookUrl() {
  if (process.env.DISCORD_WEBHOOK_URL) return process.env.DISCORD_WEBHOOK_URL;
  const saved = getSavedWebhookUrl();
  if (saved) return saved;
  const envPath = findEnvFile();
  if (!envPath) return void 0;
  try {
    const content = readFileSync2(envPath, "utf-8");
    const match = content.match(/^DISCORD_WEBHOOK_URL=(.+)$/m);
    return match?.[1]?.trim();
  } catch {
    return void 0;
  }
}
function isDiscordConfigured() {
  return !!loadWebhookUrl();
}
function buildPayload(title, body, color) {
  return JSON.stringify({
    username: "SRT \uB9E4\uD06C\uB85C",
    embeds: [
      {
        title,
        description: body,
        color,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      }
    ]
  });
}
async function postWebhook(url, title, body, color) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: buildPayload(title, body, color)
    });
    if (res.ok) return { ok: true };
    return { ok: false, error: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
async function sendDiscordTest(url) {
  return postWebhook(url, "SRT \uB9E4\uD06C\uB85C \u2014 \uD14C\uC2A4\uD2B8 \uC54C\uB9BC", "\uC6F9\uD6C5 \uC5F0\uACB0 \uD14C\uC2A4\uD2B8 \uBA54\uC2DC\uC9C0\uC785\uB2C8\uB2E4.", 5793266);
}

// ui.ts
var DEFAULT_PORT = 3001;
var MIME = {
  ".html": "text/html",
  ".js": "application/javascript",
  ".css": "text/css",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon"
};
var defaultSpawnMacro = (cliArgs) => spawn("npm", ["run", "srt", "--", ...cliArgs], {
  cwd: process.cwd(),
  stdio: ["pipe", "pipe", "pipe"]
});
var currentProcess = null;
var logEmitter = new EventEmitter();
function broadcast(type, payload) {
  logEmitter.emit("event", { type, payload });
}
function killCurrent() {
  if (!currentProcess) return;
  currentProcess.kill("SIGTERM");
  currentProcess = null;
  broadcast("log", "[UI] \uB9E4\uD06C\uB85C \uC911\uC9C0\uB428");
  broadcast("status", "stopped");
}
function stopMacro() {
  killCurrent();
}
function startServer(opts = {}) {
  const PORT2 = opts.port ?? DEFAULT_PORT;
  const spawnMacro = opts.spawnMacro ?? defaultSpawnMacro;
  const openBrowser = opts.openBrowser ?? true;
  const DIST = opts.distDir ?? join2(import.meta.dirname, "ui/dist");
  const IS_SERVE = opts.isServe ?? process.env.NODE_ENV === "production";
  const server = createServer((req, res) => {
    const path = req.url?.split("?")[0];
    if (req.method === "GET" && path === "/events") {
      res.writeHead(200, {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        "Connection": "keep-alive"
      });
      res.write(": connected\n\n");
      const send = (event) => {
        res.write(`data: ${JSON.stringify(event)}

`);
      };
      logEmitter.on("event", send);
      req.on("close", () => logEmitter.off("event", send));
      return;
    }
    if (req.method === "POST" && path === "/start") {
      let body = "";
      req.on("data", (c) => body += c);
      req.on("end", () => {
        const p = JSON.parse(body);
        if (currentProcess) killCurrent();
        const cliArgs = [
          "--dep",
          p.dep,
          "--arr",
          p.arr,
          "--date",
          p.date.replace(/-/g, ""),
          "--time",
          p.time,
          "--from",
          p.from,
          "--to",
          p.to,
          "--seat",
          p.seat
        ];
        if (p.go) cliArgs.push("--go");
        broadcast("log", `[UI] \uB9E4\uD06C\uB85C \uC2E4\uD589: ${cliArgs.join(" ")}`);
        currentProcess = spawnMacro(cliArgs);
        currentProcess.stdout?.on("data", (d) => broadcast("log", d.toString().trimEnd()));
        currentProcess.stderr?.on("data", (d) => broadcast("log", d.toString().trimEnd()));
        currentProcess.on("close", (code) => {
          broadcast("log", `[UI] \uD504\uB85C\uC138\uC2A4 \uC885\uB8CC (\uCF54\uB4DC: ${code})`);
          broadcast("status", "stopped");
          currentProcess = null;
        });
        broadcast("status", "running");
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
      return;
    }
    if (req.method === "POST" && path === "/stop") {
      killCurrent();
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (req.method === "POST" && path === "/enter") {
      if (currentProcess?.stdin) currentProcess.stdin.write("\n");
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ ok: true }));
      return;
    }
    if (req.method === "GET" && path === "/discord-webhook") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ configured: isDiscordConfigured() }));
      return;
    }
    if (req.method === "POST" && path === "/discord-webhook") {
      let body = "";
      req.on("data", (c) => body += c);
      req.on("end", () => {
        const { url } = JSON.parse(body);
        saveWebhookUrl(url);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ ok: true }));
      });
      return;
    }
    if (req.method === "POST" && path === "/discord-webhook/test") {
      let body = "";
      req.on("data", (c) => body += c);
      req.on("end", async () => {
        const { url } = JSON.parse(body);
        const result = await sendDiscordTest(url);
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify(result));
      });
      return;
    }
    if (IS_SERVE && req.method === "GET") {
      const filePath = path === "/" || !path ? join2(DIST, "index.html") : join2(DIST, path);
      if (existsSync3(filePath)) {
        const mime = MIME[extname(filePath)] ?? "application/octet-stream";
        res.writeHead(200, { "Content-Type": mime });
        createReadStream(filePath).pipe(res);
        return;
      }
      res.writeHead(200, { "Content-Type": "text/html" });
      createReadStream(join2(DIST, "index.html")).pipe(res);
      return;
    }
    res.writeHead(404);
    res.end();
  });
  server.listen(PORT2, () => {
    const openUrl = `http://localhost:${PORT2}`;
    console.log(`[API] ${openUrl}${IS_SERVE ? " (serve \uBAA8\uB4DC)" : ""}`);
    if (openBrowser) {
      setTimeout(() => exec(`open ${IS_SERVE ? openUrl : "http://localhost:3002"}`), 2e3);
    }
  });
  return server;
}
function isMainModule() {
  return !!process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
}
if (isMainModule()) {
  startServer();
}

// electron/main.ts
var PORT = 3001;
var BUNDLE_DIR = join3(import.meta.dirname, "..");
var SRT_ROOT = app.isPackaged ? join3(process.resourcesPath, "app.asar.unpacked") : BUNDLE_DIR;
var NODE_MODULES_ROOT = app.isPackaged ? SRT_ROOT : join3(SRT_ROOT, "..");
function spawnMacroViaElectronNode(cliArgs) {
  const tsxCli = join3(NODE_MODULES_ROOT, "node_modules", "tsx", "dist", "cli.mjs");
  const runSrt = join3(SRT_ROOT, "run_srt.ts");
  return spawn2(process.execPath, [tsxCli, runSrt, ...cliArgs], {
    cwd: SRT_ROOT,
    env: {
      ...process.env,
      ELECTRON_RUN_AS_NODE: "1",
      SRT_DATA_DIR: app.getPath("userData")
    },
    stdio: ["pipe", "pipe", "pipe"]
  });
}
function createWindow() {
  const win = new BrowserWindow({
    width: 1180,
    height: 820,
    title: "SRT \uC608\uB9E4 \uB9E4\uD06C\uB85C",
    autoHideMenuBar: true
  });
  win.loadURL(`http://localhost:${PORT}`);
}
app.whenReady().then(() => {
  process.env.SRT_DATA_DIR = app.getPath("userData");
  const bundledBrowsersPath = join3(process.resourcesPath, "ms-playwright");
  if (existsSync4(bundledBrowsersPath)) {
    process.env.PLAYWRIGHT_BROWSERS_PATH = bundledBrowsersPath;
  }
  const server = startServer({
    port: PORT,
    spawnMacro: spawnMacroViaElectronNode,
    openBrowser: false,
    // Electron이 자체 BrowserWindow로 띄우므로 CLI의 자동 브라우저 오픈은 끔
    // ui.ts가 esbuild로 이 파일과 하나의 번들(dist-electron/main.mjs)로 합쳐지면
    // ui.ts 내부의 import.meta.dirname이 번들 자신의 위치(dist-electron/)를 가리키게 돼
    // 기본 폴백(`<번들위치>/ui/dist`)이 틀어진다 — ui/dist는 asarUnpack 대상이 아니라
    // (읽기 전용이라 asar 내부에 있어도 무방) BUNDLE_DIR(asar 내부 경로) 기준으로 계산한다.
    // SRT_ROOT(언팩 경로)를 쓰면 안 됨 — ui/dist는 거기 존재하지 않는다.
    distDir: join3(BUNDLE_DIR, "ui/dist"),
    // Finder에서 더블클릭 실행되면 NODE_ENV 등 터미널 환경변수를 전혀 상속받지 않고,
    // ui.ts는 ESM이라 import 시점에 이미 값이 굳어버려 여기서 process.env를 나중에
    // 설정해도 반영 안 됨 — Electron은 항상 정적 파일 서빙 모드이므로 명시적으로 true.
    isServe: true
  });
  server.once("listening", createWindow);
});
app.on("before-quit", () => {
  stopMacro();
});
app.on("window-all-closed", () => {
  app.quit();
});
