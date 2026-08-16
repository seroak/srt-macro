import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { Readable, Writable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { apiProxyPlugin } from "./vite.config.ts";

type Middleware = (req: IncomingMessage, res: ServerResponse, next: () => void) => void;

function setupMiddleware(opts?: { portFile?: string; portWaitMs?: number }): Middleware {
  const plugin = apiProxyPlugin(opts);
  let middleware: Middleware | undefined;
  const configureServer = plugin.configureServer;
  assert.equal(typeof configureServer, "function");
  (configureServer as Function)({
    middlewares: {
      use(fn: Middleware) {
        middleware = fn;
      },
    },
  });
  assert.ok(middleware);
  return middleware!;
}

function fakeRequest(method: string, url: string, headers: Record<string, string> = {}): IncomingMessage {
  const req = Readable.from([]) as unknown as IncomingMessage;
  req.method = method;
  req.url = url;
  req.headers = headers;
  return req;
}

function fakeResponse(): {
  res: ServerResponse;
  finished: Promise<void>;
  writeHeadCalls: Array<[number, unknown]>;
  getBody: () => string;
} {
  let resolveFinished!: () => void;
  const finished = new Promise<void>((resolve) => { resolveFinished = resolve; });
  const writeHeadCalls: Array<[number, unknown]> = [];
  let body = "";
  const res = new Writable({
    write(chunk, _encoding, callback) { body += chunk.toString(); callback(); },
    final(callback) { callback(); resolveFinished(); },
  }) as unknown as ServerResponse;
  res.writeHead = ((status: number, headers?: unknown) => {
    writeHeadCalls.push([status, headers]);
    return res;
  }) as ServerResponse["writeHead"];
  return { res, finished, writeHeadCalls, getBody: () => body };
}

describe("Vite API proxy logging", () => {
  let dir: string;
  let portFile: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "srt-vite-proxy-"));
    portFile = join(dir, ".ui-port");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("does not log successful request headers", async () => {
    writeFileSync(portFile, "3001");
    const middleware = setupMiddleware({ portFile, portWaitMs: 0 });

    const req = fakeRequest("GET", "/discord-webhook", { cookie: "session=must-not-appear" });
    const { res, finished } = fakeResponse();

    const originalFetch = globalThis.fetch;
    const originalLog = console.log;
    const logs: unknown[][] = [];
    globalThis.fetch = async () => new Response('{"configured":false}', {
      status: 200,
      headers: { "content-type": "application/json" },
    });
    console.log = (...args: unknown[]) => { logs.push(args); };

    try {
      middleware(req, res, () => assert.fail("proxy request should not call next()"));
      await finished;
    } finally {
      globalThis.fetch = originalFetch;
      console.log = originalLog;
    }

    assert.deepEqual(logs, []);
  });

  it("forwards an empty-body POST after the request stream closes", async () => {
    writeFileSync(portFile, "3001");
    const middleware = setupMiddleware({ portFile, portWaitMs: 0 });

    const req = fakeRequest("POST", "/stop");
    const { res, finished } = fakeResponse();

    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_input, init) => {
      await new Promise<void>((resolve) => setImmediate(resolve));
      if (init?.signal?.aborted) {
        throw new DOMException("request aborted", "AbortError");
      }
      return new Response('{"ok":true}', {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    try {
      middleware(req, res, () => assert.fail("proxy request should not call next()"));
      await Promise.race([
        finished,
        new Promise<never>((_, reject) => {
          setTimeout(() => reject(new Error("empty-body POST did not finish")), 100);
        }),
      ]);
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});

describe("Vite API proxy — 포트 파일 부재 처리", () => {
  let dir: string;
  let portFile: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "srt-vite-proxy-missing-"));
    portFile = join(dir, ".ui-port");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("포트 파일이 없으면 기본 포트로 폴백하지 않고 503을 반환한다", async () => {
    const middleware = setupMiddleware({ portFile, portWaitMs: 0 });

    const req = fakeRequest("POST", "/stop");
    const { res, finished, writeHeadCalls, getBody } = fakeResponse();

    let fetchCalled = false;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      fetchCalled = true;
      throw new Error("fetch는 호출되면 안 된다");
    };

    try {
      middleware(req, res, () => assert.fail("proxy request should not call next()"));
      await finished;
    } finally {
      globalThis.fetch = originalFetch;
    }

    assert.equal(fetchCalled, false);
    assert.equal(writeHeadCalls[0]?.[0], 503);
    assert.match(getBody(), /\.ui-port/);
  });

  it("포트 파일이 늦게 생기면 대기 후 그 포트로 프록시한다", async () => {
    const middleware = setupMiddleware({ portFile, portWaitMs: 500 });

    setTimeout(() => writeFileSync(portFile, "40123"), 50);

    const req = fakeRequest("POST", "/stop");
    const { res, finished } = fakeResponse();

    let requestedUrl = "";
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (input) => {
      requestedUrl = String(input);
      return new Response('{"ok":true}', {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    try {
      middleware(req, res, () => assert.fail("proxy request should not call next()"));
      await finished;
    } finally {
      globalThis.fetch = originalFetch;
    }

    assert.match(requestedUrl, /127\.0\.0\.1:40123/);
  });

  it("포트 파일 내용이 숫자가 아니면 503을 반환한다", async () => {
    writeFileSync(portFile, "not-a-port");
    const middleware = setupMiddleware({ portFile, portWaitMs: 0 });

    const req = fakeRequest("POST", "/stop");
    const { res, finished, writeHeadCalls } = fakeResponse();

    let fetchCalled = false;
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      fetchCalled = true;
      throw new Error("fetch는 호출되면 안 된다");
    };

    try {
      middleware(req, res, () => assert.fail("proxy request should not call next()"));
      await finished;
    } finally {
      globalThis.fetch = originalFetch;
    }

    assert.equal(fetchCalled, false);
    assert.equal(writeHeadCalls[0]?.[0], 503);
  });
});
