/**
 * srt/alertPopup.test.ts — classifyAlertPopup() 판별 테스트
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { classifyAlertPopup } from "../src/flows/alertPopup.ts";

describe("classifyAlertPopup()", () => {
  it("코레일열차선택 제목 → korail-cross-sell", () => {
    const text = "코레일열차선택\n선택하신 열차는 코레일 열차입니다.\n코레일 승차권 예매를 위해 선택해주세요.";
    assert.equal(classifyAlertPopup(text), "korail-cross-sell");
  });

  it("이용안내 제목 → notice", () => {
    const text = "이용안내\n선택하신 열차는 KTX와 중련운행하는 SRT입니다. 탑승 전 열차, 호차번호를 확인하시기 바랍니다.";
    assert.equal(classifyAlertPopup(text), "notice");
  });

  it("알 수 없는 텍스트 → unknown", () => {
    assert.equal(classifyAlertPopup("전혀 관계없는 팝업 텍스트"), "unknown");
  });
});
