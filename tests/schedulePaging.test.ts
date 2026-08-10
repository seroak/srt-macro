/**
 * srt/tests/schedulePaging.test.ts — shouldAdvancePage() 검증
 *
 * SRT 결과 목록은 10건씩 페이징된다(라이브 캡처 srt/capture/96-result-*.html의
 * "다음" 버튼 확인). 탐색 구간(minDepTime~maxDepTime)이 현재 페이지 밖에 있으면
 * 재조회 대신 다음 페이지로 넘겨야 한다는 판정을 순수 함수로 분리해 검증한다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { shouldAdvancePage } from "../src/core/schedulePaging.ts";

test("현재 페이지 마지막 열차가 탐색 시작 시각보다 이르면 다음 페이지로 넘긴다", () => {
  const depTimes = ["06:00", "06:54", "07:05", "08:00"];
  assert.equal(shouldAdvancePage(depTimes, "16:39", "20:50"), true);
});

test("현재 페이지 마지막 열차가 이미 탐색 끝 시각을 넘겼으면 넘기지 않는다", () => {
  const depTimes = ["20:00", "21:00", "22:00"];
  assert.equal(shouldAdvancePage(depTimes, "16:39", "20:50"), false);
});

test("현재 페이지 안에 탐색 구간이 걸쳐 있으면 넘기지 않는다", () => {
  const depTimes = ["16:00", "16:30", "17:00", "17:30"];
  assert.equal(shouldAdvancePage(depTimes, "16:39", "20:50"), false);
});

test("경계값: 마지막 열차 시각이 탐색 시작 시각과 정확히 같으면 넘기지 않는다", () => {
  const depTimes = ["16:00", "16:39"];
  assert.equal(shouldAdvancePage(depTimes, "16:39", "20:50"), false);
});

test("빈 목록이면 넘기지 않는다 (조회 자체 실패 — requery로 위임)", () => {
  assert.equal(shouldAdvancePage([], "16:39", "20:50"), false);
});
