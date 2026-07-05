import { useState, useEffect } from "react";
import type { Config } from "../types.ts";

const STORAGE_KEY = "srt-ui-config";

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function loadSaved(): Config {
  const today = todayStr();
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    return {
      dep:  saved.dep  ?? "수서",
      arr:  saved.arr  ?? "부산",
      date: (saved.date && saved.date >= today) ? saved.date : today,
      time: saved.time ?? "06",
      from: saved.from ?? "00:00",
      to:   saved.to   ?? "23:59",
      seat: saved.seat ?? "일반실",
      go:   saved.go   ?? false,
    };
  } catch {
    return { dep: "수서", arr: "부산", date: today, time: "06", from: "00:00", to: "23:59", seat: "일반실", go: false };
  }
}

export function useConfig() {
  const [config, setConfig] = useState<Config>(loadSaved);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  }, [config]);

  const set = <K extends keyof Config>(key: K, value: Config[K]) =>
    setConfig(prev => ({ ...prev, [key]: value }));

  const validate = (): string | null => {
    if (!config.date) return "탑승일을 선택하세요.";
    if (config.date < todayStr()) return "과거 날짜는 선택할 수 없습니다.";
    if (!config.from || !config.to) return "출발 시각 범위를 설정하세요.";
    if (config.from > config.to) return "시작 시각이 종료 시각보다 늦습니다.";
    if (!config.seat) return "좌석 등급을 하나 이상 선택하세요.";
    return null;
  };

  return { config, set, validate };
}
