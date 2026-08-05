/**
 * srt/trainSelect.browser.test.ts — selectTargetTrain() DOM 파싱 검증
 *
 * etk.srail.kr 결과 테이블 구조를 흉내낸 fixture HTML을 헤드리스 브라우저에 로드하고
 * page.evaluate(selectTargetTrain, opts)로 직렬화 실행해 검증한다.
 * fds/inject.browser.test.ts와 동일한 패턴 (실 사이트 접속 없이 실제 Playwright 계약 검증).
 *
 * fixture는 2026-08-05 SRT+KTX 통합 이후 실제 라이브 캡처
 * (srt/capture/96-result-20260902-06-all-ktx.html)에서 확인된 필드명·버튼 id를 그대로 쓴다:
 * hidden input `trnNo[i]`/`dptTm[i]`/`arvTm[i]`/`trnGpNm[i]`, 버튼 id `genRsvBtn{i}`/`speRsvBtn{i}`,
 * KTX 교차판매 onclick `showKorailBookingChoice(...)`.
 * 단, 그 캡처엔 SRT 직영 열차·예약대기·입석 표본이 없어 `requestReservationInfo`/
 * `requestReservationInfoAnn`/`requestReservationWait` 온클릭은 사이트 정적 JS 원문(직접 확인한
 * 실제 함수명)을 근거로 재구성했다 — 값 조합 자체는 시나리오 구성용.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium, type Browser, type Page } from "playwright";
import { selectTargetTrain, type SeatSelectOpts } from "../src/core/trainSelect.ts";

let browser: Browser;
let page: Page;

function hidden(name: string, i: number, value: string): string {
  return `<input type="hidden" name="${name}[${i}]" value="${value}">`;
}

/** 결과 테이블 한 행(row) HTML 생성 — 실측 구조: hidden input 셀 + 특실 버튼 셀 + 일반실 버튼 셀 */
function row(
  i: number,
  trainNo: string,
  depTime: string,
  arrTime: string,
  speButton: string,
  genButton: string,
  gpNm = "SRT",
): string {
  const dep6 = depTime.replace(":", "") + "00";
  const arr6 = arrTime.replace(":", "") + "00";
  return `<tr>
    <td>직통</td>
    <td class="trnGp">${gpNm}</td>
    <td>
      ${hidden("trnNo", i, trainNo)}
      ${hidden("dptTm", i, dep6)}
      ${hidden("arvTm", i, arr6)}
      ${hidden("trnGpNm", i, gpNm)}
      ${hidden("rsvPsbFlg", i, "Y")}
      ${hidden("gnrmRsvPsbFlg", i, "Y")}
    </td>
    <td><em class="time">${depTime}</em></td>
    <td><em class="time">${arrTime}</em></td>
    <td>${speButton}</td>
    <td>${genButton}</td>
  </tr>`;
}

const SOLD_OUT = "매진";
const RESERVE_GEN = (i: number, label = "예약하기") =>
  `<a id="genRsvBtn${i}" onclick="requestReservationInfo(1,2)">${label}</a>`;
const RESERVE_SPE = (i: number, label = "예약하기") =>
  `<a id="speRsvBtn${i}" onclick="requestReservationInfo(1,2)">${label}</a>`;
const STANDING_BTN = (i: number, label = "입석+좌석 예약") =>
  `<a id="genRsvBtn${i}" onclick="requestReservationInfoAnn(1,2)">${label}</a>`;
const WAITLIST_BTN = (i: number) => `<a id="genRsvBtn${i}" onclick="requestReservationWait(1,2)">예약대기</a>`;
const KTX_GEN_BTN = (i: number) =>
  `<a id="genRsvBtn${i}" onclick="showKorailBookingChoice(${i},1,'reserve','1','07','0A')">예약하기</a>`;
const KTX_SPE_BTN = (i: number) =>
  `<a id="speRsvBtn${i}" onclick="showKorailBookingChoice(${i},2,'reserve','1','07','0A')">예약하기</a>`;

async function loadRows(rowsHtml: string[]): Promise<void> {
  await page.setContent(`<!DOCTYPE html><html><body>
    <table><tbody>${rowsHtml.join("\n")}</tbody></table>
  </body></html>`);
}

function select(
  opts: Omit<SeatSelectOpts, "maxDepTime"> & { maxDepTime?: string },
) {
  return page.evaluate(selectTargetTrain, {
    ...opts,
    maxDepTime: opts.maxDepTime ?? "23:59",
  });
}

before(async () => {
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
});

after(async () => {
  await browser?.close();
});

test("일반실 취소표 발견 → seatAvailable=true, matchedSeat=일반실", async () => {
  await loadRows([row(0, "101", "07:00", "09:00", SOLD_OUT, RESERVE_GEN(0))]);
  const result = await select({ seatClasses: ["일반실"], minDepTime: "00:00" });
  assert.ok(result);
  assert.equal(result!.seatAvailable, true);
  assert.equal(result!.matchedSeat, "일반실");
  assert.equal(result!.trainNo, "101");
});

test("일반실 매진 + 특실 취소표 → matchedSeat=특실", async () => {
  await loadRows([row(0, "102", "07:10", "09:10", RESERVE_SPE(0), SOLD_OUT)]);
  const result = await select({ seatClasses: ["일반실", "특실"], minDepTime: "00:00" });
  assert.ok(result);
  assert.equal(result!.seatAvailable, true);
  assert.equal(result!.matchedSeat, "특실");
});

test("일반실+특실 둘 다 취소표 → 우선순위상 앞 등급(일반실) 채택", async () => {
  await loadRows([row(0, "103", "07:20", "09:20", RESERVE_SPE(0), RESERVE_GEN(0))]);
  const result = await select({ seatClasses: ["일반실", "특실"], minDepTime: "00:00" });
  assert.ok(result);
  assert.equal(result!.matchedSeat, "일반실");
});

test("입석+좌석 취소표(requestReservationInfoAnn) 감지 → matchedSeat=입석+좌석", async () => {
  await loadRows([row(0, "104", "07:30", "09:30", SOLD_OUT, STANDING_BTN(0))]);
  const result = await select({ seatClasses: ["입석+좌석"], minDepTime: "00:00" });
  assert.ok(result);
  assert.equal(result!.seatAvailable, true);
  assert.equal(result!.matchedSeat, "입석+좌석");
});

test("여러 열차 중 가장 이른(첫) 잔여석 열차를 선택하고 candidateCount를 집계한다", async () => {
  await loadRows([
    row(0, "105", "05:00", "05:30", SOLD_OUT, SOLD_OUT), // 매진
    row(1, "106", "07:00", "09:00", SOLD_OUT, RESERVE_GEN(1)), // 잔여석 — 이 열차가 선택돼야 함
    row(2, "107", "20:00", "22:00", SOLD_OUT, RESERVE_GEN(2)), // 더 늦지만 역시 잔여석
  ]);
  const result = await select({ seatClasses: ["일반실"], minDepTime: "00:00" });
  assert.ok(result);
  assert.equal(result!.trainNo, "106");
  assert.equal(result!.candidateCount, 2);
});

test("전부 매진 + 예약대기 버튼(requestReservationWait) → seatAvailable=false, waitlistAvailable=true", async () => {
  await loadRows([row(0, "108", "07:40", "09:40", SOLD_OUT, WAITLIST_BTN(0))]);
  const result = await select({ seatClasses: ["일반실"], minDepTime: "00:00" });
  assert.ok(result);
  assert.equal(result!.seatAvailable, false);
  assert.equal(result!.waitlistAvailable, true);
  assert.equal(result!.matchedSeat, "일반실");
});

test("전 열차 매진이면 seatAvailable=false로 첫 열차 정보를 반환한다", async () => {
  await loadRows([
    row(0, "109", "05:00", "05:30", SOLD_OUT, SOLD_OUT),
    row(1, "110", "06:00", "06:30", SOLD_OUT, SOLD_OUT),
  ]);
  const result = await select({ seatClasses: ["일반실"], minDepTime: "00:00" });
  assert.ok(result);
  assert.equal(result!.trainNo, "109");
  assert.equal(result!.seatAvailable, false);
  assert.equal(result!.candidateCount, 2);
});

test("결과 테이블에 행이 없으면 null 반환", async () => {
  await loadRows([]);
  const result = await select({ seatClasses: ["일반실"], minDepTime: "00:00" });
  assert.equal(result, null);
});

test("탐색 시작 시각보다 이른 열차는 제외하고 경계 시각은 포함한다", async () => {
  await loadRows([
    row(0, "201", "14:59", "16:00", SOLD_OUT, RESERVE_GEN(0)),
    row(1, "202", "15:00", "17:00", SOLD_OUT, RESERVE_GEN(1)),
  ]);
  const result = await select({ seatClasses: ["일반실"], minDepTime: "15:00" });
  assert.ok(result);
  assert.equal(result!.trainNo, "202");
  assert.equal(result!.candidateCount, 1);
});

test("필터 이후 가장 이른 잔여석 열차와 후보 수를 반환한다", async () => {
  await loadRows([
    row(0, "203", "14:30", "16:00", SOLD_OUT, SOLD_OUT),
    row(1, "204", "15:00", "17:00", SOLD_OUT, SOLD_OUT),
    row(2, "205", "15:20", "17:20", SOLD_OUT, RESERVE_GEN(2)),
    row(3, "206", "16:00", "18:00", SOLD_OUT, RESERVE_GEN(3)),
  ]);
  const result = await select({ seatClasses: ["일반실"], minDepTime: "15:00" });
  assert.ok(result);
  assert.equal(result!.trainNo, "205");
  assert.equal(result!.candidateCount, 2);
});

test("필터 이후 전부 매진이면 첫 후보와 필터된 후보 수를 반환한다", async () => {
  await loadRows([
    row(0, "207", "14:50", "16:00", SOLD_OUT, SOLD_OUT),
    row(1, "208", "15:10", "17:00", SOLD_OUT, SOLD_OUT),
    row(2, "209", "15:40", "17:40", SOLD_OUT, SOLD_OUT),
  ]);
  const result = await select({ seatClasses: ["일반실"], minDepTime: "15:00" });
  assert.ok(result);
  assert.equal(result!.trainNo, "208");
  assert.equal(result!.candidateCount, 2);
});

test("탐색 시작 시각 이후 예약대기 가능한 열차를 우선 반환한다", async () => {
  await loadRows([
    row(0, "210", "14:50", "16:00", SOLD_OUT, WAITLIST_BTN(0)),
    row(1, "211", "15:10", "17:00", SOLD_OUT, SOLD_OUT),
    row(2, "212", "15:40", "17:40", SOLD_OUT, WAITLIST_BTN(2)),
  ]);
  const result = await select({ seatClasses: ["일반실"], minDepTime: "15:00" });
  assert.ok(result);
  assert.equal(result!.trainNo, "212");
  assert.equal(result!.waitlistAvailable, true);
  assert.equal(result!.candidateCount, 2);
});

test("모든 열차가 탐색 시작 시각보다 이르면 null을 반환한다", async () => {
  await loadRows([
    row(0, "213", "14:30", "16:00", SOLD_OUT, RESERVE_GEN(0)),
    row(1, "214", "14:59", "16:30", SOLD_OUT, SOLD_OUT),
  ]);
  const result = await select({ seatClasses: ["일반실"], minDepTime: "15:00" });
  assert.equal(result, null);
});

test("탐색 끝 시각과 같은 열차를 포함한다", async () => {
  await loadRows([
    row(0, "301", "17:00", "19:00", SOLD_OUT, RESERVE_GEN(0)),
    row(1, "302", "17:01", "19:01", SOLD_OUT, RESERVE_GEN(1)),
  ]);
  const result = await select({
    seatClasses: ["일반실"],
    minDepTime: "15:00",
    maxDepTime: "17:00",
  });
  assert.ok(result);
  assert.equal(result!.trainNo, "301");
  assert.equal(result!.candidateCount, 1);
});

test("탐색 끝 시각 이후 열차는 잔여석이 있어도 제외한다", async () => {
  await loadRows([
    row(0, "303", "16:30", "18:30", SOLD_OUT, SOLD_OUT),
    row(1, "304", "17:01", "19:01", SOLD_OUT, RESERVE_GEN(1)),
  ]);
  const result = await select({
    seatClasses: ["일반실"],
    minDepTime: "15:00",
    maxDepTime: "17:00",
  });
  assert.ok(result);
  assert.equal(result!.trainNo, "303");
  assert.equal(result!.seatAvailable, false);
  assert.equal(result!.candidateCount, 1);
});

test("시간 구간 안의 예약대기 열차만 선택한다", async () => {
  await loadRows([
    row(0, "305", "14:59", "17:00", SOLD_OUT, WAITLIST_BTN(0)),
    row(1, "306", "16:00", "18:00", SOLD_OUT, WAITLIST_BTN(1)),
    row(2, "307", "17:01", "19:01", SOLD_OUT, WAITLIST_BTN(2)),
  ]);
  const result = await select({
    seatClasses: ["일반실"],
    minDepTime: "15:00",
    maxDepTime: "17:00",
  });
  assert.ok(result);
  assert.equal(result!.trainNo, "306");
  assert.equal(result!.waitlistAvailable, true);
  assert.equal(result!.candidateCount, 1);
});

test("모든 열차가 탐색 시간 구간 밖이면 null을 반환한다", async () => {
  await loadRows([
    row(0, "308", "14:59", "17:00", SOLD_OUT, RESERVE_GEN(0)),
    row(1, "309", "17:01", "19:01", SOLD_OUT, RESERVE_GEN(1)),
  ]);
  const result = await select({
    seatClasses: ["일반실"],
    minDepTime: "15:00",
    maxDepTime: "17:00",
  });
  assert.equal(result, null);
});

// ── SRT+KTX 통합 이후 신규 케이스 (2026-08-05) ────────────────────────────
test("KTX 교차판매 행(showKorailBookingChoice)은 예약 가능해도 후보에서 제외한다", async () => {
  await loadRows([
    row(0, "00303", "06:00", "08:30", KTX_SPE_BTN(0), KTX_GEN_BTN(0), "KTX"),
    row(1, "111", "07:00", "09:00", SOLD_OUT, RESERVE_GEN(1), "SRT"),
  ]);
  const result = await select({ seatClasses: ["일반실"], minDepTime: "00:00" });
  assert.ok(result);
  assert.equal(result!.trainNo, "111");
  assert.equal(result!.seatAvailable, true);
});

test("전부 KTX 교차판매 행이면 예약 후보가 없어 seatAvailable=false를 반환한다", async () => {
  await loadRows([row(0, "00303", "06:00", "08:30", KTX_SPE_BTN(0), KTX_GEN_BTN(0), "KTX")]);
  const result = await select({ seatClasses: ["일반실"], minDepTime: "00:00" });
  assert.ok(result);
  assert.equal(result!.seatAvailable, false);
  assert.equal(result!.waitlistAvailable, false);
});
