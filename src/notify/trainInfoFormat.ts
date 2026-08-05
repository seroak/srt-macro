/**
 * srt/trainInfoFormat.ts — 알림(디스코드/OS)에 쓸 "잡은 열차" 요약 문자열 포맷
 *
 * 배경(2026-07-30): BookingFlow/WaitlistFlow의 notify()가 실제 잡은 열차의
 * depTime/arrTime이 아니라 config.ts의 탐색 범위 상수(TARGET_TIME~TARGET_END_TIME)를
 * 그대로 찍고 있었다 — 두 클래스가 seatLabel만 받고 실제 TrainInfo를 몰랐기 때문.
 * 이 함수는 탐색 범위를 아예 파라미터로 받지 않으므로 그 혼동이 구조적으로 불가능하다.
 */

export interface CaughtTrain {
  trainNo: string;
  depTime: string;
  arrTime: string;
  matchedSeat: string;
}

export function formatTrainInfo(dep: string, arr: string, train: CaughtTrain): string {
  return `${dep}→${arr} ${train.trainNo}호 ${train.depTime}~${train.arrTime} ${train.matchedSeat}`;
}
