/**
 * srt/config.test.ts — daysUntil() 경계값 테스트
 *
 * 실행: npm test (node --test)
 */
import { describe, it, mock, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import {
  daysUntil,
  parseSeatClasses,
  resolveTargetEndTime,
  resolveTargetTime,
  resolveTrainGroupCode,
} from "../src/config.ts";

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

describe("resolveTargetTime()", () => {
  it("옵션 생략 시 조회 기준 시각의 정각을 사용한다", () => {
    assert.equal(resolveTargetTime("14", ""), "14:00");
  });

  it("유효한 탐색 시작 시각을 그대로 반환한다", () => {
    assert.equal(resolveTargetTime("14", "15:30"), "15:30");
  });

  it("HH:mm 형식이 아니면 거부한다", () => {
    assert.throws(
      () => resolveTargetTime("14", "15"),
      /예매 탐색 시작 시각 형식 오류/,
    );
    assert.throws(
      () => resolveTargetTime("14", "24:00"),
      /예매 탐색 시작 시각 형식 오류/,
    );
  });

  it("탐색 시작 시각이 조회 기준 시각보다 빠르면 거부한다", () => {
    assert.throws(
      () => resolveTargetTime("14", "13:59"),
      /조회 기준 시각\(14:00\)보다 빠를 수 없습니다/,
    );
  });
});

describe("resolveTargetEndTime()", () => {
  it("옵션 생략 시 23:59를 사용한다", () => {
    assert.equal(resolveTargetEndTime("15:00", ""), "23:59");
  });

  it("유효한 탐색 끝 시각을 그대로 반환한다", () => {
    assert.equal(resolveTargetEndTime("15:00", "17:30"), "17:30");
  });

  it("HH:mm 형식이 아니면 거부한다", () => {
    assert.throws(
      () => resolveTargetEndTime("15:00", "17"),
      /예매 탐색 끝 시각 형식 오류/,
    );
    assert.throws(
      () => resolveTargetEndTime("15:00", "24:00"),
      /예매 탐색 끝 시각 형식 오류/,
    );
  });

  it("탐색 끝 시각이 시작 시각보다 빠르면 거부한다", () => {
    assert.throws(
      () => resolveTargetEndTime("15:00", "14:59"),
      /탐색 시작 시각\(15:00\)보다 빠를 수 없습니다/,
    );
  });
});

describe("resolveTrainGroupCode()", () => {
  it("SRT+KTX → 900 (기본값)", () => {
    assert.equal(resolveTrainGroupCode("SRT+KTX"), "900");
  });

  it("SRT → 300", () => {
    assert.equal(resolveTrainGroupCode("SRT"), "300");
  });

  it("전체 → 109", () => {
    assert.equal(resolveTrainGroupCode("전체"), "109");
  });

  it("알 수 없는 값은 거부한다", () => {
    assert.throws(
      () => resolveTrainGroupCode("KTX단독"),
      /--train-type 값 오류/,
    );
  });
});
