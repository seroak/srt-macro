/**
 * srt/webhookConfig.ts — 웹 UI에서 저장한 디스코드 웹훅 URL 읽기/쓰기
 *
 * config.ts의 SRT_SESSION_FILE과 동일한 경로 규칙을 따른다:
 * SRT_DATA_DIR(Electron이 세팅하는 앱 데이터 폴더 절대경로)가 있으면 그 아래,
 * 없으면 cwd 상대경로. 웹 UI(부모 프로세스)가 저장하면 매크로 자식 프로세스가
 * discord.ts를 통해 그대로 읽는다 — IPC나 env 전달 없이 파일 하나로 공유.
 *
 * 웹훅 URL은 시크릿이므로 이 파일은 .gitignore 대상이다.
 */
import { existsSync, readFileSync, writeFileSync, unlinkSync } from "fs";
import { join } from "path";

const SRT_DATA_DIR = process.env.SRT_DATA_DIR;
const WEBHOOK_FILE = SRT_DATA_DIR
  ? join(SRT_DATA_DIR, "discord_webhook.txt")
  : "./discord_webhook.txt";

/** 저장된 웹훅 URL을 반환한다. 없으면 undefined. */
export function getSavedWebhookUrl(): string | undefined {
  if (!existsSync(WEBHOOK_FILE)) return undefined;
  try {
    const content = readFileSync(WEBHOOK_FILE, "utf-8").trim();
    return content || undefined;
  } catch {
    return undefined;
  }
}

/** 웹훅 URL을 저장한다. 빈 문자열을 넘기면 설정을 해제(파일 삭제)한다. */
export function saveWebhookUrl(url: string): void {
  const trimmed = url.trim();
  if (!trimmed) {
    if (existsSync(WEBHOOK_FILE)) unlinkSync(WEBHOOK_FILE);
    return;
  }
  writeFileSync(WEBHOOK_FILE, trimmed, "utf-8");
}
