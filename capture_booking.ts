/**
 * srt/capture_booking.ts — 결제 화면 구조 라이브 캡처 (일회성 진단 스크립트, Phase 0)
 *
 * 목적: PaymentFlow(결제 자동화) 구현에 필요한 실제 DOM 구조(버튼 셀렉터·폼 필드명)를
 * 확보하기 위해 실제 좌석을 1건 잡고 결제 승인 직전까지 화면을 캡처한다.
 *
 * 안전장치: 이 스크립트는 결제 승인 버튼을 절대 클릭하지 않는다.
 * confirmReservationInfo.do(좌석 10분 임시 확보) 도달 이후부터는 사용자가 직접
 * 브라우저(headless:false로 뜨는 실제 창)에서 클릭하고, 스크립트는 URL이 바뀔 때마다
 * 자동으로 그 시점을 캡처한다 — 사람이 터미널에 키를 칠 필요가 없다.
 * 카드 정보 입력 화면에서 더 이상 진행하지 말고, 승인 버튼 앞에서 멈추면 된다
 * (자동 캡처는 일정 시간 새 화면 전환이 없으면 스스로 종료한다).
 *
 * 실행: tsx srt/capture_booking.ts --date 20260803
 *   (--dep/--arr/--time 기본값이 수서/부산/06시라 8/3 전체 조회 후 잔여석 있는 열차를 잡음)
 *   --pay-tab 신용카드|간편결제|계좌이체|포인트|레일리지 (기본: 간편결제, config.ts PAY_TAB)
 *     — 결제수단 선택 화면에서 클릭할 탭. 셀렉터 매핑은 payMethod.ts.
 *
 * 안전장치(2026-07-30 추가): 결제수단 선택 화면 도달 시점부터 SrtSession의 전역
 * dialog 자동승인 핸들러를 제거하고 paymentApproval.ts의 승인 파일 게이트로 교체한다
 * (PaymentFlow.ts와 동일) — 결제 확인창이 사람 확인 없이 자동 승인되는 걸 막기 위함.
 * 새로 열리는 팝업 창(간편결제가 흔히 이런 방식)도 감지해 같은 게이트를 적용하고 캡처한다.
 *
 * 캡처 종료 후 SRT 예매내역에서 해당 예약을 반드시 취소한다(결제 전 취소는 무료).
 * 출력물(srt/capture/)은 이름·전화번호 등 개인정보가 찍히므로 .gitignore 대상.
 */
import * as fs from "fs";
import * as path from "path";
import { type Page, type Dialog } from "playwright";
import { DEP, ARR, DATE, TARGET_TIME, TARGET_END_TIME, SEAT_LABEL, SRT_PAYMENT_APPROVE_FILE, PAY_TAB } from "./config.ts";
import { log, randomDelay } from "./utils.ts";
import { SrtSession } from "./SrtSession.ts";
import { waitForPaymentApproval } from "./paymentApproval.ts";
import { resolvePayTabSelector } from "./payMethod.ts";

const CAPTURE_DIR = path.join(import.meta.dirname, "capture");

/** 현재 페이지의 URL·HTML·form 필드·클릭 가능 요소를 파일로 덤프 */
async function dump(page: Page, step: number, label: string): Promise<void> {
  fs.mkdirSync(CAPTURE_DIR, { recursive: true });
  const base = path.join(CAPTURE_DIR, `${String(step).padStart(2, "0")}-${label}`);
  const url = page.url();
  const html = await page.content().catch(async () => {
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    return page.content();
  });
  const meta = await page.evaluate(() => ({
    forms: Array.from(document.forms).map((f) => ({
      name: f.name,
      id: f.id,
      action: f.action,
      method: f.method,
      fields: Array.from(f.elements)
        .map((e) => ({
          tag: e.tagName,
          name: (e as HTMLInputElement).name,
          id: e.id,
          type: (e as HTMLInputElement).type,
        }))
        .filter((x) => x.name || x.id),
    })),
    buttons: Array.from(
      document.querySelectorAll('a, button, input[type="submit"], input[type="button"]'),
    )
      .map((e) => ({
        tag: e.tagName,
        text: ((e as HTMLElement).innerText || (e as HTMLInputElement).value || "").trim().substring(0, 60),
        id: e.id,
        cls: (e as HTMLElement).className,
        onclick: (e.getAttribute("onclick") || "").substring(0, 200),
      }))
      .filter((b) => b.text || b.onclick),
  }));

  fs.writeFileSync(`${base}.html`, html);
  fs.writeFileSync(`${base}.json`, JSON.stringify({ url, ...meta }, null, 2));
  await page.screenshot({ path: `${base}.png` }).catch(() => {});
  log(`캡처 ${step}: ${label} — ${url}`);
}

/**
 * 다음 URL 전환을 기다렸다가(사람이 브라우저에서 클릭) 자동 캡처 — 최대 maxCaptures회,
 * 각 대기는 perStepTimeoutMs 안에 전환이 없으면 중단(= 사용자가 카드입력 화면에서 멈춘 것으로 간주).
 */
async function dumpUntilStable(
  page: Page,
  startStep: number,
  maxCaptures: number,
  perStepTimeoutMs: number,
): Promise<void> {
  let curUrl = page.url();
  for (let i = 0; i < maxCaptures; i++) {
    const changed = await page
      .waitForURL((u) => u.href !== curUrl, { timeout: perStepTimeoutMs })
      .then(() => true)
      .catch(() => false);
    if (!changed) {
      log("일정 시간 화면 전환 없음 — 자동 캡처 종료 (카드입력 화면에서 멈춘 것으로 판단)");
      return;
    }
    curUrl = page.url();
    await page.waitForLoadState("domcontentloaded").catch(() => {});
    await dump(page, startStep + i, `auto-${startStep + i}`);
  }
  log(`최대 캡처 횟수(${maxCaptures}) 도달 — 자동 캡처 종료`);
}

/**
 * SrtSession의 전역 dialog 자동승인 핸들러를 제거하고, 이후의 모든 dialog를
 * 승인 파일 게이트로 전환한다 — PaymentFlow.ts와 동일한 안전장치.
 * (2026-07-30: 이 게이트 없이 결제 화면까지 진입시켰다가 실제 결제 확인창까지
 * 자동승인된 사고가 있었음 — docs/solutions/logic-errors/ 참고)
 */
function armSafeDialogGate(page: Page): void {
  page.removeAllListeners("dialog");
  fs.rmSync(SRT_PAYMENT_APPROVE_FILE, { force: true });
  page.on("dialog", (dialog: Dialog) => {
    gateDialog(dialog).catch((err) => log(`팝업 처리 중 오류: ${err.message}`));
  });
}

async function gateDialog(dialog: Dialog): Promise<void> {
  log(`[결제단계 팝업] [${dialog.type()}] ${dialog.message()}`);
  log(`승인하려면 채팅에서 확인 후 "${SRT_PAYMENT_APPROVE_FILE}" 생성 — 최대 5분 대기 (기본은 취소)`);
  const approved = await waitForPaymentApproval(SRT_PAYMENT_APPROVE_FILE, 5 * 60_000);
  if (approved) {
    log("승인 신호 확인 — 진행");
    await dialog.accept().catch(() => {});
  } else {
    log("5분 내 승인 신호 없음 — 취소 처리");
    await dialog.dismiss().catch(() => {});
  }
}

async function main() {
  if (!DATE) {
    console.error("[오류] --date 옵션 필수 (예: --date 20260803)");
    process.exit(1);
  }

  console.log("══════════════════════════════════════════════");
  console.log("  SRT 결제 화면 캡처 (Phase 0 — 일회성 진단, 실제 좌석 확보됨)");
  console.log(`  구간: ${DEP} → ${ARR}, ${DATE}, 탐색 ${TARGET_TIME}~${TARGET_END_TIME}, ${SEAT_LABEL}`);
  console.log("  주의: 결제 승인 버튼은 이 스크립트도, 당신도 누르지 마세요.");
  console.log("══════════════════════════════════════════════\n");

  const session = await SrtSession.create();
  await session.ensureLogin();
  await session.searchTrains();

  let pollCount = 0;
  let train = await session.findTargetTrain();
  while (!train?.seatAvailable) {
    pollCount++;
    log(`${pollCount}회 — ${TARGET_TIME}~${TARGET_END_TIME} 잔여석 없음. 재조회 중...`);
    await randomDelay();
    await session.requery();
    train = await session.findTargetTrain();
  }

  log(`\n!! ${train.trainNo}호 ${train.depTime} [${train.matchedSeat}] 잔여석 발견 — 예약 클릭 !!`);
  const bookingPage = await session.clickReserve(train.rowIndex, train.matchedSeat);
  await dump(bookingPage, 1, "post-reserve-click");

  const urlAfterClick = bookingPage.url();
  if (urlAfterClick.includes("checkUserInfo") || urlAfterClick.includes("TK0101011")) {
    const candidates = ['input[value="예약신청"]', 'button:has-text("예약신청")', 'a:has-text("예약신청")'];
    let clicked = false;
    for (const sel of candidates) {
      const count = await bookingPage.locator(sel).count();
      if (count > 0) {
        log(`예약신청 버튼 발견: ${sel} — 클릭`);
        const navPromise = bookingPage
          .waitForURL((u) => u.href !== urlAfterClick, { timeout: 15_000 })
          .catch(() => null);
        await bookingPage.locator(sel).first().click();
        await navPromise;
        clicked = true;
        break;
      }
    }
    if (!clicked) {
      log("예약신청 버튼을 자동으로 찾지 못함 — 브라우저에서 직접 클릭해도 자동 감지됩니다");
      await bookingPage
        .waitForURL((u) => u.href !== urlAfterClick, { timeout: 5 * 60_000 })
        .catch(() => log("5분 내 화면 전환 없음 — checkUserInfo 단계에서 중단"));
    }
  }

  await dump(bookingPage, 2, "confirm-reservation");

  // ── "결제하기"(settleAmount()) 자동 클릭 — 좌석확보 화면은 셀렉터가 이미 확인됨 ──
  const payBtn = bookingPage.locator('a:has-text("결제하기"), button:has-text("결제하기")').first();
  if (await payBtn.count() > 0) {
    log('"결제하기" 버튼 발견 — 클릭');
    const urlBeforePay = bookingPage.url();
    const navPromise = bookingPage
      .waitForURL((u) => u.href !== urlBeforePay, { timeout: 15_000 })
      .then(() => true)
      .catch(() => false);
    await payBtn.click();
    const navigated = await navPromise;
    if (navigated) {
      await bookingPage.waitForLoadState("domcontentloaded").catch(() => {});
      await dump(bookingPage, 3, "post-pay-click");
    } else {
      log("결제하기 클릭 후 URL 변화 없음 — 같은 페이지에서 캡처");
      await dump(bookingPage, 3, "post-pay-click-same-url");
    }
  } else {
    log('"결제하기" 버튼을 찾지 못함 — 수동 진행 대기');
  }

  // ── 이 시점부터 결제 화면 근처 — 전역 dialog 자동승인을 승인 파일 게이트로 교체 ──
  armSafeDialogGate(bookingPage);

  // ── 간편결제는 새 팝업 창으로 뜨는 경우가 많다 — 새 창이 열리면 감지해서 같이 캡처 ──
  let popupStep = 90;
  bookingPage.context().on("page", (popup) => {
    popup.waitForLoadState("domcontentloaded").then(async () => {
      log(`새 창 감지: ${popup.url()}`);
      armSafeDialogGate(popup);
      await dump(popup, popupStep++, "popup").catch((err) => log(`팝업 캡처 실패: ${err.message}`));
      await dumpUntilStable(popup, popupStep, 8, 5 * 60_000);
    }).catch((err) => log(`새 창 처리 실패: ${err.message}`));
  });

  const tab = bookingPage.locator(resolvePayTabSelector(PAY_TAB)).first();
  if ((await tab.count()) > 0) {
    log(`"${PAY_TAB}" 탭 클릭`);
    await tab.click().catch(() => {});
    await bookingPage.waitForTimeout(500);
    await dump(bookingPage, 4, `pay-tab-${PAY_TAB}`);
  } else {
    log(`"${PAY_TAB}" 탭을 찾지 못함 — 브라우저에서 직접 선택하세요`);
  }

  console.log("\n══════════════════════════════════════════════");
  console.log("  여기서부터는 브라우저에서 직접 클릭해 진행하세요 — 화면이 바뀔 때마다 자동 캡처됩니다.");
  console.log(`  ${PAY_TAB} 결제수단(예: 네이버페이) 선택 → 비밀번호 인증까지는 직접 진행해도 됩니다.`);
  console.log("  단, 결제 승인(최종 결제) 버튼은 누르지 마세요 — 확인 팝업이 떠도 자동 승인되지 않습니다.");
  console.log("  일정 시간 더 클릭하지 않으면 자동으로 캡처가 종료됩니다.");
  console.log("══════════════════════════════════════════════\n");

  await dumpUntilStable(bookingPage, 5, 10, 5 * 60_000);

  log("\n캡처 종료. SRT 예매내역에서 이 예약을 지금 취소하세요 (결제 전 취소는 무료).");
  log("취소를 마쳤다고 채팅으로 알려주면 이 스크립트를 종료합니다 (브라우저는 그때까지 열려 있습니다).");
  await new Promise(() => {});
}

main().catch((err) => {
  console.error("[오류]", err);
  process.exit(1);
});
