# Booking Search Time Range Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Allow CLI and UI users to restrict booking exploration to an inclusive train departure-time range.

**Architecture:** Extend the existing start-time configuration with an end-time value that defaults to `23:59`. Pass both bounds through UI state, HTTP payload, CLI configuration, `SrtSession`, and the browser-serialized train selector, which performs the inclusive range filter before seat inspection.

**Tech Stack:** TypeScript, Node.js test runner, React, Playwright, Vite.

## Global Constraints

- Preserve all existing uncommitted user changes and do not commit, merge, push, or deploy.
- Interpret both boundaries as same-day `HH:mm` train departure times and include both endpoints.
- Preserve existing behavior when the end option is omitted by using `23:59`.

---

### Task 1: CLI range configuration

**Files:** `config.test.ts`, `config.ts`, `run_srt.ts`, `BookingFlow.ts`, `WaitlistFlow.ts`

**Interfaces:** Produce `TARGET_END_TIME: string` from `--target-end-time`; validate `TIME <= TARGET_TIME <= TARGET_END_TIME`.

- [x] Add failing tests proving omitted end resolves to `23:59`, malformed ends fail, and an end before the start fails.
- [x] Run `npm test` and confirm failures are caused by missing end-time behavior.
- [x] Extend the time resolver/config exports and update range display in banners, logs, and notifications.
- [x] Run `npm test` and confirm the configuration tests pass.

### Task 2: Inclusive train range filter

**Files:** `trainSelect.browser.test.ts`, `trainSelect.ts`, `SrtSession.ts`

**Interfaces:** Extend `SeatSelectOpts` with `maxDepTime: string`; include a row only when `minDepTime <= depTime <= maxDepTime`.

- [x] Add failing browser tests for inclusive end boundary, exclusion after the end, filtered candidate counts, waitlist selection, and no candidates.
- [x] Run `npm run test:browser` and confirm the new tests fail against the start-only selector.
- [x] Add maximum-time parsing/filtering and pass `TARGET_END_TIME` from `SrtSession`.
- [x] Run `npm run test:browser` and confirm all selector tests pass.

### Task 3: UI range input and documentation

**Files:** `ui/src/configState.test.ts`, `uiStart.test.ts`, `ui/src/types.ts`, `ui/src/configState.ts`, `ui/src/components/ConfigForm.tsx`, `macroArgs.ts`, `README.md`

**Interfaces:** Add `targetEndTime: string` to `Config` and `StartMacroPayload`; emit `--target-end-time <HH:mm>`.

- [x] Add failing tests for `23:59` migration, query-time auto-adjustment of both bounds, invalid ordering, and CLI argument forwarding.
- [x] Run `npm test` and confirm the new UI/argument tests fail for missing end-time behavior.
- [x] Implement state migration, validation, automatic clamping, the end-time input, payload forwarding, copy, and README examples.
- [x] Run `npm test`, `npm run test:browser`, `npx tsc --noEmit`, `npm run ui:build`, and `git diff --check`; require zero failures.
