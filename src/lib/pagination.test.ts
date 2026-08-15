import { describe, expect, it } from "vitest";
import { collectAllPages } from "./pagination";

describe("collectAllPages", () => {
  it("collects subsequent pages without truncating at the first page", async () => {
    const source = [1, 2, 3, 4, 5];
    const rows = await collectAllPages(
      (from, to) => Promise.resolve({ data: source.slice(from, to + 1), error: null }),
      { pageSize: 2, maxRows: 10 },
    );
    expect(rows).toEqual(source);
  });

  it("fails explicitly instead of returning a silent partial result", async () => {
    await expect(collectAllPages(
      (from, to) => Promise.resolve({ data: Array.from({ length: to - from + 1 }, (_, index) => index), error: null }),
      { pageSize: 2, maxRows: 4 },
    )).rejects.toThrow("melebihi batas");
  });
});
