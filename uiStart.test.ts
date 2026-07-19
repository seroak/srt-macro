import { it } from "node:test";
import assert from "node:assert/strict";
import { buildMacroCliArgs } from "./macroArgs.ts";

it("예매 탐색 시작·끝 시각을 CLI 인수로 전달한다", () => {
  const args = buildMacroCliArgs({
    dep: "수서",
    arr: "부산",
    date: "2026-07-20",
    time: "14",
    targetTime: "15:00",
    targetEndTime: "17:00",
    seat: "일반실",
    go: false,
  });

  assert.deepEqual(args.slice(-4), [
    "--target-time", "15:00",
    "--target-end-time", "17:00",
  ]);
});
