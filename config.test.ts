/**
 * srt/config.test.ts — daysUntil() 경계값 테스트
 *
 * 실행: npm test (node --test)
 */
import { describe, it, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { daysUntil, parseSeatClasses } from "./config.ts";

function yyyymmdd(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}${m}${d}`;
}

function addDays(base: Date, n: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + n);
  return d;
}

describe("daysUntil()", () => {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  it("오늘 = 0", () => {
    assert.equal(daysUntil(yyyymmdd(today)), 0);
  });

  it("내일 = 1 → POLLING 모드", () => {
    assert.equal(daysUntil(yyyymmdd(addDays(today, 1))), 1);
  });

  it("모레 = 2 → WAITLIST 모드 경계", () => {
    assert.equal(daysUntil(yyyymmdd(addDays(today, 2))), 2);
  });

  it("D+7 = 7", () => {
    assert.equal(daysUntil(yyyymmdd(addDays(today, 7))), 7);
  });

  it("어제 = -1 (과거)", () => {
    assert.equal(daysUntil(yyyymmdd(addDays(today, -1))), -1);
  });

  it("D+2 이상이면 WAITLIST, D+1 이하면 POLLING", () => {
    assert.ok(daysUntil(yyyymmdd(addDays(today, 2))) >= 2, "D+2 → WAITLIST");
    assert.ok(daysUntil(yyyymmdd(addDays(today, 1))) < 2,  "D+1 → POLLING");
    assert.ok(daysUntil(yyyymmdd(today)) < 2,              "D+0 → POLLING");
  });
});

describe("parseSeatClasses()", () => {
  it("단일 등급", () => {
    assert.deepEqual(parseSeatClasses("일반실"), ["일반실"]);
  });

  it("콤마로 구분된 복수 등급", () => {
    assert.deepEqual(parseSeatClasses("일반실,특실"), ["일반실", "특실"]);
  });

  it("공백 트림", () => {
    assert.deepEqual(parseSeatClasses(" 일반실 , 특실 "), ["일반실", "특실"]);
  });

  it("입석+좌석 포함 3개 등급", () => {
    assert.deepEqual(parseSeatClasses("일반실,특실,입석+좌석"), ["일반실", "특실", "입석+좌석"]);
  });

  it("빈 문자열 → 빈 배열", () => {
    assert.deepEqual(parseSeatClasses(""), []);
  });

  it("연속 콤마의 빈 항목 제거", () => {
    assert.deepEqual(parseSeatClasses("일반실,,특실"), ["일반실", "특실"]);
  });
});
