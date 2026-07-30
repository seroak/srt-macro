/**
 * srt/payMethod.ts — SRT 결제수단 선택 화면 셀렉터 매핑 (순수 함수)
 *
 * 라벨→셀렉터 근거: 7/30 라이브 캡처 srt/capture/04-pay-tab-간편결제.html
 * (grep으로 실제 존재 확인 완료 — 추정 셀렉터 아님).
 *
 * 이 파일은 카드번호·비밀번호·발권·결제승인은 다루지 않는다 — 결제수단 탭/수단
 * 선택까지만 자동화 범위다 (PaymentFlow.ts 상단 주석 참고).
 */

/** 결제수단 탭 순서: 신용카드, 간편결제, 계좌이체, 포인트, 레일리지 (#chTab1~5, onclick="changeTab(n)") */
const PAY_TAB_SELECTOR: Record<string, string> = {
  신용카드: "#chTab1",
  간편결제: "#chTab2",
  계좌이체: "#chTab3",
  포인트: "#chTab4",
  레일리지: "#chTab5",
};

/** 간편결제 수단 라디오 (name="easyPayYnN") — 기본 checked는 내통장결제(#settleBank) */
const EASY_PAY_SELECTOR: Record<string, string> = {
  내통장결제: "#settleBank",
  네이버페이: "#naverPay",
  페이코: "#payco",
  카카오페이: "#kakaoPay",
};

/** --pay-tab 값을 결제수단 탭 셀렉터로 변환한다. 알 수 없는 이름은 에러. */
export function resolvePayTabSelector(name: string): string {
  const selector = PAY_TAB_SELECTOR[name];
  if (!selector) {
    throw new Error(
      `알 수 없는 결제수단 탭: "${name}" — 신용카드/간편결제/계좌이체/포인트/레일리지 중 하나를 입력하세요.`,
    );
  }
  return selector;
}

/**
 * --easy-pay 값을 간편결제 수단 라디오 셀렉터로 변환한다.
 * 미지정(undefined/빈 문자열)이면 undefined — 기본 선택(내통장결제)을 그대로 둔다.
 */
export function resolveEasyPaySelector(name: string | undefined): string | undefined {
  if (!name) return undefined;
  const selector = EASY_PAY_SELECTOR[name];
  if (!selector) {
    throw new Error(
      `알 수 없는 간편결제 수단: "${name}" — 내통장결제/네이버페이/페이코/카카오페이 중 하나를 입력하세요.`,
    );
  }
  return selector;
}
