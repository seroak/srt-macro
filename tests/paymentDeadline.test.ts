/**
 * srt/paymentDeadline.test.ts — nextDeadlineAlert() 검증
 *
 * 실행: npm test (node --test)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { nextDeadlineAlert, PAYMENT_DEADLINE_MS } from "../src/payment/paymentDeadline.ts";

test("10분 타임아웃 상수는 600000ms다", () => {
  assert.equal(PAYMENT_DEADLINE_MS, 10 * 60_000);
});

test("확보 직후(잔여 10분)에는 아직 알림 대상이 아니다", () => {
  const securedAt = 0;
  const now = securedAt;
  assert.equal(nextDeadlineAlert(securedAt, now, []), undefined);
});

test("잔여 7분 시점에 도달하면 7분 알림을 반환한다", () => {
  const securedAt = 0;
  const now = securedAt + 3 * 60_000; // 10분 - 3분 경과 = 7분 남음
  const result = nextDeadlineAlert(securedAt, now, []);
  assert.deepEqual(result, { minutesLeft: 7 });
});

test("이미 보낸 알림(alertedMinutes)은 다시 반환하지 않는다", () => {
  const securedAt = 0;
  const now = securedAt + 3 * 60_000;
  assert.equal(nextDeadlineAlert(securedAt, now, [7]), undefined);
});

test("잔여 3분·1분 알림도 각각 한 번씩 순서대로 반환한다", () => {
  const securedAt = 0;
  assert.deepEqual(nextDeadlineAlert(securedAt, securedAt + 7 * 60_000, [7]), { minutesLeft: 3 });
  assert.deepEqual(
    nextDeadlineAlert(securedAt, securedAt + 9 * 60_000, [7, 3]),
    { minutesLeft: 1 },
  );
});

test("10분이 지나 마감을 넘기면 더 이상 알림을 반환하지 않는다", () => {
  const securedAt = 0;
  const now = securedAt + 11 * 60_000;
  assert.equal(nextDeadlineAlert(securedAt, now, [7, 3, 1]), undefined);
});
