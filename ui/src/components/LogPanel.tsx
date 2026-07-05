import { useEffect, useRef } from "react";
import type { LogLine } from "../types.ts";
import styles from "./LogPanel.module.css";

interface Props {
  logs: LogLine[];
  onClear: () => void;
}

export default function LogPanel({ logs, onClear }: Props) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [logs]);

  return (
    <section className={styles.panel}>
      <div className={styles.toolbar}>
        <span>실행 로그</span>
        <button className={styles.clearBtn} onClick={onClear}>지우기</button>
      </div>
      <div className={styles.log}>
        {logs.length === 0 && (
          <p className={styles.empty}>매크로를 시작하면 로그가 여기에 표시됩니다.</p>
        )}
        {logs.map(line => (
          <div key={line.id} className={`${styles.line} ${styles[line.type]}`}>
            {line.text}
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </section>
  );
}
