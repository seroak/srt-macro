/**
 * srt/ui/src/seatSelection.ts — 좌석 등급 다중 선택 순수 로직
 *
 * ConfigForm.tsx의 좌석 등급 체크박스가 사용하는 콤마 조인 문자열 조작 로직.
 * React에 의존하지 않는 순수 함수라 유닛 테스트로 검증 가능.
 */

/** 정규 순서 — 복수 잔여석일 때 이 순서로 우선순위 적용 (--seat 콤마 인수 순서와 동일) */
export const SEAT_ORDER = ["일반실", "특실", "입석+좌석"] as const;

/** 콤마 조인 문자열을 배열로 파싱 (빈 문자열 → []) */
export function parseSelectedSeats(current: string): string[] {
  return current ? current.split(",") : [];
}

/**
 * seat 토글 후 정규 순서(order)로 재조합한 콤마 문자열 반환.
 * 체크 순서와 무관하게 항상 order 순서로 정렬된다.
 * order에 없는 seat을 넘기면 결과는 변하지 않는다.
 */
export function toggleSeatClass(
  current: string,
  seat: string,
  order: readonly string[] = SEAT_ORDER,
): string {
  const selected = parseSelectedSeats(current);
  return order
    .filter((s) => (s === seat ? !selected.includes(s) : selected.includes(s)))
    .join(",");
}
