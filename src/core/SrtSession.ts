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
  TARGET_TIME,
  TARGET_END_TIME,
  SEAT_CLASSES,
  MODE,
  TRAIN_GROUP_CODE,
} from "../config.ts";
import { log, sleep } from "../utils.ts";
import { selectTargetTrain, clickReserveButton, type TrainSelectResult } from "./trainSelect.ts";
import { collectScheduleDiagnostics, type ScheduleDiagnostics } from "./scheduleDiagnostics.ts";
import { isScheduleSettled } from "./scheduleReady.ts";
import { isSrtLoginCompleteUrl } from "./loginRedirect.ts";

// ─── 검색 결과 열차 정보 ────────────────────────────────────────────────────
/** trainSelect.ts의 selectTargetTrain() 반환 타입 재-export (기존 호출부 호환용) */
export type TrainInfo = TrainSelectResult;

// ─── 좌석 등급 → 버튼 id 접두어 매핑 (clickReserve/clickWaitlist용) ──────────
// 입석+좌석도 일반실과 같은 genRsvBtn을 쓰고 onclick 함수명으로만 구분된다 (trainSelect.ts와 동일 규칙).
function seatBtnPrefix(seatClass: string): "speRsvBtn" | "genRsvBtn" {
  return seatClass === "특실" ? "speRsvBtn" : "genRsvBtn";
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

    // 새 문서마다 고유 식별자를 심는다 — waitForScheduleSettled()가 "정말 새 문서로
    // 전환됐는지"를 readyState만으로는 구분 못 하는 문제(라이브 검증 중 발견: 클릭 직후
    // NetFunnel 비동기 제출 지연 동안 이전 문서가 여전히 readyState=complete로 남아있어
    // 조기 통과할 수 있음)를 막기 위한 안전장치.
    await context.addInitScript(() => {
      (window as unknown as { __srtDocId: string }).__srtDocId =
        `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
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
    log("브라우저에서 SRT 로그인 진행 중 — 완료되면 자동으로 계속합니다.");
    if (!isSrtLoginCompleteUrl(this.page.url())) {
      await this.page.waitForURL(
        (url) => isSrtLoginCompleteUrl(url.href),
        { waitUntil: "domcontentloaded", timeout: 0 },
      );
    }

    log("로그인 완료 감지 — 조회 페이지 재진입 중...");
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

  /** 현재 페이지의 문서 식별자(__srtDocId, SrtSession.create()의 addInitScript가 심음) */
  private async currentDocId(): Promise<string | undefined> {
    return this.page
      .evaluate(() => (window as unknown as { __srtDocId?: string }).__srtDocId)
      .catch(() => undefined);
  }

  // ─── 클릭 → 결과 페이지 "정착"(로드 완료) 대기 ───────────────────────────
  /**
   * 라이브 검증 중 발견한 2단계 문제를 모두 막는다:
   *
   * 1. (scheduleRace.browser.test.ts R2/R3, 오프라인 확정) 문서가 아직
   *    document.readyState === "loading"인 동안에도 <table><tbody><tr>가 hidden input
   *    (trnNo[i])보다 먼저 파싱돼 DOM에 잡힌다. readyState만 보고 "정착"으로 판정하면 이 틈에서
   *    조기 통과한다.
   * 2. (라이브 수용 테스트 중 발견) SRT의 조회/페이징 제출은 NetFunnel_Action 비동기 콜백 →
   *    dp.submit() 경로라 클릭이 곧바로 네비게이션을 일으키지 않는다. 그 지연 동안 evaluate가
   *    "이전 문서"를 보면, 그 이전 문서는 이미 readyState==="complete"라서 1번 판정을 그냥
   *    통과해버린다 — readyState만으로는 "정말 새 문서로 전환됐는지"를 구분할 수 없었다.
   *
   * 그래서 클릭 전에 현재 문서 식별자(__srtDocId)를 찍어두고, 클릭 후에는 그 식별자가 실제로
   * 바뀔 때까지(=새 문서로 전환 확정) 먼저 기다린 다음에만 readyState 판정을 신뢰한다.
   */
  private async clickAndWaitForSchedule(click: () => Promise<void>): Promise<void> {
    const prevDocId = await this.currentDocId();

    await click();

    if (prevDocId !== undefined) {
      await this.page
        .waitForFunction(
          (prev) => (window as unknown as { __srtDocId?: string }).__srtDocId !== prev,
          prevDocId,
          { timeout: 30_000 },
        )
        .catch((err) => {
          log(`[결과 로드] 새 문서 전환 대기 실패(계속 진행): ${(err as Error).message}`);
        });
    }

    await this.waitForScheduleSettled();
  }

  private async waitForScheduleSettled(): Promise<void> {
    await this.page.waitForLoadState("domcontentloaded", { timeout: 15_000 }).catch((err) => {
      log(`[결과 로드] domcontentloaded 대기 실패: ${(err as Error).message}`);
    });

    let diag = await this.page.evaluate(collectScheduleDiagnostics);
    if (isScheduleSettled(diag)) return;

    log(`[결과 로드] readyState=${diag.readyState} — 아직 정착 안 됨, 재확인 중...`);
    for (let i = 0; i < 20; i++) {
      await sleep(100);
      diag = await this.page.evaluate(collectScheduleDiagnostics);
      if (isScheduleSettled(diag)) return;
    }
    log(`[결과 로드] 정착 재확인 타임아웃(readyState=${diag.readyState}) — 계속 진행`);
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
    // trnGpCd(차종구분, 2026-08-05 SRT+KTX 통합 이후 신설 필드)는 없는 페이지 상태에서도
    // 깨지지 않도록 존재할 때만 설정한다.
    await this.page.evaluate(
      ({ depCode, arrCode, depName, arrName, date, tm, trainGpCd }) => {
        (document.querySelector("#dptRsStnCd") as HTMLInputElement).value = depCode;
        (document.querySelector("#dptRsStnCdNm") as HTMLInputElement).value = depName;
        (document.querySelector("#arvRsStnCd") as HTMLInputElement).value = arrCode;
        (document.querySelector("#arvRsStnCdNm") as HTMLInputElement).value = arrName;
        (document.querySelector("#dptDt") as HTMLSelectElement).value = date;
        (document.querySelector("#dptTm") as HTMLSelectElement).value = tm;
        const trnGpRadio = document.querySelector(
          `input[name="trnGpCd"][value="${trainGpCd}"]`,
        ) as HTMLInputElement | null;
        if (trnGpRadio) trnGpRadio.checked = true;
      },
      { depCode, arrCode, depName: DEP, arrName: ARR, date: DATE, tm: tmValue, trainGpCd: TRAIN_GROUP_CODE },
    );

    // 조회하기 버튼 클릭
    const searchBtn = this.page.locator('button:has-text("조회하기"), input[value="조회하기"]').first();
    await this.clickAndWaitForSchedule(() => searchBtn.click());
    log("조회 완료 — 결과 테이블 로드됨");
  }

  // ─── 결과에서 목표 열차 탐지 ────────────────────────────────────────────
  /**
   * 결과 테이블에서 TARGET_TIME~TARGET_END_TIME 열차를 위에서부터 스캔해 좌석 상태 반환.
   * - 잔여석 열차 발견 → 해당 열차 반환 (seatAvailable: true, 가장 이른 열차 우선)
   * - 열차는 있지만 전부 매진 → 첫 번째 열차 반환 (seatAvailable: false)
   * - 결과 테이블에 열차 없음 → null
   */
  async findTargetTrain(): Promise<TrainInfo | null> {
    return this.page.evaluate(selectTargetTrain, {
      seatClasses: SEAT_CLASSES,
      minDepTime: TARGET_TIME,
      maxDepTime: TARGET_END_TIME,
    });
  }

  // ─── 재조회 (결과 페이지에서 조회하기 버튼 재클릭) ──────────────────────
  async requery(): Promise<void> {
    const btn = this.page.locator('button:has-text("조회하기"), input[value="조회하기"]').first();
    await this.clickAndWaitForSchedule(() => btn.click());
  }

  // ─── 결과 페이지 진단 (파싱 0건 vs 시간 필터 밖 구분용) ──────────────────
  /** findTargetTrain()이 null일 때 원인 진단을 위해 hidden input·화면 상태를 그대로 수집한다. */
  async describeSchedule(): Promise<ScheduleDiagnostics> {
    return this.page.evaluate(collectScheduleDiagnostics);
  }

  // ─── SRT 자동화 탐지 차단 감지 ────────────────────────────────────────────
  /**
   * 2026-08-12 실전 폴링 중 IP가 "비정상적인 접근이 감지되어 접속이 일시적으로 제한"
   * 페이지로 튕긴 사고가 있었다. 결과 테이블 대신 이 안내 페이지가 뜨면 findTargetTrain()은
   * 그냥 null(열차 없음)로 보이므로, 별도로 본문 텍스트를 검사해 구분한다.
   */
  async isBlockedByAntiBot(): Promise<boolean> {
    return this.page
      .evaluate(() => {
        const text = document.body?.innerText ?? "";
        return text.includes("접속이 일시적으로 제한") || text.includes("자동화된 요청으로 감지");
      })
      .catch(() => false);
  }

  // ─── 다음 페이지 조회 (결과 목록 10건씩 페이징) ──────────────────────────
  /**
   * SRT 결과 목록은 10건씩 페이징되고 "다음"(changeDptTm('NEXT', ...)) 버튼으로 다음 구간을
   * 조회한다(라이브 캡처로 확인). searchTrains()의 "조회하기 버튼을 form.submit()으로
   * 우회하지 않는다" 규칙과 동일하게, changeDptTm()을 직접 호출하지 않고 버튼을 클릭한다.
   * 버튼이 없으면(마지막 페이지) false 반환.
   */
  async goNextPage(): Promise<boolean> {
    const btn = this.page.locator('input[value="다음"]');
    if ((await btn.count()) === 0) return false;

    log("다음 페이지 조회 중 (다음 10건)...");
    await this.clickAndWaitForSchedule(() => btn.first().click());
    return true;
  }

  // ─── 예약하기 버튼 클릭 → 예약 확인 페이지 반환 ─────────────────────────
  /**
   * SRT 직통 열차는 insert-form.submit() → 현재 페이지가 checkUserInfo.do로 이동.
   * KTX 교차판매 열차는 SweetAlert2 모달이 뜨고 페이지 이동 없음 (별도 처리 필요).
   */
  async clickReserve(rowIndex: number, seatClass: string): Promise<Page> {
    log(`예약 버튼 클릭 시도: 행=${rowIndex} (${seatClass})`);

    // 예약 버튼 클릭으로 발생하는 첫 dialog만 처리
    // "스마트폰 어플이 있습니까?" 등 confirm 다이얼로그 → dismiss(아니오)로 웹 예약 흐름 유지
    // Playwright는 핸들러 없으면 자동 dismiss하지만 그 전에 핸들러 등록 필요

    const prevUrl = this.page.url();
    const navPromise = this.page
      .waitForURL((url) => url.href !== prevUrl, {
        waitUntil: "domcontentloaded",
        timeout: 15000,
      })
      .catch(() => null);

    // SRT 직통: insert-form.submit() → 현재 페이지 이동
    // 클릭 전에 설정해야 빠른 navigation을 놓치지 않음.
    // 2026-08-12: SRT가 genRsvBtn{i}/speRsvBtn{i} id를 제거해 id 기반 클릭이 조용히 no-op
    // 되던 사고가 있었다 — trainSelect.ts의 clickReserveButton()이 aria-label/onclick 인자
    // 기반으로 찾아 클릭하고, 실패 시 false를 반환해 여기서 예외로 알린다.
    const clicked = await this.page.evaluate(clickReserveButton, { rowIndex, seatClass });
    if (!clicked) {
      throw new Error(
        `예약 버튼을 찾지 못했습니다 (행=${rowIndex}, ${seatClass}) — SRT가 결과 페이지 마크업을 ` +
          `또 바꿨을 수 있습니다. 매진 로그의 btnDebug 값을 확인하세요.`,
      );
    }

    const navigated = await navPromise;

    const url = this.page.url();
    log(`클릭 후 URL: ${url} (이동: ${navigated !== null ? "O" : "X"})`);

    return this.page;
  }

  // ─── 예약대기 버튼 클릭 → 신청 페이지 반환 ───────────────────────────────
  /**
   * WAITLIST 모드에서 호출. 해당 행의 예약대기 버튼(requestReservationWait, 사이트 정적 JS
   * 원문으로 확인한 실제 함수명)을 클릭한다. clickReserve()와 동일한 패턴 (dialog 핸들러 + waitForURL).
   * 버튼 id는 예약 상태와 동일한 genRsvBtn/speRsvBtn을 재사용한다 — 사이트 JS(changeKorailBtnTxt)가
   * 같은 버튼의 텍스트만 "예약대기"로 바꿔치기하는 구조이기 때문.
   */
  async clickWaitlist(rowIndex: number, seatClass: string): Promise<Page> {
    const btnId = `${seatBtnPrefix(seatClass)}${rowIndex}`;

    log(`예약대기 버튼 클릭: id=${btnId} (${seatClass})`);

    const prevUrl = this.page.url();
    const navPromise = this.page
      .waitForURL((url) => url.href !== prevUrl, { waitUntil: "domcontentloaded", timeout: 15_000 })
      .catch(() => null);

    await this.page.evaluate((id) => {
      document.getElementById(id)?.click();
    }, btnId);

    const navigated = await navPromise;

    const url = this.page.url();
    log(`예약대기 클릭 후 URL: ${url} (이동: ${navigated !== null ? "O" : "X"})`);

    return this.page;
  }
}
