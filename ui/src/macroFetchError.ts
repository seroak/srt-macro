/**
 * /start·/stop·/enter 요청이 실패(res.ok === false)했을 때 로그 패널에 남길
 * 문구를 만든다. `[UI]` 접두는 useSrtMacro.ts의 classifyLine()이 ui 타입으로
 * 분류하는 기준이다.
 */
export function formatMacroFetchError(action: string, status: number, bodyText: string): string {
  return `[UI] ${action} 실패 (${status}) — ${bodyText}`;
}
