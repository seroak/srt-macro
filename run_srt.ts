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
 */

import { GO, DEP, ARR, DATE, TIME, TARGET_TIME, TARGET_END_TIME, SEAT_LABEL, INTERVAL, MODE, daysUntil, SMS_AGREE, WAIT_SPECIAL } from "./config.ts";
import { log, sleep, randomDelay, closeRl } from "./utils.ts";
import { SrtSession } from "./SrtSession.ts";
import { BookingFlow } from "./BookingFlow.ts";
import { WaitlistFlow } from "./WaitlistFlow.ts";
import { isDiscordConfigured } from "./discord.ts";

async function main() {
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
  }
  if (INTERVAL > 0) console.log(`  간격    : ${INTERVAL}ms 고정`);
  console.log("══════════════════════════════════════════════\n");

  // ─── 필수 인수 검증 ────────────────────────────────────────────────────
  if (!DATE) {
    console.error("[오류] --date 옵션 필수 (예: --date 20260710)");
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
        await new BookingFlow(bookingPage, train.matchedSeat).handle();
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
        await new WaitlistFlow(waitlistPage, train.matchedSeat).handle();
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
      await new BookingFlow(bookingPage, train.matchedSeat).handle();
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
