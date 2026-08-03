/**
 * run_srt.ts — SRT 승차권 예매 폴링 매크로 진입점
 *
 * 실행:
 *   tsx srt/run_srt.ts --dep 수서 --arr 부산 --date 20260710 --time 06 --seat 일반실
 *       → dry-run: 좌석 발견 로그만 찍고 예약 클릭 없음
 *
 *   tsx srt/run_srt.ts --dep 수서 --arr 부산 --date 20260710 --time 14 --seat 일반실 --go
 *       → 실전: 좌석 발견 시 자동 예약 (결제는 사용자 수동)
 *
 * 옵션:
 *   --dep       출발역 이름  (기본: 수서)
 *   --arr       도착역 이름  (기본: 부산)
 *   --date      탑승일 YYYYMMDD  (필수)
 *   --time      SRT 조회 기준 시각 00/02/04/06/08/10/12/14/16/18/20/22  (기본: 06)
 *   --target-time 예매 탐색을 시작할 열차 출발시각 HH:mm (기본: --time의 정각)
 *   --target-end-time 예매 탐색을 끝낼 열차 출발시각 HH:mm, 경계 포함 (기본: 23:59)
 *   --seat      좌석 등급 일반실|특실  (기본: 일반실, 콤마로 복수 지정 가능: 일반실,특실)
 *   --interval  폴링 간격 ms (기본: 0 = 800~1500ms 랜덤)
 *   --go        예약 실전 실행 플래그 (없으면 dry-run)
 *   --pay-tab   결제수단 탭 신용카드|간편결제|계좌이체|포인트|레일리지 (기본: 간편결제)
 *   --easy-pay  간편결제 수단 내통장결제|네이버페이|페이코|카카오페이 (기본: 미지정, 화면 기본값 유지)
 */

import { log, sleep, randomDelay, closeRl } from "./utils.ts";
import { isDiscordConfigured } from "./discord.ts";

/**
 * config.ts는 --target-time/--target-end-time 등 CLI 인수를 모듈 평가 시점(top-level)에
 * 검증해 잘못되면 즉시 throw한다. SrtSession.ts/BookingFlow.ts/WaitlistFlow.ts도 전부
 * config.ts를 정적 import하므로, 이들을 이 파일 상단에서 정적으로 import하면 config.ts의
 * throw가 main() 진입 전 모듈 로딩 단계에서 터져 나가 사용자에게 friendly 메시지 없이
 * 스택트레이스만 보여주고 죽는다(2026-08 리뷰에서 발견). main() 안에서 동적 import로
 * 감싸 실패 시 friendly 에러 메시지 + exit(1)을 보장한다.
 */
async function loadDependencies() {
  const config = await import("./config.ts");
  const { SrtSession } = await import("./SrtSession.ts");
  const { BookingFlow } = await import("./BookingFlow.ts");
  const { WaitlistFlow } = await import("./WaitlistFlow.ts");
  const { validatePaymentSelection } = await import("./payMethod.ts");
  return { config, SrtSession, BookingFlow, WaitlistFlow, validatePaymentSelection };
}

async function main() {
  let deps: Awaited<ReturnType<typeof loadDependencies>>;
  try {
    deps = await loadDependencies();
  } catch (err) {
    console.error(`[오류] 설정 검증 실패: ${(err as Error).message}`);
    process.exit(1);
  }

  const {
    config: {
      GO, DEP, ARR, DATE, TIME, TARGET_TIME, TARGET_END_TIME, SEAT_LABEL,
      INTERVAL, MODE, daysUntil, SMS_AGREE, WAIT_SPECIAL, PAY_TAB, EASY_PAY,
    },
    SrtSession, BookingFlow, WaitlistFlow, validatePaymentSelection,
  } = deps;

  // ─── 시작 배너 ────────────────────────────────────────────────────────
  const days = DATE ? daysUntil(DATE) : null;
  const modeLabel = MODE === "WAITLIST"
    ? `예약대기 신청 (D-${days})`
    : `취소표 폴링 (D-${days})`;

  console.log("══════════════════════════════════════════════");
  console.log("  SRT 승차권 예매 매크로");
  console.log(`  모드    : ${GO ? "실전 (--go)" : "DRY RUN (클릭 없음)"}`);
  console.log(`  동작    : ${modeLabel}`);
  console.log(`  구간    : ${DEP} → ${ARR}`);
  console.log(`  날짜    : ${DATE}`);
  console.log(`  조회    : ${TIME}시 이후`);
  console.log(`  탐색    : ${TARGET_TIME}~${TARGET_END_TIME}`);
  console.log(`  좌석    : ${SEAT_LABEL}`);
  console.log(`  디스코드: ${isDiscordConfigured() ? "설정됨" : "미설정 (알림 안 옴!)"}`);
  if (MODE === "WAITLIST") {
    console.log(`  SMS동의 : ${SMS_AGREE ? "예" : "아니오"}`);
    console.log(`  특실배정: ${WAIT_SPECIAL ? "수락" : "거부"}`);
  } else {
    console.log(`  결제탭  : ${PAY_TAB}${EASY_PAY ? ` (${EASY_PAY})` : ""}`);
  }
  if (INTERVAL > 0) console.log(`  간격    : ${INTERVAL}ms 고정`);
  console.log("══════════════════════════════════════════════\n");

  // ─── 필수 인수 검증 ────────────────────────────────────────────────────
  if (!DATE) {
    console.error("[오류] --date 옵션 필수 (예: --date 20260710)");
    process.exit(1);
  }

  // ─── 결제수단 인수 사전 검증 ─────────────────────────────────────────────
  // 좌석 확보(임시 10분 확보) 이후 PaymentFlow 실행 시점에야 --pay-tab/--easy-pay
  // 오타가 발각되면 throw로 프로세스가 죽고 브라우저가 닫히며 좌석이 유실된다 —
  // 세션 생성 전에 미리 검증해 fail-fast 시킨다.
  try {
    validatePaymentSelection(PAY_TAB, EASY_PAY);
  } catch (err) {
    console.error(`[오류] ${(err as Error).message}`);
    process.exit(1);
  }

  // ─── 세션 생성 & 로그인 ────────────────────────────────────────────────
  const session = await SrtSession.create();
  await session.ensureLogin();

  // ─── 최초 조회 ─────────────────────────────────────────────────────────
  await session.searchTrains();

  const pollDelay = () => INTERVAL > 0 ? sleep(INTERVAL) : randomDelay();
  let pollCount = 0;

  // ─── WAITLIST 모드: 예약대기 신청 ──────────────────────────────────────
  if (MODE === "WAITLIST") {
    log(`예약대기 탐색 시작 — 조회 ${TIME}시 이후 / 탐색 ${TARGET_TIME}~${TARGET_END_TIME} ${SEAT_LABEL}`);

    while (true) {
      pollCount++;
      const train = await session.findTargetTrain();

      if (!train) {
        log(`${pollCount}회 — ${TARGET_TIME}~${TARGET_END_TIME} 열차 없음. 재조회 중...`);
        await pollDelay();
        await session.requery();
        continue;
      }

      const prefix = `${pollCount}회 — ${train.trainNo}호 ${train.depTime} [${train.matchedSeat}]`;

      // 취소표가 먼저 나왔으면 바로 예약
      if (train.seatAvailable) {
        log(`\n!! ${prefix} 잔여석 발견 !! (예약대기 모드지만 취소표 즉시 예약)`);
        if (!GO) {
          log("DRY RUN — 예약 클릭 생략.");
          break;
        }
        const bookingPage = await session.clickReserve(train.rowIndex, train.matchedSeat);
        await new BookingFlow(bookingPage, train).handle();
        break;
      }

      if (train.waitlistAvailable) {
        log(`\n!! ${prefix} 예약대기 버튼 발견 !!`);
        if (!GO) {
          log("DRY RUN — 예약대기 클릭 생략. --go 플래그를 추가하면 실전 신청.");
          break;
        }
        log("예약대기 신청 클릭 실행!");
        const waitlistPage = await session.clickWaitlist(train.rowIndex, train.matchedSeat);
        await new WaitlistFlow(waitlistPage, train).handle();
        break;
      }

      log(`${prefix} 매진 (예약대기 버튼 미감지, 조회된 ${train.candidateCount}개). 재조회 중...`);
      await pollDelay();
      await session.requery();
    }
  } else {
    // ─── POLLING 모드: 취소표 실시간 폴링 ───────────────────────────────
    log(`폴링 시작 — 조회 ${TIME}시 이후 / 탐색 ${TARGET_TIME}~${TARGET_END_TIME} ${SEAT_LABEL}`);

    while (true) {
      pollCount++;
      const train = await session.findTargetTrain();

      if (!train) {
        log(`${pollCount}회 — ${TARGET_TIME}~${TARGET_END_TIME} 열차 없음. 재조회 중...`);
        await pollDelay();
        await session.requery();
        continue;
      }

      const prefix = `${pollCount}회 — ${train.trainNo}호 ${train.depTime} [${train.matchedSeat}]`;

      if (!train.seatAvailable) {
        log(`${prefix} 매진 (조회된 ${train.candidateCount}개 열차 모두 매진). 재조회 중...`);
        await pollDelay();
        await session.requery();
        continue;
      }

      // 좌석 발견
      log(`\n!! ${prefix} 좌석 발견 !! 상태: "${train.statusText}"`);

      if (!GO) {
        log("DRY RUN — 예약 클릭 생략. --go 플래그를 추가하면 실전 예약.");
        break;
      }

      log("예약하기 클릭 실행!");
      const bookingPage = await session.clickReserve(train.rowIndex, train.matchedSeat);
      await new BookingFlow(bookingPage, train).handle();
      break;
    }
  }

  closeRl();
  log("매크로 종료. 브라우저를 닫으려면 Ctrl+C");
  await new Promise(() => {}); // 브라우저 유지
}

main().catch((err) => {
  console.error("[오류]", err);
  process.exit(1);
});
