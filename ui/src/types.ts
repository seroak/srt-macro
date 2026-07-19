export type Status = "idle" | "running" | "found" | "stopped";

export interface LogLine {
  id: number;
  text: string;
  type: "ui" | "found" | "ok" | "err" | "prompt" | "default";
}

export interface Config {
  dep: string;
  arr: string;
  date: string;
  time: string;
  /** 조회 결과에서 실제 예매 탐색을 시작할 최소 출발시각(HH:mm) */
  targetTime: string;
  /** 조회 결과에서 실제 예매 탐색을 끝낼 최대 출발시각(HH:mm, 경계 포함) */
  targetEndTime: string;
  /** 콤마 조인된 좌석 등급 목록 (예: "일반실", "특실", "일반실,특실") */
  seat: string;
  go: boolean;
}
