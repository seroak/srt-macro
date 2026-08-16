/**
 * srt/flows/alertPopup.ts — SweetAlert2 팝업(.swal2-popup) 텍스트로 종류 판별 (순수 함수)
 *
 * 2026-08-05 SRT+KTX 통합 이후 결과 화면 예약 클릭 시 뜰 수 있는 모달 2종:
 * - "코레일열차선택" (showKorailBookingChoice): KTX 교차판매 — 사람이 코레일 사이트에서 처리해야 함
 * - "이용안내" (reservationAfterMsg): 중련/복합운행 SRT 열차 안내 — 확인만 누르면 예약 흐름 계속 진행
 * (두 제목 모두 사이트 정적 JS 원문에서 직접 확인한 문자열)
 */
export type AlertPopupKind = "korail-cross-sell" | "notice" | "unknown";

export function classifyAlertPopup(popupText: string): AlertPopupKind {
  if (popupText.includes("코레일열차선택")) return "korail-cross-sell";
  if (popupText.includes("이용안내")) return "notice";
  return "unknown";
}
