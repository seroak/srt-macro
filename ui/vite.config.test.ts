import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Readable, Writable } from "node:stream";
import type { IncomingMessage, ServerResponse } from "node:http";
import { apiProxyPlugin } from "./vite.config.ts";

describe("Vite API proxy logging", () => {
  it("does not log successful request headers", async () => {
    const plugin = apiProxyPlugin();
    let middleware: ((req: IncomingMessage, res: ServerResponse, next: () => void) => void) | undefined;

    const configureServer = plugin.configureServer;
    assert.equal(typeof configureServer, "function");
    (configureServer as Function)({
      middlewares: {
        use(fn: typeof middleware) {
          middleware = fn;
        },
      },
    });
    assert.ok(middleware);

    const req = Readable.from([]) as unknown as IncomingMessage;
    req.method = "GET";
    req.url = "/discord-webhook";
    req.headers = { cookie: "session=must-not-appear" };

    let resolveFinished!: () => void;
    const finished = new Promise<void>((resolve) => { resolveFinished = resolve; });
    const res = new Writable({
      write(_chunk, _encoding, callback) { callback(); },
      final(callback) { callback(); resolveFinished(); },
    }) as unknown as ServerResponse;
    res.writeHead = (() => res) as ServerResponse["writeHead"];

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
    const plugin = apiProxyPlugin();
    let middleware: ((req: IncomingMessage, res: ServerResponse, next: () => void) => void) | undefined;

    const configureServer = plugin.configureServer;
    assert.equal(typeof configureServer, "function");
    (configureServer as Function)({
      middlewares: {
        use(fn: typeof middleware) {
          middleware = fn;
        },
      },
    });
    assert.ok(middleware);

    const req = Readable.from([]) as unknown as IncomingMessage;
    req.method = "POST";
    req.url = "/stop";
    req.headers = {};

    let resolveFinished!: () => void;
    const finished = new Promise<void>((resolve) => { resolveFinished = resolve; });
    const res = new Writable({
      write(_chunk, _encoding, callback) { callback(); },
      final(callback) { callback(); resolveFinished(); },
    }) as unknown as ServerResponse;
    res.writeHead = (() => res) as ServerResponse["writeHead"];

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
