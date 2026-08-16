/**
 * srt/tests/scheduleRace.browser.test.ts — "결과 로드 완료" 판정 경합 오프라인 재현
 *
 * 배경: 라이브 사이트에서 findTargetTrain()/collectScheduleDiagnostics()가 같은 페이지·같은
 * 순간에도 hidden input(trnNo[i])을 10개 찾거나 0개 찾는 비결정적 현상이 관찰됐다. 동시에
 * page.content()에는 그 hidden input이 텍스트로 존재하는 모순도 확인됐다.
 *
 * 근본원인 가설: 결과 페이지(srt/capture/96-result-20260902-06-all-ktx.html, 라이브 캡처)에서
 * <table><tbody><tr>가 hidden input trnNo[0]보다 문서 순서상 먼저 나온다 — 브라우저는 <tr> 여는
 * 태그가 파싱되는 즉시 그 요소를 DOM에 추가하고(자식이 아직 파싱 안 됐어도)
 * querySelectorAll("table tbody tr")이 매칭시킬 수 있는 반면, trnNo[0] input은 그 <tr> 안의
 * 자식이라 조금 더 걸려야 파싱된다. SrtSession.searchTrains()/requery()/goNextPage()가 지금
 * "결과 로드 완료" 판정으로 쓰는 waitForSelector("table tbody tr")은 바로 이 틈을 파고들어
 * 조기 통과할 수 있다 — 즉 실제 사이트의 비결정성은 안티봇 방어가 아니라 파싱 도중 상태를
 * 붙잡는 경합일 가능성이 높다.
 *
 * 이 틈을 실제 네트워크 스트리밍(로컬 HTTP 서버가 <tr> 직후 지점에서 응답을 끊어 지연 전송)으로
 * 재현한다. 서브 리소스(스크립트/CSS 등)는 즉시 204로 응답해 파싱 지연에 섞여들지 않게 한다
 * (최초 시도에서 서브 리소스를 방치했더니 그것들이 <head> 파싱을 막아 결과가 오염됐던 경험 반영).
 * 외부 네트워크 접근 없음.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { createServer, type Server } from "node:http";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { chromium, type Browser, type Page } from "playwright";
import { collectScheduleDiagnostics } from "../src/core/scheduleDiagnostics.ts";
import { isScheduleSettled } from "../src/core/scheduleReady.ts";

const FIXTURE_PATH = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../capture/96-result-20260902-06-all-ktx.html",
);
const FIXTURE = readFileSync(FIXTURE_PATH, "utf-8");

/** trnNo[0] 바로 앞의 <tr> 여는 태그 닫힘 위치(문자 인덱스) — 이 직후에서 응답을 끊는다 */
function findSplitPoint(): number {
  const trnIdx = FIXTURE.indexOf('name="trnNo[0]"');
  if (trnIdx === -1) throw new Error("fixture에서 trnNo[0]를 찾지 못함 — 캡처 파일이 바뀌었는지 확인");
  const trOpenIdx = FIXTURE.lastIndexOf("<tr", trnIdx);
  const trCloseIdx = FIXTURE.indexOf(">", trOpenIdx);
  if (trOpenIdx === -1 || trCloseIdx === -1) throw new Error("trnNo[0] 앞의 <tr> 여는 태그를 못 찾음");
  return trCloseIdx + 1;
}

const SPLIT_AT = findSplitPoint();
const STREAM_DELAY_MS = 400;

let browser: Browser;
let page: Page;
let server: Server;

/**
 * 루트 문서만 SPLIT_AT까지 즉시 쓰고 STREAM_DELAY_MS 뒤 나머지를 전송한다.
 * 그 외 모든 서브 리소스 요청은 즉시 204로 응답해 파싱 지연에 섞이지 않게 한다.
 */
function startStreamingServer(): Promise<{ server: Server; baseUrl: string }> {
  const srv = createServer((req, res) => {
    if (req.url !== "/") {
      res.writeHead(204);
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.write(FIXTURE.slice(0, SPLIT_AT));
    setTimeout(() => res.end(FIXTURE.slice(SPLIT_AT)), STREAM_DELAY_MS);
  });
  return new Promise((resolve) => {
    srv.listen(0, () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ server: srv, baseUrl: `http://127.0.0.1:${port}/` });
    });
  });
}

/** 전체 응답을 한 번에(지연 없이) 보내는 서버 — R1 기준선용 */
function startInstantServer(): Promise<{ server: Server; baseUrl: string }> {
  const srv = createServer((req, res) => {
    if (req.url !== "/") {
      res.writeHead(204);
      res.end();
      return;
    }
    res.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    res.end(FIXTURE);
  });
  return new Promise((resolve) => {
    srv.listen(0, () => {
      const addr = srv.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      resolve({ server: srv, baseUrl: `http://127.0.0.1:${port}/` });
    });
  });
}

before(async () => {
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
});

after(async () => {
  await page?.close();
  await browser?.close();
});

test("R1 — 완전히 로드된 fixture는 반복 호출해도 항상 10건을 찾는다 (함수·셀렉터 자체는 결백)", async () => {
  const started = await startInstantServer();
  server = started.server;

  await page.goto(started.baseUrl, { waitUntil: "load" });

  for (let i = 0; i < 10; i++) {
    const d = await page.evaluate(collectScheduleDiagnostics);
    assert.equal(d.hiddenRowCount, 10, `호출 ${i}: hiddenRowCount는 항상 10이어야 함`);
  }

  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test("R2/R3 — <tr> 도착 직후·trnNo[0] 도착 전 시점에는 table tbody tr는 매칭되지만 hidden input은 0건이다", async () => {
  const started = await startStreamingServer();
  server = started.server;

  // waitUntil: "commit" — 응답 수신 확정 시점에만 resolve, 파싱 완료(domcontentloaded)를 기다리지 않는다.
  await page.goto(started.baseUrl, { waitUntil: "commit" });

  // 고정 딜레이로 틈새 시점을 추측하지 않고, table tbody tr가 처음 매칭되는 순간까지 짧은
  // 간격으로 폴링해 그 정확한 시점의 hidden input 카운트를 같이 잰다. 전체 응답
  // (STREAM_DELAY_MS) 도착 전에 못 잡으면 재현 실패로 간주한다.
  const deadline = Date.now() + STREAM_DELAY_MS - 50;
  let tableRowCount = 0;
  let hiddenRowCount = -1;
  let partialHtmlLen = 0;
  while (Date.now() < deadline) {
    tableRowCount = await page.evaluate(() => document.querySelectorAll("table tbody tr").length);
    if (tableRowCount > 0) {
      hiddenRowCount = await page.evaluate(
        () => document.querySelectorAll('input[name^="trnNo["]').length,
      );
      partialHtmlLen = await page.evaluate(() => document.documentElement.outerHTML.length);
      break;
    }
  }

  // 나머지 응답이 이어서 도착할 때까지 기다린 뒤 최종 상태를 대조용으로 확인.
  await page.waitForTimeout(STREAM_DELAY_MS + 200);
  const finalHiddenRowCount = await page.evaluate(
    () => document.querySelectorAll('input[name^="trnNo["]').length,
  );

  console.log(
    `[scheduleRace] 틈새 시점 — table tbody tr=${tableRowCount}, trnNo hidden=${hiddenRowCount}, ` +
      `outerHTML.length=${partialHtmlLen} / 최종 trnNo hidden=${finalHiddenRowCount}`,
  );

  // 핵심 주장: 이 틈새에서 table tbody tr는 이미 매칭되는데(현재 판정 기준으로 "로드 완료" 취급),
  // 정작 hidden input은 아직 0건이다 — 이게 재현되면 waitForSelector("table tbody tr")이
  // "결과 로드 완료" 판정으로 부적절하다는 근본원인이 오프라인에서 기계적으로 확정된다.
  assert.ok(tableRowCount > 0, "table tbody tr를 STREAM_DELAY_MS 안에 못 잡음(경합 조건 성립 전제 실패)");
  assert.equal(hiddenRowCount, 0, "trnNo hidden input은 이 시점에 아직 0건이어야 함(경합 재현)");
  assert.equal(finalHiddenRowCount, 10, "전체 응답 수신 후에는 정상적으로 10건이 잡혀야 함");

  await new Promise<void>((resolve) => server.close(() => resolve()));
});

test("R4(회귀) — isScheduleSettled() 기준으로 대기하면 같은 경합 상황에서도 0건을 반환하지 않는다", async () => {
  // SrtSession.waitForScheduleSettled()가 실제로 하는 일(짧은 간격으로 collectScheduleDiagnostics를
  // 재확인하며 isScheduleSettled()를 기다림)을 그대로 재현해, R2/R3가 증명한 경합 시점에도
  // 이 판정 기준을 쓰면 더 이상 hiddenRowCount=0을 잡지 않음을 확인한다.
  const started = await startStreamingServer();
  server = started.server;

  await page.goto(started.baseUrl, { waitUntil: "commit" });

  let diag = await page.evaluate(collectScheduleDiagnostics);
  const deadline = Date.now() + STREAM_DELAY_MS + 1000;
  while (!isScheduleSettled(diag) && Date.now() < deadline) {
    await page.waitForTimeout(20);
    diag = await page.evaluate(collectScheduleDiagnostics);
  }

  assert.ok(isScheduleSettled(diag), `제한 시간 안에 정착 안 됨 (readyState=${diag.readyState})`);
  assert.equal(
    diag.hiddenRowCount,
    10,
    "isScheduleSettled() 기준으로 기다린 뒤에는 hidden input이 항상 10건이어야 함(경합 미재현)",
  );

  await new Promise<void>((resolve) => server.close(() => resolve()));
});
