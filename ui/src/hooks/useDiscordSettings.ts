import { useState, useEffect, useCallback } from "react";

interface TestResult {
  ok: boolean;
  error?: string;
}

/** 디스코드 웹훅 설정 — 실행 파라미터(useConfig)와 무관한 독립 설정이라 자체 완결형 훅. */
export function useDiscordSettings() {
  const [configured, setConfigured] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/discord-webhook")
      .then(r => r.json())
      .then((d: { configured: boolean }) => setConfigured(d.configured))
      .finally(() => setLoading(false));
  }, []);

  const save = useCallback(async (url: string) => {
    await fetch("/discord-webhook", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    setConfigured(!!url.trim());
  }, []);

  const test = useCallback(async (url: string): Promise<TestResult> => {
    const res = await fetch("/discord-webhook/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    return res.json();
  }, []);

  return { configured, loading, save, test };
}
