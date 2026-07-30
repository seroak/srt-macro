/**
 * srt/paymentApproval.ts — 결제 확인 팝업 승인 게이트
 *
 * 배경(2026-07-30): SrtSession의 전역 dialog 핸들러가 뜨는 모든 confirm/alert을
 * 무조건 accept()해서, 실제 "결제 및 발권하시겠습니까?" 확인창까지 자동 승인해버린
 * 사고가 있었다. Playwright는 dialog 리스너가 없으면 자동으로 dismiss(취소)하고
 * (사람이 실제 팝업을 클릭할 방법이 없음), 리스너가 있으면 그 리스너가 즉시
 * accept/dismiss를 결정해야 한다 — 따라서 "사람이 직접 클릭"은 이 브라우저
 * 안에서는 불가능하고, 외부 신호(채팅에서 확인 후 이 파일 생성)로만 승인한다.
 */
import * as fs from "fs";

// utils.ts의 sleep은 import 시 readline.createInterface()로 stdin을 열어(waitEnter용)
// 프로세스를 계속 살려두는 부작용이 있다 — 이 모듈은 그 인터페이스가 필요 없어 로컬로 정의.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * approveFilePath가 생성될 때까지 최대 timeoutMs 동안 폴링한다.
 * 파일이 생기면 즉시 삭제하고 true, timeoutMs 안에 없으면 false(안전 기본값 — 취소).
 */
export async function waitForPaymentApproval(
  approveFilePath: string,
  timeoutMs: number,
  pollIntervalMs = 1000,
): Promise<boolean> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (fs.existsSync(approveFilePath)) {
      fs.rmSync(approveFilePath, { force: true });
      return true;
    }
    await sleep(pollIntervalMs);
  }
  return false;
}
