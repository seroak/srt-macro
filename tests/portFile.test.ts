import { describe, it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync } from "fs";
import { join } from "path";
import { tmpdir } from "os";
import { writePortFile, releasePortFile, waitForPortFile } from "../src/server/portFile.ts";

describe("writePortFile() / releasePortFile()", () => {
  let dir: string;
  let portFilePath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "srt-portfile-"));
    portFilePath = join(dir, ".ui-port");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("자기가 쓴 포트가 그대로 남아 있으면 파일을 지운다", () => {
    writePortFile(portFilePath, 5000);
    const released = releasePortFile(portFilePath, 5000);
    assert.equal(released, true);
    assert.equal(existsSync(portFilePath), false);
  });

  it("다른 인스턴스가 덮어쓴 포트 파일은 지우지 않는다", () => {
    writePortFile(portFilePath, 5000);
    writePortFile(portFilePath, 6000);
    const released = releasePortFile(portFilePath, 5000);
    assert.equal(released, false);
    assert.equal(existsSync(portFilePath), true);
    assert.equal(readFileSync(portFilePath, "utf-8"), "6000");
  });

  it("파일이 이미 없으면 throw 없이 false를 반환한다", () => {
    const released = releasePortFile(portFilePath, 5000);
    assert.equal(released, false);
  });

  it("개행·공백이 섞여 있어도 같은 포트로 인정한다", () => {
    writeFileSync(portFilePath, " 5000\n");
    const released = releasePortFile(portFilePath, 5000);
    assert.equal(released, true);
    assert.equal(existsSync(portFilePath), false);
  });

  it("숫자가 아닌 내용이면 지우지 않는다", () => {
    writeFileSync(portFilePath, "not-a-port");
    const released = releasePortFile(portFilePath, 5000);
    assert.equal(released, false);
    assert.equal(existsSync(portFilePath), true);
  });
});

describe("waitForPortFile()", () => {
  let dir: string;
  let portFilePath: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "srt-portfile-wait-"));
    portFilePath = join(dir, ".ui-port");
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("파일이 이미 있으면 즉시 포트를 반환한다", async () => {
    writeFileSync(portFilePath, "7000");
    const port = await waitForPortFile(portFilePath, 1000, 10);
    assert.equal(port, 7000);
  });

  it("파일이 대기 중 생기면 그 포트를 반환한다", async () => {
    setTimeout(() => writeFileSync(portFilePath, "7100"), 50);
    const port = await waitForPortFile(portFilePath, 1000, 10);
    assert.equal(port, 7100);
  });

  it("waitMs 안에 파일이 안 생기면 null을 반환한다", async () => {
    const port = await waitForPortFile(portFilePath, 50, 10);
    assert.equal(port, null);
  });
});
