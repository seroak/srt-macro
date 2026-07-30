import { type Page, type Dialog } from "playwright";
import * as fs from "fs";
import { DEP, ARR, PAY_TAB, EASY_PAY, SRT_PAYMENT_APPROVE_FILE } from "./config.ts";
import { log, waitEnter } from "./utils.ts";
import { sendDiscord } from "./discord.ts";
import { waitForPaymentApproval } from "./paymentApproval.ts";
import { formatTrainInfo, type CaughtTrain } from "./trainInfoFormat.ts";
import { resolvePayTabSelector, resolveEasyPaySelector } from "./payMethod.ts";
import { nextDeadlineAlert, PAYMENT_DEADLINE_MS } from "./paymentDeadline.ts";

/**
 * PaymentFlow — confirmReservationInfo.do(좌석 10분 임시확보) 이후 결제 화면 진입까지 자동 처리.
 *
 * 자동화 범위: 결제하기 클릭(settleAmount()) → selectSettleInfo.do 도달 → 결제수단 탭·
 * 간편결제 수단 선택(--pay-tab/--easy-pay) → 10분 잔여시간 재알림.
 * 자동화하지 않는 범위: 카드번호·비밀번호 입력(TransKey 보안키패드), 간편결제 팝업의
 * 비밀번호 인증, 발권 버튼, 최종 결제 승인(requestIssueInfo()) — 항상 사람이 직접
 * 한다. TransKey는 이미지 기반·위치 랜덤 가상키패드라 텍스트 입력 자체가 불가능하고,
 * 자동 클릭하려면 화면을 읽어(OCR) 키로거·자동화 방지 목적의 보안장치를 우회해야
 * 하므로 구현하지 않는다. 카드 비밀번호를 설정·프롬프트에 평문으로 두는 것도 유출
 * 경로라 넘기지 않는다.
 *
 * 안전장치: SrtSession의 전역 dialog 핸들러(모든 confirm/alert을 자동 accept)가
 * 실제 "결제 및 발권하시겠습니까?" 확인창까지 자동 승인해버린 사고가 있었다(2026-07-30).
 * Playwright는 dialog 리스너가 없으면 자동으로 dismiss(사람이 실제 팝업을 클릭할
 * 방법이 없음)하므로, 이 단계부터는 그 전역 핸들러를 제거하고 모든 dialog를
 * paymentApproval.waitForPaymentApproval()로 게이트한다 — 채팅에서 사람이 실제로
 * 확인한 뒤 승인 파일을 생성해야만 진행된다.
 *
 * handle()만 public.
 */
export class PaymentFlow {
  constructor(
    private readonly page: Page,
    private readonly train: CaughtTrain,
  ) {}

  async handle(): Promise<void> {
    const payBtn = this.page.locator('a:has-text("결제하기"), button:has-text("결제하기")').first();
    if ((await payBtn.count()) === 0) {
      log("결제하기 버튼을 찾지 못함 — 브라우저에서 직접 진행하세요.");
      await waitEnter("결제 완료 후 Enter > ");
      return;
    }

    const urlBeforePay = this.page.url();
    const navPromise = this.page
      .waitForURL((u) => u.href !== urlBeforePay, { timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    await payBtn.click();
    if (!(await navPromise)) {
      log("결제하기 클릭 후 화면 전환 없음 — 브라우저에서 직접 진행하세요.");
      await waitEnter("결제 완료 후 Enter > ");
      return;
    }
    await this.page.waitForLoadState("domcontentloaded").catch(() => {});
    log(`결제 수단 선택 화면 도달: ${this.page.url()}`);

    await this.selectPayMethod();

    this.armPaymentDialogGate();

    const trainInfo = formatTrainInfo(DEP, ARR, this.train);
    log(`결제 화면 도달 — ${trainInfo}. 카드 정보를 직접 입력하고 "결제 및 발권"을 누르세요.`);
    log('최종 결제 확인 팝업은 자동으로 승인되지 않습니다 — 채팅에서 확인해야 진행됩니다.');
    sendDiscord(
      "SRT 결제 화면 도달",
      `**${trainInfo}** — 카드 정보 입력 후 결제 승인 대기 중`,
      0xf1c40f,
    );

    const securedAtMs = Date.now();
    const alertedMinutes: number[] = [];
    const deadlineTimer = setInterval(() => {
      const alert = nextDeadlineAlert(securedAtMs, Date.now(), alertedMinutes);
      if (!alert) return;
      alertedMinutes.push(alert.minutesLeft);
      log(`결제 잔여시간 ${alert.minutesLeft}분`);
      sendDiscord(
        "SRT 결제 잔여시간 알림",
        `**${trainInfo}** — 결제 잔여 **${alert.minutesLeft}분**, 10분 내 미결제 시 좌석이 풀립니다.`,
        0xe67e22,
      );
    }, 15_000);

    const urlAtPayment = this.page.url();
    const navigated = await this.page
      .waitForURL((u) => u.href !== urlAtPayment, { timeout: PAYMENT_DEADLINE_MS })
      .then(() => true)
      .catch(() => false)
      .finally(() => clearInterval(deadlineTimer));

    if (!navigated) {
      log("10분 내 결제 완료 감지 안 됨 — 브라우저에서 직접 확인하세요.");
      return;
    }
    log(`결제 이후 화면: ${this.page.url()}`);
    log("실제 결제·발권 여부는 SRT 예매내역에서 직접 확인하세요 (자동 판정하지 않음).");
  }

  /** 결제수단 탭(--pay-tab) 선택 후, 간편결제 탭이면 간편결제 수단(--easy-pay) 라디오 선택 */
  private async selectPayMethod(): Promise<void> {
    const tabSelector = resolvePayTabSelector(PAY_TAB);
    const tab = this.page.locator(tabSelector).first();
    if ((await tab.count()) > 0) {
      await tab.click().catch(() => {});
    } else {
      log(`결제수단 탭(${PAY_TAB} → ${tabSelector})을 찾지 못함 — 브라우저에서 직접 선택하세요.`);
      return;
    }

    if (PAY_TAB !== "간편결제") return;

    const easyPaySelector = resolveEasyPaySelector(EASY_PAY);
    if (!easyPaySelector) return; // 미지정 — 화면 기본 선택(내통장결제) 유지

    const radio = this.page.locator(easyPaySelector).first();
    if ((await radio.count()) > 0) {
      // onclick="changeStlTpCd(this)" 핸들러가 붙어 있어 .check()가 아니라 .click()으로 발동시킨다.
      await radio.click().catch(() => {});
    } else {
      log(`간편결제 수단(${EASY_PAY} → ${easyPaySelector})을 찾지 못함 — 브라우저에서 직접 선택하세요.`);
    }
  }

  /** 이 단계부터의 모든 dialog를 승인 파일 게이트로 전환 — 전역 자동승인 핸들러를 대체한다 */
  private armPaymentDialogGate(): void {
    this.page.removeAllListeners("dialog");
    fs.rmSync(SRT_PAYMENT_APPROVE_FILE, { force: true });
    this.page.on("dialog", (dialog) => {
      this.gateDialog(dialog).catch((err) => log(`결제 팝업 처리 중 오류: ${err.message}`));
    });
  }

  private async gateDialog(dialog: Dialog): Promise<void> {
    log(`[결제단계 팝업] [${dialog.type()}] ${dialog.message()}`);
    log(`승인하려면 채팅에서 확인 후 "${SRT_PAYMENT_APPROVE_FILE}" 생성 — 최대 5분 대기`);
    const approved = await waitForPaymentApproval(SRT_PAYMENT_APPROVE_FILE, 5 * 60_000);
    if (approved) {
      log("결제 승인 신호 확인 — 진행");
      await dialog.accept().catch(() => {});
    } else {
      log("5분 내 승인 신호 없음 — 취소 처리");
      await dialog.dismiss().catch(() => {});
    }
  }
}
