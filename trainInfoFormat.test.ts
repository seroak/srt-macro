/**
 * srt/trainInfoFormat.test.ts — formatTrainInfo() 검증
 *
 * 실행: npm test (node --test)
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatTrainInfo } from "./trainInfoFormat.ts";

test("실제 잡은 열차의 trainNo·depTime·arrTime을 그대로 사용한다 (탐색 범위 아님)", () => {
  const result = formatTrainInfo("수서", "부산", {
    trainNo: "307",
    depTime: "07:05",
    arrTime: "09:12",
    matchedSeat: "일반실",
  });

  assert.equal(result, "수서→부산 307호 07:05~09:12 일반실");
});

test("탐색 범위(target-time~target-end-time)와 실제 depTime이 다르면 depTime을 쓴다", () => {
  // 탐색 범위가 06:30~09:00이어도 실제로 잡힌 열차는 07:05 출발일 수 있다 —
  // 이 함수는 탐색 범위를 아예 모르므로(파라미터로 안 받음) 구조적으로 혼동이 불가능해야 한다.
  const result = formatTrainInfo("수서", "부산", {
    trainNo: "309",
    depTime: "08:40",
    arrTime: "10:55",
    matchedSeat: "특실",
  });

  assert.ok(result.includes("08:40~10:55"));
  assert.ok(!result.includes("06:30"));
  assert.ok(!result.includes("09:00"));
});

test("좌석 등급(matchedSeat)이 결과 문자열 끝에 포함된다", () => {
  const result = formatTrainInfo("동탄", "울산통도사", {
    trainNo: "101",
    depTime: "14:00",
    arrTime: "16:00",
    matchedSeat: "입석+좌석",
  });

  assert.ok(result.endsWith("입석+좌석"));
});
