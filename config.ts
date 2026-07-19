/**
 * srt/config.ts — SRT 예매 매크로 설정 & CLI 인수
 *
 * 실행 예시:
 *   tsx srt/run_srt.ts --dep 수서 --arr 부산 --date 20260710 --time 06 --seat 일반실
 *   tsx srt/run_srt.ts --dep 수서 --arr 부산 --date 20260710 --time 14 --seat 특실 --go
 *   tsx srt/run_srt.ts --dep 수서 --arr 부산 --date 20260710 --time 14 --seat 일반실,특실 --go
 *   tsx srt/run_srt.ts --dep 수서 --arr 부산 --date 20260710 --time 14 --target-time 15:00 --seat 일반실 --go
 *   tsx srt/run_srt.ts --dep 수서 --arr 부산 --date 20260710 --time 14 --target-time 15:00 --target-end-time 17:00 --seat 일반실 --go
 */

import { join } from "path";

/**
 * 세션 저장 파일 경로.
 * Electron 패키징 모드에서는 main.ts가 SRT_DATA_DIR(앱 데이터 폴더 절대경로)를 세팅한다 —
 * 이 경우 그 폴더 아래 저장. CLI 개발 모드는 기존처럼 cwd 상대경로 유지 (회귀 없음).
 */
const SRT_DATA_DIR = process.env.SRT_DATA_DIR;
export const SRT_SESSION_FILE = SRT_DATA_DIR
  ? join(SRT_DATA_DIR, "srt_session.json")
  : "./srt_session.json";

export const SRT_SEARCH_URL =
  "https://etk.srail.kr/hpg/hra/01/selectScheduleList.do?pageId=TK0101010000";

export const SRT_LOGIN_URL =
  "https://etk.srail.kr/cmc/01/selectLoginForm.do?pageId=TK0701000000";

// ─── 주요 SRT 역 코드 ─────────────────────────────────────────────────────
// 역 이름 → 역 코드 (숫자 4자리 문자열)
// 코드를 모르는 역: 직접 etk.srail.kr 검색 폼에서 DevTools로 dptRsStnCd 값 확인 후 추가
export const STATION_CODE: Record<string, string> = {
  수서: "0551",
  동탄: "0552",
  평택지제: "0553",
  오송: "0297",
  대전: "0010",
  김천구미: "0507",
  서대구: "0506",
  동대구: "0015",
  신경주: "0508",
  울산통도사: "0509",
  부산: "0020",
  광주송정: "0036",
  목포: "0056",
  공주: "0514",
  익산: "0050",
  정읍: "0405",
  순천: "0224",
  여수엑스포: "0263",
};

// ─── 날짜 유틸 ────────────────────────────────────────────────────────────
/**
 * YYYYMMDD 날짜까지 남은 일수 (자정 기준).
 * 오늘 = 0, 내일 = 1, 모레 = 2, ...
 * 과거 날짜는 음수 반환.
 */
export function daysUntil(yyyymmdd: string): number {
  const y = parseInt(yyyymmdd.slice(0, 4), 10);
  const m = parseInt(yyyymmdd.slice(4, 6), 10) - 1;
  const d = parseInt(yyyymmdd.slice(6, 8), 10);
  const target = new Date(y, m, d);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
}

// ─── CLI 인수 파싱 ─────────────────────────────────────────────────────────
const argv = process.argv.slice(2);
const getArg = (key: string, def = "") => {
  const i = argv.indexOf(key);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : def;
};

/** --go 없으면 dry-run: 좌석 발견 로그만 찍고 실제 예약 클릭 생략 */
export const GO = argv.includes("--go");

/** 출발역 이름 (기본: 수서) */
export const DEP = getArg("--dep", "수서");

/** 도착역 이름 (기본: 부산) */
export const ARR = getArg("--arr", "부산");

/** 탑승일 YYYYMMDD 형식 (필수) */
export const DATE = getArg("--date");

/**
 * 조회 기준 시각 (00 | 02 | 04 | 06 | 08 | 10 | 12 | 14 | 16 | 18 | 20 | 22)
 * SRT 폼 제출 value: "060000" 형태 — 내부 변환은 SrtSession에서 처리
 */
export const TIME = getArg("--time", "06");

/**
 * 예매 탐색 시작 시각을 HH:mm으로 정규화하고 조회 기준 시각과의 관계를 검증한다.
 * 옵션을 생략하면 기존 동작과 동일하게 조회 기준 시각의 정각부터 탐색한다.
 */
export function resolveTargetTime(queryTime: string, rawTargetTime = ""): string {
  const queryHour = queryTime.padStart(2, "0");
  const targetTime = rawTargetTime || `${queryHour}:00`;

  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(targetTime)) {
    throw new Error(
      `예매 탐색 시작 시각 형식 오류: "${targetTime}" — HH:mm 형식으로 입력하세요 (예: 15:00)`,
    );
  }

  const [targetHour, targetMinute] = targetTime.split(":").map(Number);
  const queryMinutes = Number(queryHour) * 60;
  const targetMinutes = targetHour * 60 + targetMinute;
  if (targetMinutes < queryMinutes) {
    throw new Error(
      `예매 탐색 시작 시각(${targetTime})은 조회 기준 시각(${queryHour}:00)보다 빠를 수 없습니다.`,
    );
  }

  return targetTime;
}

/** 결과 목록에서 실제 좌석·예약대기 탐색을 시작할 출발시각(HH:mm) */
export const TARGET_TIME = resolveTargetTime(TIME, getArg("--target-time"));

/** 탐색 끝 시각을 HH:mm으로 검증하고 시작 시각 이후인지 확인한다. */
export function resolveTargetEndTime(targetTime: string, rawEndTime = ""): string {
  const endTime = rawEndTime || "23:59";
  if (!/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(endTime)) {
    throw new Error(
      `예매 탐색 끝 시각 형식 오류: "${endTime}" — HH:mm 형식으로 입력하세요 (예: 17:00)`,
    );
  }
  if (endTime < targetTime) {
    throw new Error(
      `예매 탐색 끝 시각(${endTime})은 탐색 시작 시각(${targetTime})보다 빠를 수 없습니다.`,
    );
  }
  return endTime;
}

/** 결과 목록에서 실제 좌석·예약대기 탐색을 끝낼 출발시각(HH:mm, 경계 포함) */
export const TARGET_END_TIME = resolveTargetEndTime(
  TARGET_TIME,
  getArg("--target-end-time"),
);

/**
 * 좌석 등급: "일반실" (기본), "특실", "입석+좌석"
 * - 일반실    → td[6], onclick*="requestReservationInfo" (Ann 제외)
 * - 입석+좌석 → td[6], onclick*="requestReservationInfoAnn"
 * - 특실      → td[5], onclick*="requestReservationInfo" (Ann 제외)
 *
 * 콤마로 구분해 복수 등급 동시 감시 가능: --seat 일반실,특실
 * 우선순위 = 입력 순서 (앞쪽 등급에 취소표/예약대기가 있으면 그것을 우선 사용).
 */
/** "일반실,특실" 같은 콤마 조인 문자열을 트림된 배열로 파싱 (빈 항목 제거) */
export function parseSeatClasses(raw: string): string[] {
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export const SEAT_CLASSES: string[] = parseSeatClasses(getArg("--seat", "일반실"));

/** 배너·로그 표시용 (예: "일반실/특실") */
export const SEAT_LABEL = SEAT_CLASSES.join("/");

/**
 * 폴링 간격(ms). 0이면 800~1500ms 랜덤 jitter 사용.
 * 랜덤 jitter 권장 — 고정 간격보다 자연스럽게 조회
 */
export const INTERVAL = Number(getArg("--interval", "0"));

// ─── 예약대기 옵션 ─────────────────────────────────────────────────────────
/**
 * --no-sms: SMS 수신 동의 거부 (기본: 동의)
 * SRT 예약대기 신청 폼의 "SMS 수신 동의" 체크박스 설정에 사용
 */
export const SMS_AGREE = !argv.includes("--no-sms");

/**
 * --wait-special: 일반실 예약대기 신청 시 특실 취소표도 배정 수락 (기본: false)
 * SRT 예약대기 신청 폼의 "특실 취소 승차권 배정 여부" 선택에 사용
 */
export const WAIT_SPECIAL = argv.includes("--wait-special");

/**
 * --force-poll: D-2 이상이어도 취소표 폴링 모드 강제 (테스트/예외용)
 */
const FORCE_POLL = argv.includes("--force-poll");

/**
 * 실행 모드:
 * - WAITLIST : 출발 2일 이상 전 → 매진 열차 예약대기 자동 신청
 * - POLLING  : 출발 1일 이내    → 취소표 실시간 폴링 (현재 동작)
 */
export const MODE: "WAITLIST" | "POLLING" =
  DATE && daysUntil(DATE) >= 2 && !FORCE_POLL ? "WAITLIST" : "POLLING";
