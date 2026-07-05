import { useSrtMacro } from "./hooks/useSrtMacro.ts";
import { useConfig } from "./hooks/useConfig.ts";
import ConfigForm from "./components/ConfigForm.tsx";
import LogPanel from "./components/LogPanel.tsx";
import StatusBadge from "./components/StatusBadge.tsx";
import styles from "./App.module.css";

export default function App() {
  const macro = useSrtMacro();
  const { config, set, validate } = useConfig();

  return (
    <div className={styles.app}>
      <header className={styles.header}>
        <span className={styles.logo}>
          <svg className={styles.logoMark} viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">
            <rect x="3" y="5" width="18" height="13" rx="2.5" fill="none" stroke="currentColor" strokeWidth="1.6" />
            <path d="M3 10.5h18" stroke="currentColor" strokeWidth="1.6" />
            <circle cx="7.5" cy="14.5" r="1.1" fill="currentColor" />
            <path d="M12 14.5h6" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" />
          </svg>
          SRT 예매 매크로
        </span>
        <StatusBadge status={macro.status} />
      </header>

      <div className={styles.body}>
        <ConfigForm
          config={config}
          set={set}
          validate={validate}
          status={macro.status}
          waitingEnter={macro.waitingEnter}
          onStart={() => macro.start(config)}
          onStop={macro.stop}
          onEnter={macro.enter}
        />
        <LogPanel logs={macro.logs} onClear={macro.clearLogs} />
      </div>
    </div>
  );
}
