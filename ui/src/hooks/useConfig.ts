import { useState, useEffect } from "react";
import type { Config } from "../types.ts";
import { buildConfig, setQueryTime, validateConfig } from "../configState.ts";

const STORAGE_KEY = "srt-ui-config";

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function loadSaved(): Config {
  const today = todayStr();
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}") as Partial<Config>;
    return buildConfig(saved, today);
  } catch {
    return buildConfig({}, today);
  }
}

export function useConfig() {
  const [config, setConfig] = useState<Config>(loadSaved);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
  }, [config]);

  const set = <K extends keyof Config>(key: K, value: Config[K]) =>
    setConfig(prev => key === "time"
      ? setQueryTime(prev, value as string)
      : { ...prev, [key]: value });

  const validate = (): string | null => validateConfig(config, todayStr());

  return { config, set, validate };
}
