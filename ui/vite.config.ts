import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "fs";
import { join } from "path";
import { Readable } from "stream";
import type { IncomingMessage } from "http";

// ui.ts가 실제로 바인딩한 포트를 기록하는 파일 — 선호 포트(3001)가 이미 다른 프로세스에
// 점유돼 있으면 ui.ts는 listen(0)으로 랜덤 포트에 뜬다. vite의 내장 server.proxy는
// 설정 시점에 target을 한 번만 고정하고 이 vite 버전의 내부 구현은 동적 재해석을
// 지원하지 않아 — 그래서 미들웨어로 직접 프록시하며 매 요청마다 포트 파일을 다시 읽어
// 실제 API 서버를 따라가게 한다.
//
// Node의 http.request()로 구현했다가 이 Vite 버전의 dev 서버 프로세스 안에서만
// 매 요청이 연결 직후 ECONNRESET("socket hang up")으로 끊기는 걸 확인했다 — 같은
// 백엔드에 순수 node -e 스크립트로 직접 붙으면 정상 응답한다. 원인은 Vite가 이
// 프로세스 안에서 'http' 모듈을 자체적으로 감싸는 것으로 추정되고, 전역 fetch(undici)로
// 우회하면 문제없이 동작한다 — 그래서 http.request 대신 fetch를 사용한다.
const PORT_FILE = join(import.meta.dirname, "../.ui-port");
const DEFAULT_API_PORT = 3001;
const PROXY_PATHS = ["/start", "/stop", "/enter", "/events", "/discord-webhook"];

function resolveApiPort(): number {
  try {
    const port = Number(readFileSync(PORT_FILE, "utf-8").trim());
    if (port > 0) return port;
  } catch {
    // API 서버가 아직 포트 파일을 쓰기 전(콜드스타트) — 기본 포트로 폴백
  }
  return DEFAULT_API_PORT;
}

function collectBody(req: IncomingMessage): Promise<Buffer | undefined> {
  if (req.method === "GET" || req.method === "HEAD") return Promise.resolve(undefined);
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      const buf = Buffer.concat(chunks);
      // 길이 0인 Buffer도 JS에서는 truthy라서, 아래 `body ? ... : ...` 체크가
      // "바디 없는 POST"(예: /stop, /enter)까지 body-present로 오판해 fetch에
      // duplex:"half"를 걸었고, 그 결과 매 요청이 응답 없이 영영 멈추는 버그가 있었다.
      // 실제 데이터가 있을 때만 Buffer를 반환하고, 없으면 undefined로 명시한다.
      resolve(buf.length > 0 ? buf : undefined);
    });
    req.on("error", reject);
  });
}

export function apiProxyPlugin(): Plugin {
  return {
    name: "srt-api-proxy",
    configureServer(server) {
      server.middlewares.use((req, res, next) => {
        const path = req.url?.split("?")[0] ?? "";
        if (!PROXY_PATHS.some(p => path === p || path.startsWith(`${p}/`))) {
          next();
          return;
        }

        const controller = new AbortController();
        req.once("aborted", () => controller.abort());
        res.once("close", () => {
          if (!res.writableEnded) controller.abort();
        });

        (async () => {
          const port = resolveApiPort();
          const body = await collectBody(req);
          const upstream = await fetch(`http://127.0.0.1:${port}${req.url}`, {
            method: req.method,
            headers: body ? { "content-type": req.headers["content-type"] ?? "application/json" } : undefined,
            body,
            signal: controller.signal,
            // @ts-expect-error Node fetch(undici)는 스트리밍 요청 바디에 duplex 지정을 요구한다
            duplex: body ? "half" : undefined,
          });

          res.writeHead(upstream.status, {
            "Content-Type": upstream.headers.get("content-type") ?? "application/octet-stream",
          });

          if (!upstream.body) {
            res.end();
            return;
          }
          const upstreamStream = Readable.fromWeb(upstream.body as never);
          // 클라이언트(SSE EventSource 등)가 먼저 연결을 끊으면 controller.abort()가
          // 이 스트림에 AbortError를 발생시킨다 — 정상적인 종료이므로 그냥 무시한다.
          // 리스너 없이 에러가 나면 Node가 미처리 'error' 이벤트로 프로세스를 죽인다.
          upstreamStream.on("error", err => {
            if (controller.signal.aborted) return;
            console.error("[srt-api-proxy] stream error", err);
          });
          upstreamStream.pipe(res);
        })().catch(err => {
          if (controller.signal.aborted) return;
          res.writeHead(502, { "Content-Type": "text/plain" });
          res.end(`Bad Gateway: ${err.message}`);
        });
      });
    },
  };
}

export default defineConfig({
  plugins: [react(), apiProxyPlugin()],
  root: import.meta.dirname,
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 3002,
    open: true,
  },
});
