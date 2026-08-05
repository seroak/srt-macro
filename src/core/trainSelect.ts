/**
 * srt/trainSelect.ts — 열차 결과 테이블 파싱 및 목표 열차 선정 알고리즘
 *
 * SrtSession.findTargetTrain()이 page.evaluate(selectTargetTrain, opts)로 실행한다.
 * page.evaluate는 함수를 Function.prototype.toString()으로 직렬화해 브라우저 컨텍스트에서
 * 재실행하므로, 이 파일의 export 함수는 모듈 스코프 변수를 참조하지 않는 self-contained
 * 함수여야 한다 (document·전달된 opts만 사용).
 */

export interface SeatSelectOpts {
  /** 감시할 좌석 등급 목록 (우선순위 = 배열 순서) */
  seatClasses: string[];
  /** 예매 탐색 대상에 포함할 최소 출발시각 (HH:mm, 경계 포함) */
  minDepTime: string;
  /** 예매 탐색 대상에 포함할 최대 출발시각 (HH:mm, 경계 포함) */
  maxDepTime: string;
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
  /** 스캔한 열차 총 수 */
  candidateCount: number;
  /** 예약대기 버튼 존재 여부 (매진 + WAITLIST 모드에서 유의미) */
  waitlistAvailable: boolean;
  /** seatClasses 중 실제로 취소표/예약대기가 매칭된 등급 (복수 등급 감시 시 사용) */
  matchedSeat: string;
}

/**
 * 결과 테이블에서 minDepTime 이상 maxDepTime 이하인 열차를 위에서부터 스캔해 좌석 상태 반환.
 * - 잔여석 열차 발견 → 해당 열차 반환 (seatAvailable: true, 가장 이른 열차 우선)
 * - 열차는 있지만 전부 매진 → 첫 번째 열차 반환 (seatAvailable: false)
 * - 결과 테이블에 열차 없음 → null
 *
 * 2026-08-05 SRT+KTX 통합 이후: td 칸 순서가 아니라 결과 행의 숨은 input
 * (`trnNo[i]`/`dptTm[i]`/`arvTm[i]`/`trnGpNm[i]`, 라이브 캡처로 확인)과
 * 버튼 id(`genRsvBtn{i}`/`speRsvBtn{i}`)로 파싱한다 — td 개수·순서가 또
 * 바뀌어도 안전. rowIndex는 이 hidden input의 인덱스 i와 동일하다.
 */
// NOTE: 이 함수 안에서는 `const f = (x) => ...` 형태의 지역 헬퍼 함수를 만들지 않는다.
// tsx(esbuild)가 keepNames 옵션으로 모든 지역 함수를 `__name(fn, "이름")` 호출로
// 감싸는데, 이 헬퍼는 모듈 스코프에만 정의돼 있어 Playwright가 이 함수 하나만
// .toString()으로 직렬화해 브라우저에 보낼 때 "__name is not defined"로 깨진다.
// 그래서 시각 변환/버튼 판별은 지역 함수로 추출하지 않고 인라인 표현식으로 둔다.
export function selectTargetTrain(opts: SeatSelectOpts): TrainSelectResult | null {
  const { seatClasses, minDepTime, maxDepTime } = opts;
  const minMatch = /^(\d{2}):(\d{2})$/.exec(minDepTime);
  const minMinutes = minMatch
    ? Number(minMatch[1]) * 60 + Number(minMatch[2])
    : 0;
  const maxMatch = /^(\d{2}):(\d{2})$/.exec(maxDepTime);
  const maxMinutes = maxMatch
    ? Number(maxMatch[1]) * 60 + Number(maxMatch[2])
    : 23 * 60 + 59;

  // 결과 행 인덱스는 trnNo[i] hidden input으로 구한다 (td 칸 순서 무관)
  const idxSet = new Set<number>();
  document.querySelectorAll('input[name^="trnNo["]').forEach((el) => {
    const m = /trnNo\[(\d+)\]/.exec((el as HTMLInputElement).name);
    if (m) idxSet.add(Number(m[1]));
  });
  const indices = Array.from(idxSet).sort((a, b) => a - b);

  let firstCandidate: TrainSelectResult | null = null;
  let candidateCount = 0;

  for (const i of indices) {
    const trainNo = (document.querySelector(`input[name="trnNo[${i}]"]`) as HTMLInputElement | null)?.value ?? "";
    const rawDep = (document.querySelector(`input[name="dptTm[${i}]"]`) as HTMLInputElement | null)?.value ?? "";
    const rawArr = (document.querySelector(`input[name="arvTm[${i}]"]`) as HTMLInputElement | null)?.value ?? "";

    // dptTm/arvTm hidden input은 "HHMMSS" 포맷 (예: "060000") — "HH:MM"으로 변환
    const depMatch = /^(\d{2})(\d{2})/.exec(rawDep);
    if (!depMatch) continue;
    const depTime = `${depMatch[1]}:${depMatch[2]}`;
    const arrMatch = /^(\d{2})(\d{2})/.exec(rawArr);
    const arrTime = arrMatch ? `${arrMatch[1]}:${arrMatch[2]}` : "";

    const depMinutes = Number(depMatch[1]) * 60 + Number(depMatch[2]);
    if (depMinutes < minMinutes || depMinutes > maxMinutes) continue;

    // ── KTX 교차판매 행 배제 ────────────────────────────────────────
    // hidden input trnGpNm[i]="KTX"이면 매크로가 예약할 수 없는 행 (showKorailBookingChoice로
    // 코레일 사이트 이동 — 사람이 처리). SRT 직영 행만 후보로 남긴다.
    const trnGpNm = (document.querySelector(`input[name="trnGpNm[${i}]"]`) as HTMLInputElement | null)?.value ?? "";
    const isKorailCrossSell = trnGpNm === "KTX";

    candidateCount++;

    // ── 좌석 등급을 우선순위(입력 순서)대로 검사 ──────────────────────
    // 취소표가 있는 첫 번째 등급을 즉시 채택. 없으면 예약대기 가능한
    // 첫 번째 등급을 기록해두고 다음 등급도 계속 검사한다.
    let matchedSeat = seatClasses[0] ?? "";
    let statusText = "";
    let seatAvailable = false;
    let waitlistAvailable = false;

    if (!isKorailCrossSell) {
      for (const sc of seatClasses) {
        const isStanding = sc === "입석+좌석";
        // 입석+좌석도 일반실과 같은 버튼(genRsvBtn)을 쓰고 onclick 함수명으로만 구분된다.
        const btn = document.getElementById(sc === "특실" ? `speRsvBtn${i}` : `genRsvBtn${i}`);
        const onclick = btn?.getAttribute("onclick") ?? "";
        // showKorail* onclick이면 이 좌석 등급도 코레일 교차판매 — 예약 대상 아님
        const isKorailBtn = onclick.includes("showKorail");

        // ── 취소표 예약 버튼 감지 ────────────────────────────────────
        // 입석+좌석: requestReservationInfoAnn (native alert 먼저 띄움)
        // 일반실/특실: requestReservationInfo (Ann 제외)
        const hasReserve = isStanding
          ? onclick.includes("requestReservationInfoAnn")
          : onclick.includes("requestReservationInfo") && !onclick.includes("requestReservationInfoAnn");

        if (btn && !isKorailBtn && hasReserve) {
          // 취소표 발견 — 이 등급으로 즉시 확정, 낮은 우선순위 등급은 검사 불필요
          matchedSeat = sc;
          statusText = btn.innerText?.trim() ?? "";
          seatAvailable = true;
          break;
        }

        // ── 예약대기 버튼 감지 (WAITLIST 모드에서 사용, 취소표 없을 때만 유효) ──
        if (!waitlistAvailable && btn && !isKorailBtn && onclick.includes("requestReservationWait")) {
          waitlistAvailable = true;
          matchedSeat = sc;
          statusText = btn.innerText?.trim() ?? "";
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
        candidateCount,
        waitlistAvailable: false,
        matchedSeat,
      };
    }
    if (!firstCandidate) {
      firstCandidate = {
        rowIndex: i,
        trainNo,
        depTime,
        arrTime,
        seatAvailable: false,
        statusText,
        candidateCount: 0,
        waitlistAvailable,
        matchedSeat,
      };
    } else if (waitlistAvailable && !firstCandidate.waitlistAvailable) {
      // 예약대기 버튼 있는 열차를 우선 반환
      firstCandidate = {
        rowIndex: i,
        trainNo,
        depTime,
        arrTime,
        seatAvailable: false,
        statusText,
        candidateCount: 0,
        waitlistAvailable,
        matchedSeat,
      };
    }
  }
  return firstCandidate ? { ...firstCandidate, candidateCount } : null;
}
