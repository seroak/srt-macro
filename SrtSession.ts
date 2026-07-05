import { chromium, type Page, type BrowserContext, type Dialog } from "playwright";
import * as fs from "fs";
import {
  SRT_SESSION_FILE,
  SRT_SEARCH_URL,
  SRT_LOGIN_URL,
  STATION_CODE,
  DEP,
  ARR,
  DATE,
  TIME,
  SEAT_CLASSES,
  MODE,
} from "./config.ts";
import { log, sleep, waitEnter } from "./utils.ts";
import { selectTargetTrain, type TrainSelectResult } from "./trainSelect.ts";

// ─── 검색 결과 열차 정보 ────────────────────────────────────────────────────
/** trainSelect.ts의 selectTargetTrain() 반환 타입 재-export (기존 호출부 호환용) */
export type TrainInfo = TrainSelectResult;

// ─── 좌석 등급 → 컬럼/타입 매핑 (Node 사이드에서 사용, clickReserve/clickWaitlist용) ──
function seatColIdx(seatClass: string): number {
  return seatClass === "특실" ? 5 : 6;
}
function isStandingSeat(seatClass: string): boolean {
  return seatClass === "입석+좌석";
}

// ─── 역 코드 조회 헬퍼 ──────────────────────────────────────────────────────
function resolveStationCode(name: string): string {
  const code = STATION_CODE[name];
  if (!code) {
    throw new Error(
      `역 코드 미등록: "${name}"\n` +
        `srt/config.ts STATION_CODE 맵에 코드를 추가하거나,\n` +
        `etk.srail.kr 검색 폼에서 DevTools → dptRsStnCd 값을 확인하세요.`,
    );
  }
  return code;
}

// ─── 시간 → SRT 폼 value 변환 ────────────────────────────────────────────
// TIME = "06" → dptTm select value = "060000"
function timeToFormValue(hh: string): string {
  return hh.padStart(2, "0") + "0000";
}

// ─── 날짜 format 유효성 검사 ───────────────────────────────────────────────
function validateDate(date: string): void {
  if (!/^\d{8}$/.test(date)) {
    throw new Error(`날짜 형식 오류: "${date}" — YYYYMMDD 형식으로 입력하세요 (예: 20260710)`);
  }
}

export class SrtSession {
  private constructor(
    public readonly context: BrowserContext,
    public readonly page: Page,
  ) {}

  static async create(): Promise<SrtSession> {
    log("브라우저 기동 중...");
    const browser = await chromium.launch({
      headless: false,
      args: ["--disable-blink-features=AutomationControlled"],
    });

    const sessionExists = fs.existsSync(SRT_SESSION_FILE);
    log(`세션 파일: ${sessionExists ? SRT_SESSION_FILE + " (복원)" : "없음 (신규 로그인 필요)"}`);

    const context = await browser.newContext({
      userAgent:
        "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
        "(KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
      locale: "ko-KR",
      viewport: { width: 1280, height: 900 },
      extraHTTPHeaders: {
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
        "sec-ch-ua": '"Chromium";v="136", "Google Chrome";v="136", "Not.A/Brand";v="99"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"macOS"',
      },
      ...(sessionExists ? { storageState: SRT_SESSION_FILE } : {}),
    });

    const page = await context.newPage();
    page.on("pageerror", (err) => log(`브라우저 에러: ${err.message}`));
    page.on("dialog", async (dialog) => {
      log(`[${dialog.type()}] ${dialog.message()}`);

      await dialog.accept();
    });
    return new SrtSession(context, page);
  }

  // ─── 로그인 보장 ────────────────────────────────────────────────────────
  async ensureLogin(): Promise<void> {
    log("SRT 조회 페이지 진입 중...");
    await this.page.goto(SRT_SEARCH_URL, { waitUntil: "domcontentloaded" });
    await sleep(600);

    const loggedIn = await this.checkLogin();
    if (!loggedIn) {
      log("비로그인 상태 감지 → 수동 로그인 필요");
      await this.doLogin();
    } else {
      log("로그인 상태 확인 — 세션 저장");
      await this.saveSession();
    }
  }

  /** 헤더의 "로그인" 링크 존재 여부로 로그인 상태 판단 */
  private async checkLogin(): Promise<boolean> {
    await this.page.waitForLoadState("domcontentloaded");
    const count = await this.page.locator('a[href*="selectLoginForm"]').count();
    log(`로그인 링크 개수: ${count} → ${count === 0 ? "로그인 상태" : "비로그인"}`);
    return count === 0;
  }

  private async doLogin(): Promise<void> {
    log("로그인 페이지로 이동...");
    await this.page.goto(SRT_LOGIN_URL, { waitUntil: "domcontentloaded" });
    await waitEnter("브라우저에서 SRT 로그인 완료 후 Enter > ");

    log("로그인 완료 — 조회 페이지 재진입 중...");
    await this.page.goto(SRT_SEARCH_URL, { waitUntil: "domcontentloaded" });
    await sleep(800);

    const loggedIn = await this.checkLogin();
    if (!loggedIn) {
      log("아직 로그인 안 됨. 다시 시도...");
      await this.doLogin();
      return;
    }
    await this.saveSession();
  }

  private async saveSession(): Promise<void> {
    await this.context.storageState({ path: SRT_SESSION_FILE });
    log(`세션 저장 완료 → ${SRT_SESSION_FILE}`);
  }

  // ─── 열차 조회 (폼 입력 → 제출) ────────────────────────────────────────
  async searchTrains(): Promise<void> {
    validateDate(DATE);
    const depCode = resolveStationCode(DEP);
    const arrCode = resolveStationCode(ARR);
    const tmValue = timeToFormValue(TIME);

    log(`조회: ${DEP}(${depCode}) → ${ARR}(${arrCode}), ${DATE}, ${TIME}시 이후`);

    // 조회 페이지로 이동 (결과 페이지에 있어도 폼 재설정 가능)
    if (!this.page.url().includes("selectScheduleList")) {
      await this.page.goto(SRT_SEARCH_URL, { waitUntil: "domcontentloaded" });
      await sleep(500);
    }

    // 출발역/도착역 직접 설정 (숨김 코드 필드 + 표시 텍스트 필드)
    await this.page.evaluate(
      ({ depCode, arrCode, depName, arrName, date, tm }) => {
        (document.querySelector("#dptRsStnCd") as HTMLInputElement).value = depCode;
        (document.querySelector("#dptRsStnCdNm") as HTMLInputElement).value = depName;
        (document.querySelector("#arvRsStnCd") as HTMLInputElement).value = arrCode;
        (document.querySelector("#arvRsStnCdNm") as HTMLInputElement).value = arrName;
        (document.querySelector("#dptDt") as HTMLSelectElement).value = date;
        (document.querySelector("#dptTm") as HTMLSelectElement).value = tm;
      },
      { depCode, arrCode, depName: DEP, arrName: ARR, date: DATE, tm: tmValue },
    );

    // 조회하기 버튼 클릭
    const searchBtn = this.page.locator('button:has-text("조회하기"), input[value="조회하기"]').first();
    await searchBtn.click();
    await this.page.waitForLoadState("domcontentloaded");
    await this.page.waitForSelector("table tbody tr", { timeout: 10_000 }).catch(() => {});
    log("조회 완료 — 결과 테이블 로드됨");
  }

  // ─── 결과에서 목표 열차 탐지 ────────────────────────────────────────────
  /**
   * 결과 테이블을 조회 기준 시각(TIME) 이후 위에서부터 스캔해 좌석 상태 반환.
   * - 잔여석 열차 발견 → 해당 열차 반환 (seatAvailable: true, 가장 이른 열차 우선)
   * - 열차는 있지만 전부 매진 → 첫 번째 열차 반환 (seatAvailable: false)
   * - 결과 테이블에 열차 없음 → null
   */
  async findTargetTrain(): Promise<TrainInfo | null> {
    return this.page.evaluate(selectTargetTrain, {
      seatClasses: SEAT_CLASSES,
    });
  }

  // ─── 재조회 (결과 페이지에서 조회하기 버튼 재클릭) ──────────────────────
  async requery(): Promise<void> {
    const btn = this.page.locator('button:has-text("조회하기"), input[value="조회하기"]').first();
    await btn.click();
    await this.page.waitForLoadState("domcontentloaded");
    await this.page.waitForSelector("table tbody tr", { timeout: 10_000 }).catch(() => {});
  }

  // ─── 예약하기 버튼 클릭 → 예약 확인 페이지 반환 ─────────────────────────
  /**
   * SRT 직통 열차는 insert-form.submit() → 현재 페이지가 checkUserInfo.do로 이동.
   * KTX 교차판매 열차는 SweetAlert2 모달이 뜨고 페이지 이동 없음 (별도 처리 필요).
   */
  async clickReserve(rowIndex: number, seatClass: string): Promise<Page> {
    const colIdx = seatColIdx(seatClass);
    const isStanding = isStandingSeat(seatClass);
    // 예약 버튼 클릭으로 발생하는 첫 dialog만 처리

    log(`예약 버튼 클릭: row=${rowIndex}, col=${colIdx} (${seatClass})`);

    // 예약 버튼 클릭으로 발생하는 첫 dialog만 처리

    const prevUrl = this.page.url();
    const navPromise = this.page
      .waitForURL((url) => url.href !== prevUrl, {
        waitUntil: "domcontentloaded",
        timeout: 15000,
      })
      .catch(() => null);
    // "스마트폰 어플이 있습니까?" 등 confirm 다이얼로그 → dismiss(아니오)로 웹 예약 흐름 유지
    // Playwright는 핸들러 없으면 자동 dismiss하지만 그 전에 핸들러 등록 필요

    // SRT 직통: insert-form.submit() → 현재 페이지 이동
    // 클릭 전에 설정해야 빠른 navigation을 놓치지 않음

    // id 없이 행의 좌석 셀에서 대상 버튼을 직접 찾아 클릭
    await this.page.evaluate(
      ({ ri, ci, standing }) => {
        const rows = document.querySelectorAll("table tbody tr");
        const row = rows[ri];
        if (!row) return;
        const tds = row.querySelectorAll("td");
        const cell = tds[ci];
        if (!cell) return;
        let btn: HTMLElement | null = null;
        if (standing) {
          btn = cell.querySelector(
            'a[onclick*="requestReservationInfoAnn"], button[onclick*="requestReservationInfoAnn"]',
          );
          if (!btn) {
            btn =
              (Array.from(cell.querySelectorAll("a, button")).find((el) =>
                (el as HTMLElement).innerText?.includes("입석"),
              ) as HTMLElement) ?? null;
          }
        } else {
          btn =
            (Array.from(cell.querySelectorAll("a, button")).find((el) => {
              const onclick = el.getAttribute("onclick") ?? "";
              return onclick.includes("requestReservationInfo") && !onclick.includes("requestReservationInfoAnn");
            }) as HTMLElement) ?? null;
          if (!btn) {
            btn =
              (Array.from(cell.querySelectorAll("a, button")).find(
                (el) =>
                  (el as HTMLElement).innerText?.includes("예약") &&
                  !(el as HTMLElement).innerText?.includes("입석") &&
                  !(el.getAttribute("onclick") ?? "").includes("showKorail"),
              ) as HTMLElement) ?? null;
          }
        }
        btn?.click();
      },
      { ri: rowIndex, ci: colIdx, standing: isStanding },
    );

    const navigated = await navPromise;

    const url = this.page.url();
    log(`클릭 후 URL: ${url} (이동: ${navigated !== null ? "O" : "X"})`);

    return this.page;
  }

  // ─── 예약대기 버튼 클릭 → 신청 페이지 반환 ───────────────────────────────
  /**
   * WAITLIST 모드에서 호출. 해당 행의 "예약대기" 버튼을 클릭한다.
   * clickReserve()와 동일한 패턴 (dialog 핸들러 + waitForURL).
   *
   * NOTE: waitlistBtn 셀렉터(onclick 함수명)는 라이브 DevTools 확인 후 갱신 필요.
   *       현재는 "예약대기" 텍스트 폴백을 최우선으로 사용.
   */
  async clickWaitlist(rowIndex: number, seatClass: string): Promise<Page> {
    const colIdx = seatColIdx(seatClass);

    log(`예약대기 버튼 클릭: row=${rowIndex}, col=${colIdx} (${seatClass})`);

    const prevUrl = this.page.url();
    const navPromise = this.page
      .waitForURL((url) => url.href !== prevUrl, { waitUntil: "domcontentloaded", timeout: 15_000 })
      .catch(() => null);

    await this.page.evaluate(
      ({ ri, ci }) => {
        const rows = document.querySelectorAll("table tbody tr");
        const row = rows[ri];
        if (!row) return;
        const tds = row.querySelectorAll("td");
        const cell = tds[ci];
        if (!cell) return;
        // onclick 함수명 우선, 텍스트 폴백
        let btn: HTMLElement | null = cell.querySelector(
          'a[onclick*="requestWaitingReservation"], button[onclick*="requestWaitingReservation"],' +
            'a[onclick*="waitList"], button[onclick*="waitList"]',
        );
        if (!btn) {
          btn =
            (Array.from(cell.querySelectorAll("a, button")).find((el) =>
              (el as HTMLElement).innerText?.includes("예약대기"),
            ) as HTMLElement) ?? null;
        }
        btn?.click();
      },
      { ri: rowIndex, ci: colIdx },
    );

    const navigated = await navPromise;

    const url = this.page.url();
    log(`예약대기 클릭 후 URL: ${url} (이동: ${navigated !== null ? "O" : "X"})`);

    return this.page;
  }
}
