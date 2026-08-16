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
import { type Page, type Dialog } from "playwright";

// utils.ts의 sleep/log는 import 시 readline.createInterface()로 stdin을 열어(waitEnter용)
// 프로세스를 계속 살려두는 부작용이 있다 — 이 모듈은 그 인터페이스가 필요 없어 로컬로 정의.
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const ts = () => new Date().toLocaleTimeString("ko-KR", { hour12: false });
const log = (msg: string) => console.log(`[${ts()}] ${msg}`);

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

/**
 * page의 모든 dialog 리스너를 제거하고, 이후 뜨는 모든 dialog를 승인 파일 게이트로 전환한다.
 * SrtSession.create()가 등록한 전역 auto-accept 핸들러(조회·예약 클릭 단계의
 * "스마트폰 어플이 있습니까?" 같은 confirm 처리용)를 대체한다 — 결제 확인 등
 * 되돌릴 수 없는 dialog가 뜰 수 있는 지점에서는 반드시 이 함수를 호출한 뒤에
 * 사람에게 브라우저를 넘겨야 한다 (2026-07-30 자동승인 사고 재발 방지).
 */
export function armPaymentApprovalGate(
  page: Page,
  approveFilePath: string,
  timeoutMs = 5 * 60_000,
  pollIntervalMs = 1000,
): void {
  page.removeAllListeners("dialog");
  fs.rmSync(approveFilePath, { force: true });
  page.on("dialog", (dialog) => {
    gateDialog(dialog, approveFilePath, timeoutMs, pollIntervalMs).catch((err) =>
      log(`결제 팝업 처리 중 오류: ${err.message}`),
    );
  });
}

async function gateDialog(
  dialog: Dialog,
  approveFilePath: string,
  timeoutMs: number,
  pollIntervalMs: number,
): Promise<void> {
  const minutes = Math.round(timeoutMs / 60_000);
  log(`[결제단계 팝업] [${dialog.type()}] ${dialog.message()}`);
  log(`승인하려면 채팅에서 확인 후 "${approveFilePath}" 생성 — 최대 ${minutes}분 대기`);
  const approved = await waitForPaymentApproval(approveFilePath, timeoutMs, pollIntervalMs);
  if (approved) {
    log("결제 승인 신호 확인 — 진행");
    await dialog.accept().catch(() => {});
  } else {
    log(`${minutes}분 내 승인 신호 없음 — 취소 처리`);
    await dialog.dismiss().catch(() => {});
  }
}
