/**
 * srt/payMethod.test.ts — resolvePayTabSelector() / resolveEasyPaySelector() 검증
 *
 * 실행: npm test (node --test)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolvePayTabSelector, resolveEasyPaySelector, validatePaymentSelection } from "./payMethod.ts";

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

// ─── validatePaymentSelection() ─────────────────────────────────────────────
// 배경: 기존에는 --pay-tab/--easy-pay 오타가 좌석 확보 후 PaymentFlow 실행 시점에야
// 발각돼, throw로 프로세스가 죽으며 브라우저가 닫히고 10분 임시확보 좌석이
// 유실됐다 — run_srt.ts가 세션 생성 전에 이 함수로 미리 fail-fast 해야 한다.
test("validatePaymentSelection — 유효한 조합은 통과한다", () => {
  assert.doesNotThrow(() => validatePaymentSelection("간편결제", "네이버페이"));
  assert.doesNotThrow(() => validatePaymentSelection("신용카드", undefined));
});

test("validatePaymentSelection — 잘못된 --pay-tab은 즉시 던진다(좌석 확보 전 검증용)", () => {
  assert.throws(() => validatePaymentSelection("가상계좌", undefined), /가상계좌/);
});

test("validatePaymentSelection — 잘못된 --easy-pay는 즉시 던진다(좌석 확보 전 검증용)", () => {
  assert.throws(() => validatePaymentSelection("간편결제", "토스페이"), /토스페이/);
});
