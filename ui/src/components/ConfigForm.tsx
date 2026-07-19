import { useState } from "react";
import type { Config, Status } from "../types.ts";
import { SEAT_ORDER, parseSelectedSeats, toggleSeatClass } from "../seatSelection.ts";
import DiscordSettings from "./DiscordSettings.tsx";
import styles from "./ConfigForm.module.css";

const STATIONS = [
  "수서", "동탄", "평택지제", "오송", "대전",
  "김천구미", "서대구", "동대구", "신경주", "울산통도사", "부산",
  "광주송정", "목포", "공주", "익산", "정읍", "순천", "여수엑스포",
];

const TIMES = ["00","02","04","06","08","10","12","14","16","18","20","22"];

interface Props {
  config: Config;
  set: <K extends keyof Config>(key: K, value: Config[K]) => void;
  validate: () => string | null;
  status: Status;
  waitingEnter: boolean;
  onStart: () => void;
  onStop: () => void;
  onEnter: () => void;
}

export default function ConfigForm({ config, set, validate, status, waitingEnter, onStart, onStop, onEnter }: Props) {
  const [error, setError] = useState("");

  const running = status === "running" || status === "found";
  const selectedSeats = parseSelectedSeats(config.seat);

  function toggleSeat(seat: string) {
    set("seat", toggleSeatClass(config.seat, seat));
  }

  function handleStart() {
    const err = validate();
    if (err) { setError(err); return; }
    setError("");
    onStart();
  }

  return (
    <aside className={styles.panel}>
      <div className={styles.section}>
        <p className={styles.sectionLabel}>구간</p>
        <div className={styles.row2}>
          <label className={styles.field}>
            <span>출발역</span>
            <select value={config.dep} onChange={e => set("dep", e.target.value)} disabled={running}>
              {STATIONS.map(s => <option key={s}>{s}</option>)}
            </select>
          </label>
          <label className={styles.field}>
            <span>도착역</span>
            <select value={config.arr} onChange={e => set("arr", e.target.value)} disabled={running}>
              {STATIONS.map(s => <option key={s}>{s}</option>)}
            </select>
          </label>
        </div>
      </div>

      <div className={styles.section}>
        <p className={styles.sectionLabel}>일정</p>
        <label className={styles.field}>
          <span>탑승일</span>
          <input
            type="date"
            value={config.date}
            min={new Date().toISOString().slice(0, 10)}
            onChange={e => set("date", e.target.value)}
            disabled={running}
          />
        </label>
        <label className={styles.field}>
          <span>조회 기준 시각</span>
          <select value={config.time} onChange={e => set("time", e.target.value)} disabled={running}>
            {TIMES.map(t => <option key={t} value={t}>{t}시 이후</option>)}
          </select>
        </label>
        <div className={styles.row2}>
          <label className={styles.field}>
            <span>예매 탐색 시작</span>
            <input
              type="time"
              value={config.targetTime}
              step="60"
              onChange={e => set("targetTime", e.target.value)}
              disabled={running}
            />
          </label>
          <label className={styles.field}>
            <span>예매 탐색 끝</span>
            <input
              type="time"
              value={config.targetEndTime}
              step="60"
              onChange={e => set("targetEndTime", e.target.value)}
              disabled={running}
            />
          </label>
        </div>
      </div>

      <div className={styles.section}>
        <p className={styles.sectionLabel}>좌석 등급</p>
        <div className={styles.radioGroup}>
          {SEAT_ORDER.map(seat => (
            <label key={seat} className={`${styles.radioLabel} ${selectedSeats.includes(seat) ? styles.radioChecked : ""}`}>
              <input
                type="checkbox"
                value={seat}
                checked={selectedSeats.includes(seat)}
                onChange={() => toggleSeat(seat)}
                disabled={running}
              />
              {seat}
            </label>
          ))}
        </div>
      </div>

      <hr className={styles.divider} />

      <label className={`${styles.goToggle} ${config.go ? styles.goActive : ""}`}>
        <input
          type="checkbox"
          checked={config.go}
          onChange={e => set("go", e.target.checked)}
          disabled={running}
        />
        <div>
          <strong>실전 모드 (--go)</strong>
          <small>좌석 발견 시 자동 예약 실행</small>
        </div>
      </label>

      {error && <p className={styles.error}>{error}</p>}

      <div className={styles.actions}>
        <button className={styles.btnStart} onClick={handleStart} disabled={running}>
          ▶ 시작
        </button>
        <button className={styles.btnStop} onClick={onStop} disabled={!running}>
          ■ 중지
        </button>
      </div>

      <button
        className={`${styles.btnEnter} ${waitingEnter ? styles.btnEnterHighlight : ""}`}
        onClick={onEnter}
        disabled={!running}
        title="결제 완료 후 매크로에 Enter 전송"
      >
        ↵ Enter 전송 {waitingEnter ? "— 입력 대기 중" : "(결제 완료 후)"}
      </button>

      <hr className={styles.divider} />

      <DiscordSettings />
    </aside>
  );
}
