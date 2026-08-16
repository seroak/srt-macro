/**
 * srt/tests/scheduleReady.test.ts — isScheduleSettled() 검증
 *
 * scheduleRace.browser.test.ts(R2/R3)가 오프라인으로 확정한 근본원인: 문서가 아직
 * "loading" 상태(domcontentloaded 이전)인 동안엔 table tbody tr는 매칭돼도 hidden input
 * (trnNo[i])은 파싱 전이라 0건일 수 있다. document.readyState가 "interactive" 이상이면
 * (domcontentloaded 이후 — HTML 파싱 자체는 끝난 상태) 이 틈이 닫힌다는 게 그 재현 테스트의
 * 실측 결과다.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { isScheduleSettled } from "../src/core/scheduleReady.ts";

test("readyState가 loading이면 hidden input이 0건이든 아니든 아직 정착 안 됨", () => {
  assert.equal(
    isScheduleSettled({ hiddenRowCount: 0, visibleRowCount: 1, readyState: "loading" }),
    false,
  );
  assert.equal(
    isScheduleSettled({ hiddenRowCount: 0, visibleRowCount: 0, readyState: "loading" }),
    false,
  );
});

test("readyState가 interactive면 정착된 것으로 본다 (domcontentloaded 이후 — HTML 파싱 완료)", () => {
  assert.equal(
    isScheduleSettled({ hiddenRowCount: 10, visibleRowCount: 10, readyState: "interactive" }),
    true,
  );
});

test("readyState가 complete면 정착된 것으로 본다", () => {
  assert.equal(
    isScheduleSettled({ hiddenRowCount: 10, visibleRowCount: 10, readyState: "complete" }),
    true,
  );
});

test("readyState가 interactive/complete인데 hiddenRowCount=0이어도 정착으로 본다 (진짜 열차 없음)", () => {
  // 파싱이 끝난 뒤에도 hidden input이 없다면 그건 로드 미완이 아니라 실제로 결과가 없는 것이다.
  assert.equal(
    isScheduleSettled({ hiddenRowCount: 0, visibleRowCount: 0, readyState: "complete" }),
    true,
  );
});
