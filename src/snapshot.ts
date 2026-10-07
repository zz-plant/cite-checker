/**
 * The published form of a run.
 *
 * One entry per distinct URL: the same source cited from two pages was
 * checked once for each and answered the same both times. `checkedAt` is
 * the run's date, the one a page prints beside each citation. The snapshot
 * is meant to be committed, so a build needs no network and a reader sees
 * the date the check actually ran — and sees it stop moving if the check
 * stops running.
 *
 * A verdict is a fact about a fetch, not a grade on the claim. PASS means the
 * URL answered with the document. UNKNOWN means the host refused an automated
 * client, which says nothing either way. FAIL means the source stopped
 * answering, and the page that cites it should say so.
 */
import type { SourceResult, Verdict } from "./check.ts";

export interface SourceCheck {
  url: string;
  verdict: Verdict;
  status: number | null;
  detail: string;
}

export interface SourceCheckSnapshot {
  /** ISO date of the run, e.g. "2026-09-17". */
  checkedAt: string;
  sources: SourceCheck[];
}

export interface SourceCheckCounts {
  /** Distinct URLs cited as evidence. */
  cited: number;
  live: number;
  unverifiable: number;
  broken: number;
}

/**
 * Collapse per-file results to one entry per URL. The worst verdict wins
 * when a URL was checked more than once and the answers disagree: FAIL over
 * UNKNOWN over PASS.
 */
export function toSnapshot(results: SourceResult[], checkedAt: string): SourceCheckSnapshot {
  const rank: Record<Verdict, number> = { PASS: 0, UNKNOWN: 1, FAIL: 2 };
  const byUrl = new Map<string, SourceCheck>();
  for (const r of results) {
    const entry = { url: r.url, verdict: r.verdict, status: r.status, detail: r.detail };
    const existing = byUrl.get(r.url);
    if (!existing || rank[r.verdict] > rank[existing.verdict]) byUrl.set(r.url, entry);
  }
  return { checkedAt, sources: [...byUrl.values()].sort((a, b) => a.url.localeCompare(b.url)) };
}

/** A snapshot as a page reads it: lookup by URL, the run date, the counts. */
export function readSnapshot(snapshot: SourceCheckSnapshot) {
  const byUrl = new Map<string, SourceCheck>(snapshot.sources.map((s) => [s.url, s]));
  const all = [...byUrl.values()];
  const count = (v: Verdict) => all.filter((s) => s.verdict === v).length;
  const counts: SourceCheckCounts = {
    cited: all.length,
    live: count("PASS"),
    unverifiable: count("UNKNOWN"),
    broken: count("FAIL"),
  };
  return {
    checkedAt: snapshot.checkedAt,
    counts,
    sources: all,
    lookup: (url: string): SourceCheck | undefined => byUrl.get(url),
  };
}

export const SNAPSHOT_SCHEMA = {
  $schema: "https://json-schema.org/draft/2020-12/schema",
  title: "cite-check snapshot",
  type: "object",
  required: ["checkedAt", "sources"],
  properties: {
    checkedAt: { type: "string", pattern: "^\\d{4}-\\d{2}-\\d{2}$" },
    sources: {
      type: "array",
      items: {
        type: "object",
        required: ["url", "verdict", "status", "detail"],
        properties: {
          url: { type: "string", format: "uri" },
          verdict: { enum: ["PASS", "FAIL", "UNKNOWN"] },
          status: { type: ["integer", "null"] },
          detail: { type: "string" },
        },
      },
    },
  },
} as const;
