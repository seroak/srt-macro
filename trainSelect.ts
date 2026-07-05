/**
 * srt/trainSelect.ts — 열차 결과 테이블 파싱 및 목표 열차 선정 알고리즘
 *
 * SrtSession.findTargetTrain()이 page.evaluate(selectTargetTrain, opts)로 실행한다.
 * page.evaluate는 함수를 Function.prototype.toString()으로 직렬화해 브라우저 컨텍스트에서
 * 재실행하므로, 이 파일의 export 함수는 모듈 스코프 변수를 참조하지 않는 self-contained
 * 함수여야 한다 (document·전달된 opts만 사용).
 */

export interface SeatSelectOpts {
  /** 목표 시각 범위 시작 HH:MM */
  fromTime: string;
  /** 목표 시각 범위 종료 HH:MM */
  toTime: string;
  /** 감시할 좌석 등급 목록 (우선순위 = 배열 순서) */
  seatClasses: string[];
}

export interface TrainSelectResult {
  /** 결과 테이블에서의 row 순서 (0-based) — 버튼 id에 사용 */
  rowIndex: number;
  trainNo: string;
  depTime: string; // "HH:MM"
  arrTime: string; // "HH:MM"
  /** true = 예약 가능 버튼 활성 (잔여 좌석 있음) */
  seatAvailable: boolean;
  /** 해당 좌석 컬럼의 텍스트 ("예약하기", "매진", "예약대기" 등) */
  statusText: string;
  /** 범위 내 열차 총 수 */
  inRangeCount: number;
  /** 예약대기 버튼 존재 여부 (매진 + WAITLIST 모드에서 유의미) */
  waitlistAvailable: boolean;
  /** seatClasses 중 실제로 취소표/예약대기가 매칭된 등급 (복수 등급 감시 시 사용) */
  matchedSeat: string;
}

/**
 * 결과 테이블을 파싱해 [fromTime ~ toTime] 범위 내 좌석 상태 반환.
 * - 범위 내 잔여석 열차 발견 → 해당 열차 반환 (seatAvailable: true)
 * - 범위 내 열차 있지만 전부 매진 → 첫 번째 열차 반환 (seatAvailable: false)
 * - 범위 내 열차 없음 → null
 */
// NOTE: 이 함수 안에서는 `const f = (x) => ...` 형태의 지역 헬퍼 함수를 만들지 않는다.
// tsx(esbuild)가 keepNames 옵션으로 모든 지역 함수를 `__name(fn, "이름")` 호출로
// 감싸는데, 이 헬퍼는 모듈 스코프에만 정의돼 있어 Playwright가 이 함수 하나만
// .toString()으로 직렬화해 브라우저에 보낼 때 "__name is not defined"로 깨진다.
// 그래서 컬럼 인덱스/입석 여부 판별은 지역 함수로 추출하지 않고 인라인 표현식으로 둔다.
export function selectTargetTrain(opts: SeatSelectOpts): TrainSelectResult | null {
  const { fromTime, toTime, seatClasses } = opts;

  const rows = document.querySelectorAll("table tbody tr");
  let firstInRange: TrainSelectResult | null = null;
  let inRangeCount = 0;

  for (let i = 0; i < rows.length; i++) {
    const tds = rows[i].querySelectorAll("td");
    if (tds.length < 7) continue;

    const trainNo = tds[2].innerText?.trim() ?? "";
    const depTime = (tds[3].querySelector("em.time") as HTMLElement | null)?.innerText?.trim() ?? "";
    const arrTime = (tds[4].querySelector("em.time") as HTMLElement | null)?.innerText?.trim() ?? "";

    // HH:MM 문자열 비교로 범위 필터
    if (depTime < fromTime || depTime > toTime) continue;
    inRangeCount++;

    // ── 좌석 등급을 우선순위(입력 순서)대로 검사 ──────────────────────
    // 취소표가 있는 첫 번째 등급을 즉시 채택. 없으면 예약대기 가능한
    // 첫 번째 등급을 기록해두고 다음 등급도 계속 검사한다.
    let matchedSeat = seatClasses[0] ?? "";
    let statusText = "";
    let seatAvailable = false;
    let waitlistAvailable = false;

    for (const sc of seatClasses) {
      const colIdx = sc === "특실" ? 5 : 6;
      const seatCell = tds[colIdx];
      if (!seatCell) continue;
      const isStanding = sc === "입석+좌석";

      // ── 취소표 예약 버튼 감지 ────────────────────────────────────
      // 입석+좌석: requestReservationInfoAnn (native alert 먼저 띄움)
      // 일반실/특실: requestReservationInfo (Ann 제외)
      // KTX 교차판매(showKorailBookingChoice)는 예약 대상 아님
      let reserveBtn: Element | null = null;
      if (isStanding) {
        reserveBtn = seatCell.querySelector(
          'a[onclick*="requestReservationInfoAnn"], button[onclick*="requestReservationInfoAnn"]',
        );
        if (!reserveBtn) {
          reserveBtn =
            Array.from(seatCell.querySelectorAll("a, button")).find((el) =>
              (el as HTMLElement).innerText?.includes("입석"),
            ) ?? null;
        }
      } else {
        reserveBtn =
          Array.from(seatCell.querySelectorAll("a, button")).find((el) => {
            const onclick = el.getAttribute("onclick") ?? "";
            return onclick.includes("requestReservationInfo") && !onclick.includes("requestReservationInfoAnn");
          }) ?? null;
        if (!reserveBtn) {
          reserveBtn =
            Array.from(seatCell.querySelectorAll("a, button")).find(
              (el) =>
                (el as HTMLElement).innerText?.includes("예약") &&
                !(el as HTMLElement).innerText?.includes("예약대기") &&
                !(el as HTMLElement).innerText?.includes("입석") &&
                !(el.getAttribute("onclick") ?? "").includes("showKorail"),
            ) ?? null;
        }
      }

      if (reserveBtn) {
        // 취소표 발견 — 이 등급으로 즉시 확정, 낮은 우선순위 등급은 검사 불필요
        matchedSeat = sc;
        statusText = seatCell.innerText?.replace(/\s+/g, " ").trim() ?? "";
        seatAvailable = true;
        break;
      }

      // ── 예약대기 버튼 감지 (WAITLIST 모드에서 사용, 취소표 없을 때만 유효) ──
      // TODO: 실제 onclick 함수명은 라이브 DevTools로 확인 후 교체 필요.
      //       현재는 "예약대기" 텍스트 폴백만 사용.
      if (!waitlistAvailable) {
        let waitlistBtn: Element | null = seatCell.querySelector(
          'a[onclick*="requestWaitingReservation"], button[onclick*="requestWaitingReservation"],' +
            'a[onclick*="waitList"], button[onclick*="waitList"]',
        );
        if (!waitlistBtn) {
          waitlistBtn =
            Array.from(seatCell.querySelectorAll("a, button")).find((el) =>
              (el as HTMLElement).innerText?.includes("예약대기"),
            ) ?? null;
        }
        if (waitlistBtn) {
          waitlistAvailable = true;
          matchedSeat = sc;
          statusText = seatCell.innerText?.replace(/\s+/g, " ").trim() ?? "";
        }
      }
    }

    if (seatAvailable) {
      return {
        rowIndex: i,
        trainNo,
        depTime,
        arrTime,
        seatAvailable: true,
        statusText,
        inRangeCount,
        waitlistAvailable: false,
        matchedSeat,
      };
    }
    if (!firstInRange) {
      firstInRange = {
        rowIndex: i,
        trainNo,
        depTime,
        arrTime,
        seatAvailable: false,
        statusText,
        inRangeCount: 0,
        waitlistAvailable,
        matchedSeat,
      };
    } else if (waitlistAvailable && !firstInRange.waitlistAvailable) {
      // 예약대기 버튼 있는 열차를 우선 반환
      firstInRange = {
        rowIndex: i,
        trainNo,
        depTime,
        arrTime,
        seatAvailable: false,
        statusText,
        inRangeCount: 0,
        waitlistAvailable,
        matchedSeat,
      };
    }
  }
  return firstInRange ? { ...firstInRange, inRangeCount } : null;
}
