import type { Status } from "../types.ts";
import styles from "./StatusBadge.module.css";

const LABELS: Record<Status, string> = {
  idle:    "대기중",
  running: "실행중",
  found:   "좌석 발견!",
  stopped: "중지됨",
};

export default function StatusBadge({ status }: { status: Status }) {
  return (
    <span className={`${styles.badge} ${styles[status]}`}>
      <span className={styles.dot} />
      {LABELS[status]}
    </span>
  );
}
