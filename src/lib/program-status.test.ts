import { describe, expect, it } from "vitest";
import { jakartaCalendarDate, resolveScheduledProgramStatus } from "./program-status";

describe("scheduled program status", () => {
  it("memulai program aktif pada tanggal mulai", () => {
    expect(resolveScheduledProgramStatus({ status: "active", startDate: "2026-09-04", endDate: "2026-09-10" }, "2026-09-04")).toBe("in_progress");
  });

  it("memindahkan program lewat tanggal selesai ke tahap review", () => {
    expect(resolveScheduledProgramStatus({ status: "active", startDate: "2026-09-01", endDate: "2026-09-03" }, "2026-09-04")).toBe("review");
    expect(resolveScheduledProgramStatus({ status: "in_progress", startDate: "2026-09-01", endDate: "2026-09-03" }, "2026-09-04")).toBe("review");
  });

  it("mengembalikan program berjalan ke aktif ketika jadwal dipindah ke masa depan", () => {
    expect(resolveScheduledProgramStatus({ status: "in_progress", startDate: "2026-09-06", endDate: "2026-09-10" }, "2026-09-04")).toBe("active");
  });

  it("tidak mengubah status yang memerlukan keputusan manusia", () => {
    for (const status of ["draft", "review", "completed", "archived"] as const) {
      expect(resolveScheduledProgramStatus({ status, startDate: "2026-09-01", endDate: "2026-09-03" }, "2026-09-04")).toBe(status);
    }
  });

  it("menggunakan kalender Asia/Jakarta", () => {
    expect(jakartaCalendarDate(new Date("2026-09-03T17:30:00.000Z"))).toBe("2026-09-04");
  });
});
