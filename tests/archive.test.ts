import { describe, expect, test } from "bun:test";
import { archiveEntriesIn, insertCapture, latestCapture, needsCapture } from "../src/archive.ts";

const md = `---
title: "A study"
# A comment a YAML parser would drop.
evidenceSources:
  - claim: "One."
    href: "https://example.org/one"   # trailing comment
    source: "Example"
  - claim: "Two, already archived."
    href: "https://example.org/two"
    archived:
      href: "https://web.archive.org/web/20250101000000/https://example.org/two"
      captured: "2025-01-01"
  - claim: "Three, is an archive URL."
    href: "https://web.archive.org/web/20240101000000/https://example.org/three"
artifacts:
  - label: "Not in the block."
    href: "https://example.org/artifact"
---

Body.`;

describe("archive entries", () => {
  test("finds one entry per item in the evidence block, with its archive state", () => {
    const entries = archiveEntriesIn("x.md", md);
    expect(entries.map((e) => [e.url, e.urlLine, e.hasArchive])).toEqual([
      ["https://example.org/one", 5, false],
      ["https://example.org/two", 8, true],
      ["https://web.archive.org/web/20240101000000/https://example.org/three", 13, false],
    ]);
    expect(entries.filter(needsCapture).map((e) => e.url)).toEqual(["https://example.org/one"]);
  });

  test("the block name is configurable", () => {
    expect(archiveEntriesIn("x.md", md, { block: "artifacts" }).map((e) => e.url)).toEqual([
      "https://example.org/artifact",
    ]);
  });

  test("inserts the capture after the URL line and keeps every comment", () => {
    const [entry] = archiveEntriesIn("x.md", md);
    const out = insertCapture(md, entry!, {
      href: "https://web.archive.org/web/20260101000000/https://example.org/one",
      captured: "2026-01-01",
    });
    const lines = out.split("\n");
    expect(lines[5]).toBe('    href: "https://example.org/one"   # trailing comment');
    expect(lines[6]).toBe("    archived:");
    expect(lines[7]).toBe(
      '      href: "https://web.archive.org/web/20260101000000/https://example.org/one"'
    );
    expect(lines[8]).toBe('      captured: "2026-01-01"');
    expect(out).toContain("# A comment a YAML parser would drop.");
    expect(archiveEntriesIn("x.md", out)[0]!.hasArchive).toBe(true);
  });
});

describe("the CDX lookup", () => {
  test("turns the latest 200 capture into an archive URL and a date", async () => {
    const fetchImpl = (async () =>
      Response.json([["timestamp"], ["20250304123456"]])) as unknown as typeof fetch;
    const capture = await latestCapture("https://example.org/one", {
      userAgent: "test",
      fetch: fetchImpl,
    });
    expect(capture).toEqual({
      href: "https://web.archive.org/web/20250304123456/https://example.org/one",
      captured: "2025-03-04",
    });
  });

  test("answers null when the archive has no capture", async () => {
    const fetchImpl = (async () => Response.json([])) as unknown as typeof fetch;
    expect(
      await latestCapture("https://example.org/none", { userAgent: "test", fetch: fetchImpl })
    ).toBeNull();
  });

  test("retries a 503 before giving up", async () => {
    let n = 0;
    const fetchImpl = (async () => {
      n += 1;
      return n < 3
        ? new Response("", { status: 503 })
        : Response.json([["timestamp"], ["20250101000000"]]);
    }) as unknown as typeof fetch;
    const capture = await latestCapture("https://example.org/", {
      userAgent: "test",
      fetch: fetchImpl,
      sleep: async () => {},
    });
    expect(n).toBe(3);
    expect(capture?.captured).toBe("2025-01-01");
  });
});
