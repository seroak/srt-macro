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
  /**
   * 진단용 — seatClasses[0] 등급에 대해 실제로 찾은 버튼의 aria-label/onclick/텍스트 요약
   * ("버튼 없음"이면 못 찾은 것). 2026-08-12 SRT가 genRsvBtn/speRsvBtn id를 제거하고
   * aria-label 버튼으로 바꾼 뒤 좌석이 있어도 매진으로 오판정하는 사고가 있었다 — 사이트가
   * 또 마크업을 바꿔도 이 필드를 로그에 남기면 재캡처 없이 바로 원인 판별이 가능하다.
   */
  btnDebug: string;
}

/**
 * 결과 테이블에서 minDepTime 이상 maxDepTime 이하인 열차를 위에서부터 스캔해 좌석 상태 반환.
 * - 잔여석 열차 발견 → 해당 열차 반환 (seatAvailable: true, 가장 이른 열차 우선)
 * - 열차는 있지만 전부 매진 → 첫 번째 열차 반환 (seatAvailable: false)
 * - 결과 테이블에 열차 없음 → null
 *
 * 2026-08-05 SRT+KTX 통합 이후: td 칸 순서가 아니라 결과 행의 숨은 input
 * (`trnNo[i]`/`dptTm[i]`/`arvTm[i]`/`trnGpNm[i]`, 라이브 캡처로 확인)으로 파싱한다.
 * rowIndex는 이 hidden input의 인덱스 i와 동일하다.
 *
 * 2026-08-12 라이브 캡처(사용자 제공)로 확인: SRT가 버튼 id(`genRsvBtn{i}`/`speRsvBtn{i}`)를
 * 제거하고 `aria-label`(웹 접근성 조치)로 대체했다 — id 기반 조회는 항상 null이라 좌석이
 * 있어도 매진으로 오판정하는 사고가 있었다. 이제 좌석 가용 여부는 hidden input
 * `rsvPsbFlg[i]`(특실)/`gnrmRsvPsbFlg[i]`(일반실) 플래그를 1차 근거로 삼고, 실제 클릭 대상
 * 버튼은 해당 행(`trnNo[i]`의 `closest("tr")`) 안에서 다음 우선순위로 찾는다:
 *   1. `id="genRsvBtn{i}"/"speRsvBtn{i}"` (구 마크업 하위호환)
 *   2. `aria-label`에 "{등급} 예약하기" 포함
 *   3. onclick에 `reservationAfterMsg(this, {i}, '{psrmClCd}'` 포함 (psrmClCd: 특실=2, 일반실=1 —
 *      사이트 정적 JS 주석 "psrmClCd: 특실(2), 일반실(1)" 원문 그대로)
 *   4. `requestReservationInfo`/`commuterTrain` 등 기존 함수명 폴백 (구 마크업 하위호환)
 * 행 스코프 검색이라 td 칸 순서·컬럼 개수가 바뀌어도 안전하다.
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

  if (indices.length > 0) {
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
      const trnGpNm = (document.querySelector(`input[name="trnGpNm[${i}]"]`) as HTMLInputElement | null)?.value ?? "";
      const isKorailCrossSell = trnGpNm === "KTX";

      candidateCount++;

      // 2026-08-12: 버튼 id가 사라져 이 행의 <tr>를 잡아두고 그 안에서 aria-label/onclick으로 찾는다.
      const rowTr = (document.querySelector(`input[name="trnNo[${i}]"]`) as HTMLInputElement | null)?.closest("tr") ?? null;

      let matchedSeat = seatClasses[0] ?? "";
      let statusText = "";
      let seatAvailable = false;
      let waitlistAvailable = false;
      let btnDebug = "버튼 없음";

      if (!isKorailCrossSell) {
        for (const sc of seatClasses) {
          const isStanding = sc === "입석+좌석";
          const isSpecial = sc === "특실";
          const psrmClCd = isSpecial ? "2" : "1";

          const idBtn = document.getElementById(isSpecial ? `speRsvBtn${i}` : `genRsvBtn${i}`);
          const ariaBtn = !idBtn && rowTr
            ? (Array.from(rowTr.querySelectorAll("a")).find(
                (a) => (a.getAttribute("aria-label") ?? "").includes(`${sc} 예약하기`),
              ) ?? null)
            : null;
          const argBtn = !idBtn && !ariaBtn && rowTr
            ? (Array.from(rowTr.querySelectorAll<HTMLAnchorElement>("a[onclick]")).find((a) =>
                (a.getAttribute("onclick") ?? "").includes(`reservationAfterMsg(this, ${i}, '${psrmClCd}'`),
              ) ?? null)
            : null;
          const btn = idBtn ?? ariaBtn ?? argBtn;

          const onclick = btn?.getAttribute("onclick") ?? "";
          const ariaLabel = btn?.getAttribute("aria-label") ?? "";
          const isKorailBtn = onclick.includes("showKorail");

          const hasReserve = isStanding
            ? onclick.includes("requestReservationInfoAnn")
            : onclick.includes("reservationAfterMsg") ||
              onclick.includes("commuterTrain") ||
              (onclick.includes("requestReservationInfo") && !onclick.includes("requestReservationInfoAnn"));

          if (sc === seatClasses[0]) {
            btnDebug = btn
              ? `aria="${ariaLabel.slice(0, 30)}" onclick="${onclick.slice(0, 50)}" text="${btn.innerText?.trim() ?? ""}"`
              : "버튼 없음";
          }

          if (btn && !isKorailBtn && hasReserve) {
            matchedSeat = sc;
            statusText = btn.innerText?.trim() ?? "";
            seatAvailable = true;
            break;
          }

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
          btnDebug,
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
          btnDebug,
        };
      } else if (waitlistAvailable && !firstCandidate.waitlistAvailable) {
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
          btnDebug,
        };
      }
    }
  } else {
    // ── Fallback: hidden input이 없을 때 table tbody tr를 직접 파싱 ──
    const rows = Array.from(document.querySelectorAll("table tbody tr"));
    for (let rIndex = 0; rIndex < rows.length; rIndex++) {
      const tr = rows[rIndex];
      const timeEls = tr.querySelectorAll("em.time");
      if (timeEls.length === 0) continue;

      const rawDepText = (timeEls[0] as HTMLElement).innerText?.trim() ?? "";
      const depMatch = /(\d{2}):(\d{2})/.exec(rawDepText);
      if (!depMatch) continue;
      const depTime = `${depMatch[1]}:${depMatch[2]}`;

      const rawArrText = timeEls.length > 1 ? (timeEls[1] as HTMLElement).innerText?.trim() ?? "" : "";
      const arrMatch = /(\d{2}):(\d{2})/.exec(rawArrText);
      const arrTime = arrMatch ? `${arrMatch[1]}:${arrMatch[2]}` : "";

      const depMinutes = Number(depMatch[1]) * 60 + Number(depMatch[2]);
      if (depMinutes < minMinutes || depMinutes > maxMinutes) continue;

      const trnNoCell = tr.querySelector("td.trnNo") as HTMLElement | null;
      const trainNo = trnNoCell?.innerText?.trim().replace(/\s+/g, "") ?? "";

      const trnGpCell = tr.querySelector("td.trnGp") as HTMLElement | null;
      const trnGpText = trnGpCell?.innerText?.trim() ?? "";
      const isKorailCrossSell = trnGpText.includes("KTX") || tr.innerHTML.includes("showKorailBookingChoice");

      // rowIndex 파싱: 버튼 id(genRsvBtn0, speRsvBtn0)에서 인덱스 번호 추출 시도
      let rowIndex = rIndex;
      const genBtnInTr = tr.querySelector('[id^="genRsvBtn"]') as HTMLElement | null;
      const speBtnInTr = tr.querySelector('[id^="speRsvBtn"]') as HTMLElement | null;
      if (genBtnInTr && genBtnInTr.id) {
        const m = /genRsvBtn(\d+)/.exec(genBtnInTr.id);
        if (m) rowIndex = Number(m[1]);
      } else if (speBtnInTr && speBtnInTr.id) {
        const m = /speRsvBtn(\d+)/.exec(speBtnInTr.id);
        if (m) rowIndex = Number(m[1]);
      }

      candidateCount++;

      let matchedSeat = seatClasses[0] ?? "";
      let statusText = "";
      let seatAvailable = false;
      let waitlistAvailable = false;
      let btnDebug = "버튼 없음";

      if (!isKorailCrossSell) {
        for (const sc of seatClasses) {
          const isStanding = sc === "입석+좌석";
          const isSpecial = sc === "특실";
          const psrmClCd = isSpecial ? "2" : "1";

          const idBtn = (isSpecial ? speBtnInTr : genBtnInTr) ||
            document.getElementById(isSpecial ? `speRsvBtn${rowIndex}` : `genRsvBtn${rowIndex}`);
          const ariaBtn = !idBtn
            ? (Array.from(tr.querySelectorAll("a")).find(
                (a) => (a.getAttribute("aria-label") ?? "").includes(`${sc} 예약하기`),
              ) ?? null)
            : null;
          const argBtn = !idBtn && !ariaBtn
            ? (Array.from(tr.querySelectorAll<HTMLAnchorElement>("a[onclick]")).find((a) =>
                (a.getAttribute("onclick") ?? "").includes(`reservationAfterMsg(this, ${rowIndex}, '${psrmClCd}'`),
              ) ?? null)
            : null;
          const btn = idBtn ?? ariaBtn ?? argBtn;

          const onclick = btn?.getAttribute("onclick") ?? "";
          const ariaLabel = btn?.getAttribute("aria-label") ?? "";
          const isKorailBtn = onclick.includes("showKorail");

          const hasReserve = isStanding
            ? onclick.includes("requestReservationInfoAnn")
            : onclick.includes("reservationAfterMsg") ||
              onclick.includes("commuterTrain") ||
              (onclick.includes("requestReservationInfo") && !onclick.includes("requestReservationInfoAnn"));

          if (sc === seatClasses[0]) {
            btnDebug = btn
              ? `aria="${ariaLabel.slice(0, 30)}" onclick="${onclick.slice(0, 50)}" text="${btn.innerText?.trim() ?? ""}"`
              : "버튼 없음";
          }

          if (btn && !isKorailBtn && hasReserve) {
            matchedSeat = sc;
            statusText = btn.innerText?.trim() ?? "";
            seatAvailable = true;
            break;
          }

          if (!waitlistAvailable && btn && !isKorailBtn && onclick.includes("requestReservationWait")) {
            waitlistAvailable = true;
            matchedSeat = sc;
            statusText = btn.innerText?.trim() ?? "";
          }
        }
      }

      if (seatAvailable) {
        return {
          rowIndex,
          trainNo,
          depTime,
          arrTime,
          seatAvailable: true,
          statusText,
          candidateCount,
          waitlistAvailable: false,
          matchedSeat,
          btnDebug,
        };
      }
      if (!firstCandidate) {
        firstCandidate = {
          rowIndex,
          trainNo,
          depTime,
          arrTime,
          seatAvailable: false,
          statusText,
          candidateCount: 0,
          waitlistAvailable,
          matchedSeat,
          btnDebug,
        };
      } else if (waitlistAvailable && !firstCandidate.waitlistAvailable) {
        firstCandidate = {
          rowIndex,
          trainNo,
          depTime,
          arrTime,
          seatAvailable: false,
          statusText,
          candidateCount: 0,
          waitlistAvailable,
          matchedSeat,
          btnDebug,
        };
      }
    }
  }

  return firstCandidate ? { ...firstCandidate, candidateCount } : null;
}

export interface ClickReserveOpts {
  rowIndex: number;
  seatClass: string;
}

/**
 * SrtSession.clickReserve()가 page.evaluate(clickReserveButton, opts)로 실행한다.
 * selectTargetTrain()과 같은 버튼 탐색 규칙(id → aria-label → onclick 인자, 위 함수 docstring
 * 참고)을 그대로 따르지만, page.evaluate로 각자 독립 직렬화되므로(파일 상단 NOTE) 로직을
 * import로 공유하지 않고 이 함수 자체가 self-contained하게 다시 쓴다.
 * 버튼을 찾아 클릭했으면 true, 못 찾았으면 false를 반환한다 — 호출부가 이 값으로 실패를 알 수
 * 있게 한다(과거엔 id 기반 조회 실패 시 조용히 no-op이라 예약 버튼 클릭이 안 먹은 채로도
 * 아무 에러 없이 넘어가는 사고가 있었다).
 */
export function clickReserveButton(opts: ClickReserveOpts): boolean {
  const { rowIndex, seatClass } = opts;
  const isSpecial = seatClass === "특실";
  const isStanding = seatClass === "입석+좌석";
  const psrmClCd = isSpecial ? "2" : "1";

  const rowTr = (document.querySelector(`input[name="trnNo[${rowIndex}]"]`) as HTMLInputElement | null)?.closest("tr") ?? null;

  const idBtn = document.getElementById(isSpecial ? `speRsvBtn${rowIndex}` : `genRsvBtn${rowIndex}`);
  const ariaBtn = !idBtn && rowTr
    ? (Array.from(rowTr.querySelectorAll("a")).find(
        (a) => (a.getAttribute("aria-label") ?? "").includes(`${seatClass} 예약하기`),
      ) ?? null)
    : null;
  const argBtn = !idBtn && !ariaBtn && rowTr
    ? (Array.from(rowTr.querySelectorAll<HTMLAnchorElement>("a[onclick]")).find((a) => {
        const oc = a.getAttribute("onclick") ?? "";
        return isStanding
          ? oc.includes("requestReservationInfoAnn")
          : oc.includes(`reservationAfterMsg(this, ${rowIndex}, '${psrmClCd}'`) || oc.includes("commuterTrain");
      }) ?? null)
    : null;

  const btn = idBtn ?? ariaBtn ?? argBtn;
  if (!btn) return false;
  (btn as HTMLElement).click();
  return true;
}
