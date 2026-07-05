/**
 * srt/ui.test.ts — startServer() 포트 자동 폴백 검증
 *
 * 실행: npm test (node --test)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "http";
import { startServer } from "./ui.ts";

function onceListening(server: Server): Promise<void> {
  return new Promise((resolve) => server.once("listening", resolve));
}

function boundPort(server: Server): number {
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("서버가 소켓에 바인딩되지 않음");
  return addr.port;
}

describe("startServer() 포트 자동 폴백", () => {
  it("요청 포트가 비어있으면 그대로 사용한다", async () => {
    const port = 34561;
    const server = startServer({ port, openBrowser: false });
    await onceListening(server);
    assert.equal(boundPort(server), port);
    server.close();
  });

  it("요청 포트가 사용 중이면 OS가 배정한 다른 빈 포트로 전환한다", async () => {
    const port = 34562;
    const blocker = createServer();
    await new Promise<void>((resolve) => blocker.listen(port, resolve));

    try {
      const server = startServer({ port, openBrowser: false });
      await onceListening(server);
      const actual = boundPort(server);
      // listen(0)으로 OS가 배정하므로 구체적 포트 번호는 예측 불가 —
      // "막힌 포트가 아닌 유효한 포트에 실제로 바인딩됐는지"만 검증한다.
      assert.notEqual(actual, port);
      assert.ok(actual > 0);
      server.close();
    } finally {
      blocker.close();
    }
  });
});
