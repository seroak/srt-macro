/**
 * srt/ui/src/seatSelection.test.ts — 좌석 등급 다중 선택 로직 검증
 *
 * 실행: npm test -w srt (node --test)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { toggleSeatClass, parseSelectedSeats, SEAT_ORDER } from "./seatSelection.ts";

test("초기 '일반실'에서 '특실' 체크 → '일반실,특실'", () => {
  assert.equal(toggleSeatClass("일반실", "특실"), "일반실,특실");
});

test("체크 순서와 무관하게 정규 순서(SEAT_ORDER) 유지 — 입석을 먼저 체크해도 순서 보존", () => {
  const afterStanding = toggleSeatClass("일반실", "입석+좌석");
  assert.equal(afterStanding, "일반실,입석+좌석");

  const afterAll = toggleSeatClass(afterStanding, "특실");
  assert.equal(afterAll, "일반실,특실,입석+좌석");
});

test("3개 전체 선택 후 중간 항목 해제 시 나머지 순서 보존", () => {
  const all = "일반실,특실,입석+좌석";
  assert.equal(toggleSeatClass(all, "일반실"), "특실,입석+좌석");
  assert.equal(toggleSeatClass(all, "특실"), "일반실,입석+좌석");
});

test("마지막 항목 해제 → 빈 문자열 (validation 트리거 조건)", () => {
  assert.equal(toggleSeatClass("입석+좌석", "입석+좌석"), "");
});

test("SEAT_ORDER에 없는 값을 토글해도 결과 불변", () => {
  assert.equal(toggleSeatClass("일반실", "존재하지않는등급"), "일반실");
});

test("parseSelectedSeats — 빈 문자열은 빈 배열", () => {
  assert.deepEqual(parseSelectedSeats(""), []);
});

test("parseSelectedSeats — 콤마 조인 문자열을 배열로 분리", () => {
  assert.deepEqual(parseSelectedSeats("일반실,특실"), ["일반실", "특실"]);
});

test("SEAT_ORDER는 일반실 → 특실 → 입석+좌석 순서", () => {
  assert.deepEqual(SEAT_ORDER, ["일반실", "특실", "입석+좌석"]);
});
