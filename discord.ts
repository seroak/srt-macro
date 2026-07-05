import { existsSync, readFileSync } from "fs";
import { dirname, resolve } from "path";
import { log } from "./utils.ts";
import { getSavedWebhookUrl } from "./webhookConfig.ts";

/**
 * .env 파일을 CWD와 무관하게 찾는다.
 * 워크스페이스(cwd=srt/)에서 실행돼도 상위(루트)의 .env를 발견하도록,
 * 이 모듈 위치와 process.cwd() 양쪽에서 파일시스템 루트까지 거슬러 올라가며 탐색.
 */
function findEnvFile(): string | undefined {
  const starts = [dirname(new URL(import.meta.url).pathname), process.cwd()];
  for (const start of starts) {
    let dir = start;
    while (true) {
      const candidate = resolve(dir, ".env");
      if (existsSync(candidate)) return candidate;
      const parent = dirname(dir);
      if (parent === dir) break; // 파일시스템 루트 도달
      dir = parent;
    }
  }
  return undefined;
}

/**
 * 웹훅 URL 우선순위:
 * 1. DISCORD_WEBHOOK_URL 환경변수
 * 2. 웹 UI에서 저장한 설정 파일 (webhookConfig.ts)
 * 3. .env 파일 walk-up 탐색 (레거시 — 기존 .env 사용자 하위호환)
 */
function loadWebhookUrl(): string | undefined {
  if (process.env.DISCORD_WEBHOOK_URL) return process.env.DISCORD_WEBHOOK_URL;

  const saved = getSavedWebhookUrl();
  if (saved) return saved;

  const envPath = findEnvFile();
  if (!envPath) return undefined;
  try {
    const content = readFileSync(envPath, "utf-8");
    const match = content.match(/^DISCORD_WEBHOOK_URL=(.+)$/m);
    return match?.[1]?.trim();
  } catch {
    return undefined;
  }
}

/** 웹훅 URL이 설정돼 있으면 true (시작 배너 경고용). */
export function isDiscordConfigured(): boolean {
  return !!loadWebhookUrl();
}

/** embed 페이로드 문자열 생성 (sendDiscord/sendDiscordTest 공용). */
function buildPayload(title: string, body: string, color: number): string {
  return JSON.stringify({
    username: "SRT 매크로",
    embeds: [
      {
        title,
        description: body,
        color,
        timestamp: new Date().toISOString(),
      },
    ],
  });
}

/** 주어진 url로 실제 fetch 전송. 성공 시 ok:true, 실패 시 ok:false + error 메시지. */
async function postWebhook(
  url: string,
  title: string,
  body: string,
  color: number,
): Promise<{ ok: boolean; error?: string }> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: buildPayload(title, body, color),
    });
    if (res.ok) return { ok: true };
    return { ok: false, error: `HTTP ${res.status}` };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

/**
 * Discord 웹훅으로 알림 전송 (저장된/환경변수 URL 사용, 매크로 실행 중 호출).
 * @param title  embed 제목
 * @param body   embed 본문
 * @param color  embed 색상 (기본: 초록)
 */
export async function sendDiscord(
  title: string,
  body: string,
  color = 0x2ecc71,
): Promise<void> {
  const url = loadWebhookUrl();
  if (!url) {
    log("[Discord] DISCORD_WEBHOOK_URL 미설정 — 알림 스킵");
    return;
  }

  const result = await postWebhook(url, title, body, color);
  if (result.ok) {
    log("[Discord] 알림 전송 완료");
  } else {
    log(`[Discord] 전송 실패 — ${result.error}`);
  }
}

/**
 * 저장 여부와 무관하게 임의 URL로 테스트 메시지를 즉시 전송한다.
 * 웹 UI의 "테스트 전송" 버튼에서 사용 — 저장 전에 URL이 유효한지 확인용.
 */
export async function sendDiscordTest(url: string): Promise<{ ok: boolean; error?: string }> {
  return postWebhook(url, "SRT 매크로 — 테스트 알림", "웹훅 연결 테스트 메시지입니다.", 0x5865f2);
}
