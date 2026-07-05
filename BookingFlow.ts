import notifier from "node-notifier";
import { type Page } from "playwright";
import { DEP, ARR, TIME } from "./config.ts";
import { log, sleep, waitEnter } from "./utils.ts";
import { sendDiscord } from "./discord.ts";

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
  /** @param seatLabel 실제로 확보된 좌석 등급 (복수 등급 감시 시 매칭된 등급) */
  constructor(
    private readonly page: Page,
    private readonly seatLabel: string,
  ) {}

  async handle(): Promise<void> {
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
      log("결제 페이지로 진행하세요. 10분 내 결제 필요.");
      await waitEnter("결제 완료 후 Enter > ");
      return;
    }

    // ── KTX 교차판매 SweetAlert 감지 ──────────────────────────────────────
    // KTX 열차는 페이지 이동 없이 모달이 뜸 → 사용자가 직접 처리
    if (url.includes("selectScheduleList") || url.includes("dynaPath")) {
      const hasKtxAlert = await this.page.evaluate(() => {
        const el = document.querySelector(".swal2-popup");
        return el ? (el as HTMLElement).innerText.substring(0, 100) : null;
      });
      if (hasKtxAlert) {
        log(`KTX 교차판매 모달 감지:\n  "${hasKtxAlert}"`);
        log("KTX 열차는 코레일 사이트로 이동합니다. 브라우저에서 직접 진행하세요.");
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
    if (this.isPaymentPage(url)) {
      this.notify();
      log("결제 페이지 도달 완료. 10분 내 수동 결제를 진행하세요.");
      await waitEnter("결제 완료 후 Enter > ");
      return;
    }

    // ── 알 수 없는 페이지 ─────────────────────────────────────────────────
    log(`알 수 없는 예약 단계 URL: ${url}`);
    log("브라우저를 직접 확인하고 예약을 완료하세요.");
    await waitEnter("완료 후 Enter > ");
  }

  // ─── checkUserInfo.do 에서 예약신청 버튼 자동 클릭 ─────────────────────
  private async submitConfirmForm(): Promise<boolean> {
    await sleep(800);

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

    for (const sel of candidates) {
      const count = await this.page.locator(sel).count();
      if (count > 0) {
        log(`예약 확인 버튼 발견: ${sel}`);

        const prevUrl = this.page.url();
        const navPromise = this.page
          .waitForURL(url => url.href !== prevUrl, { waitUntil: "domcontentloaded", timeout: 15_000 })
          .catch(() => null);

        await this.page.locator(sel).first().click();
        await navPromise;

        const nextUrl = this.page.url();
        log(`예약 확인 후 URL: ${nextUrl}`);

        // URL이 checkUserInfo를 벗어났으면 예약 진행된 것 → 무조건 알림 발송
        if (!nextUrl.includes("checkUserInfo") && !nextUrl.includes("TK0101011")) {
          this.notify();
          if (this.isPaymentPage(nextUrl)) {
            log("결제 페이지 도달! 10분 내 수동 결제를 진행하세요.");
          } else if (this.isReservationCompletePage(nextUrl)) {
            log("예약 완료! 예매내역에서 결제를 진행하세요.");
          } else {
            log(`예약 진행됨 (URL: ${nextUrl}). 브라우저에서 결제를 완료하세요.`);
          }
          await waitEnter("완료 후 Enter > ");
          return true;
        }

        // 아직 같은 단계 — 추가 확인 단계 재시도
        log("추가 확인 단계 감지 — 다시 시도 중...");
        return this.submitConfirmForm();
      }
    }

    log("예약 확인 버튼을 찾지 못했습니다. 현재 페이지 텍스트:");
    const bodyText = await this.page.evaluate(() =>
      document.body.innerText.substring(0, 300)
    );
    log(bodyText);
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
    const trainInfo = `${DEP}→${ARR} ${TIME}시 이후 ${this.seatLabel}`;
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
