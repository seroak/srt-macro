import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { isSrtLoginCompleteUrl } from "../src/core/loginRedirect.ts";

describe("isSrtLoginCompleteUrl()", () => {
  it("accepts the SRT main page reached after login", () => {
    assert.equal(isSrtLoginCompleteUrl("https://etk.srail.kr/main.do"), true);
  });

  it("rejects the login page and unrelated hosts", () => {
    assert.equal(
      isSrtLoginCompleteUrl("https://etk.srail.kr/cmc/01/selectLoginForm.do?pageId=TK0701000000"),
      false,
    );
    assert.equal(isSrtLoginCompleteUrl("https://example.com/main.do"), false);
  });
});
