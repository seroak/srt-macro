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
import { waitForPaymentApproval } from "./paymentApproval.ts";

function tmpApproveFile(): string {
  return path.join(os.tmpdir(), `srt_payment_approve_test_${Date.now()}_${Math.random().toString(36).slice(2)}`);
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
