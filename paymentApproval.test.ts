/**
 * srt/paymentApproval.test.ts — waitForPaymentApproval() 검증
 *
 * 실행: npm test (node --test)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { EventEmitter } from "events";
import { type Page } from "playwright";
import { waitForPaymentApproval, armPaymentApprovalGate } from "./paymentApproval.ts";

function tmpApproveFile(): string {
  return path.join(os.tmpdir(), `srt_payment_approve_test_${Date.now()}_${Math.random().toString(36).slice(2)}`);
}

/** playwright Dialog의 최소 인터페이스만 흉내낸 페이크 — accept/dismiss 호출 여부만 관찰 */
class FakeDialog {
  accepted = false;
  dismissed = false;
  constructor(private readonly msg: string, private readonly kind = "confirm") {}
  type() { return this.kind; }
  message() { return this.msg; }
  async accept() { this.accepted = true; }
  async dismiss() { this.dismissed = true; }
}

/** playwright Page의 dialog 이벤트 배선만 흉내낸 페이크 (EventEmitter 기반) */
function fakePage() {
  const emitter = new EventEmitter();
  return {
    on: (event: string, cb: (...args: unknown[]) => void) => emitter.on(event, cb),
    removeAllListeners: (event?: string) => emitter.removeAllListeners(event),
    emitDialog: (dialog: FakeDialog) => emitter.emit("dialog", dialog),
  };
}

test("승인 파일이 이미 있으면 즉시 true를 반환하고 파일을 삭제한다", async () => {
  const file = tmpApproveFile();
  fs.writeFileSync(file, "yes");

  const result = await waitForPaymentApproval(file, 1000, 20);

  assert.equal(result, true);
  assert.equal(fs.existsSync(file), false);
});

test("타임아웃 안에 승인 파일이 생기지 않으면 false를 반환한다(안전 기본값)", async () => {
  const file = tmpApproveFile();

  const start = Date.now();
  const result = await waitForPaymentApproval(file, 150, 20);
  const elapsed = Date.now() - start;

  assert.equal(result, false);
  assert.ok(elapsed >= 150, `timeout보다 일찍 끝나면 안 됨 (elapsed=${elapsed})`);
});

test("대기 도중 승인 파일이 생기면 그 시점에 true를 반환한다", async () => {
  const file = tmpApproveFile();
  setTimeout(() => fs.writeFileSync(file, "yes"), 80);

  const start = Date.now();
  const result = await waitForPaymentApproval(file, 2000, 20);
  const elapsed = Date.now() - start;

  assert.equal(result, true);
  assert.ok(elapsed < 500, `너무 오래 걸림 (elapsed=${elapsed})`);
  assert.equal(fs.existsSync(file), false);
});

// ─── armPaymentApprovalGate() ───────────────────────────────────────────────
// 배경(2026-07-30): 전역 auto-accept dialog 핸들러가 실제 "결제 및 발권하시겠습니까?"
// 확인창까지 자동 승인해버린 사고 재발 방지 — 이 게이트가 장착된 뒤에는 승인 파일
// 없이는 절대 accept되지 않아야 한다.

test("승인 파일 없이는 dialog가 accept되지 않고, 타임아웃 시 dismiss된다", async () => {
  const file = tmpApproveFile();
  const page = fakePage();

  armPaymentApprovalGate(page as unknown as Page, file, 150, 20);
  const dialog = new FakeDialog("결제 및 발권하시겠습니까?");
  page.emitDialog(dialog);

  await new Promise((r) => setTimeout(r, 300));

  assert.equal(dialog.accepted, false);
  assert.equal(dialog.dismissed, true);
});

test("승인 파일이 생기면 그 시점에 dialog를 accept한다", async () => {
  const file = tmpApproveFile();
  const page = fakePage();

  armPaymentApprovalGate(page as unknown as Page, file, 2000, 20);
  const dialog = new FakeDialog("결제 및 발권하시겠습니까?");
  page.emitDialog(dialog);
  setTimeout(() => fs.writeFileSync(file, "yes"), 60);

  await new Promise((r) => setTimeout(r, 300));

  assert.equal(dialog.accepted, true);
  assert.equal(dialog.dismissed, false);
});

test("장착 시 기존 dialog 리스너를 제거한다 — 옛 auto-accept 핸들러는 더 이상 호출되지 않는다", async () => {
  const file = tmpApproveFile();
  const page = fakePage();
  let oldHandlerCalled = false;
  page.on("dialog", () => { oldHandlerCalled = true; });

  armPaymentApprovalGate(page as unknown as Page, file, 150, 20);
  const dialog = new FakeDialog("아무 확인창");
  page.emitDialog(dialog);

  await new Promise((r) => setTimeout(r, 300));

  assert.equal(oldHandlerCalled, false, "removeAllListeners로 제거됐어야 할 옛 핸들러가 호출됨");
});
