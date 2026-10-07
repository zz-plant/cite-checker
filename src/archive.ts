/**
 * Wayback captures for cited sources.
 *
 * `check` answers whether a source is still up; this answers what a reader
 * can open once it is not. Every entry in a frontmatter evidence block whose
 * URL is a live page gets an `archived` block — the Wayback Machine capture
 * and its date — inserted right after its URL line.
 *
 * Line-based on purpose: the frontmatter is comment-heavy, and a YAML parser
 * would drop the comments a writer would then have to restore.
 */
import { readFile, writeFile } from "node:fs/promises";
import { glob } from "tinyglobby";
import { getErrorMessage } from "./check.ts";

export interface ArchiveOptions {
  /** Who is asking, sent to the Wayback Machine. */
  userAgent: string;
  /** Frontmatter block whose entries get captures. Default: `evidenceSources`. */
  block?: string;
  /** The key that carries the URL. Default: `href`. */
  urlKey?: string;
  /** The key the capture is written under. Default: `archived`. */
  archivedKey?: string;
  wayback?: string;
  timeoutMs?: number;
  /** Retries against the CDX API, which answers 503 in bursts. Default: 4. */
  attempts?: number;
  /** Injectable for tests. */
  fetch?: typeof fetch;
  sleep?: (ms: number) => Promise<unknown>;
}

export interface ArchiveEntry {
  file: string;
  url: string;
  /** Zero-based line of the URL. */
  urlLine: number;
  hasArchive: boolean;
}

export interface Capture {
  href: string;
  /** ISO date of the capture. */
  captured: string;
}

const DEFAULTS = {
  block: "evidenceSources",
  urlKey: "href",
  archivedKey: "archived",
  wayback: "https://web.archive.org",
  timeoutMs: 20_000,
  attempts: 4,
};

const defaultSleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/** One record per `- ` item in the evidence block of one file. */
export function archiveEntriesIn(
  file: string,
  text: string,
  options: Partial<ArchiveOptions> = {}
): ArchiveEntry[] {
  const block = options.block ?? DEFAULTS.block;
  const urlKey = options.urlKey ?? DEFAULTS.urlKey;
  const archivedKey = options.archivedKey ?? DEFAULTS.archivedKey;
  const urlPattern = new RegExp(`^\\s*${escapeRegExp(urlKey)}:\\s*["'](https?:\\/\\/[^"']+)["']`);
  const archivedPattern = new RegExp(`^\\s*${escapeRegExp(archivedKey)}:`);

  const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!fm) return [];
  const lines = text.split(/\r?\n/);
  const frontmatterEnd = fm[0].split(/\r?\n/).length;

  const entries: ArchiveEntry[] = [];
  let inBlock = false;
  let current: ArchiveEntry | null = null;
  for (let i = 0; i < frontmatterEnd; i += 1) {
    const line = lines[i]!;
    if (/^[a-zA-Z]\w*:/.test(line)) {
      inBlock = line.startsWith(`${block}:`);
      if (current) entries.push(current);
      current = null;
      continue;
    }
    if (!inBlock) continue;
    if (/^\s*- /.test(line)) {
      if (current) entries.push(current);
      current = null;
    }
    const href = urlPattern.exec(line);
    if (href && !current) current = { file, url: href[1]!, urlLine: i, hasArchive: false };
    if (current && archivedPattern.test(line)) current.hasArchive = true;
  }
  if (current) entries.push(current);
  return entries;
}

/** Entries that still need a capture: no archived block, and not already an archive URL. */
export function needsCapture(entry: ArchiveEntry): boolean {
  return !entry.hasArchive && !new URL(entry.url).hostname.endsWith("archive.org");
}

async function withRetry<T>(
  run: () => Promise<T>,
  attempts: number,
  sleep: ArchiveOptions["sleep"]
): Promise<T> {
  let delay = 5_000;
  for (let attempt = 1; ; attempt += 1) {
    try {
      return await run();
    } catch (error) {
      if (attempt >= attempts) throw error;
      await (sleep ?? defaultSleep)(delay);
      delay *= 2;
    }
  }
}

/** The latest capture the CDX API knows that answered 200. */
export async function latestCapture(url: string, options: ArchiveOptions): Promise<Capture | null> {
  const wayback = options.wayback ?? DEFAULTS.wayback;
  const doFetch = options.fetch ?? fetch;
  const q = new URL(`${wayback}/cdx/search/cdx`);
  q.searchParams.set("url", url);
  q.searchParams.set("output", "json");
  q.searchParams.set("filter", "statuscode:200");
  q.searchParams.set("fl", "timestamp");
  q.searchParams.set("limit", "-1");
  const rows = await withRetry(
    async () => {
      const res = await doFetch(q, {
        headers: { "User-Agent": options.userAgent },
        signal: AbortSignal.timeout(options.timeoutMs ?? DEFAULTS.timeoutMs),
      });
      if (!res.ok) throw new Error(`CDX ${res.status}`);
      return (await res.json()) as string[][];
    },
    options.attempts ?? DEFAULTS.attempts,
    options.sleep
  );
  const ts = rows[1]?.[0];
  if (!ts) return null;
  return {
    href: `${wayback}/web/${ts}/${url}`,
    captured: `${ts.slice(0, 4)}-${ts.slice(4, 6)}-${ts.slice(6, 8)}`,
  };
}

/** Ask the Wayback Machine to capture a page it has never seen. */
export async function saveCapture(url: string, options: ArchiveOptions): Promise<void> {
  const wayback = options.wayback ?? DEFAULTS.wayback;
  const doFetch = options.fetch ?? fetch;
  const res = await doFetch(`${wayback}/save/${url}`, {
    headers: { "User-Agent": options.userAgent },
    redirect: "follow",
    signal: AbortSignal.timeout(60_000),
  });
  if (!res.ok) throw new Error(`save ${res.status}`);
}

/** The file text with the capture written in after the entry's URL line, comments intact. */
export function insertCapture(
  text: string,
  entry: ArchiveEntry,
  capture: Capture,
  options: Partial<ArchiveOptions> = {}
): string {
  const archivedKey = options.archivedKey ?? DEFAULTS.archivedKey;
  const lines = text.split("\n");
  const indent = /^(\s*)/.exec(lines[entry.urlLine]!)![1]!;
  lines.splice(
    entry.urlLine + 1,
    0,
    `${indent}${archivedKey}:`,
    `${indent}  href: "${capture.href}"`,
    `${indent}  captured: "${capture.captured}"`
  );
  return lines.join("\n");
}

export interface ArchiveRunOptions extends ArchiveOptions {
  cwd?: string;
  /** Insert captures into the files. Without it, only report. */
  write?: boolean;
  /** Ask the Wayback Machine to capture sources it has never seen. */
  save?: boolean;
  log?(line: string): void;
}

export interface ArchiveOutcome {
  entry: ArchiveEntry;
  status: "FOUND" | "WROTE" | "NONE" | "ERROR";
  capture?: Capture;
  error?: string;
}

/** Every entry in every matching file that needs a capture, handled in turn. */
export async function archiveSources(
  patterns: string[],
  options: ArchiveRunOptions
): Promise<ArchiveOutcome[]> {
  const cwd = options.cwd ?? process.cwd();
  const sleep = options.sleep ?? defaultSleep;
  const log = options.log ?? (() => {});
  const files = (await glob(patterns, { cwd, onlyFiles: true })).sort();

  const entries: ArchiveEntry[] = [];
  for (const file of files) {
    const text = await readFile(`${cwd}/${file}`, "utf8");
    entries.push(...archiveEntriesIn(file, text, options).filter(needsCapture));
  }
  if (entries.length === 0) {
    log("Every cited source has a capture on file.");
    return [];
  }

  // Written bottom-up per file so earlier line numbers stay valid.
  const ordered = [...entries].sort(
    (a, b) => a.file.localeCompare(b.file) || b.urlLine - a.urlLine
  );
  const outcomes: ArchiveOutcome[] = [];
  for (const entry of ordered) {
    try {
      let capture = await latestCapture(entry.url, options);
      if (!capture && options.save) {
        await saveCapture(entry.url, options);
        await sleep(8_000);
        capture = await latestCapture(entry.url, options);
      }
      if (!capture) {
        outcomes.push({ entry, status: "NONE" });
        log(`NONE   ${entry.file}  ${entry.url}`);
      } else if (options.write) {
        const path = `${cwd}/${entry.file}`;
        await writeFile(path, insertCapture(await readFile(path, "utf8"), entry, capture, options));
        outcomes.push({ entry, status: "WROTE", capture });
        log(`WROTE  ${entry.file}  ${capture.captured}  ${entry.url}`);
      } else {
        outcomes.push({ entry, status: "FOUND", capture });
        log(`FOUND  ${entry.file}  ${capture.captured}  ${entry.url}`);
      }
    } catch (error) {
      const message = getErrorMessage(error);
      outcomes.push({ entry, status: "ERROR", error: message });
      log(`ERROR  ${entry.file}  ${message}  ${entry.url}`);
    }
    await sleep(2_000);
  }
  return outcomes;
}
