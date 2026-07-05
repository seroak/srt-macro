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
  from: string;
  to: string;
  /** 콤마 조인된 좌석 등급 목록 (예: "일반실", "특실", "일반실,특실") */
  seat: string;
  go: boolean;
}
