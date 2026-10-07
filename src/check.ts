/**
 * Liveness, with the bot-block problem solved honestly.
 *
 * A generic fetch is refused by a good share of the hosts a careful site
 * cites. A link checker that tolerates 403 lets a genuinely broken link on a
 * bot-blocking host pass forever; one that fails on 403 drowns the real
 * signal in false alarms. This does neither: it sends each host what it
 * wants (SEC, for one, requires a declared User-Agent naming the requester)
 * and reports a refusal as UNKNOWN — a third state that is never counted as
 * a pass. PASS is reserved for a response that proves the document is there.
 *
 * Resolvers run before the HTTP check. A DOI is a registry key with an open
 * API behind it, so doi.org refusing browsers does not make the source
 * unverifiable; an SEC archive path has a structure that can be checked with
 * no network at all. Add your own for arXiv, PubMed, ISBN or anything else
 * with a resolver.
 *
 * This checks liveness only. Whether the source *says what the claim says*
 * is a reading task — see skills/evidence-custody/SKILL.md.
 */
import type { SourceRef } from "./extract.ts";

export type Verdict = "PASS" | "FAIL" | "UNKNOWN";

export interface SourceResult extends SourceRef {
  status: number | null;
  verdict: Verdict;
  detail: string;
}

export interface HostRule {
  /** Headers to send this host instead of the browser-like defaults. */
  headers?: Record<string, string>;
  /**
   * The host is known to refuse automated clients regardless of headers. A
   * refusal from it is reported as UNKNOWN with a note saying so, rather than
   * as something worth a look.
   */
  knownBlocker?: boolean;
}

export interface Resolver {
  name: string;
  /** Return a result to short-circuit the HTTP check, or null to fall through. */
  check(ref: SourceRef, ctx: ResolverContext): Promise<SourceResult | null>;
}

export interface ResolverContext {
  userAgent: string;
  fetch: typeof fetch;
  timeoutMs: number;
}

export interface CheckOptions {
  /**
   * Who is asking, e.g. "example.org source verification you@example.org".
   * Sent to hosts whose policy wants a contactable requester (SEC, Crossref).
   */
  userAgent: string;
  /** Sent to everyone else. Defaults to a current desktop Chrome string. */
  browserUserAgent?: string;
  /** Per-host rules, matched by hostname suffix ("sec.gov" matches www.sec.gov). */
  hosts?: Record<string, HostRule>;
  /** Statuses that mean "refused", not "gone". Default: 401, 403, 429, 503. */
  refusalStatuses?: number[];
  /** Identifier resolvers tried before the HTTP check. Default: SEC structure, Crossref DOI. */
  resolvers?: Resolver[];
  timeoutMs?: number;
  /** Injectable for tests. */
  fetch?: typeof fetch;
}

export interface RunOptions extends CheckOptions {
  /** Pause between sources. Serial on purpose: a burst gets a run throttled into false UNKNOWNs. */
  delayMs?: number;
  /** Pause before the one retry a FAIL gets. */
  retryDelayMs?: number;
  onResult?(result: SourceResult): void;
}

const BROWSER_UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36";

export const DEFAULT_REFUSAL_STATUSES = [401, 403, 429, 503];

/** Hosts observed to refuse automated clients at any User-Agent. */
export const DEFAULT_HOSTS: Record<string, HostRule> = {
  "doi.org": { knownBlocker: true },
  "trademarks.justia.com": { knownBlocker: true },
  "axios.com": { knownBlocker: true },
  "businesswire.com": { knownBlocker: true },
  "web.archive.org": { knownBlocker: true },
};

export function getErrorMessage(error: unknown, fallback = "Unknown error"): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return fallback;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The rule for a hostname, by longest matching suffix. */
export function hostRule(
  hostname: string,
  hosts: Record<string, HostRule> = {}
): HostRule | undefined {
  let best: { suffix: string; rule: HostRule } | undefined;
  for (const [suffix, rule] of Object.entries(hosts)) {
    const matches = hostname === suffix || hostname.endsWith(`.${suffix}`);
    if (matches && (!best || suffix.length > best.suffix.length)) best = { suffix, rule };
  }
  return best?.rule;
}

export function headersFor(url: string, options: CheckOptions): Record<string, string> {
  const host = new URL(url).hostname;
  const rule = hostRule(host, { ...secHosts(options.userAgent), ...options.hosts });
  if (rule?.headers) return rule.headers;
  return {
    "User-Agent": options.browserUserAgent ?? BROWSER_UA,
    Accept: "text/html,application/xhtml+xml,application/pdf,*/*",
    "Accept-Language": "en-US,en;q=0.9",
  };
}

/** SEC's fair-access policy wants a requester it can contact. */
function secHosts(userAgent: string): Record<string, HostRule> {
  return { "sec.gov": { headers: { "User-Agent": userAgent } } };
}

/**
 * SEC archive paths are /Archives/edgar/data/{CIK}/{accession}/{doc}. The
 * failure that motivated this package dropped the CIK and left the accession
 * in its place, which is detectable without a network call.
 */
export function secStructuralProblem(url: string): string | null {
  const m = url.match(/sec\.gov\/Archives\/edgar\/data\/(\d+)\/([^/]+)/);
  if (!m) return null;
  const [, cik, next] = m;
  if (cik!.length > 12 && /^\d+$/.test(cik!) && !next!.match(/^\d{18}$/)) {
    return `CIK segment "${cik}" looks like an accession number — SEC paths are /data/{CIK}/{accession}/{doc}`;
  }
  return null;
}

export const secArchiveStructure: Resolver = {
  name: "sec-archive-structure",
  async check(ref) {
    const problem = secStructuralProblem(ref.url);
    return problem ? { ...ref, status: null, verdict: "FAIL", detail: problem } : null;
  },
};

/**
 * doi.org refuses automated clients, but a DOI is a registry key and the
 * registry has an open API — so a DOI never needs to be UNKNOWN. Crossref
 * also returns the title and author order, which the detail carries so a
 * first-author claim can be verified rather than asserted.
 */
export const crossrefDoi: Resolver = {
  name: "crossref-doi",
  async check(ref, ctx) {
    const doi = ref.url.match(/doi\.org\/(10\.[^\s?#]+)/)?.[1];
    if (!doi) return null;
    try {
      const res = await ctx.fetch(`https://api.crossref.org/works/${doi}`, {
        headers: { "User-Agent": ctx.userAgent },
        signal: AbortSignal.timeout(ctx.timeoutMs),
      });
      // Only a definitive not-found proves a DOI is absent. Throttling and
      // outages say nothing about the record and must not read as breakage.
      if (res.status === 404 || res.status === 410) {
        return {
          ...ref,
          status: res.status,
          verdict: "FAIL",
          detail: "not registered in Crossref",
        };
      }
      if (!res.ok) {
        return {
          ...ref,
          status: res.status,
          verdict: "UNKNOWN",
          detail: `Crossref unavailable (${res.status}) — resolver problem, not evidence about the DOI`,
        };
      }
      const { message } = (await res.json()) as {
        message: { title?: string[]; author?: { given?: string; family?: string }[] };
      };
      const authors = (message.author ?? [])
        .map((a) => `${a.given ?? ""} ${a.family ?? ""}`.trim())
        .filter(Boolean);
      return {
        ...ref,
        status: 200,
        verdict: "PASS",
        detail: `Crossref: “${message.title?.[0] ?? doi}” — ${authors.join(", ")}`,
      };
    } catch (error) {
      return {
        ...ref,
        status: null,
        verdict: "UNKNOWN",
        detail: `could not reach Crossref: ${getErrorMessage(error)}`,
      };
    }
  },
};

export const DEFAULT_RESOLVERS: Resolver[] = [secArchiveStructure, crossrefDoi];

/** One source, one verdict. */
export async function checkSource(ref: SourceRef, options: CheckOptions): Promise<SourceResult> {
  const doFetch = options.fetch ?? fetch;
  const timeoutMs = options.timeoutMs ?? 30_000;
  const ctx: ResolverContext = { userAgent: options.userAgent, fetch: doFetch, timeoutMs };

  for (const resolver of options.resolvers ?? DEFAULT_RESOLVERS) {
    const result = await resolver.check(ref, ctx);
    if (result) return result;
  }

  const refusals = options.refusalStatuses ?? DEFAULT_REFUSAL_STATUSES;
  const hosts = { ...DEFAULT_HOSTS, ...options.hosts };
  try {
    const res = await doFetch(ref.url, {
      method: "GET",
      redirect: "follow",
      headers: headersFor(ref.url, options),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const host = new URL(ref.url).hostname;
    if (res.ok) return { ...ref, status: res.status, verdict: "PASS", detail: "resolved" };
    if (refusals.includes(res.status)) {
      const known = hostRule(host, hosts)?.knownBlocker === true;
      return {
        ...ref,
        status: res.status,
        verdict: "UNKNOWN",
        detail: known
          ? `${host} refuses automated clients — verify by hand or with a browser`
          : `refused with ${res.status}; not a known blocker, worth a look`,
      };
    }
    return { ...ref, status: res.status, verdict: "FAIL", detail: `responded ${res.status}` };
  } catch (error) {
    return { ...ref, status: null, verdict: "FAIL", detail: getErrorMessage(error) };
  }
}

/**
 * Every source, serially, with one retry on FAIL: a transient timeout or a
 * rate limit that lands as a hard error would otherwise exit non-zero and
 * train everyone to ignore the check. A source is only reported broken if it
 * fails twice.
 */
export async function checkSources(
  refs: SourceRef[],
  options: RunOptions
): Promise<SourceResult[]> {
  const results: SourceResult[] = [];
  const delayMs = options.delayMs ?? 150;
  const retryDelayMs = options.retryDelayMs ?? 2_000;
  for (const ref of refs) {
    let result = await checkSource(ref, options);
    if (result.verdict === "FAIL") {
      if (retryDelayMs > 0) await sleep(retryDelayMs);
      const retry = await checkSource(ref, options);
      if (retry.verdict !== "FAIL") retry.detail += " (passed on retry)";
      result = retry;
    }
    results.push(result);
    options.onResult?.(result);
    if (delayMs > 0) await sleep(delayMs);
  }
  return results;
}
