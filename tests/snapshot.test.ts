import { describe, expect, test } from "bun:test";
import { readSnapshot, toSnapshot } from "../src/snapshot.ts";
import type { SourceResult } from "../src/check.ts";

const r = (
  file: string,
  url: string,
  verdict: SourceResult["verdict"],
  status: number | null = 200
): SourceResult => ({
  file,
  url,
  verdict,
  status,
  detail: verdict === "PASS" ? "resolved" : `responded ${status}`,
});

describe("snapshot", () => {
  test("collapses per-file results to one entry per URL, sorted", () => {
    const snap = toSnapshot(
      [
        r("b.md", "https://x.test/2", "FAIL", 404),
        r("a.md", "https://x.test/1", "PASS"),
        r("b.md", "https://x.test/1", "PASS"),
      ],
      "2026-09-17"
    );
    expect(snap.checkedAt).toBe("2026-09-17");
    expect(snap.sources.map((s) => s.url)).toEqual(["https://x.test/1", "https://x.test/2"]);
    expect(snap.sources[1]!.verdict).toBe("FAIL");
  });

  test("the worst verdict wins when checks of one URL disagree", () => {
    const snap = toSnapshot(
      [
        r("a.md", "https://x.test/1", "PASS"),
        r("b.md", "https://x.test/1", "FAIL", 500),
        r("c.md", "https://x.test/1", "UNKNOWN", 403),
      ],
      "2026-09-17"
    );
    expect(snap.sources).toHaveLength(1);
    expect(snap.sources[0]!.verdict).toBe("FAIL");
  });

  test("reads back counts and lookups", () => {
    const { counts, lookup, checkedAt } = readSnapshot({
      checkedAt: "2026-09-17",
      sources: [
        { url: "https://x.test/1", verdict: "PASS", status: 200, detail: "resolved" },
        { url: "https://x.test/2", verdict: "UNKNOWN", status: 403, detail: "refused" },
        { url: "https://x.test/3", verdict: "FAIL", status: 404, detail: "responded 404" },
        { url: "https://x.test/4", verdict: "PASS", status: 200, detail: "resolved" },
      ],
    });
    expect(checkedAt).toBe("2026-09-17");
    expect(counts).toEqual({ cited: 4, live: 2, unverifiable: 1, broken: 1 });
    expect(lookup("https://x.test/3")?.verdict).toBe("FAIL");
    expect(lookup("https://nowhere.test/")).toBeUndefined();
  });
});
