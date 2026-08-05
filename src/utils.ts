import * as readline from "readline";

export const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

/** 800~1500ms 사이 랜덤 딜레이 (폴링 jitter) */
export const randomDelay = () => sleep(800 + Math.floor(Math.random() * 700));

export function nowStr() {
  return new Date().toLocaleTimeString("ko-KR", { hour12: false });
}

export function log(msg: string) {
  console.log(`[${nowStr()}] ${msg}`);
}

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
export const waitEnter = (msg: string) =>
  new Promise<void>(res => rl.question(msg, () => res()));
export const closeRl = () => rl.close();
