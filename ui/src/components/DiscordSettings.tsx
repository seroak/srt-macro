import { useState } from "react";
import { useDiscordSettings } from "../hooks/useDiscordSettings.ts";
import styles from "./DiscordSettings.module.css";

type SendStatus = "idle" | "saved" | "testing" | "test-ok" | "test-fail";

/**
 * 디스코드 웹훅 설정 — 실행 파라미터(ConfigForm의 useConfig 상태)와 무관한
 * 독립 설정이라 prop 없이 자체 훅으로 완결된다.
 *
 * 보안: 이미 저장된 웹훅 URL은 서버가 절대 되돌려주지 않는다(GET은 configured
 * 불리언만 반환) — 그래서 "설정됨" 상태여도 입력창은 항상 비어있다. 값을
 * 바꾸려면 새 URL을 입력해서 다시 저장한다.
 */
export default function DiscordSettings() {
  const { configured, loading, save, test } = useDiscordSettings();
  const [url, setUrl] = useState("");
  const [visible, setVisible] = useState(false);
  const [status, setStatus] = useState<SendStatus>("idle");
  const [testError, setTestError] = useState("");

  function handleChange(value: string) {
    setUrl(value);
    setStatus("idle");
  }

  async function handleSave() {
    await save(url);
    setStatus("saved");
  }

  async function handleTest() {
    setStatus("testing");
    setTestError("");
    const result = await test(url);
    if (result.ok) {
      setStatus("test-ok");
    } else {
      setStatus("test-fail");
      setTestError(result.error ?? "알 수 없는 오류");
    }
  }

  const badgeLabel = loading ? "확인 중" : configured ? "설정됨" : "미설정";

  return (
    <div className={styles.section}>
      <div className={styles.header}>
        <p className={styles.sectionLabel}>디스코드 알림</p>
        <span className={`${styles.badge} ${configured ? styles.badgeOn : styles.badgeOff}`}>
          {badgeLabel}
        </span>
      </div>

      <div className={styles.row}>
        <input
          type={visible ? "text" : "password"}
          placeholder={configured ? "설정됨 — 바꾸려면 새 URL 입력" : "https://discord.com/api/webhooks/..."}
          value={url}
          onChange={e => handleChange(e.target.value)}
          className={styles.input}
          autoComplete="off"
        />
        <button type="button" className={styles.toggleBtn} onClick={() => setVisible(v => !v)}>
          {visible ? "숨기기" : "보기"}
        </button>
      </div>

      <div className={styles.actions}>
        <button type="button" className={styles.saveBtn} onClick={handleSave} disabled={!url.trim()}>
          저장
        </button>
        <button
          type="button"
          className={styles.testBtn}
          onClick={handleTest}
          disabled={!url.trim() || status === "testing"}
        >
          {status === "testing" ? "전송 중..." : "테스트 전송"}
        </button>
      </div>

      {status === "saved" && <p className={styles.msgOk}>저장했습니다.</p>}
      {status === "test-ok" && (
        <p className={styles.msgOk}>테스트 메시지를 전송했습니다 — 디스코드 채널을 확인하세요.</p>
      )}
      {status === "test-fail" && <p className={styles.msgErr}>전송 실패: {testError}</p>}
    </div>
  );
}
