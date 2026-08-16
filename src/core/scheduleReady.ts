/**
 * srt/src/core/scheduleReady.ts — 결과 페이지 "정착"(로드 완료) 판정
 *
 * scheduleRace.browser.test.ts(R2/R3)가 오프라인으로 확정한 근본원인: 문서가 아직
 * document.readyState === "loading"인 동안엔 table tbody tr는 매칭돼도 hidden input
 * (trnNo[i])은 파싱 전이라 0건일 수 있다(SRT 결과 페이지의 <table><tbody><tr>가 hidden
 * input보다 문서 순서상 먼저 나오기 때문). readyState가 "interactive" 이상(=domcontentloaded
 * 이후, HTML 파싱 자체는 끝난 상태)이면 이 틈이 닫힌다는 게 그 재현 테스트의 실측 결과다.
 *
 * SrtSession.waitForScheduleSettled()가 이 판정을 실시간으로 쓰고, run_srt.ts의 진단 로그가
 * "로드 미정착"과 "진짜 열차 없음"을 구분하는 데도 이 함수를 쓴다.
 *
 * DOM 접근 없는 순수 함수 — snapshot은 scheduleDiagnostics.ts(collectScheduleDiagnostics)가
 * page.evaluate로 수집해 넘겨준다.
 */

export interface ScheduleSnapshot {
  hiddenRowCount: number;
  visibleRowCount: number;
  readyState: string;
}

/**
 * readyState가 "loading"이면 아직 파싱 도중이라 hidden input 유무를 신뢰할 수 없다 → false.
 * "interactive"/"complete"면 HTML 파싱은 끝난 상태이므로, hiddenRowCount가 0이어도 그건
 * 로드 미완이 아니라 실제로 결과가 없는 것 → true.
 */
export function isScheduleSettled(snapshot: ScheduleSnapshot): boolean {
  return snapshot.readyState !== "loading";
}
