# cite-check

Checks that the sources behind a site's claims still answer, and publishes the result.

Most link checkers answer one question: does the URL resolve? For a site whose point is
that its claims can be checked, that is the wrong question twice over. A refused request
(401, 403, 429, 503) proves nothing either way, and a generic checker has to pick between
counting it as a pass (so a broken link on a bot-blocking host passes forever) or as a
failure (so a quarter of the hosts a careful site cites fail on every run). And a check
nobody can see is a check nobody trusts.

`cite-check` does three things differently:

- **A third verdict.** Every source is `PASS`, `FAIL` or `UNKNOWN`. A refusal is `UNKNOWN`
  and is never counted as a pass. Hosts you know refuse everything are labelled as such so
  they stop hiding the ones worth a look.
- **Identifier resolvers.** A DOI is checked through Crossref's open API (which also returns
  title and author order) rather than the blocked `doi.org` redirect. A malformed SEC
  archive path fails with no network call. Add your own resolver for arXiv, PubMed, ISBN or
  a registry of your own.
- **A committed snapshot.** `--write` records the run as JSON your site can render: the
  date beside each citation, a notice on the one that stopped answering, the counts in the
  footer. The snapshot is what the tool wrote; nothing is retyped. Pair it with the Wayback
  command so a dead source still has somewhere to point.

It only collects URLs that back claims. A nav item and a citation share the same
`label:` + `href:` shape, so scoping by adjacent key cannot tell them apart; `cite-check`
scopes by block instead: named frontmatter blocks in Markdown, and the brace-balanced
record carrying a claim key in TypeScript or JavaScript data files.

## Install

```sh
bun add -d cite-check
```

It runs under [Bun](https://bun.sh). The library uses only standard APIs and `tinyglobby`.

## Configure

`cite-check.config.ts` at the root of the project:

```ts
import { defineConfig } from "cite-check";

export default defineConfig({
  // Files that carry claims. Markdown is read for frontmatter evidence blocks;
  // .ts/.js is read for records with a claim key.
  files: ["src/content/**/*.md", "src/data/**/*.ts"],

  // Who is asking. SEC's fair-access policy and Crossref both want a contact.
  userAgent: "example.org source verification you@example.org",

  // Where `check --write` records the run. Commit it; render it.
  snapshot: "src/data/generated/source-checks.json",

  extract: {
    frontmatterBlocks: ["evidenceSources", "artifacts"], // default
    claimKey: "claim", // default
    urlKey: "href", // default
  },

  check: {
    // Per-host rules, matched by hostname suffix. `knownBlocker` hosts refuse
    // any automated client; a refusal from one is reported as such rather than
    // as something worth a look. `headers` replaces the browser-like defaults.
    hosts: {
      "investors.example.com": { knownBlocker: true },
      "api.example.net": { headers: { Authorization: "Bearer …" } },
    },
    delayMs: 150, // between sources; serial on purpose
    retryDelayMs: 2000, // before the one retry a FAIL gets
  },

  archive: {
    files: ["src/content/work/*.md"], // default: `files`
    block: "evidenceSources", // default
  },
});
```

The defaults already know SEC (declared User-Agent), Crossref (DOIs), and a few hosts that
refuse everyone (`doi.org`, `web.archive.org`, wire services).

## Run

```sh
cite-check check            # verdict per source; exit 1 on any FAIL
cite-check check --json     # the results as JSON
cite-check check --write    # also record the run in the snapshot
cite-check archive          # list citations with no Wayback capture on file
cite-check archive --write  # insert `archived: { href, captured }` after each href
cite-check archive --save   # ask the Wayback Machine to capture sources it has never seen
```

Sources are checked one at a time with a short pause. That is deliberate: SEC and the
Wayback Machine both throttle bursts, and a throttled run reads as a page of false
`UNKNOWN`s. A `FAIL` is retried once before it is reported, so a transient timeout does not
train everyone to ignore the check.

### The snapshot

```json
{
  "checkedAt": "2026-10-03",
  "sources": [
    {
      "url": "https://doi.org/10.1021/bk-2011-1082.ch007",
      "verdict": "PASS",
      "status": 200,
      "detail": "Crossref: “A Thermodynamic Perspective…” — First Author, Second Author"
    },
    {
      "url": "https://investors.example.com/news/…",
      "verdict": "UNKNOWN",
      "status": 403,
      "detail": "investors.example.com refuses automated clients — verify by hand or with a browser"
    }
  ]
}
```

Read it at build time with the `/snapshot` export:

```ts
import { readSnapshot } from "cite-check/snapshot";
import snapshot from "./src/data/generated/source-checks.json";

const checks = readSnapshot(snapshot);
checks.checkedAt; // "2026-10-03"
checks.counts; // { cited, live, unverifiable, broken }
checks.lookup(url)?.verdict; // "PASS" | "FAIL" | "UNKNOWN" | undefined
```

The snapshot's shape is exported as `SNAPSHOT_SCHEMA` (JSON Schema) for validation.

### Archiving

`archive` reads the same frontmatter blocks line by line, on purpose: evidence blocks are
comment-heavy, and a YAML round-trip would drop the comments a writer would then have to
restore. The capture is inserted directly after the `href:` line of each entry:

```yaml
evidenceSources:
  - claim: "Dialer handled a million calls a day by 2023."
    href: "https://example.com/press/2023-02-01"
    archived:
      href: "https://web.archive.org/web/20230205120000/https://example.com/press/2023-02-01"
      captured: "2023-02-05"
```

## As a library

```ts
import { collectSources, checkSources, toSnapshot, type Resolver } from "cite-check";

const arxiv: Resolver = {
  name: "arxiv",
  async check(ref, ctx) {
    const id = ref.url.match(/arxiv\.org\/abs\/([\d.]+)/)?.[1];
    if (!id) return null; // not ours; fall through
    const res = await ctx.fetch(`https://export.arxiv.org/api/query?id_list=${id}`);
    return res.ok
      ? { ...ref, status: 200, verdict: "PASS", detail: "arXiv" }
      : { ...ref, status: res.status, verdict: "UNKNOWN", detail: "arXiv API unavailable" };
  },
};

const refs = await collectSources(["content/**/*.md"]);
const results = await checkSources(refs, {
  userAgent: "example.org you@example.org",
  resolvers: [arxiv, ...DEFAULT_RESOLVERS],
});
const snapshot = toSnapshot(results, new Date().toISOString().slice(0, 10));
```

`fetch` and `sleep` are injectable, so the whole pipeline is testable without a network.

## Skills

`skills/` holds two agent skills (Claude Code, Gemini CLI, Antigravity and anything else
that reads `SKILL.md`) that carry the methodology the tool is one part of:

- **evidence-custody** — the three checks that must never be reported as each other
  (liveness, support, provenance), the three provenance tiers (sourced, artifact, attested),
  host-routing notes, the drift loop, and the failure modes to look for by name.
- **claim-adversary** — the self-audit: build the strongest case that each claim is wrong,
  inflated or unsupported, then check it. Attack patterns in order of yield, what counts as
  a finding, and how to keep a ledger across runs.

Copy them into your project's skills directory and add the site-specific sections they
point at (your evidence schema, your poisoned-sources list, your resolved-findings ledger).

## What it is not

It checks **liveness**, not **support**. Whether the source says what the claim says is a
reading task, and the skills above are about doing that reading well. A link checker for
every link on a site is a different tool; use [lychee](https://github.com/lycheeverse/lychee)
for that.

## License

MIT
