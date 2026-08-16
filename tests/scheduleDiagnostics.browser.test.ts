/**
 * srt/tests/scheduleDiagnostics.browser.test.ts — collectScheduleDiagnostics() DOM 진단 검증
 *
 * "탐색 구간 열차 없음" 무한 반복 버그 진단용. selectTargetTrain()이 null을 반환하는
 * 두 원인(hidden input 파싱 0건 vs 시간 필터 밖)을 로그 한 줄로 구분하기 위해
 * 결과 페이지의 hidden input/화면 행/다음 페이지 버튼 상태를 그대로 수집한다.
 *
 * fixture는 trainSelect.browser.test.ts와 동일한 라이브 캡처 구조
 * (srt/capture/96-result-20260902-06-all-ktx.html)를 근거로 한다: hidden input
 * `trnNo[i]`/`dptTm[i]`, `em.time` 출발/도착 셀, `<input value="다음" onclick="changeDptTm('NEXT','HHMMSS')">`.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { chromium, type Browser, type Page } from "playwright";
import { collectScheduleDiagnostics } from "../src/core/scheduleDiagnostics.ts";

let browser: Browser;
let page: Page;

function hidden(name: string, i: number, value: string): string {
  return `<input type="hidden" name="${name}[${i}]" value="${value}">`;
}

function row(i: number, trainNo: string, depTime: string, arrTime: string): string {
  const dep6 = depTime.replace(":", "") + "00";
  const arr6 = arrTime.replace(":", "") + "00";
  return `<tr>
    <td>
      ${hidden("trnNo", i, trainNo)}
      ${hidden("dptTm", i, dep6)}
      ${hidden("arvTm", i, arr6)}
    </td>
    <td><em class="time">${depTime}</em></td>
    <td><em class="time">${arrTime}</em></td>
  </tr>`;
}

const NEXT_BUTTON =
  `<input type="button" value="다음" onclick="changeDptTm('NEXT', '103000');">`;

async function loadPage(bodyHtml: string): Promise<void> {
  await page.setContent(`<!DOCTYPE html><html><body>${bodyHtml}</body></html>`);
}

before(async () => {
  browser = await chromium.launch({ headless: true });
  page = await browser.newPage();
});

after(async () => {
  await browser?.close();
});

test("hidden input이 정상 파싱되면 hiddenRowCount와 hiddenDepTimes를 채운다", async () => {
  await loadPage(`<table><tbody>
    ${row(0, "101", "16:00", "18:00")}
    ${row(1, "102", "16:30", "18:30")}
  </tbody></table>`);
  const result = await page.evaluate(collectScheduleDiagnostics);
  assert.equal(result.hiddenRowCount, 2);
  assert.deepEqual(result.hiddenDepTimes, ["16:00", "16:30"]);
  assert.equal(result.visibleRowCount, 2);
});

test("hidden input이 없고 화면 행만 있으면 hiddenRowCount=0, visibleRowCount>0으로 파싱 실패를 드러낸다", async () => {
  await loadPage(`<table><tbody>
    <tr><td><em class="time">16:00</em></td><td><em class="time">18:00</em></td></tr>
  </tbody></table>`);
  const result = await page.evaluate(collectScheduleDiagnostics);
  assert.equal(result.hiddenRowCount, 0);
  assert.equal(result.visibleRowCount, 1);
  assert.ok(result.visibleTimes.includes("16:00"));
});

test("다음 페이지 버튼이 있으면 hasNextButton=true와 nextSeedTime을 반환한다", async () => {
  await loadPage(`<table><tbody>${row(0, "103", "06:00", "08:00")}</tbody></table>${NEXT_BUTTON}`);
  const result = await page.evaluate(collectScheduleDiagnostics);
  assert.equal(result.hasNextButton, true);
  assert.equal(result.nextSeedTime, "103000");
});

test("다음 페이지 버튼이 없으면 hasNextButton=false, nextSeedTime=빈 문자열", async () => {
  await loadPage(`<table><tbody>${row(0, "104", "20:00", "22:00")}</tbody></table>`);
  const result = await page.evaluate(collectScheduleDiagnostics);
  assert.equal(result.hasNextButton, false);
  assert.equal(result.nextSeedTime, "");
});
