import { describe, expect, it } from "vitest";
import { evaluateFollowUpWindow, followUpWindowFromEnvironment } from "./follow-up-policy";

describe("follow-up business window", () => {
  it("allows a weekday during Jakarta working hours", () => {
    expect(evaluateFollowUpWindow(new Date("2026-08-27T03:00:00.000Z")).allowed).toBe(true);
  });

  it("blocks weekends and configured holidays", () => {
    expect(evaluateFollowUpWindow(new Date("2026-08-29T03:00:00.000Z")).allowed).toBe(false);
    const policy = { ...followUpWindowFromEnvironment(), holidays: ["2026-08-27"] };
    expect(evaluateFollowUpWindow(new Date("2026-08-27T03:00:00.000Z"), policy).isHoliday).toBe(true);
  });

  it("reads a controlled schedule from environment values", () => {
    const policy = followUpWindowFromEnvironment({
      FOLLOW_UP_TIME_ZONE: "Asia/Makassar",
      FOLLOW_UP_WINDOW_START: "8",
      FOLLOW_UP_WINDOW_END: "17",
      FOLLOW_UP_WEEKDAYS: "1,2,3,4,5,6",
      FOLLOW_UP_HOLIDAYS: "2026-08-17,invalid",
    });
    expect(policy).toMatchObject({ timeZone: "Asia/Makassar", startHour: 8, endHour: 17, weekdays: [1, 2, 3, 4, 5, 6], holidays: ["2026-08-17"] });
  });
});
