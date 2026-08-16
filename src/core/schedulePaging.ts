/**
 * srt/src/core/schedulePaging.ts — 결과 목록 페이지 넘김 판정
 *
 * SRT 결과 목록은 10건씩 페이징된다(라이브 캡처 srt/capture/96-result-*.html의
 * "다음"(changeDptTm('NEXT', ...)) 버튼으로 확인). 조회 기준 시각(--time)이 탐색 시작
 * 시각(--target-time)보다 훨씬 이르면, 목표 구간이 첫 페이지 밖에 있어 매크로가
 * 재조회를 아무리 반복해도 영원히 찾지 못한다 — 이 함수는 현재 페이지에 보이는
 * 열차들의 출발시각만 보고 "다음 페이지로 넘겨야 하는지"를 순수하게 판정한다.
 *
 * 순수 함수(네트워크·DOM 접근 없음) — SrtSession.goNextPage() 호출 여부는 run_srt.ts가 결정한다.
 */

/** "HH:MM" → 자정 기준 분(minute) */
function toMinutes(hhmm: string): number {
  const m = /^(\d{2}):(\d{2})$/.exec(hhmm);
  if (!m) return -1;
  return Number(m[1]) * 60 + Number(m[2]);
}

/**
 * 현재 페이지에 나열된 열차 출발시각 목록(도착 순서, 위→아래)을 보고 다음 페이지로
 * 넘겨야 하는지 판정한다.
 *
 * - 목록이 비어있으면(조회 자체 실패) 넘기지 않는다 — requery()로 재시도하는 게 맞다.
 * - 마지막(가장 늦은) 열차 출발시각이 탐색 시작 시각(minDepTime)보다 이르면(strictly less)
 *   탐색 구간이 아직 다음 페이지에 있다는 뜻 — 넘긴다.
 * - 그 외(현재 페이지가 탐색 구간과 겹치거나 이미 지나쳤으면) 넘기지 않는다.
 */
export function shouldAdvancePage(
  depTimes: string[],
  minDepTime: string,
  maxDepTime: string,
): boolean {
  if (depTimes.length === 0) return false;

  const minMinutes = toMinutes(minDepTime);
  const lastMinutes = toMinutes(depTimes[depTimes.length - 1]);
  if (minMinutes < 0 || lastMinutes < 0) return false;

  return lastMinutes < minMinutes;
}
