import { describe, expect, test } from "bun:test";
import { evidenceRegions, sourcesIn, urlsIn } from "../src/extract.ts";

const hrefsIn = (file: string, text: string) =>
  evidenceRegions(file, text).flatMap((region) => urlsIn(region));

describe("evidence region extraction", () => {
  // The type permits either property order, so a record written href-first
  // must not put its citation outside the region.
  test("finds the citation when the URL precedes the claim", () => {
    const text = `
export const ledger = [
  {
    href: "https://example.org/before",
    claim: "Stated with href written first.",
    source: "Example",
  },
  {
    claim: "Stated with claim written first.",
    href: "https://example.org/after",
    source: "Example",
  },
];`;
    expect(hrefsIn("src/data/content/x.ts", text).sort()).toEqual([
      "https://example.org/after",
      "https://example.org/before",
    ]);
  });

  test("finds the citation however long the record is", () => {
    const text = `
export const ledger = [
  {
    claim: "${"padding ".repeat(140)}",
    href: "https://example.org/far",
  },
];`;
    expect(text.indexOf("href:") - text.indexOf("claim:")).toBeGreaterThan(800);
    expect(hrefsIn("src/data/content/x.ts", text)).toEqual(["https://example.org/far"]);
  });

  // A nav item and an artifacts entry share the label:+href: shape, so only
  // a real claim: key admits a record.
  test("ignores URLs in records that back no claim", () => {
    const text = `
export const nav = [
  { label: "Home", href: "https://example.org/nav" },
];
export const ledger = [
  { claim: "Real.", href: "https://example.org/cited" },
];`;
    expect(hrefsIn("src/data/navigation.ts", text)).toEqual(["https://example.org/cited"]);
  });

  test("ignores the claim key inside a comment or a string", () => {
    const text = `
// This record does not claim: anything.
const note = "nor does claim: inside a string";
export const nav = [{ label: "Home", href: "https://example.org/nav" }];`;
    expect(hrefsIn("src/data/navigation.ts", text)).toEqual([]);
  });

  test("scopes markdown frontmatter to evidence blocks", () => {
    const text = `---
title: "A case study"
artifacts:
  - label: "Spec page"
    href: "https://example.org/artifact"
evidenceSources:
  - claim: "Something checkable."
    href: "https://example.org/evidence"
related:
  - label: "Unrelated"
    href: "https://example.org/nav"
---

Body text with href: "https://example.org/body" that is not frontmatter.`;
    expect(hrefsIn("src/content/work/x.md", text).sort()).toEqual([
      "https://example.org/artifact",
      "https://example.org/evidence",
    ]);
  });

  test("the claim key, URL key and frontmatter blocks are configurable", () => {
    const ts = `export const x = [{ assertion: "A", url: 'https://example.org/one' }];`;
    expect(
      evidenceRegions("x.ts", ts, { claimKey: "assertion" }).flatMap((r) => urlsIn(r, "url"))
    ).toEqual(["https://example.org/one"]);

    const md = `---
citations:
  - href: "https://example.org/two"
---`;
    expect(hrefsIn("x.md", md)).toEqual([]);
    expect(
      evidenceRegions("x.md", md, { frontmatterBlocks: ["citations"] }).flatMap((r) => urlsIn(r))
    ).toEqual(["https://example.org/two"]);
  });

  test("deduplicates a URL cited twice in one file", () => {
    const text = `
export const ledger = [
  { claim: "One.", href: "https://example.org/same" },
  { claim: "Two.", href: "https://example.org/same" },
];`;
    expect(sourcesIn("x.ts", text)).toEqual([{ file: "x.ts", url: "https://example.org/same" }]);
  });
});
