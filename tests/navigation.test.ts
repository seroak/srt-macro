import { it } from "node:test";
import assert from "node:assert/strict";
import { runAndWaitForNavigation } from "../src/core/navigation.ts";

it("registers navigation waiting before triggering the action", async () => {
  const events: string[] = [];
  let finishNavigation!: () => void;
  const navigationFinished = new Promise<void>((resolve) => { finishNavigation = resolve; });

  const page = {
    waitForNavigation() {
      events.push("wait registered");
      return navigationFinished;
    },
  };

  const completed = runAndWaitForNavigation(page, async () => {
    events.push("action triggered");
    setImmediate(finishNavigation);
  });

  assert.deepEqual(events, ["wait registered", "action triggered"]);
  await completed;
});
