/**
 * srt/paymentDeadline.ts — 결제 10분 제한 잔여시간 재알림 계산 (순수 함수)
 *
 * SRT는 좌석 확보 후 10분 안에 결제하지 않으면 좌석이 풀린다. 결제 자체는
 * 자동화하지 않지만(카드정보·TransKey·최종승인 — PaymentFlow.ts 참고), 사람이
 * 10분을 놓치지 않도록 잔여 7/3/1분 시점에 재알림을 보낸다.
 *
 * 시간 계산과 실제 알림 발송(Discord 등 I/O)을 분리해 테스트 가능하게 한다 —
 * 발송은 PaymentFlow.ts가 이 함수의 반환값을 보고 수행한다.
 */

/** SRT 좌석 확보 후 결제 가능 시간 */
export const PAYMENT_DEADLINE_MS = 10 * 60_000;

/** 잔여시간 재알림을 보낼 시점들 (분 단위, 큰 값부터) */
const ALERT_MINUTES = [7, 3, 1];

/**
 * securedAtMs(좌석 확보 시각)와 nowMs(현재 시각) 기준으로, 아직 alertedMinutes에
 * 없는 재알림 시점 중 이미 지난 것이 있으면 가장 큰(가장 이른) 것을 반환한다.
 * 보낼 알림이 없으면 undefined.
 */
export function nextDeadlineAlert(
  securedAtMs: number,
  nowMs: number,
  alertedMinutes: number[],
): { minutesLeft: number } | undefined {
  const elapsedMs = nowMs - securedAtMs;
  const remainingMs = PAYMENT_DEADLINE_MS - elapsedMs;
  const remainingMinutes = remainingMs / 60_000;

  for (const minutes of ALERT_MINUTES) {
    if (alertedMinutes.includes(minutes)) continue;
    if (remainingMinutes <= minutes) {
      return { minutesLeft: minutes };
    }
  }
  return undefined;
}
