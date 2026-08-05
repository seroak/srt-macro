export interface StartMacroPayload {
  dep: string;
  arr: string;
  date: string;
  time: string;
  targetTime: string;
  targetEndTime: string;
  seat: string;
  go: boolean;
}

/** UI 실행 설정을 매크로 CLI 인수로 변환한다. */
export function buildMacroCliArgs(p: StartMacroPayload): string[] {
  const cliArgs = [
    "--dep", p.dep, "--arr", p.arr,
    "--date", p.date.replace(/-/g, ""), "--time", p.time,
    "--seat", p.seat,
    "--target-time", p.targetTime || `${p.time}:00`,
    "--target-end-time", p.targetEndTime || "23:59",
  ];
  if (p.go) cliArgs.push("--go");
  return cliArgs;
}
