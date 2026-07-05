import notifier from "node-notifier";
import { type Page } from "playwright";
import { DEP, ARR, TIME, SMS_AGREE, WAIT_SPECIAL } from "./config.ts";
import { log, sleep, waitEnter } from "./utils.ts";
import { sendDiscord } from "./discord.ts";

/**
 * WaitlistFlow — 예약대기 신청 페이지 처리.
 *
 * SRT 예약대기 흐름:
 *   예약대기 버튼 클릭 → 신청 페이지 (SMS 동의 / 특실 선택)
 *   → 신청 완료 버튼 클릭 → 순번 안내 페이지
 *
 * NOTE: 신청 페이지 셀렉터(체크박스 id, 신청 버튼 selector)는
 *       라이브 DevTools 확인 후 교체 필요. 현재는 추정값.
 *
 * handle()만 public.
 */
export class WaitlistFlow {
  /** @param seatLabel 실제로 예약대기 신청된 좌석 등급 (복수 등급 감시 시 매칭된 등급) */
  constructor(
    private readonly page: Page,
    private readonly seatLabel: string,
  ) {}

  async handle(): Promise<void> {
    const url = this.page.url();
    log(`[WaitlistFlow] 현재 URL: ${url}`);

    // ── 예약대기 신청 페이지 진입 여부 확인 ──────────────────────────────
    const isWaitlistPage =
      url.includes("requestWaiting") ||
      url.includes("waitList") ||
      url.includes("selectWaiting") ||
      url.includes("Waiting");

    if (!isWaitlistPage) {
      log(`예약대기 신청 페이지로 이동되지 않음 (URL: ${url})`);
      log("브라우저에서 직접 예약대기를 신청하세요.");
      await waitEnter("신청 완료 후 Enter > ");
      return;
    }

    await sleep(800);
    const submitted = await this.submitWaitlistForm();
    if (!submitted) {
      log("예약대기 신청 자동 처리 실패 — 브라우저에서 직접 진행하세요.");
      await waitEnter("신청 완료 후 Enter > ");
    }
  }

  // ─── 예약대기 신청 폼 처리 ─────────────────────────────────────────────
  /**
   * NOTE: 아래 셀렉터들은 라이브 SRT 페이지 확인 후 갱신 필요.
   *       체크박스 id, 라디오 name 등이 다를 경우 DevTools에서 직접 확인.
   */
  private async submitWaitlistForm(): Promise<boolean> {
    // ── SMS 수신 동의 체크박스 ───────────────────────────────────────────
    // TODO: 실제 id/name은 라이브 확인 후 교체
    const smsCandidates = [
      "#smsYn",
      'input[name="smsYn"]',
      'input[type="checkbox"][id*="sms"]',
      'input[type="checkbox"][id*="Sms"]',
    ];
    for (const sel of smsCandidates) {
      const el = this.page.locator(sel).first();
      if (await el.count() > 0) {
        const checked = await el.isChecked();
        if (SMS_AGREE && !checked) {
          await el.check();
          log(`SMS 수신 동의 체크 완료 (${sel})`);
        } else if (!SMS_AGREE && checked) {
          await el.uncheck();
          log(`SMS 수신 동의 해제 (${sel})`);
        } else {
          log(`SMS 수신 동의 상태 유지: ${checked ? "동의" : "미동의"}`);
        }
        break;
      }
    }

    // ── 특실 취소표 배정 여부 ────────────────────────────────────────────
    // 일반실로 예약대기 신청했을 때만 유의미 (특실 자체를 신청했으면 불필요)
    // TODO: 실제 셀렉터는 라이브 확인 후 교체
    if (this.seatLabel === "일반실") {
      const specialCandidates = [
        "#spcSeatYn",
        'input[name="spcSeatYn"]',
        'input[type="checkbox"][id*="spc"]',
        'input[type="radio"][value="Y"][name*="special"]',
      ];
      for (const sel of specialCandidates) {
        const el = this.page.locator(sel).first();
        if (await el.count() > 0) {
          const checked = await el.isChecked();
          if (WAIT_SPECIAL && !checked) {
            await el.check();
            log(`특실 취소표 배정 수락 설정 (${sel})`);
          } else if (!WAIT_SPECIAL && checked) {
            await el.uncheck();
            log(`특실 취소표 배정 미수락 설정 (${sel})`);
          }
          break;
        }
      }
    }

    await sleep(400);

    // ── 신청 완료 버튼 클릭 ──────────────────────────────────────────────
    // TODO: 실제 셀렉터는 라이브 확인 후 교체
    const submitCandidates = [
      'input[value="예약대기신청"]',
      'button:has-text("예약대기신청")',
      'a:has-text("예약대기신청")',
      'input[value="신청"]',
      'button:has-text("신청하기")',
      'input[type="submit"]',
    ];

    for (const sel of submitCandidates) {
      const count = await this.page.locator(sel).count();
      if (count > 0) {
        log(`예약대기 신청 버튼 발견: ${sel}`);

        const prevUrl = this.page.url();
        const navPromise = this.page
          .waitForURL(url => url.href !== prevUrl, { waitUntil: "domcontentloaded", timeout: 15_000 })
          .catch(() => null);

        await this.page.locator(sel).first().click();
        await navPromise;

        const nextUrl = this.page.url();
        log(`신청 후 URL: ${nextUrl}`);

        // 순번 안내 / 완료 페이지 감지
        const rankText = await this.page.evaluate(() => {
          const body = document.body.innerText;
          // "순번", "예약대기", "접수" 키워드로 완료 판단
          if (body.includes("순번") || body.includes("대기번호") || body.includes("접수완료")) {
            // 순번 숫자 추출 시도
            const m = body.match(/(\d+)\s*번/);
            return m ? m[1] : "완료";
          }
          return null;
        });

        if (rankText) {
          this.notify(rankText);
          log(`예약대기 신청 완료 — 순번: ${rankText}번`);
          log("다음날 오전 9시에 SMS(카카오 알림톡)로 배정 결과를 안내받습니다.");
          log("배정 시 당일 자정(24:00)까지 SRT 앱/홈페이지에서 결제하세요.");
          return true;
        }

        // 완료 키워드 미감지 — 페이지 텍스트 일부 출력
        log("신청 완료 페이지 미감지. 현재 페이지 내용:");
        const bodySnippet = await this.page.evaluate(() =>
          document.body.innerText.substring(0, 300)
        );
        log(bodySnippet);
        return true; // 버튼 클릭은 성공했으므로 true 반환
      }
    }

    log("예약대기 신청 버튼을 찾지 못했습니다. 현재 페이지:");
    const bodyText = await this.page.evaluate(() =>
      document.body.innerText.substring(0, 300)
    );
    log(bodyText);
    return false;
  }

  // ─── OS 알림 + 소리 + Discord ────────────────────────────────────────
  private notify(rank: string): void {
    const trainInfo = `${DEP}→${ARR} ${TIME}시 이후 ${this.seatLabel}`;
    const msg = `SRT 예약대기 ${rank}번 신청 완료! ${trainInfo} — 내일 오전 9시 배정 안내`;

    console.log("\n");
    console.log("══════════════════════════════════════════════");
    console.log(`  !! SRT 예약대기 신청 완료 !! ${trainInfo}`);
    console.log(`  순번: ${rank}번 — 내일 오전 9시 카카오 알림톡으로 안내`);
    console.log("  배정 시 당일 자정까지 결제하세요.");
    console.log("══════════════════════════════════════════════\n");

    // macOS/Windows 공용 — node-notifier가 각 OS 기본 알림+사운드를 담당 (osascript/afplay 대체)
    notifier.notify(
      { title: "SRT 매크로", message: msg, sound: true },
      (err) => { if (err) log(`알림 전송 실패 (무시): ${err.message}`); },
    );

    sendDiscord(
      "SRT 예약대기 신청 완료!",
      `**${trainInfo}**\n순번: **${rank}번**\n내일 오전 9시 카카오 알림톡으로 배정 안내를 받습니다.\n배정 시 **당일 자정까지 결제**하세요.`,
      0x3498db, // 파랑
    );
  }
}
