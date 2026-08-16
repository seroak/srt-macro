import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { formatMacroFetchError } from "./macroFetchError.ts";

describe("formatMacroFetchError()", () => {
  it("동작명과 상태코드, 응답 본문을 포함한 로그 문구를 만든다", () => {
    const text = formatMacroFetchError("시작", 503, "API 서버 포트 파일을 찾지 못했습니다");
    assert.match(text, /^\[UI\]/);
    assert.match(text, /시작/);
    assert.match(text, /503/);
    assert.match(text, /API 서버 포트 파일을 찾지 못했습니다/);
  });

  it("중지 요청 실패도 동일 형식으로 만든다", () => {
    const text = formatMacroFetchError("중지", 500, "internal error");
    assert.match(text, /중지/);
    assert.match(text, /500/);
  });
});
