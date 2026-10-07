/**
 * Finds the URLs that back claims, and only those.
 *
 * A bare `href:` match is too broad: navigation items, profile links and
 * reading lists all use the same key, and none of them backs a claim.
 * Reporting one of those as a broken citation — and exiting non-zero for it —
 * would make the check mean something other than what it says. Adjacent keys
 * cannot separate them either, because `label:` + `href:` is the exact shape
 * of both a nav item and an artifact entry. So the scope is the block the URL
 * sits in:
 *
 *   - Markdown frontmatter: the named evidence blocks (`evidenceSources:` and
 *     `artifacts:` by default), each running until the next top-level key.
 *   - TypeScript / JavaScript: the brace-balanced record that carries a real
 *     claim key (`claim:` by default). Comments and string bodies are masked
 *     first, so the word "claim" in a sentence cannot admit a record, and
 *     property order and record length do not matter.
 */
import { readFile } from "node:fs/promises";
import { glob } from "tinyglobby";

export interface ExtractOptions {
  /** Frontmatter blocks whose entries are citations. Default: evidenceSources, artifacts. */
  frontmatterBlocks?: string[];
  /** The key whose presence marks a TS/JS record as a claim. Default: `claim`. */
  claimKey?: string;
  /** The key that carries the URL. Default: `href`. */
  urlKey?: string;
}

export interface SourceRef {
  /** Repo-relative path of the file that cites the URL. */
  file: string;
  url: string;
}

const DEFAULTS: Required<ExtractOptions> = {
  frontmatterBlocks: ["evidenceSources", "artifacts"],
  claimKey: "claim",
  urlKey: "href",
};

type Span = { start: number; end: number };

const escapeRegExp = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

/**
 * `text` with every comment and string body blanked to spaces, same length so
 * offsets still line up with the original. The data files this reads are
 * prose-heavy: an apostrophe inside a claim, a brace inside a note, a
 * commented-out record, or the literal word "claim" in a sentence would each
 * throw off a scan of the raw text.
 */
export function maskCode(text: string): string {
  const out = text.split("");
  const blank = (from: number, to: number) => {
    for (let j = from; j < to && j < out.length; j += 1) {
      if (out[j] !== "\n") out[j] = " ";
    }
  };
  let i = 0;
  while (i < text.length) {
    const c = text[i]!;
    if (c === "/" && text[i + 1] === "/") {
      const nl = text.indexOf("\n", i);
      const stop = nl === -1 ? text.length : nl;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      const close = text.indexOf("*/", i + 2);
      const stop = close === -1 ? text.length : close + 2;
      blank(i, stop);
      i = stop;
      continue;
    }
    if (c === '"' || c === "'" || c === "`") {
      const from = i;
      i += 1;
      while (i < text.length) {
        if (text[i] === "\\") {
          i += 2;
          continue;
        }
        if (text[i] === c) {
          i += 1;
          break;
        }
        i += 1;
      }
      blank(from, i);
      continue;
    }
    i += 1;
  }
  return out.join("");
}

/** Every brace-balanced `{...}` in masked code, as offsets into the original. */
export function objectSpans(mask: string): Span[] {
  const spans: Span[] = [];
  const open: number[] = [];
  for (let i = 0; i < mask.length; i += 1) {
    if (mask[i] === "{") open.push(i);
    else if (mask[i] === "}") {
      const from = open.pop();
      if (from !== undefined) spans.push({ start: from, end: i + 1 });
    }
  }
  return spans;
}

/**
 * The regions of a file that may carry citations: evidence blocks of a
 * Markdown file's frontmatter, or the claim-carrying records of a TS/JS file.
 */
export function evidenceRegions(
  file: string,
  text: string,
  options: ExtractOptions = {}
): string[] {
  const opts = { ...DEFAULTS, ...options };

  if (/\.(md|mdx|markdown)$/.test(file)) {
    const fm = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if (!fm) return [];
    const lines = fm[1]!.split(/\r?\n/);
    const regions: string[] = [];
    let current: string[] | null = null;
    for (const line of lines) {
      const topLevel = /^([a-zA-Z][\w]*):/.exec(line);
      if (topLevel) {
        if (current) regions.push(current.join("\n"));
        current = opts.frontmatterBlocks.includes(topLevel[1]!) ? [line] : null;
      } else if (current) {
        current.push(line);
      }
    }
    if (current) regions.push(current.join("\n"));
    return regions;
  }

  const mask = maskCode(text);
  const spans = objectSpans(mask);
  const regions: string[] = [];
  const claimPattern = new RegExp(`\\b${escapeRegExp(opts.claimKey)}\\s*:`, "g");
  for (const m of mask.matchAll(claimPattern)) {
    const at = m.index!;
    // Innermost enclosing object: among the spans covering this key, the one
    // that opens last.
    let record: Span | null = null;
    for (const span of spans) {
      if (span.start <= at && at < span.end && (!record || span.start > record.start)) {
        record = span;
      }
    }
    if (record) regions.push(text.slice(record.start, record.end));
  }
  return regions;
}

/** Every URL a region cites. */
export function urlsIn(region: string, urlKey = DEFAULTS.urlKey): string[] {
  const pattern = new RegExp(`\\b${escapeRegExp(urlKey)}:\\s*["'](https?:\\/\\/[^"']+)["']`, "g");
  return [...region.matchAll(pattern)].map((m) => m[1]!);
}

/** Cited sources in one file, deduplicated per file. */
export function sourcesIn(file: string, text: string, options: ExtractOptions = {}): SourceRef[] {
  const urlKey = options.urlKey ?? DEFAULTS.urlKey;
  const seen = new Set<string>();
  const refs: SourceRef[] = [];
  for (const region of evidenceRegions(file, text, options)) {
    for (const url of urlsIn(region, urlKey)) {
      if (seen.has(url)) continue;
      seen.add(url);
      refs.push({ file, url });
    }
  }
  return refs;
}

/** Cited sources across every file the globs match, in file order. */
export async function collectSources(
  patterns: string[],
  options: ExtractOptions & { cwd?: string } = {}
): Promise<SourceRef[]> {
  const cwd = options.cwd ?? process.cwd();
  const files = (await glob(patterns, { cwd, onlyFiles: true })).sort();
  const refs: SourceRef[] = [];
  for (const file of files) {
    const text = await readFile(`${cwd}/${file}`, "utf8");
    refs.push(...sourcesIn(file, text, options));
  }
  return refs;
}
