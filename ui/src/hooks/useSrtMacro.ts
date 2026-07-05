import { useState, useEffect, useCallback } from "react";
import type { Config, Status, LogLine } from "../types.ts";

function classifyLine(text: string): LogLine["type"] {
  if (text.startsWith("[UI]")) return "ui";
  if (text.includes("좌석 발견") || text.includes("!!")) return "found";
  if (text.includes("결제 페이지") || text.includes("예약 완료") || text.includes("도달")) return "ok";
  if (text.includes("[오류]") || text.toLowerCase().includes("error")) return "err";
  if (text.includes("Enter >")) return "prompt";
  return "default";
}

let lineId = 0;

export function useSrtMacro() {
  const [status, setStatus] = useState<Status>("idle");
  const [logs, setLogs] = useState<LogLine[]>([]);
  const [waitingEnter, setWaitingEnter] = useState(false);

  const addLog = useCallback((text: string) => {
    const lines = text.split("\n").filter(l => l.trim());
    setLogs(prev => [
      ...prev,
      ...lines.map(line => ({ id: lineId++, text: line, type: classifyLine(line) })),
    ]);
    if (lines.some(l => l.includes("Enter >"))) setWaitingEnter(true);
  }, []);

  useEffect(() => {
    const es = new EventSource("/events");
    es.onmessage = (e) => {
      const { type, payload } = JSON.parse(e.data) as { type: string; payload: string };
      if (type === "status") {
        setStatus(payload as Status);
        if (payload === "stopped" || payload === "idle") setWaitingEnter(false);
      } else {
        addLog(payload);
      }
    };
    return () => es.close();
  }, [addLog]);

  const start = useCallback(async (config: Config) => {
    setLogs([]);
    setWaitingEnter(false);
    await fetch("/start", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(config),
    });
  }, []);

  const stop = useCallback(async () => {
    await fetch("/stop", { method: "POST" });
    setWaitingEnter(false);
  }, []);

  const enter = useCallback(async () => {
    setWaitingEnter(false);
    await fetch("/enter", { method: "POST" });
    addLog("[UI] Enter 전송됨");
  }, [addLog]);

  const clearLogs = useCallback(() => setLogs([]), []);

  return { status, logs, waitingEnter, start, stop, enter, clearLogs };
}
