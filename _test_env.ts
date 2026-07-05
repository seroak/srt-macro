import { sendDiscord } from "./discord.ts";
async function main() {
  await sendDiscord("SRT 매크로 — CWD 수정 확인", "워크스페이스(cwd=srt)에서 .env를 상위에서 찾아 전송 성공하면 정상.", 0x9b59b6);
  await new Promise((r) => setTimeout(r, 2000));
}
main();
