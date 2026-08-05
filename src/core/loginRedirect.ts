export function isSrtLoginCompleteUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" &&
      parsed.hostname === "etk.srail.kr" &&
      parsed.pathname === "/main.do";
  } catch {
    return false;
  }
}
