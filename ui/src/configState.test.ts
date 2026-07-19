import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  buildConfig,
  setQueryTime,
  validateConfig,
} from "./configState.ts";

const TODAY = "2026-07-18";

describe("buildConfig()", () => {
  it("기존 저장값에 targetTime이 없으면 조회 시각의 정각을 사용한다", () => {
    const config = buildConfig({ time: "14", date: TODAY }, TODAY);
    assert.equal(config.targetTime, "14:00");
    assert.equal(config.targetEndTime, "23:59");
  });

  it("저장된 targetTime을 유지한다", () => {
    const config = buildConfig(
      { time: "14", targetTime: "15:30", date: TODAY },
      TODAY,
    );
    assert.equal(config.targetTime, "15:30");
  });

  it("저장된 targetEndTime을 유지한다", () => {
    const config = buildConfig(
      { time: "14", targetTime: "15:30", targetEndTime: "17:20", date: TODAY },
      TODAY,
    );
    assert.equal(config.targetEndTime, "17:20");
  });
});

describe("setQueryTime()", () => {
  it("새 조회 시각이 탐색 시작 시각보다 늦으면 정각으로 올린다", () => {
    const config = buildConfig(
      { time: "14", targetTime: "15:30", date: TODAY },
      TODAY,
    );
    const changed = setQueryTime(config, "16");
    assert.equal(changed.time, "16");
    assert.equal(changed.targetTime, "16:00");
  });

  it("탐색 시작 시각이 더 늦으면 사용자 값을 유지한다", () => {
    const config = buildConfig(
      { time: "14", targetTime: "17:20", date: TODAY },
      TODAY,
    );
    const changed = setQueryTime(config, "16");
    assert.equal(changed.targetTime, "17:20");
  });

  it("새 조회 시각이 끝 시각보다 늦으면 시작과 끝을 함께 정각으로 올린다", () => {
    const config = buildConfig(
      { time: "14", targetTime: "15:30", targetEndTime: "15:50", date: TODAY },
      TODAY,
    );
    const changed = setQueryTime(config, "16");
    assert.equal(changed.targetTime, "16:00");
    assert.equal(changed.targetEndTime, "16:00");
  });

  it("끝 시각이 새 조회 시각보다 늦으면 사용자 값을 유지한다", () => {
    const config = buildConfig(
      { time: "14", targetTime: "15:30", targetEndTime: "17:20", date: TODAY },
      TODAY,
    );
    const changed = setQueryTime(config, "16");
    assert.equal(changed.targetEndTime, "17:20");
  });
});

describe("validateConfig()", () => {
  it("잘못된 탐색 시작 시각 형식을 거부한다", () => {
    const config = buildConfig(
      { time: "14", targetTime: "15", date: TODAY },
      TODAY,
    );
    assert.match(validateConfig(config, TODAY) ?? "", /HH:mm/);
  });

  it("탐색 시작 시각이 조회 기준 시각보다 빠르면 거부한다", () => {
    const config = buildConfig(
      { time: "14", targetTime: "13:59", date: TODAY },
      TODAY,
    );
    assert.match(validateConfig(config, TODAY) ?? "", /조회 기준 시각보다 빠를 수 없습니다/);
  });

  it("잘못된 탐색 끝 시각 형식을 거부한다", () => {
    const config = buildConfig(
      { time: "14", targetTime: "15:00", targetEndTime: "17", date: TODAY },
      TODAY,
    );
    assert.match(validateConfig(config, TODAY) ?? "", /탐색 끝 시각은 HH:mm/);
  });

  it("탐색 끝 시각이 시작 시각보다 빠르면 거부한다", () => {
    const config = buildConfig(
      { time: "14", targetTime: "15:00", targetEndTime: "14:59", date: TODAY },
      TODAY,
    );
    assert.match(validateConfig(config, TODAY) ?? "", /탐색 시작 시각보다 빠를 수 없습니다/);
  });
});
