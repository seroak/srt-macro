import type { Config } from "./types.ts";

/** 저장된 일부 설정을 현재 Config 형태로 보완한다. */
export function buildConfig(saved: Partial<Config>, today: string): Config {
  const time = saved.time ?? "06";
  return {
    dep: saved.dep ?? "수서",
    arr: saved.arr ?? "부산",
    date: saved.date && saved.date >= today ? saved.date : today,
    time,
    targetTime: saved.targetTime ?? `${time}:00`,
    targetEndTime: saved.targetEndTime ?? "23:59",
    seat: saved.seat ?? "일반실",
    go: saved.go ?? false,
  };
}

/** 조회 기준 시각 변경 시 탐색 시작 시각이 앞서지 않도록 필요한 경우 함께 올린다. */
export function setQueryTime(config: Config, time: string): Config {
  const queryStart = `${time}:00`;
  const targetTime = config.targetTime < queryStart ? queryStart : config.targetTime;
  return {
    ...config,
    time,
    targetTime,
    targetEndTime: config.targetEndTime < targetTime
      ? targetTime
      : config.targetEndTime,
  };
}

export function validateConfig(config: Config, today: string): string | null {
  if (!config.date) return "탑승일을 선택하세요.";
  if (config.date < today) return "과거 날짜는 선택할 수 없습니다.";
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(config.targetTime)) {
    return "예매 탐색 시작 시각은 HH:mm 형식으로 입력하세요.";
  }
  if (config.targetTime < `${config.time}:00`) {
    return "예매 탐색 시작 시각은 조회 기준 시각보다 빠를 수 없습니다.";
  }
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(config.targetEndTime)) {
    return "예매 탐색 끝 시각은 HH:mm 형식으로 입력하세요.";
  }
  if (config.targetEndTime < config.targetTime) {
    return "예매 탐색 끝 시각은 탐색 시작 시각보다 빠를 수 없습니다.";
  }
  if (!config.seat) return "좌석 등급을 하나 이상 선택하세요.";
  return null;
}
