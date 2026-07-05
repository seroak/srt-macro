// config.ts
import { join } from "path";
var SRT_DATA_DIR = process.env.SRT_DATA_DIR;
var SRT_SESSION_FILE = SRT_DATA_DIR ? join(SRT_DATA_DIR, "srt_session.json") : "./srt_session.json";
var SRT_SEARCH_URL = "https://etk.srail.kr/hpg/hra/01/selectScheduleList.do?pageId=TK0101010000";
var SRT_LOGIN_URL = "https://etk.srail.kr/cmc/01/selectLoginForm.do?pageId=TK0701000000";
var STATION_CODE = {
  \uC218\uC11C: "0551",
  \uB3D9\uD0C4: "0552",
  \uD3C9\uD0DD\uC9C0\uC81C: "0553",
  \uC624\uC1A1: "0297",
  \uB300\uC804: "0010",
  \uAE40\uCC9C\uAD6C\uBBF8: "0507",
  \uC11C\uB300\uAD6C: "0506",
  \uB3D9\uB300\uAD6C: "0015",
  \uC2E0\uACBD\uC8FC: "0508",
  \uC6B8\uC0B0\uD1B5\uB3C4\uC0AC: "0509",
  \uBD80\uC0B0: "0020",
  \uAD11\uC8FC\uC1A1\uC815: "0036",
  \uBAA9\uD3EC: "0056",
  \uACF5\uC8FC: "0514",
  \uC775\uC0B0: "0050",
  \uC815\uC74D: "0405",
  \uC21C\uCC9C: "0224",
  \uC5EC\uC218\uC5D1\uC2A4\uD3EC: "0263"
};
function daysUntil(yyyymmdd) {
  const y = parseInt(yyyymmdd.slice(0, 4), 10);
  const m = parseInt(yyyymmdd.slice(4, 6), 10) - 1;
  const d = parseInt(yyyymmdd.slice(6, 8), 10);
  const target = new Date(y, m, d);
  const today = /* @__PURE__ */ new Date();
  today.setHours(0, 0, 0, 0);
  target.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / (1e3 * 60 * 60 * 24));
}
var argv = process.argv.slice(2);
var getArg = (key, def = "") => {
  const i = argv.indexOf(key);
  return i !== -1 && argv[i + 1] ? argv[i + 1] : def;
};
var GO = argv.includes("--go");
var DEP = getArg("--dep", "\uC218\uC11C");
var ARR = getArg("--arr", "\uBD80\uC0B0");
var DATE = getArg("--date");
var TIME = getArg("--time", "06");
var TRAIN_FROM = getArg("--from", "00:00");
var TRAIN_TO = getArg("--to", "23:59");
function parseSeatClasses(raw) {
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}
var SEAT_CLASSES = parseSeatClasses(getArg("--seat", "\uC77C\uBC18\uC2E4"));
var SEAT_LABEL = SEAT_CLASSES.join("/");
var INTERVAL = Number(getArg("--interval", "0"));
var SMS_AGREE = !argv.includes("--no-sms");
var WAIT_SPECIAL = argv.includes("--wait-special");
var FORCE_POLL = argv.includes("--force-poll");
var MODE = DATE && daysUntil(DATE) >= 2 && !FORCE_POLL ? "WAITLIST" : "POLLING";

// utils.ts
import * as readline from "readline";
var sleep = (ms) => new Promise((r) => setTimeout(r, ms));
var randomDelay = () => sleep(800 + Math.floor(Math.random() * 700));
function nowStr() {
  return (/* @__PURE__ */ new Date()).toLocaleTimeString("ko-KR", { hour12: false });
}
function log(msg) {
  console.log(`[${nowStr()}] ${msg}`);
}
var rl = readline.createInterface({ input: process.stdin, output: process.stdout });
var waitEnter = (msg) => new Promise((res) => rl.question(msg, () => res()));
var closeRl = () => rl.close();

// SrtSession.ts
import { chromium } from "playwright";
import * as fs from "fs";

// trainSelect.ts
function selectTargetTrain(opts) {
  const { fromTime, toTime, seatClasses } = opts;
  const rows = document.querySelectorAll("table tbody tr");
  let firstInRange = null;
  let inRangeCount = 0;
  for (let i = 0; i < rows.length; i++) {
    const tds = rows[i].querySelectorAll("td");
    if (tds.length < 7) continue;
    const trainNo = tds[2].innerText?.trim() ?? "";
    const depTime = tds[3].querySelector("em.time")?.innerText?.trim() ?? "";
    const arrTime = tds[4].querySelector("em.time")?.innerText?.trim() ?? "";
    if (depTime < fromTime || depTime > toTime) continue;
    inRangeCount++;
    let matchedSeat = seatClasses[0] ?? "";
    let statusText = "";
    let seatAvailable = false;
    let waitlistAvailable = false;
    for (const sc of seatClasses) {
      const colIdx = sc === "\uD2B9\uC2E4" ? 5 : 6;
      const seatCell = tds[colIdx];
      if (!seatCell) continue;
      const isStanding = sc === "\uC785\uC11D+\uC88C\uC11D";
      let reserveBtn = null;
      if (isStanding) {
        reserveBtn = seatCell.querySelector(
          'a[onclick*="requestReservationInfoAnn"], button[onclick*="requestReservationInfoAnn"]'
        );
        if (!reserveBtn) {
          reserveBtn = Array.from(seatCell.querySelectorAll("a, button")).find(
            (el) => el.innerText?.includes("\uC785\uC11D")
          ) ?? null;
        }
      } else {
        reserveBtn = Array.from(seatCell.querySelectorAll("a, button")).find((el) => {
          const onclick = el.getAttribute("onclick") ?? "";
          return onclick.includes("requestReservationInfo") && !onclick.includes("requestReservationInfoAnn");
        }) ?? null;
        if (!reserveBtn) {
          reserveBtn = Array.from(seatCell.querySelectorAll("a, button")).find(
            (el) => el.innerText?.includes("\uC608\uC57D") && !el.innerText?.includes("\uC608\uC57D\uB300\uAE30") && !el.innerText?.includes("\uC785\uC11D") && !(el.getAttribute("onclick") ?? "").includes("showKorail")
          ) ?? null;
        }
      }
      if (reserveBtn) {
        matchedSeat = sc;
        statusText = seatCell.innerText?.replace(/\s+/g, " ").trim() ?? "";
        seatAvailable = true;
        break;
      }
      if (!waitlistAvailable) {
        let waitlistBtn = seatCell.querySelector(
          'a[onclick*="requestWaitingReservation"], button[onclick*="requestWaitingReservation"],a[onclick*="waitList"], button[onclick*="waitList"]'
        );
        if (!waitlistBtn) {
          waitlistBtn = Array.from(seatCell.querySelectorAll("a, button")).find(
            (el) => el.innerText?.includes("\uC608\uC57D\uB300\uAE30")
          ) ?? null;
        }
        if (waitlistBtn) {
          waitlistAvailable = true;
          matchedSeat = sc;
          statusText = seatCell.innerText?.replace(/\s+/g, " ").trim() ?? "";
        }
      }
    }
    if (seatAvailable) {
      return {
        rowIndex: i,
        trainNo,
        depTime,
        arrTime,
        seatAvailable: true,
        statusText,
        inRangeCount,
        waitlistAvailable: false,
        matchedSeat
      };
    }
    if (!firstInRange) {
      firstInRange = {
        rowIndex: i,
        trainNo,
        depTime,
        arrTime,
        seatAvailable: false,
        statusText,
        inRangeCount: 0,
        waitlistAvailable,
        matchedSeat
      };
    } else if (waitlistAvailable && !firstInRange.waitlistAvailable) {
      firstInRange = {
        rowIndex: i,
        trainNo,
        depTime,
        arrTime,
        seatAvailable: false,
        statusText,
        inRangeCount: 0,
        waitlistAvailable,
        matchedSeat
      };
    }
  }
  return firstInRange ? { ...firstInRange, inRangeCount } : null;
}

// SrtSession.ts
function seatColIdx(seatClass) {
  return seatClass === "\uD2B9\uC2E4" ? 5 : 6;
}
function isStandingSeat(seatClass) {
  return seatClass === "\uC785\uC11D+\uC88C\uC11D";
}
function resolveStationCode(name) {
  const code = STATION_CODE[name];
  if (!code) {
    throw new Error(
      `\uC5ED \uCF54\uB4DC \uBBF8\uB4F1\uB85D: "${name}"
srt/config.ts STATION_CODE \uB9F5\uC5D0 \uCF54\uB4DC\uB97C \uCD94\uAC00\uD558\uAC70\uB098,
etk.srail.kr \uAC80\uC0C9 \uD3FC\uC5D0\uC11C DevTools \u2192 dptRsStnCd \uAC12\uC744 \uD655\uC778\uD558\uC138\uC694.`
    );
  }
  return code;
}
function timeToFormValue(hh) {
  return hh.padStart(2, "0") + "0000";
}
function validateDate(date) {
  if (!/^\d{8}$/.test(date)) {
    throw new Error(`\uB0A0\uC9DC \uD615\uC2DD \uC624\uB958: "${date}" \u2014 YYYYMMDD \uD615\uC2DD\uC73C\uB85C \uC785\uB825\uD558\uC138\uC694 (\uC608: 20260710)`);
  }
}
var SrtSession = class _SrtSession {
  constructor(context, page) {
    this.context = context;
    this.page = page;
  }
  context;
  page;
  static async create() {
    log("\uBE0C\uB77C\uC6B0\uC800 \uAE30\uB3D9 \uC911...");
    const browser = await chromium.launch({
      headless: false,
      args: ["--disable-blink-features=AutomationControlled"]
    });
    const sessionExists = fs.existsSync(SRT_SESSION_FILE);
    log(`\uC138\uC158 \uD30C\uC77C: ${sessionExists ? SRT_SESSION_FILE + " (\uBCF5\uC6D0)" : "\uC5C6\uC74C (\uC2E0\uADDC \uB85C\uADF8\uC778 \uD544\uC694)"}`);
    const context = await browser.newContext({
      userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
      locale: "ko-KR",
      viewport: { width: 1280, height: 900 },
      extraHTTPHeaders: {
        "Accept-Language": "ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7",
        "sec-ch-ua": '"Chromium";v="136", "Google Chrome";v="136", "Not.A/Brand";v="99"',
        "sec-ch-ua-mobile": "?0",
        "sec-ch-ua-platform": '"macOS"'
      },
      ...sessionExists ? { storageState: SRT_SESSION_FILE } : {}
    });
    const page = await context.newPage();
    page.on("pageerror", (err) => log(`\uBE0C\uB77C\uC6B0\uC800 \uC5D0\uB7EC: ${err.message}`));
    page.on("dialog", async (dialog) => {
      log(`[${dialog.type()}] ${dialog.message()}`);
      await dialog.accept();
    });
    return new _SrtSession(context, page);
  }
  // ─── 로그인 보장 ────────────────────────────────────────────────────────
  async ensureLogin() {
    log("SRT \uC870\uD68C \uD398\uC774\uC9C0 \uC9C4\uC785 \uC911...");
    await this.page.goto(SRT_SEARCH_URL, { waitUntil: "domcontentloaded" });
    await sleep(600);
    const loggedIn = await this.checkLogin();
    if (!loggedIn) {
      log("\uBE44\uB85C\uADF8\uC778 \uC0C1\uD0DC \uAC10\uC9C0 \u2192 \uC218\uB3D9 \uB85C\uADF8\uC778 \uD544\uC694");
      await this.doLogin();
    } else {
      log("\uB85C\uADF8\uC778 \uC0C1\uD0DC \uD655\uC778 \u2014 \uC138\uC158 \uC800\uC7A5");
      await this.saveSession();
    }
  }
  /** 헤더의 "로그인" 링크 존재 여부로 로그인 상태 판단 */
  async checkLogin() {
    await this.page.waitForLoadState("domcontentloaded");
    const count = await this.page.locator('a[href*="selectLoginForm"]').count();
    log(`\uB85C\uADF8\uC778 \uB9C1\uD06C \uAC1C\uC218: ${count} \u2192 ${count === 0 ? "\uB85C\uADF8\uC778 \uC0C1\uD0DC" : "\uBE44\uB85C\uADF8\uC778"}`);
    return count === 0;
  }
  async doLogin() {
    log("\uB85C\uADF8\uC778 \uD398\uC774\uC9C0\uB85C \uC774\uB3D9...");
    await this.page.goto(SRT_LOGIN_URL, { waitUntil: "domcontentloaded" });
    await waitEnter("\uBE0C\uB77C\uC6B0\uC800\uC5D0\uC11C SRT \uB85C\uADF8\uC778 \uC644\uB8CC \uD6C4 Enter > ");
    log("\uB85C\uADF8\uC778 \uC644\uB8CC \u2014 \uC870\uD68C \uD398\uC774\uC9C0 \uC7AC\uC9C4\uC785 \uC911...");
    await this.page.goto(SRT_SEARCH_URL, { waitUntil: "domcontentloaded" });
    await sleep(800);
    const loggedIn = await this.checkLogin();
    if (!loggedIn) {
      log("\uC544\uC9C1 \uB85C\uADF8\uC778 \uC548 \uB428. \uB2E4\uC2DC \uC2DC\uB3C4...");
      await this.doLogin();
      return;
    }
    await this.saveSession();
  }
  async saveSession() {
    await this.context.storageState({ path: SRT_SESSION_FILE });
    log(`\uC138\uC158 \uC800\uC7A5 \uC644\uB8CC \u2192 ${SRT_SESSION_FILE}`);
  }
  // ─── 열차 조회 (폼 입력 → 제출) ────────────────────────────────────────
  async searchTrains() {
    validateDate(DATE);
    const depCode = resolveStationCode(DEP);
    const arrCode = resolveStationCode(ARR);
    const tmValue = timeToFormValue(TIME);
    log(`\uC870\uD68C: ${DEP}(${depCode}) \u2192 ${ARR}(${arrCode}), ${DATE}, ${TIME}\uC2DC \uC774\uD6C4`);
    if (!this.page.url().includes("selectScheduleList")) {
      await this.page.goto(SRT_SEARCH_URL, { waitUntil: "domcontentloaded" });
      await sleep(500);
    }
    await this.page.evaluate(
      ({ depCode: depCode2, arrCode: arrCode2, depName, arrName, date, tm }) => {
        document.querySelector("#dptRsStnCd").value = depCode2;
        document.querySelector("#dptRsStnCdNm").value = depName;
        document.querySelector("#arvRsStnCd").value = arrCode2;
        document.querySelector("#arvRsStnCdNm").value = arrName;
        document.querySelector("#dptDt").value = date;
        document.querySelector("#dptTm").value = tm;
      },
      { depCode, arrCode, depName: DEP, arrName: ARR, date: DATE, tm: tmValue }
    );
    const searchBtn = this.page.locator('button:has-text("\uC870\uD68C\uD558\uAE30"), input[value="\uC870\uD68C\uD558\uAE30"]').first();
    await searchBtn.click();
    await this.page.waitForLoadState("domcontentloaded");
    await this.page.waitForSelector("table tbody tr", { timeout: 1e4 }).catch(() => {
    });
    log("\uC870\uD68C \uC644\uB8CC \u2014 \uACB0\uACFC \uD14C\uC774\uBE14 \uB85C\uB4DC\uB428");
  }
  // ─── 결과에서 목표 열차 탐지 ────────────────────────────────────────────
  /**
   * 결과 테이블을 파싱해 [TRAIN_FROM ~ TRAIN_TO] 범위 내 좌석 상태 반환.
   * - 범위 내 잔여석 열차 발견 → 해당 열차 반환 (seatAvailable: true)
   * - 범위 내 열차 있지만 전부 매진 → 첫 번째 열차 반환 (seatAvailable: false)
   * - 범위 내 열차 없음 → null
   */
  async findTargetTrain() {
    return this.page.evaluate(selectTargetTrain, {
      fromTime: TRAIN_FROM,
      toTime: TRAIN_TO,
      seatClasses: SEAT_CLASSES
    });
  }
  // ─── 재조회 (결과 페이지에서 조회하기 버튼 재클릭) ──────────────────────
  async requery() {
    const btn = this.page.locator('button:has-text("\uC870\uD68C\uD558\uAE30"), input[value="\uC870\uD68C\uD558\uAE30"]').first();
    await btn.click();
    await this.page.waitForLoadState("domcontentloaded");
    await this.page.waitForSelector("table tbody tr", { timeout: 1e4 }).catch(() => {
    });
  }
  // ─── 예약하기 버튼 클릭 → 예약 확인 페이지 반환 ─────────────────────────
  /**
   * SRT 직통 열차는 insert-form.submit() → 현재 페이지가 checkUserInfo.do로 이동.
   * KTX 교차판매 열차는 SweetAlert2 모달이 뜨고 페이지 이동 없음 (별도 처리 필요).
   */
  async clickReserve(rowIndex, seatClass) {
    const colIdx = seatColIdx(seatClass);
    const isStanding = isStandingSeat(seatClass);
    log(`\uC608\uC57D \uBC84\uD2BC \uD074\uB9AD: row=${rowIndex}, col=${colIdx} (${seatClass})`);
    const prevUrl = this.page.url();
    const navPromise = this.page.waitForURL((url2) => url2.href !== prevUrl, {
      waitUntil: "domcontentloaded",
      timeout: 15e3
    }).catch(() => null);
    await this.page.evaluate(
      ({ ri, ci, standing }) => {
        const rows = document.querySelectorAll("table tbody tr");
        const row = rows[ri];
        if (!row) return;
        const tds = row.querySelectorAll("td");
        const cell = tds[ci];
        if (!cell) return;
        let btn = null;
        if (standing) {
          btn = cell.querySelector(
            'a[onclick*="requestReservationInfoAnn"], button[onclick*="requestReservationInfoAnn"]'
          );
          if (!btn) {
            btn = Array.from(cell.querySelectorAll("a, button")).find(
              (el) => el.innerText?.includes("\uC785\uC11D")
            ) ?? null;
          }
        } else {
          btn = Array.from(cell.querySelectorAll("a, button")).find((el) => {
            const onclick = el.getAttribute("onclick") ?? "";
            return onclick.includes("requestReservationInfo") && !onclick.includes("requestReservationInfoAnn");
          }) ?? null;
          if (!btn) {
            btn = Array.from(cell.querySelectorAll("a, button")).find(
              (el) => el.innerText?.includes("\uC608\uC57D") && !el.innerText?.includes("\uC785\uC11D") && !(el.getAttribute("onclick") ?? "").includes("showKorail")
            ) ?? null;
          }
        }
        btn?.click();
      },
      { ri: rowIndex, ci: colIdx, standing: isStanding }
    );
    const navigated = await navPromise;
    const url = this.page.url();
    log(`\uD074\uB9AD \uD6C4 URL: ${url} (\uC774\uB3D9: ${navigated !== null ? "O" : "X"})`);
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
  async clickWaitlist(rowIndex, seatClass) {
    const colIdx = seatColIdx(seatClass);
    log(`\uC608\uC57D\uB300\uAE30 \uBC84\uD2BC \uD074\uB9AD: row=${rowIndex}, col=${colIdx} (${seatClass})`);
    const prevUrl = this.page.url();
    const navPromise = this.page.waitForURL((url2) => url2.href !== prevUrl, { waitUntil: "domcontentloaded", timeout: 15e3 }).catch(() => null);
    await this.page.evaluate(
      ({ ri, ci }) => {
        const rows = document.querySelectorAll("table tbody tr");
        const row = rows[ri];
        if (!row) return;
        const tds = row.querySelectorAll("td");
        const cell = tds[ci];
        if (!cell) return;
        let btn = cell.querySelector(
          'a[onclick*="requestWaitingReservation"], button[onclick*="requestWaitingReservation"],a[onclick*="waitList"], button[onclick*="waitList"]'
        );
        if (!btn) {
          btn = Array.from(cell.querySelectorAll("a, button")).find(
            (el) => el.innerText?.includes("\uC608\uC57D\uB300\uAE30")
          ) ?? null;
        }
        btn?.click();
      },
      { ri: rowIndex, ci: colIdx }
    );
    const navigated = await navPromise;
    const url = this.page.url();
    log(`\uC608\uC57D\uB300\uAE30 \uD074\uB9AD \uD6C4 URL: ${url} (\uC774\uB3D9: ${navigated !== null ? "O" : "X"})`);
    return this.page;
  }
};

// BookingFlow.ts
import notifier from "node-notifier";

// discord.ts
import { existsSync as existsSync3, readFileSync as readFileSync2 } from "fs";
import { dirname, resolve } from "path";

// webhookConfig.ts
import { existsSync as existsSync2, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join as join2 } from "path";
var SRT_DATA_DIR2 = process.env.SRT_DATA_DIR;
var WEBHOOK_FILE = SRT_DATA_DIR2 ? join2(SRT_DATA_DIR2, "discord_webhook.txt") : "./discord_webhook.txt";
function getSavedWebhookUrl() {
  if (!existsSync2(WEBHOOK_FILE)) return void 0;
  try {
    const content = readFileSync(WEBHOOK_FILE, "utf-8").trim();
    return content || void 0;
  } catch {
    return void 0;
  }
}

// discord.ts
function findEnvFile() {
  const starts = [dirname(new URL(import.meta.url).pathname), process.cwd()];
  for (const start of starts) {
    let dir = start;
    while (true) {
      const candidate = resolve(dir, ".env");
      if (existsSync3(candidate)) return candidate;
      const parent = dirname(dir);
      if (parent === dir) break;
      dir = parent;
    }
  }
  return void 0;
}
function loadWebhookUrl() {
  if (process.env.DISCORD_WEBHOOK_URL) return process.env.DISCORD_WEBHOOK_URL;
  const saved = getSavedWebhookUrl();
  if (saved) return saved;
  const envPath = findEnvFile();
  if (!envPath) return void 0;
  try {
    const content = readFileSync2(envPath, "utf-8");
    const match = content.match(/^DISCORD_WEBHOOK_URL=(.+)$/m);
    return match?.[1]?.trim();
  } catch {
    return void 0;
  }
}
function isDiscordConfigured() {
  return !!loadWebhookUrl();
}
function buildPayload(title, body, color) {
  return JSON.stringify({
    username: "SRT \uB9E4\uD06C\uB85C",
    embeds: [
      {
        title,
        description: body,
        color,
        timestamp: (/* @__PURE__ */ new Date()).toISOString()
      }
    ]
  });
}
async function postWebhook(url, title, body, color) {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: buildPayload(title, body, color)
    });
    if (res.ok) return { ok: true };
    return { ok: false, error: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}
async function sendDiscord(title, body, color = 3066993) {
  const url = loadWebhookUrl();
  if (!url) {
    log("[Discord] DISCORD_WEBHOOK_URL \uBBF8\uC124\uC815 \u2014 \uC54C\uB9BC \uC2A4\uD0B5");
    return;
  }
  const result = await postWebhook(url, title, body, color);
  if (result.ok) {
    log("[Discord] \uC54C\uB9BC \uC804\uC1A1 \uC644\uB8CC");
  } else {
    log(`[Discord] \uC804\uC1A1 \uC2E4\uD328 \u2014 ${result.error}`);
  }
}

// BookingFlow.ts
var BookingFlow = class {
  /** @param seatLabel 실제로 확보된 좌석 등급 (복수 등급 감시 시 매칭된 등급) */
  constructor(page, seatLabel) {
    this.page = page;
    this.seatLabel = seatLabel;
  }
  page;
  seatLabel;
  async handle() {
    if (!this.isReservationConfirmPage(this.page.url())) {
      await this.page.waitForURL((u) => this.isReservationConfirmPage(u.href), { timeout: 5e3 }).catch(() => null);
    }
    const url = this.page.url();
    log(`[BookingFlow] \uD604\uC7AC URL: ${url}`);
    if (this.isReservationConfirmPage(url)) {
      log("\uC608\uC57D \uD655\uC778 \uD398\uC774\uC9C0 \uB3C4\uB2EC \u2014 \uC88C\uC11D \uD655\uBCF4! \uB514\uC2A4\uCF54\uB4DC \uC54C\uB9BC \uBC1C\uC1A1");
      this.notify();
      log("\uACB0\uC81C \uD398\uC774\uC9C0\uB85C \uC9C4\uD589\uD558\uC138\uC694. 10\uBD84 \uB0B4 \uACB0\uC81C \uD544\uC694.");
      await waitEnter("\uACB0\uC81C \uC644\uB8CC \uD6C4 Enter > ");
      return;
    }
    if (url.includes("selectScheduleList") || url.includes("dynaPath")) {
      const hasKtxAlert = await this.page.evaluate(() => {
        const el = document.querySelector(".swal2-popup");
        return el ? el.innerText.substring(0, 100) : null;
      });
      if (hasKtxAlert) {
        log(`KTX \uAD50\uCC28\uD310\uB9E4 \uBAA8\uB2EC \uAC10\uC9C0:
  "${hasKtxAlert}"`);
        log("KTX \uC5F4\uCC28\uB294 \uCF54\uB808\uC77C \uC0AC\uC774\uD2B8\uB85C \uC774\uB3D9\uD569\uB2C8\uB2E4. \uBE0C\uB77C\uC6B0\uC800\uC5D0\uC11C \uC9C1\uC811 \uC9C4\uD589\uD558\uC138\uC694.");
        await waitEnter("\uCC98\uB9AC \uC644\uB8CC \uD6C4 Enter > ");
        return;
      }
      log("\uC608\uC57D \uD398\uC774\uC9C0\uB85C \uC774\uB3D9\uB418\uC9C0 \uC54A\uC74C \u2014 \uBE0C\uB77C\uC6B0\uC800\uB97C \uC9C1\uC811 \uD655\uC778\uD558\uC138\uC694.");
      await waitEnter("\uC644\uB8CC \uD6C4 Enter > ");
      return;
    }
    if (url.includes("checkUserInfo") || url.includes("TK0101011")) {
      log("checkUserInfo.do \uB3C4\uB2EC \u2014 \uC608\uC57D \uD655\uC778 \uCC98\uB9AC \uC911...");
      const confirmed = await this.submitConfirmForm();
      if (!confirmed) {
        log("\uC608\uC57D \uD655\uC778 \uBC84\uD2BC \uC790\uB3D9 \uD074\uB9AD \uC2E4\uD328 \u2014 \uBE0C\uB77C\uC6B0\uC800\uC5D0\uC11C \uC9C1\uC811 \uC9C4\uD589\uD558\uC138\uC694.");
        await waitEnter("\uC608\uC57D \uC644\uB8CC \uD6C4 Enter > ");
      }
      return;
    }
    if (this.isPaymentPage(url)) {
      this.notify();
      log("\uACB0\uC81C \uD398\uC774\uC9C0 \uB3C4\uB2EC \uC644\uB8CC. 10\uBD84 \uB0B4 \uC218\uB3D9 \uACB0\uC81C\uB97C \uC9C4\uD589\uD558\uC138\uC694.");
      await waitEnter("\uACB0\uC81C \uC644\uB8CC \uD6C4 Enter > ");
      return;
    }
    log(`\uC54C \uC218 \uC5C6\uB294 \uC608\uC57D \uB2E8\uACC4 URL: ${url}`);
    log("\uBE0C\uB77C\uC6B0\uC800\uB97C \uC9C1\uC811 \uD655\uC778\uD558\uACE0 \uC608\uC57D\uC744 \uC644\uB8CC\uD558\uC138\uC694.");
    await waitEnter("\uC644\uB8CC \uD6C4 Enter > ");
  }
  // ─── checkUserInfo.do 에서 예약신청 버튼 자동 클릭 ─────────────────────
  async submitConfirmForm() {
    await sleep(800);
    const candidates = [
      'input[value="\uC608\uC57D\uC2E0\uCCAD"]',
      'button:has-text("\uC608\uC57D\uC2E0\uCCAD")',
      'a:has-text("\uC608\uC57D\uC2E0\uCCAD")',
      'input[value="\uC608\uC57D\uD558\uAE30"]',
      'button:has-text("\uC608\uC57D\uD558\uAE30")',
      'a:has-text("\uC608\uC57D\uD558\uAE30")',
      'input[type="submit"]',
      'button[type="submit"]'
    ];
    for (const sel of candidates) {
      const count = await this.page.locator(sel).count();
      if (count > 0) {
        log(`\uC608\uC57D \uD655\uC778 \uBC84\uD2BC \uBC1C\uACAC: ${sel}`);
        const prevUrl = this.page.url();
        const navPromise = this.page.waitForURL((url) => url.href !== prevUrl, { waitUntil: "domcontentloaded", timeout: 15e3 }).catch(() => null);
        await this.page.locator(sel).first().click();
        await navPromise;
        const nextUrl = this.page.url();
        log(`\uC608\uC57D \uD655\uC778 \uD6C4 URL: ${nextUrl}`);
        if (!nextUrl.includes("checkUserInfo") && !nextUrl.includes("TK0101011")) {
          this.notify();
          if (this.isPaymentPage(nextUrl)) {
            log("\uACB0\uC81C \uD398\uC774\uC9C0 \uB3C4\uB2EC! 10\uBD84 \uB0B4 \uC218\uB3D9 \uACB0\uC81C\uB97C \uC9C4\uD589\uD558\uC138\uC694.");
          } else if (this.isReservationCompletePage(nextUrl)) {
            log("\uC608\uC57D \uC644\uB8CC! \uC608\uB9E4\uB0B4\uC5ED\uC5D0\uC11C \uACB0\uC81C\uB97C \uC9C4\uD589\uD558\uC138\uC694.");
          } else {
            log(`\uC608\uC57D \uC9C4\uD589\uB428 (URL: ${nextUrl}). \uBE0C\uB77C\uC6B0\uC800\uC5D0\uC11C \uACB0\uC81C\uB97C \uC644\uB8CC\uD558\uC138\uC694.`);
          }
          await waitEnter("\uC644\uB8CC \uD6C4 Enter > ");
          return true;
        }
        log("\uCD94\uAC00 \uD655\uC778 \uB2E8\uACC4 \uAC10\uC9C0 \u2014 \uB2E4\uC2DC \uC2DC\uB3C4 \uC911...");
        return this.submitConfirmForm();
      }
    }
    log("\uC608\uC57D \uD655\uC778 \uBC84\uD2BC\uC744 \uCC3E\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4. \uD604\uC7AC \uD398\uC774\uC9C0 \uD14D\uC2A4\uD2B8:");
    const bodyText = await this.page.evaluate(
      () => document.body.innerText.substring(0, 300)
    );
    log(bodyText);
    return false;
  }
  // ─── 예약 확인 페이지 판단 (예매 버튼 클릭 직후 도달) ────────────────────
  // confirmReservationInfo.do?pageId=TK0101030000
  isReservationConfirmPage(url) {
    return url.includes("confirmReservationInfo") || url.includes("TK0101030000");
  }
  // ─── 결제 대기 페이지 판단 ─────────────────────────────────────────────
  isPaymentPage(url) {
    return url.includes("selectPayment") || url.includes("insertPayment") || url.includes("hpg/haa") || // SRT 결제 URL 패턴 추정
    url.includes("/pay/") || url.includes("Payment") || url.includes("TK030");
  }
  // ─── 예약 완료 페이지 판단 ────────────────────────────────────────────
  isReservationCompletePage(url) {
    return url.includes("selectReservation") || url.includes("reservationComplete") || url.includes("TK010201") || // 예매내역 페이지 패턴 추정
    url.includes("TK0102");
  }
  // ─── OS 알림 + 소리 + Discord ────────────────────────────────────────
  notify() {
    const trainInfo = `${DEP}\u2192${ARR} ${TRAIN_FROM}~${TRAIN_TO} ${this.seatLabel}`;
    const msg = `SRT \uC88C\uC11D \uD655\uBCF4! ${trainInfo} \u2014 \uACB0\uC81C \uC9C4\uD589\uD558\uC138\uC694`;
    console.log("\n");
    console.log("\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550");
    console.log(`  !! SRT \uC88C\uC11D \uD655\uBCF4 !! ${trainInfo}`);
    console.log("  \uACB0\uC81C\uB97C \uC644\uB8CC\uD558\uC138\uC694.");
    console.log("\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n");
    notifier.notify(
      { title: "SRT \uB9E4\uD06C\uB85C", message: msg, sound: true },
      (err) => {
        if (err) log(`\uC54C\uB9BC \uC804\uC1A1 \uC2E4\uD328 (\uBB34\uC2DC): ${err.message}`);
      }
    );
    sendDiscord(
      "SRT \uC88C\uC11D \uD655\uBCF4!",
      `**${trainInfo}**
\uACB0\uC81C \uD398\uC774\uC9C0\uB85C \uC774\uB3D9\uD588\uC2B5\uB2C8\uB2E4. **10\uBD84 \uB0B4 \uACB0\uC81C**\uD558\uC138\uC694.`,
      3066993
      // 초록
    );
  }
};

// WaitlistFlow.ts
import notifier2 from "node-notifier";
var WaitlistFlow = class {
  /** @param seatLabel 실제로 예약대기 신청된 좌석 등급 (복수 등급 감시 시 매칭된 등급) */
  constructor(page, seatLabel) {
    this.page = page;
    this.seatLabel = seatLabel;
  }
  page;
  seatLabel;
  async handle() {
    const url = this.page.url();
    log(`[WaitlistFlow] \uD604\uC7AC URL: ${url}`);
    const isWaitlistPage = url.includes("requestWaiting") || url.includes("waitList") || url.includes("selectWaiting") || url.includes("Waiting");
    if (!isWaitlistPage) {
      log(`\uC608\uC57D\uB300\uAE30 \uC2E0\uCCAD \uD398\uC774\uC9C0\uB85C \uC774\uB3D9\uB418\uC9C0 \uC54A\uC74C (URL: ${url})`);
      log("\uBE0C\uB77C\uC6B0\uC800\uC5D0\uC11C \uC9C1\uC811 \uC608\uC57D\uB300\uAE30\uB97C \uC2E0\uCCAD\uD558\uC138\uC694.");
      await waitEnter("\uC2E0\uCCAD \uC644\uB8CC \uD6C4 Enter > ");
      return;
    }
    await sleep(800);
    const submitted = await this.submitWaitlistForm();
    if (!submitted) {
      log("\uC608\uC57D\uB300\uAE30 \uC2E0\uCCAD \uC790\uB3D9 \uCC98\uB9AC \uC2E4\uD328 \u2014 \uBE0C\uB77C\uC6B0\uC800\uC5D0\uC11C \uC9C1\uC811 \uC9C4\uD589\uD558\uC138\uC694.");
      await waitEnter("\uC2E0\uCCAD \uC644\uB8CC \uD6C4 Enter > ");
    }
  }
  // ─── 예약대기 신청 폼 처리 ─────────────────────────────────────────────
  /**
   * NOTE: 아래 셀렉터들은 라이브 SRT 페이지 확인 후 갱신 필요.
   *       체크박스 id, 라디오 name 등이 다를 경우 DevTools에서 직접 확인.
   */
  async submitWaitlistForm() {
    const smsCandidates = [
      "#smsYn",
      'input[name="smsYn"]',
      'input[type="checkbox"][id*="sms"]',
      'input[type="checkbox"][id*="Sms"]'
    ];
    for (const sel of smsCandidates) {
      const el = this.page.locator(sel).first();
      if (await el.count() > 0) {
        const checked = await el.isChecked();
        if (SMS_AGREE && !checked) {
          await el.check();
          log(`SMS \uC218\uC2E0 \uB3D9\uC758 \uCCB4\uD06C \uC644\uB8CC (${sel})`);
        } else if (!SMS_AGREE && checked) {
          await el.uncheck();
          log(`SMS \uC218\uC2E0 \uB3D9\uC758 \uD574\uC81C (${sel})`);
        } else {
          log(`SMS \uC218\uC2E0 \uB3D9\uC758 \uC0C1\uD0DC \uC720\uC9C0: ${checked ? "\uB3D9\uC758" : "\uBBF8\uB3D9\uC758"}`);
        }
        break;
      }
    }
    if (this.seatLabel === "\uC77C\uBC18\uC2E4") {
      const specialCandidates = [
        "#spcSeatYn",
        'input[name="spcSeatYn"]',
        'input[type="checkbox"][id*="spc"]',
        'input[type="radio"][value="Y"][name*="special"]'
      ];
      for (const sel of specialCandidates) {
        const el = this.page.locator(sel).first();
        if (await el.count() > 0) {
          const checked = await el.isChecked();
          if (WAIT_SPECIAL && !checked) {
            await el.check();
            log(`\uD2B9\uC2E4 \uCDE8\uC18C\uD45C \uBC30\uC815 \uC218\uB77D \uC124\uC815 (${sel})`);
          } else if (!WAIT_SPECIAL && checked) {
            await el.uncheck();
            log(`\uD2B9\uC2E4 \uCDE8\uC18C\uD45C \uBC30\uC815 \uBBF8\uC218\uB77D \uC124\uC815 (${sel})`);
          }
          break;
        }
      }
    }
    await sleep(400);
    const submitCandidates = [
      'input[value="\uC608\uC57D\uB300\uAE30\uC2E0\uCCAD"]',
      'button:has-text("\uC608\uC57D\uB300\uAE30\uC2E0\uCCAD")',
      'a:has-text("\uC608\uC57D\uB300\uAE30\uC2E0\uCCAD")',
      'input[value="\uC2E0\uCCAD"]',
      'button:has-text("\uC2E0\uCCAD\uD558\uAE30")',
      'input[type="submit"]'
    ];
    for (const sel of submitCandidates) {
      const count = await this.page.locator(sel).count();
      if (count > 0) {
        log(`\uC608\uC57D\uB300\uAE30 \uC2E0\uCCAD \uBC84\uD2BC \uBC1C\uACAC: ${sel}`);
        const prevUrl = this.page.url();
        const navPromise = this.page.waitForURL((url) => url.href !== prevUrl, { waitUntil: "domcontentloaded", timeout: 15e3 }).catch(() => null);
        await this.page.locator(sel).first().click();
        await navPromise;
        const nextUrl = this.page.url();
        log(`\uC2E0\uCCAD \uD6C4 URL: ${nextUrl}`);
        const rankText = await this.page.evaluate(() => {
          const body = document.body.innerText;
          if (body.includes("\uC21C\uBC88") || body.includes("\uB300\uAE30\uBC88\uD638") || body.includes("\uC811\uC218\uC644\uB8CC")) {
            const m = body.match(/(\d+)\s*번/);
            return m ? m[1] : "\uC644\uB8CC";
          }
          return null;
        });
        if (rankText) {
          this.notify(rankText);
          log(`\uC608\uC57D\uB300\uAE30 \uC2E0\uCCAD \uC644\uB8CC \u2014 \uC21C\uBC88: ${rankText}\uBC88`);
          log("\uB2E4\uC74C\uB0A0 \uC624\uC804 9\uC2DC\uC5D0 SMS(\uCE74\uCE74\uC624 \uC54C\uB9BC\uD1A1)\uB85C \uBC30\uC815 \uACB0\uACFC\uB97C \uC548\uB0B4\uBC1B\uC2B5\uB2C8\uB2E4.");
          log("\uBC30\uC815 \uC2DC \uB2F9\uC77C \uC790\uC815(24:00)\uAE4C\uC9C0 SRT \uC571/\uD648\uD398\uC774\uC9C0\uC5D0\uC11C \uACB0\uC81C\uD558\uC138\uC694.");
          return true;
        }
        log("\uC2E0\uCCAD \uC644\uB8CC \uD398\uC774\uC9C0 \uBBF8\uAC10\uC9C0. \uD604\uC7AC \uD398\uC774\uC9C0 \uB0B4\uC6A9:");
        const bodySnippet = await this.page.evaluate(
          () => document.body.innerText.substring(0, 300)
        );
        log(bodySnippet);
        return true;
      }
    }
    log("\uC608\uC57D\uB300\uAE30 \uC2E0\uCCAD \uBC84\uD2BC\uC744 \uCC3E\uC9C0 \uBABB\uD588\uC2B5\uB2C8\uB2E4. \uD604\uC7AC \uD398\uC774\uC9C0:");
    const bodyText = await this.page.evaluate(
      () => document.body.innerText.substring(0, 300)
    );
    log(bodyText);
    return false;
  }
  // ─── OS 알림 + 소리 + Discord ────────────────────────────────────────
  notify(rank) {
    const trainInfo = `${DEP}\u2192${ARR} ${TRAIN_FROM}~${TRAIN_TO} ${this.seatLabel}`;
    const msg = `SRT \uC608\uC57D\uB300\uAE30 ${rank}\uBC88 \uC2E0\uCCAD \uC644\uB8CC! ${trainInfo} \u2014 \uB0B4\uC77C \uC624\uC804 9\uC2DC \uBC30\uC815 \uC548\uB0B4`;
    console.log("\n");
    console.log("\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550");
    console.log(`  !! SRT \uC608\uC57D\uB300\uAE30 \uC2E0\uCCAD \uC644\uB8CC !! ${trainInfo}`);
    console.log(`  \uC21C\uBC88: ${rank}\uBC88 \u2014 \uB0B4\uC77C \uC624\uC804 9\uC2DC \uCE74\uCE74\uC624 \uC54C\uB9BC\uD1A1\uC73C\uB85C \uC548\uB0B4`);
    console.log("  \uBC30\uC815 \uC2DC \uB2F9\uC77C \uC790\uC815\uAE4C\uC9C0 \uACB0\uC81C\uD558\uC138\uC694.");
    console.log("\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n");
    notifier2.notify(
      { title: "SRT \uB9E4\uD06C\uB85C", message: msg, sound: true },
      (err) => {
        if (err) log(`\uC54C\uB9BC \uC804\uC1A1 \uC2E4\uD328 (\uBB34\uC2DC): ${err.message}`);
      }
    );
    sendDiscord(
      "SRT \uC608\uC57D\uB300\uAE30 \uC2E0\uCCAD \uC644\uB8CC!",
      `**${trainInfo}**
\uC21C\uBC88: **${rank}\uBC88**
\uB0B4\uC77C \uC624\uC804 9\uC2DC \uCE74\uCE74\uC624 \uC54C\uB9BC\uD1A1\uC73C\uB85C \uBC30\uC815 \uC548\uB0B4\uB97C \uBC1B\uC2B5\uB2C8\uB2E4.
\uBC30\uC815 \uC2DC **\uB2F9\uC77C \uC790\uC815\uAE4C\uC9C0 \uACB0\uC81C**\uD558\uC138\uC694.`,
      3447003
      // 파랑
    );
  }
};

// run_srt.ts
async function main() {
  const days = DATE ? daysUntil(DATE) : null;
  const modeLabel = MODE === "WAITLIST" ? `\uC608\uC57D\uB300\uAE30 \uC2E0\uCCAD (D-${days})` : `\uCDE8\uC18C\uD45C \uD3F4\uB9C1 (D-${days})`;
  console.log("\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550");
  console.log("  SRT \uC2B9\uCC28\uAD8C \uC608\uB9E4 \uB9E4\uD06C\uB85C");
  console.log(`  \uBAA8\uB4DC    : ${GO ? "\uC2E4\uC804 (--go)" : "DRY RUN (\uD074\uB9AD \uC5C6\uC74C)"}`);
  console.log(`  \uB3D9\uC791    : ${modeLabel}`);
  console.log(`  \uAD6C\uAC04    : ${DEP} \u2192 ${ARR}`);
  console.log(`  \uB0A0\uC9DC    : ${DATE}`);
  console.log(`  \uC870\uD68C\uC2DC\uAC01: ${TIME}\uC2DC \uC774\uD6C4`);
  console.log(`  \uBAA9\uD45C\uBC94\uC704: ${TRAIN_FROM} ~ ${TRAIN_TO}`);
  console.log(`  \uC88C\uC11D    : ${SEAT_LABEL}`);
  console.log(`  \uB514\uC2A4\uCF54\uB4DC: ${isDiscordConfigured() ? "\uC124\uC815\uB428" : "\uBBF8\uC124\uC815 (\uC54C\uB9BC \uC548 \uC634!)"}`);
  if (MODE === "WAITLIST") {
    console.log(`  SMS\uB3D9\uC758 : ${SMS_AGREE ? "\uC608" : "\uC544\uB2C8\uC624"}`);
    console.log(`  \uD2B9\uC2E4\uBC30\uC815: ${WAIT_SPECIAL ? "\uC218\uB77D" : "\uAC70\uBD80"}`);
  }
  if (INTERVAL > 0) console.log(`  \uAC04\uACA9    : ${INTERVAL}ms \uACE0\uC815`);
  console.log("\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\u2550\n");
  if (!DATE) {
    console.error("[\uC624\uB958] --date \uC635\uC158 \uD544\uC218 (\uC608: --date 20260710)");
    process.exit(1);
  }
  const session = await SrtSession.create();
  await session.ensureLogin();
  await session.searchTrains();
  const pollDelay = () => INTERVAL > 0 ? sleep(INTERVAL) : randomDelay();
  let pollCount = 0;
  if (MODE === "WAITLIST") {
    log(`\uC608\uC57D\uB300\uAE30 \uD0D0\uC0C9 \uC2DC\uC791 \u2014 \uBAA9\uD45C \uBC94\uC704: ${TRAIN_FROM} ~ ${TRAIN_TO} ${SEAT_LABEL}`);
    while (true) {
      pollCount++;
      const train = await session.findTargetTrain();
      if (!train) {
        log(`${pollCount}\uD68C \u2014 ${TRAIN_FROM}~${TRAIN_TO} \uBC94\uC704 \uC5F4\uCC28 \uC5C6\uC74C. \uC7AC\uC870\uD68C \uC911...`);
        await pollDelay();
        await session.requery();
        continue;
      }
      const prefix = `${pollCount}\uD68C \u2014 ${train.trainNo}\uD638 ${train.depTime} [${train.matchedSeat}]`;
      if (train.seatAvailable) {
        log(`
!! ${prefix} \uC794\uC5EC\uC11D \uBC1C\uACAC !! (\uC608\uC57D\uB300\uAE30 \uBAA8\uB4DC\uC9C0\uB9CC \uCDE8\uC18C\uD45C \uC989\uC2DC \uC608\uC57D)`);
        if (!GO) {
          log("DRY RUN \u2014 \uC608\uC57D \uD074\uB9AD \uC0DD\uB7B5.");
          break;
        }
        const bookingPage = await session.clickReserve(train.rowIndex, train.matchedSeat);
        await new BookingFlow(bookingPage, train.matchedSeat).handle();
        break;
      }
      if (train.waitlistAvailable) {
        log(`
!! ${prefix} \uC608\uC57D\uB300\uAE30 \uBC84\uD2BC \uBC1C\uACAC !!`);
        if (!GO) {
          log("DRY RUN \u2014 \uC608\uC57D\uB300\uAE30 \uD074\uB9AD \uC0DD\uB7B5. --go \uD50C\uB798\uADF8\uB97C \uCD94\uAC00\uD558\uBA74 \uC2E4\uC804 \uC2E0\uCCAD.");
          break;
        }
        log("\uC608\uC57D\uB300\uAE30 \uC2E0\uCCAD \uD074\uB9AD \uC2E4\uD589!");
        const waitlistPage = await session.clickWaitlist(train.rowIndex, train.matchedSeat);
        await new WaitlistFlow(waitlistPage, train.matchedSeat).handle();
        break;
      }
      log(`${prefix} \uB9E4\uC9C4 (\uC608\uC57D\uB300\uAE30 \uBC84\uD2BC \uBBF8\uAC10\uC9C0, \uBC94\uC704 \uB0B4 ${train.inRangeCount}\uAC1C). \uC7AC\uC870\uD68C \uC911...`);
      await pollDelay();
      await session.requery();
    }
  } else {
    log(`\uD3F4\uB9C1 \uC2DC\uC791 \u2014 \uBAA9\uD45C \uBC94\uC704: ${TRAIN_FROM} ~ ${TRAIN_TO} ${SEAT_LABEL}`);
    while (true) {
      pollCount++;
      const train = await session.findTargetTrain();
      if (!train) {
        log(`${pollCount}\uD68C \u2014 ${TRAIN_FROM}~${TRAIN_TO} \uBC94\uC704 \uC5F4\uCC28 \uC5C6\uC74C. \uC7AC\uC870\uD68C \uC911...`);
        await pollDelay();
        await session.requery();
        continue;
      }
      const prefix = `${pollCount}\uD68C \u2014 ${train.trainNo}\uD638 ${train.depTime} [${train.matchedSeat}]`;
      if (!train.seatAvailable) {
        log(`${prefix} \uB9E4\uC9C4 (\uBC94\uC704 \uB0B4 ${train.inRangeCount}\uAC1C \uC5F4\uCC28 \uBAA8\uB450 \uB9E4\uC9C4). \uC7AC\uC870\uD68C \uC911...`);
        await pollDelay();
        await session.requery();
        continue;
      }
      log(`
!! ${prefix} \uC88C\uC11D \uBC1C\uACAC !! \uC0C1\uD0DC: "${train.statusText}"`);
      if (!GO) {
        log("DRY RUN \u2014 \uC608\uC57D \uD074\uB9AD \uC0DD\uB7B5. --go \uD50C\uB798\uADF8\uB97C \uCD94\uAC00\uD558\uBA74 \uC2E4\uC804 \uC608\uC57D.");
        break;
      }
      log("\uC608\uC57D\uD558\uAE30 \uD074\uB9AD \uC2E4\uD589!");
      const bookingPage = await session.clickReserve(train.rowIndex, train.matchedSeat);
      await new BookingFlow(bookingPage, train.matchedSeat).handle();
      break;
    }
  }
  closeRl();
  log("\uB9E4\uD06C\uB85C \uC885\uB8CC. \uBE0C\uB77C\uC6B0\uC800\uB97C \uB2EB\uC73C\uB824\uBA74 Ctrl+C");
  await new Promise(() => {
  });
}
main().catch((err) => {
  console.error("[\uC624\uB958]", err);
  process.exit(1);
});
