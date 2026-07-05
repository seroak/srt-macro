/**
 * srt/trainSelect.browser.test.ts — selectTargetTrain() DOM 파싱 검증
 *
 * etk.srail.kr 결과 테이블 구조를 흉내낸 fixture HTML을 헤드리스 브라우저에 로드하고
 * page.evaluate(selectTargetTrain, opts)로 직렬화 실행해 검증한다.
 * fds/inject.browser.test.ts와 동일한 패턴 (실 사이트 접속 없이 실제 Playwright 계약 검증).
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium, type Browser, type Page } from "playwright";
import { selectTargetTrain, type SeatSelectOpts } from "./trainSelect.ts";

let browser: Browser;
let page: Page;

/** 결과 테이블 한 행(row) HTML 생성. specialCell=td[5](특실), generalCell=td[6](일반실/입석) */
function row(trainNo: string, depTime: string, arrTime: string, specialCell: string, generalCell: string): string {
  return `<tr>
    <td>0</td><td>SRT</td>
    <td>${trainNo}</td>
    <td><em class="time">${depTime}</em></td>
    <td><em class="time">${arrTime}</em></td>
    <td>${specialCell}</td>
    <td>${generalCell}</td>
  </tr>`;
}

const SOLD_OUT = "매진";
const RESERVE_BTN = (label = "예약하기") => `<a onclick="requestReservationInfo(1,2)">${label}</a>`;
const STANDING_BTN = (label = "입석+좌석 예약") => `<a onclick="requestReservationInfoAnn(1,2)">${label}</a>`;
const WAITLIST_BTN = () => `<a onclick="doSomething()">예약대기</a>`;

async function loadRows(rowsHtml: string[]): Promise<void> {
  await page.setContent(`<!DOCTYPE html><html><body>
    <table><tbody>${rowsHtml.join("\n")}</tbody></table>
  </body></html>`);
}

function select(opts: SeatSelectOpts) {
  return page.evaluate(selectTargetTrain, opts);
}

before(async () => {
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
});

after(async () => {
  await browser?.close();
});

test("일반실 취소표 발견 → seatAvailable=true, matchedSeat=일반실", async () => {
  await loadRows([row("101", "07:00", "09:00", SOLD_OUT, RESERVE_BTN())]);
  const result = await select({ seatClasses: ["일반실"] });
  assert.ok(result);
  assert.equal(result!.seatAvailable, true);
  assert.equal(result!.matchedSeat, "일반실");
  assert.equal(result!.trainNo, "101");
});

test("일반실 매진 + 특실 취소표 → matchedSeat=특실", async () => {
  await loadRows([row("102", "07:10", "09:10", RESERVE_BTN(), SOLD_OUT)]);
  const result = await select({ seatClasses: ["일반실", "특실"] });
  assert.ok(result);
  assert.equal(result!.seatAvailable, true);
  assert.equal(result!.matchedSeat, "특실");
});

test("일반실+특실 둘 다 취소표 → 우선순위상 앞 등급(일반실) 채택", async () => {
  await loadRows([row("103", "07:20", "09:20", RESERVE_BTN(), RESERVE_BTN())]);
  const result = await select({ seatClasses: ["일반실", "특실"] });
  assert.ok(result);
  assert.equal(result!.matchedSeat, "일반실");
});

test("입석+좌석 취소표(requestReservationInfoAnn) 감지 → matchedSeat=입석+좌석", async () => {
  await loadRows([row("104", "07:30", "09:30", SOLD_OUT, STANDING_BTN())]);
  const result = await select({ seatClasses: ["입석+좌석"] });
  assert.ok(result);
  assert.equal(result!.seatAvailable, true);
  assert.equal(result!.matchedSeat, "입석+좌석");
});

test("여러 열차 중 가장 이른(첫) 잔여석 열차를 선택하고 candidateCount를 집계한다", async () => {
  await loadRows([
    row("105", "05:00", "05:30", SOLD_OUT, SOLD_OUT), // 매진
    row("106", "07:00", "09:00", SOLD_OUT, RESERVE_BTN()), // 잔여석 — 이 열차가 선택돼야 함
    row("107", "20:00", "22:00", SOLD_OUT, RESERVE_BTN()), // 더 늦지만 역시 잔여석
  ]);
  const result = await select({ seatClasses: ["일반실"] });
  assert.ok(result);
  assert.equal(result!.trainNo, "106");
  assert.equal(result!.candidateCount, 2);
});

test("전부 매진 + 예약대기 버튼 → seatAvailable=false, waitlistAvailable=true", async () => {
  await loadRows([row("108", "07:40", "09:40", SOLD_OUT, WAITLIST_BTN())]);
  const result = await select({ seatClasses: ["일반실"] });
  assert.ok(result);
  assert.equal(result!.seatAvailable, false);
  assert.equal(result!.waitlistAvailable, true);
  assert.equal(result!.matchedSeat, "일반실");
});

test("전 열차 매진이면 seatAvailable=false로 첫 열차 정보를 반환한다", async () => {
  await loadRows([
    row("109", "05:00", "05:30", SOLD_OUT, SOLD_OUT),
    row("110", "06:00", "06:30", SOLD_OUT, SOLD_OUT),
  ]);
  const result = await select({ seatClasses: ["일반실"] });
  assert.ok(result);
  assert.equal(result!.trainNo, "109");
  assert.equal(result!.seatAvailable, false);
  assert.equal(result!.candidateCount, 2);
});

test("결과 테이블에 행이 없으면 null 반환", async () => {
  await loadRows([]);
  const result = await select({ seatClasses: ["일반실"] });
  assert.equal(result, null);
});
