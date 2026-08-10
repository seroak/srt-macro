/**
 * srt/src/core/scheduleDiagnostics.ts — 결과 페이지 DOM 진단 수집
 *
 * "탐색 구간 열차 없음"이 무한 반복될 때, selectTargetTrain()(trainSelect.ts)이 null인
 * 이유가 (1) hidden input 파싱 자체가 0건인지, (2) 파싱은 됐지만 전부 시간 필터 밖인지를
 * 로그 한 줄로 구분하기 위한 진단 함수. SrtSession.describeSchedule()이
 * page.evaluate(collectScheduleDiagnostics)로 실행한다.
 *
 * trainSelect.ts와 동일한 제약: page.evaluate로 직렬화되므로 모듈 스코프 변수를 참조하지
 * 않는 self-contained 함수여야 하고, 지역 화살표 함수(`const f = (x) => ...`)를 선언하지
 * 않는다 — tsx(esbuild)의 keepNames가 지역 함수를 `__name(fn, "이름")` 호출로 감싸는데,
 * 이 함수만 단독으로 .toString() 직렬화될 때 "__name is not defined"로 깨진다.
 */

export interface ScheduleDiagnostics {
  /** hidden input trnNo[i]로 파싱된 고유 행 수 — 0이면 DOM 구조 변경/파싱 실패 의심 */
  hiddenRowCount: number;
  /** hidden input dptTm[i] → "HH:MM" 변환 목록 (파싱된 순서) */
  hiddenDepTimes: string[];
  /** 화면에 실제로 렌더링된 테이블 행(tr) 수 */
  visibleRowCount: number;
  /** em.time 셀 텍스트 (출발·도착 섞여 있음, 앞 12개만) — 화면에 어느 시간대가 보이는지 확인용 */
  visibleTimes: string[];
  /** "다음"(다음 10건 조회) 버튼 존재 여부 */
  hasNextButton: boolean;
  /** changeDptTm('NEXT', 'HHMMSS')의 인자 — 다음 페이지 조회 기준 시각 */
  nextSeedTime: string;
  /** 진단 시점 페이지 URL */
  pageUrl: string;
}

export function collectScheduleDiagnostics(): ScheduleDiagnostics {
  const idxSet = new Set<number>();
  document.querySelectorAll('input[name^="trnNo["]').forEach((el) => {
    const m = /trnNo\[(\d+)\]/.exec((el as HTMLInputElement).name);
    if (m) idxSet.add(Number(m[1]));
  });
  const indices = Array.from(idxSet).sort((a, b) => a - b);

  const hiddenDepTimes: string[] = [];
  for (const i of indices) {
    const raw =
      (document.querySelector(`input[name="dptTm[${i}]"]`) as HTMLInputElement | null)?.value ?? "";
    const m = /^(\d{2})(\d{2})/.exec(raw);
    hiddenDepTimes.push(m ? `${m[1]}:${m[2]}` : "");
  }

  const visibleTimes: string[] = [];
  document.querySelectorAll("em.time").forEach((el) => {
    if (visibleTimes.length < 12) {
      visibleTimes.push((el as HTMLElement).innerText?.trim() ?? "");
    }
  });

  const nextBtn = document.querySelector('input[value="다음"]') as HTMLInputElement | null;
  const onclickAttr = nextBtn?.getAttribute("onclick") ?? "";
  const seedMatch = /changeDptTm\(\s*'NEXT'\s*,\s*'(\d+)'\s*\)/.exec(onclickAttr);

  return {
    hiddenRowCount: indices.length,
    hiddenDepTimes,
    visibleRowCount: document.querySelectorAll("table tbody tr").length,
    visibleTimes,
    hasNextButton: nextBtn !== null,
    nextSeedTime: seedMatch ? seedMatch[1] : "",
    pageUrl: document.location.href,
  };
}
