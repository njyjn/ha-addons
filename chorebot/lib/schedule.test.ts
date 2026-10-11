import { test } from "node:test";
import assert from "node:assert/strict";
import { requiredBy, taskStatus, weekStart } from "./schedule.ts";

const daily = { cadence: "daily", timesPer: 1, intervalDays: 1 };
const every2 = { cadence: "every_n_days", timesPer: 1, intervalDays: 2 };
const twiceWeekly = { cadence: "weekly", timesPer: 2, intervalDays: 1 };
const weekly = { cadence: "weekly", timesPer: 1, intervalDays: 1 };
const monthly = { cadence: "monthly", timesPer: 1, intervalDays: 1 };

// 2026-10-11 is a Sunday
test("weeks start on Sunday", () => {
  assert.equal(weekStart("2026-10-11"), "2026-10-11");
  assert.equal(weekStart("2026-10-17"), "2026-10-11");
  assert.equal(weekStart("2026-10-18"), "2026-10-18");
});

test("daily is due until ticked", () => {
  assert.equal(taskStatus(daily, ["2026-10-10"], "2026-10-11").kind, "due");
  assert.equal(taskStatus(daily, ["2026-10-11"], "2026-10-11").kind, "done");
});

test("every 2 days", () => {
  assert.equal(taskStatus(every2, [], "2026-10-11").kind, "due");
  assert.equal(taskStatus(every2, ["2026-10-10"], "2026-10-11").kind, "not_due");
  assert.equal(taskStatus(every2, ["2026-10-09"], "2026-10-11").kind, "due");
  assert.equal(taskStatus(every2, ["2026-10-08"], "2026-10-11").label, "Overdue by 1 day");
  assert.equal(taskStatus(every2, ["2026-10-11"], "2026-10-11").kind, "done");
});

test("2x / week is paced Wednesday then Saturday", () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6].map((i) => requiredBy(i, 7, 2)), [0, 0, 0, 1, 1, 1, 2]);
  assert.equal(taskStatus(twiceWeekly, [], "2026-10-13").kind, "pending"); // Tue
  assert.equal(taskStatus(twiceWeekly, [], "2026-10-14").kind, "due"); // Wed
  assert.equal(taskStatus(twiceWeekly, ["2026-10-12"], "2026-10-16").kind, "pending"); // Fri
  assert.equal(taskStatus(twiceWeekly, ["2026-10-12"], "2026-10-17").kind, "due"); // Sat
  assert.equal(taskStatus(twiceWeekly, ["2026-10-12", "2026-10-15"], "2026-10-17").kind, "done");
  // last week's completions do not count
  assert.equal(taskStatus(twiceWeekly, ["2026-10-09", "2026-10-10"], "2026-10-14").kind, "due");
});

test("one tick on a behind-pace day still leaves it due", () => {
  assert.equal(taskStatus(twiceWeekly, ["2026-10-17"], "2026-10-17").kind, "due");
});

test("1x / week is due on Saturday", () => {
  assert.equal(taskStatus(weekly, [], "2026-10-16").kind, "pending");
  assert.equal(taskStatus(weekly, [], "2026-10-17").kind, "due");
});

test("1x / month is due on the last day", () => {
  assert.equal(taskStatus(monthly, [], "2026-10-30").kind, "pending");
  assert.equal(taskStatus(monthly, [], "2026-10-31").kind, "due");
  assert.equal(taskStatus(monthly, [], "2026-02-28").kind, "due");
  assert.equal(taskStatus(monthly, ["2026-10-02"], "2026-10-31").kind, "done");
  assert.equal(taskStatus(monthly, ["2026-09-30"], "2026-10-31").kind, "due");
});

test("completions after the day being viewed are ignored", () => {
  assert.equal(taskStatus(daily, ["2026-10-12"], "2026-10-11").kind, "due");
});
