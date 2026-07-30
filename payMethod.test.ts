/**
 * srt/payMethod.test.ts — resolvePayTabSelector() / resolveEasyPaySelector() 검증
 *
 * 실행: npm test (node --test)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolvePayTabSelector, resolveEasyPaySelector } from "./payMethod.ts";

test("결제수단 탭 이름을 chTab 셀렉터로 변환한다 (capture/04-pay-tab-간편결제.html 확인 순서)", () => {
  assert.equal(resolvePayTabSelector("신용카드"), "#chTab1");
  assert.equal(resolvePayTabSelector("간편결제"), "#chTab2");
  assert.equal(resolvePayTabSelector("계좌이체"), "#chTab3");
  assert.equal(resolvePayTabSelector("포인트"), "#chTab4");
  assert.equal(resolvePayTabSelector("레일리지"), "#chTab5");
});

test("알 수 없는 탭 이름은 명확한 에러를 던진다", () => {
  assert.throws(() => resolvePayTabSelector("가상계좌"), /가상계좌/);
});

test("간편결제 수단 이름을 라디오 셀렉터로 변환한다", () => {
  assert.equal(resolveEasyPaySelector("내통장결제"), "#settleBank");
  assert.equal(resolveEasyPaySelector("네이버페이"), "#naverPay");
  assert.equal(resolveEasyPaySelector("페이코"), "#payco");
  assert.equal(resolveEasyPaySelector("카카오페이"), "#kakaoPay");
});

test("간편결제 수단을 지정하지 않으면 undefined — 라디오를 건드리지 않는다", () => {
  assert.equal(resolveEasyPaySelector(undefined), undefined);
  assert.equal(resolveEasyPaySelector(""), undefined);
});

test("알 수 없는 간편결제 수단 이름은 명확한 에러를 던진다", () => {
  assert.throws(() => resolveEasyPaySelector("토스페이"), /토스페이/);
});
