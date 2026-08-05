/**
 * srt/ui.test.ts — startServer() 포트 자동 폴백 검증
 *
 * 실행: npm test (node --test)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { createServer, request as httpRequest, type Server } from "http";
import { EventEmitter } from "events";
import type { ChildProcess } from "child_process";
import { startServer, type SpawnMacro } from "../ui.ts";

/**
 * tsx 4.22.4 + Node v25.2.1 조합에서 http.Server를 만들고 close()한 뒤에도
 * 내부 Socket 핸들이 이벤트 루프에서 해제되지 않아 이 파일의 모든 테스트가
 * 통과한 뒤에도 프로세스가 종료되지 않는 현상이 있다(2026-08-05 확인).
 *
 * 격리된 최소 재현으로 검증한 사실:
 *  - HTTP 요청을 한 번도 안 보내고 server.listen()+close()만 해도 재현된다
 *    (연결/keep-alive 소켓과 무관 — 이 파일의 request() 헬퍼가 이미 처리한
 *    undici 이슈와는 다른 원인).
 *  - `node --experimental-strip-types`(tsx 없이 네이티브 타입 스트리핑)로
 *    똑같은 재현 스크립트를 돌리면 동일하게 핸들이 잠깐 남지만 이후 event
 *    loop tick에서 정상 해제되어 프로세스가 종료된다 — tsx 아래에서만 그
 *    해제가 영영 일어나지 않는다.
 * 즉 startServer()/ui.ts의 결함이 아니라 tsx 로더가 이 Node 버전에서 해당
 * 핸들의 자연 해제를 막는 도구 계층 이슈로 판단한다. 프로덕션 실행(장기
 * 구동 서버)에는 영향이 없다.
 *
 * 해결: `after(() => process.exit(...))` 훅으로 직접 강제 종료를 시도했으나
 * node:test의 루트 after 훅이 마지막 describe의 비동기 테스트가 시작되기도
 * 전에 실행돼 그 테스트를 통째로 건너뛰는(실행조차 안 되는) 회귀가 재현됐다
 * (3회 재현, 매번 5개 중 마지막 1개 누락 — 테스트를 조용히 안 도는 것은
 * 프로세스가 안 끝나는 것보다 위험하다). 대신 Node 코어가 이 정확한 실패
 * 유형("테스트는 다 통과했는데 핸들 누수로 프로세스가 안 끝남")을 위해 제공하는
 * `--test-force-exit` CLI 플래그를 쓴다 — 모든 테스트가 실제로 다 실행되고
 * 리포터가 결과를 flush한 뒤에만 강제 종료하므로 커버리지 손실이 없다.
 * package.json의 test/test:browser 스크립트가 이 플래그를 전달한다.
 */

function onceListening(server: Server): Promise<void> {
  return new Promise((resolve) => server.once("listening", resolve));
}

function boundPort(server: Server): number {
  const addr = server.address();
  if (!addr || typeof addr === "string") throw new Error("서버가 소켓에 바인딩되지 않음");
  return addr.port;
}

/**
 * 전역 fetch(undici)는 응답을 받아도 keep-alive 소켓을 커넥션 풀에 남겨둬 —
 * node:test 프로세스가 이 파일의 마지막 테스트 이후 자연 종료되지 못하고 걸리는
 * 원인이었다(직접 재현 확인). agent:false + Connection: close로 매 요청마다
 * 소켓을 즉시 닫는 최소 HTTP 클라이언트로 대체한다.
 */
function request(
  port: number,
  method: string,
  path: string,
  body?: string,
): Promise<{ status: number; text: string }> {
  return new Promise((resolve, reject) => {
    const req = httpRequest(
      {
        hostname: "localhost",
        port,
        path,
        method,
        agent: false,
        headers: {
          Connection: "close",
          ...(body ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(body) } : {}),
        },
      },
      (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, text: data }));
      },
    );
    req.on("error", reject);
    if (body) req.write(body);
    req.end();
  });
}

/** ui.ts가 실제로 쓰는 ChildProcess 표면(stdout/stderr/on("close")/kill/stdin)만 흉내낸 페이크 */
class FakeChild extends EventEmitter {
  stdout = new EventEmitter();
  stderr = new EventEmitter();
  stdin = { write: (_msg: string) => {} };
  killed = false;
  kill(_signal?: string) {
    this.killed = true;
  }
}

const START_PAYLOAD = JSON.stringify({
  dep: "수서", arr: "부산", date: "2026-08-10", time: "06",
  targetTime: "06:00", targetEndTime: "23:59", seat: "일반실", go: false,
});

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

describe("/start 프로세스 교체 레이스", () => {
  it("옛 프로세스의 지연된 close 이벤트가 새로 시작한 프로세스를 대신 죽이지 않는다", async () => {
    const port = 34563;
    const children: FakeChild[] = [];
    const spawnMacro: SpawnMacro = () => {
      const child = new FakeChild();
      children.push(child);
      return child as unknown as ChildProcess;
    };
    const server = startServer({ port, openBrowser: false, spawnMacro });
    await onceListening(server);

    const start = () => request(port, "POST", "/start", START_PAYLOAD);

    await start();
    await start(); // 내부적으로 killCurrent() → children[0].kill() 호출, currentProcess = children[1]

    assert.equal(children.length, 2);
    assert.equal(children[0].killed, true);

    // children[0]의 실제 프로세스 종료(close)가 뒤늦게 도착하는 상황을 재현
    children[0].emit("close", 0);

    // 레이스가 있으면 위 close 핸들러가 currentProcess를 null로 덮어써서
    // 아래 /stop이 children[1]을 죽이지 못한다.
    await request(port, "POST", "/stop");
    assert.equal(
      children[1].killed,
      true,
      "옛 프로세스의 지연된 close가 currentProcess를 덮어써 새 프로세스를 못 죽임",
    );

    server.close();
  });
});

describe("HTTP 핸들러 크래시 내성", () => {
  it("잘못된 JSON 본문이 와도 서버가 죽지 않고 400을 반환한다", async () => {
    const port = 34564;
    const server = startServer({ port, openBrowser: false });
    await onceListening(server);

    const res = await request(port, "POST", "/start", "이건 JSON이 아님");
    assert.equal(res.status, 400);

    // 서버가 살아있는지 후속 요청으로 확인
    const health = await request(port, "GET", "/discord-webhook");
    assert.equal(health.status, 200);

    server.close();
  });

  it("/discord-webhook 저장 요청도 잘못된 JSON이면 400을 반환한다", async () => {
    const port = 34565;
    const server = startServer({ port, openBrowser: false });
    await onceListening(server);

    const res = await request(port, "POST", "/discord-webhook", "{잘못된 JSON");
    assert.equal(res.status, 400);

    server.close();
  });
});
