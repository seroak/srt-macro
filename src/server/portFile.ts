import { existsSync, readFileSync, unlinkSync, writeFileSync } from "fs";

/** UI API 서버가 실제 바인딩한 포트를 파일에 기록한다. */
export function writePortFile(path: string, port: number): void {
  writeFileSync(path, String(port));
}

/**
 * 파일에 기록된 포트를 읽는다. 파일이 없거나 숫자가 아니면 null.
 * 개행·공백은 트림 후 파싱한다.
 */
export function readPortFile(path: string): number | null {
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, "utf-8").trim();
  if (!/^\d+$/.test(raw)) return null;
  return Number(raw);
}

/**
 * 파일 내용이 ownedPort와 같을 때만 삭제한다. 삭제했으면 true.
 * 다른 인스턴스가 이미 자기 포트로 덮어썼거나(교차 삭제 방지) 파일이 없으면
 * false — 무조건 unlinkSync하던 기존 버그(같은 워크스페이스에서 나중에 죽는
 * 인스턴스가 먼저 뜬 인스턴스의 포트 파일을 지우는 문제)를 막는다.
 */
export function releasePortFile(path: string, ownedPort: number): boolean {
  if (readPortFile(path) !== ownedPort) return false;
  unlinkSync(path);
  return true;
}

/**
 * 파일이 생길 때까지 최대 waitMs 대기 후 포트를 반환한다. 콜드스타트(API
 * 서버가 아직 파일을 쓰기 전) 상태를 정상 상황으로 흡수하되, 그 밖의
 * 이유로 파일이 끝내 없으면(API 서버 자체가 안 뜬 경우 등) null을 반환해
 * 호출부가 다른 워크스페이스의 기본 포트로 조용히 폴백하지 않게 한다.
 */
export function waitForPortFile(
  path: string,
  waitMs: number,
  intervalMs = 100,
): Promise<number | null> {
  return new Promise((resolve) => {
    const deadline = Date.now() + waitMs;
    const tick = () => {
      const port = readPortFile(path);
      if (port !== null) {
        resolve(port);
        return;
      }
      if (Date.now() >= deadline) {
        resolve(null);
        return;
      }
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}
