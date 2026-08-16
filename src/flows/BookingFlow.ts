import notifier from "node-notifier";
import { type Page } from "playwright";
import { DEP, ARR, SRT_PAYMENT_APPROVE_FILE } from "../config.ts";
import { log, sleep, waitEnter } from "../utils.ts";
import { sendDiscord } from "../notify/discord.ts";
import { PaymentFlow } from "./PaymentFlow.ts";
import { armPaymentApprovalGate } from "../payment/paymentApproval.ts";
import { formatTrainInfo, type CaughtTrain } from "../notify/trainInfoFormat.ts";
import { classifyAlertPopup } from "./alertPopup.ts";

/**
 * BookingFlow — checkUserInfo.do 이후 예약 완료까지 자동 처리.
 *
 * SRT 예약 흐름:
 *   requestReservationInfo 클릭 → insert-form.submit()
 *   → checkUserInfo.do  (승객·좌석 확인 화면)
 *   → 예약신청 버튼 클릭
 *   → 예약 완료 / 결제 대기 페이지 (약 10분)
 *
 * handle()만 public.
 */
export class BookingFlow {
  /** @param train 실제로 확보된 열차 정보 (trainNo/depTime/arrTime/matchedSeat) */
  constructor(
    private readonly page: Page,
    private readonly train: CaughtTrain,
  ) {}

  // 이용안내(중련운행 안내) 모달 자동 확인 후 재진입 시 무한 재귀를 막는 상한.
  private static readonly MAX_NOTICE_CONFIRM_ATTEMPTS = 3;

  async handle(noticeAttempt = 0): Promise<void> {
    // 예약하기 클릭 직후 confirmReservationInfo.do 로 이동하는 중일 수 있으므로 잠깐 대기
    if (!this.isReservationConfirmPage(this.page.url())) {
      await this.page
        .waitForURL((u) => this.isReservationConfirmPage(u.href), { timeout: 5000 })
        .catch(() => null);
    }

    const url = this.page.url();
    log(`[BookingFlow] 현재 URL: ${url}`);

    // ── 예약 확인 페이지 도달 → 즉시 디스코드 알림 ────────────────────────
    // 예매(예약하기) 버튼 클릭 시 진입하는 실제 URL:
    //   confirmReservationInfo.do?pageId=TK0101030000  (좌석 10분 임시 확보)
    if (this.isReservationConfirmPage(url)) {
      log("예약 확인 페이지 도달 — 좌석 확보! 디스코드 알림 발송");
      this.notify();
      await new PaymentFlow(this.page, this.train).handle();
      return;
    }

    // ── SweetAlert 모달 감지 (코레일 교차판매 / 이용안내) ──────────────────
    // 두 모달 모두 페이지 이동 없이 뜬다. 코레일 교차판매는 사람이 처리해야 하지만,
    // 이용안내(중련·복합운행 SRT 안내)는 "확인"만 누르면 그대로 예약 흐름이 이어진다.
    if (url.includes("selectScheduleList") || url.includes("dynaPath")) {
      const popupText = await this.page.evaluate(() => {
        const el = document.querySelector(".swal2-popup");
        return el ? (el as HTMLElement).innerText : null;
      });
      if (popupText) {
        const kind = classifyAlertPopup(popupText);
        if (kind === "notice" && noticeAttempt < BookingFlow.MAX_NOTICE_CONFIRM_ATTEMPTS) {
          log(`이용안내 모달 감지 — 자동 확인 후 예약 계속 진행:\n  "${popupText.substring(0, 100)}"`);
          await this.page.locator(".swal2-confirm").first().click().catch(() => {});
          await sleep(500);
          return this.handle(noticeAttempt + 1);
        }
        if (kind === "notice") {
          log(`이용안내 모달이 ${BookingFlow.MAX_NOTICE_CONFIRM_ATTEMPTS}회 반복돼 자동 확인을 중단합니다 — 브라우저에서 직접 진행하세요.`);
        } else {
          log(`KTX 교차판매 모달 감지:\n  "${popupText.substring(0, 100)}"`);
          log("KTX 열차는 코레일 사이트로 이동합니다. 브라우저에서 직접 진행하세요.");
        }
        await waitEnter("처리 완료 후 Enter > ");
        return;
      }
      log("예약 페이지로 이동되지 않음 — 브라우저를 직접 확인하세요.");
      await waitEnter("완료 후 Enter > ");
      return;
    }

    // ── checkUserInfo.do / 예약 확인 단계 ─────────────────────────────────
    if (url.includes("checkUserInfo") || url.includes("TK0101011")) {
      log("checkUserInfo.do 도달 — 예약 확인 처리 중...");
      const confirmed = await this.submitConfirmForm();
      if (!confirmed) {
        log("예약 확인 버튼 자동 클릭 실패 — 브라우저에서 직접 진행하세요.");
        await waitEnter("예약 완료 후 Enter > ");
      }
      return;
    }

    // ── 이미 결제 페이지에 도달한 경우 ───────────────────────────────────
    // PaymentFlow.handle()을 거치지 않은 경로라 전역 auto-accept dialog 핸들러가
    // 아직 살아있다 — 사람에게 넘기기 전에 반드시 승인 게이트로 교체한다.
    if (this.isPaymentPage(url)) {
      armPaymentApprovalGate(this.page, SRT_PAYMENT_APPROVE_FILE);
      this.notify();
      log("결제 페이지 도달 완료. 10분 내 수동 결제를 진행하세요.");
      log('최종 결제 확인 팝업은 자동으로 승인되지 않습니다 — 채팅에서 확인해야 진행됩니다.');
      await waitEnter("결제 완료 후 Enter > ");
      return;
    }

    // ── 알 수 없는 페이지 ─────────────────────────────────────────────────
    log(`알 수 없는 예약 단계 URL: ${url}`);
    log("브라우저를 직접 확인하고 예약을 완료하세요.");
    await waitEnter("완료 후 Enter > ");
  }

  // ─── checkUserInfo.do 에서 예약신청 버튼 자동 클릭 ─────────────────────
  // 최대 시도 횟수를 두는 이유: 클릭해도 URL이 안 바뀌는 상황(추가 확인 단계로
  // 오인)이 반복되면 과거엔 재귀 호출이 무한히 이어졌다 — 셀렉터 후보의
  // input[type="submit"]/button[type="submit"]처럼 넓은 폴백이 페이지의 엉뚱한
  // submit 버튼을 계속 클릭하는 경우 특히 위험했다. 이제 유한 횟수 후 사람에게 넘긴다.
  private static readonly MAX_CONFIRM_ATTEMPTS = 3;

  private async submitConfirmForm(): Promise<boolean> {
    // SRT checkUserInfo 페이지의 예약신청 버튼 후보 셀렉터 (우선순위 순)
    const candidates = [
      'input[value="예약신청"]',
      'button:has-text("예약신청")',
      'a:has-text("예약신청")',
      'input[value="예약하기"]',
      'button:has-text("예약하기")',
      'a:has-text("예약하기")',
      'input[type="submit"]',
      'button[type="submit"]',
    ];

    for (let attempt = 1; attempt <= BookingFlow.MAX_CONFIRM_ATTEMPTS; attempt++) {
      await sleep(800);

      let matchedSelector: string | null = null;
      for (const sel of candidates) {
        if ((await this.page.locator(sel).count()) > 0) {
          matchedSelector = sel;
          break;
        }
      }

      if (!matchedSelector) {
        log("예약 확인 버튼을 찾지 못했습니다. 현재 페이지 텍스트:");
        const bodyText = await this.page.evaluate(() =>
          document.body.innerText.substring(0, 300)
        );
        log(bodyText);
        return false;
      }

      log(`예약 확인 버튼 발견: ${matchedSelector} (시도 ${attempt}/${BookingFlow.MAX_CONFIRM_ATTEMPTS})`);

      const prevUrl = this.page.url();
      const navPromise = this.page
        .waitForURL(url => url.href !== prevUrl, { waitUntil: "domcontentloaded", timeout: 15_000 })
        .catch(() => null);

      await this.page.locator(matchedSelector).first().click();
      await navPromise;

      const nextUrl = this.page.url();
      log(`예약 확인 후 URL: ${nextUrl}`);

      // URL이 checkUserInfo를 벗어났으면 예약 진행된 것 → 무조건 알림 발송
      if (!nextUrl.includes("checkUserInfo") && !nextUrl.includes("TK0101011")) {
        // PaymentFlow.handle()을 거치지 않은 경로라 전역 auto-accept dialog 핸들러가
        // 아직 살아있다 — 결제 페이지라면 사람에게 넘기기 전에 승인 게이트로 교체한다.
        if (this.isPaymentPage(nextUrl)) {
          armPaymentApprovalGate(this.page, SRT_PAYMENT_APPROVE_FILE);
        }
        this.notify();
        if (this.isPaymentPage(nextUrl)) {
          log("결제 페이지 도달! 10분 내 수동 결제를 진행하세요.");
          log('최종 결제 확인 팝업은 자동으로 승인되지 않습니다 — 채팅에서 확인해야 진행됩니다.');
        } else if (this.isReservationCompletePage(nextUrl)) {
          log("예약 완료! 예매내역에서 결제를 진행하세요.");
        } else {
          log(`예약 진행됨 (URL: ${nextUrl}). 브라우저에서 결제를 완료하세요.`);
        }
        await waitEnter("완료 후 Enter > ");
        return true;
      }

      // 아직 같은 단계 — 추가 확인 단계로 보고 재시도
      log("추가 확인 단계 감지 — 다시 시도 중...");
    }

    log(`추가 확인 단계가 ${BookingFlow.MAX_CONFIRM_ATTEMPTS}회 반복돼 자동 처리를 중단합니다 — 브라우저에서 직접 진행하세요.`);
    return false;
  }

  // ─── 예약 확인 페이지 판단 (예매 버튼 클릭 직후 도달) ────────────────────
  // confirmReservationInfo.do?pageId=TK0101030000
  private isReservationConfirmPage(url: string): boolean {
    return (
      url.includes("confirmReservationInfo") ||
      url.includes("TK0101030000")
    );
  }

  // ─── 결제 대기 페이지 판단 ─────────────────────────────────────────────
  private isPaymentPage(url: string): boolean {
    return (
      url.includes("selectPayment") ||
      url.includes("insertPayment") ||
      url.includes("hpg/haa") ||       // SRT 결제 URL 패턴 추정
      url.includes("/pay/") ||
      url.includes("Payment") ||
      url.includes("TK030")             // 결제 pageId 패턴 추정
    );
  }

  // ─── 예약 완료 페이지 판단 ────────────────────────────────────────────
  private isReservationCompletePage(url: string): boolean {
    return (
      url.includes("selectReservation") ||
      url.includes("reservationComplete") ||
      url.includes("TK010201") ||       // 예매내역 페이지 패턴 추정
      url.includes("TK0102")
    );
  }

  // ─── OS 알림 + 소리 + Discord ────────────────────────────────────────
  private notify(): void {
    const trainInfo = formatTrainInfo(DEP, ARR, this.train);
    const msg = `SRT 좌석 확보! ${trainInfo} — 결제 진행하세요`;

    console.log("\n");
    console.log("══════════════════════════════════════════════");
    console.log(`  !! SRT 좌석 확보 !! ${trainInfo}`);
    console.log("  결제를 완료하세요.");
    console.log("══════════════════════════════════════════════\n");

    // macOS/Windows 공용 — node-notifier가 각 OS 기본 알림+사운드를 담당 (osascript/afplay 대체)
    notifier.notify(
      { title: "SRT 매크로", message: msg, sound: true },
      (err) => { if (err) log(`알림 전송 실패 (무시): ${err.message}`); },
    );

    sendDiscord(
      "SRT 좌석 확보!",
      `**${trainInfo}**\n결제 페이지로 이동했습니다. **10분 내 결제**하세요.`,
      0x2ecc71, // 초록
    );
  }
}
