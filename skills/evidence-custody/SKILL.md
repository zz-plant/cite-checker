---
name: evidence-custody
description: Maintains the binding between every public claim and the source that backs it — the verification standard, the provenance grammar, and the drift loop. Load before editing any claim, citation, artifact, or disclaimer.
---

# Evidence Custody

A site that says its claims can be checked does not stay that way by good intentions.
Sources move, programs get retired, and a claim written years after the fact drifts
more precise every time it is retold. This skill is the maintenance loop.

**The skill supplies the standard, not the procedure.** Meeting the standard is a reading
and judgement task. Do it as well as you are able rather than to a checklist floor.

## 1. The verification standard

There are three distinct checks and they are routinely conflated. Never report one as
another.

| Check          | Question                                       | How                         |
| -------------- | ---------------------------------------------- | --------------------------- |
| **Liveness**   | Does the URL resolve?                          | `cite-check check`          |
| **Support**    | Does the source _say what the claim says_?     | Read the source. Judgement. |
| **Provenance** | Is this the author's work, or something cited? | Ownership, authorship, date |

A live URL is not support. A government page about a retired program can return 200 for
years after the program was folded into another one — liveness passes the whole time.

When you verify support, quote the sentence in the source that carries the claim. If you
cannot find one, the claim is not sourced, whatever the `href` says.

### Do not trust a generic link checker for cited sources

Generic link checkers treat 403/401/429/503 as passing, because a generic fetch is refused
by a good share of hosts and the false positives would bury the real signal. The cost is
that **a broken link on a bot-blocking host passes forever.** A malformed SEC archive URL
can 404 for as long as it exists while the whole site reports clean, because sec.gov
answers 403 to an undeclared client.

`cite-check check` exists for this. It sends each host what it wants, resolves DOIs
through Crossref rather than the blocked `doi.org` redirect, catches malformed SEC archive
paths without a network call, and — the important part — reports a refusal as **UNKNOWN
rather than PASS**. Unverifiable is not passing. Read those by hand before recording that
the claims were audited.

It collects from evidence blocks only — the configured frontmatter blocks, and any record
with a real claim key. Scoping by block rather than by adjacent key is deliberate:
`label:` + `href:` is the identical shape for a nav item and an artifact entry, so nothing
next to the href can tell them apart. If you add a new evidence structure, add it to the
config or its sources will silently go unchecked.

### Host routing, learned the hard way

- **sec.gov** — needs a `User-Agent` naming the requester (their fair-access policy).
  Without it, everything is 403. Rate-limit; a burst throttles the run into false unknowns.
- **Finding the right SEC document**: `https://data.sec.gov/submissions/CIK{10-digit-padded}.json`
  lists every filing with its accession number and primary document. Archive paths are
  `/Archives/edgar/data/{CIK}/{accession-without-dashes}/{document}`.
- **doi.org** — blocked to browsers, open at `https://api.crossref.org/works/{doi}`, which
  also returns author order. A DOI never needs to be UNKNOWN.
- **Hosts that refuse curl at any User-Agent** (legal-filing mirrors, wire services, many
  investor-relations sites) — a browser-driven fetch often succeeds where curl does not;
  try it before giving up. Search-result snippets are a last resort and are weaker evidence
  than the page.
- **Government PDF hosts** — some 403 a bare fetch and are fine with a browser User-Agent.
  Pipe PDFs through `pdftotext`.
- **Before marking anything unverifiable, ask whether the thing cited has an identifier
  with a machine-readable resolver behind it** (DOI, arXiv, PubMed, ISBN, a registry).

## 2. Provenance grammar

Every assertion falls into one of three tiers, and the tier must be visible to the reader.

- **Sourced** — a public, dated, third-party record says it. Gets a citation entry with
  the claim, the URL, the source's name, a note, and what rendered fields it actually backs.
  Prefer filings, federal registries, and trademark records over marketing pages; prefer
  the Internet Archive over a dead link.
- **Artifact** — a primary document the author produced survives. Gets an artifact entry
  with an image or a note describing what it is and when.
- **Attested** — only the author can say it. Gets named in a disclaimer that renders beside
  the claim. Never silently upgrade attested to sourced.

Keep the grammar the same wherever it appears (frontmatter, data files, JSON endpoints);
it is one grammar.

## 3. Rules that are not derivable from the repo

- **Contemporaneous beats retrospective, always.** A document written _during_ the work
  outranks one written years later describing it. Where they disagree, the older document
  wins and the difference gets recorded, not smoothed.
- **Specificity that grows with distance is a red flag.** A figure that first appears in a
  retelling years after the work, with no contemporaneous document quantifying it, is not
  thereby false. It is attested, and must be labelled so.
- **The site can be right against its own archive.** When the public record and the
  author's old documents disagree, check the underlying fact before "correcting" the site
  back to the archive. (An institution's founding date settles its age; a résumé does not.)
- **Keep a list of poisoned sources.** Any document known to be LLM-generated, to contain
  fabricated anecdotes, or to inflate titles and figures goes on a named list and is never
  mined for claims. Flag any claim that traces to one.
- **Cloud-synced document stubs (`.gdoc`, `.gsheet`, `.gslides`) are unreadable on disk and
  readable through the provider's API or connector.** Never conclude a document is lost
  because `cat` returned nothing.

## 4. The drift loop

Run this when touching claims, and periodically regardless.

1. `cite-check check --write` — real liveness, per host, recorded in the snapshot the site
   reads. Each citation can print its result ("answered" with the run's date, "stopped
   answering by" on a dead one, "refuses automated checks" on a refusal). Anything FAIL is
   broken now, and is shown as broken until repointed. Anything UNKNOWN needs a human; it is
   not a pass. Commit the snapshot.
2. For each citation, fetch the source and find the sentence carrying the claim. **Before
   fetching, ask whether the cited document type could plausibly contain the claim at all**
   — see §5.
3. On drift, prefer repointing to a source that does carry the claim over weakening a claim
   that is probably true. Weaken only when no such source can be found. Silently dropping
   the citation while keeping the claim is the one unacceptable option.
4. Dates and counts the site prints about its own checks are read from the snapshot; do not
   type them. Advance any "claims audited" date only when support was actually re-read —
   never after a liveness-only run.

### When a claim cannot be verified either way

Some claims are neither confirmable nor refutable from any reachable source. The policy is:
**remove rather than recite.** An unsourceable specific is worse than no specific, because
it spends credibility the rest of the page earned. If a source turns up later it costs
nothing to restore. Say in the citation note that it was removed and why, so the removal is
itself on the record.

## 5. Worked example — the failure this skill was built from

Two prominent numbers on a site were cited to SEC 8-K filings. Every step of the naive check
passed: the link checker reported clean (sec.gov answers 403; the checker tolerated 403);
the filings were real, correctly numbered, and about the right company and quarters; the
claims were plausible and, as it turned out, roughly true.

What broke it was one question: **can an 8-K contain this?** An 8-K is a narrow form — a
current-report body plus exhibits. The citation note attributed the figures to _CEO prepared
remarks on an earnings call_, and an earnings call is not part of an 8-K. That prior is what
justified the fetch. Fetching confirmed it: neither filing contained the numbers.

The real source, found by search, was a later investor release — and it corrected the
_wording_, not merely the link, in four separate particulars.

Three lessons, in order of transferability:

- **Ask what the document type can hold before reading it.** Formal filings, press
  releases, earnings calls, and investor decks are different sources with different
  contents, and a claim routinely gets attributed to the most authoritative-sounding one.
- **A correct link to a real document is not a citation.** Both filings existed and were
  correctly identified. Neither said the thing.
- **Fixing a citation usually corrects the claim too.** The right source was more precise
  than the wrong one.

## 6. Failure modes to check for by name

- **Citation supports a nearby claim, not the stated one.** A source about the patient
  portal cited for a claim about the clinician interface.
- **Artifact caption overclaims what the image shows.** A mockup with placeholder text
  annotated as a live analysis.
- **A document is real but attached to the wrong thing.** A genuine white paper, by the
  author, external-facing — and about a different product, two years earlier.
- **Named deliverable with nothing behind it.** Artifact entries that assert a document
  exists and show nothing. If it cannot be shown, say why in the note.
- **A metric contradicted by the author's own data.** A launch figure against a launch
  chart that never reaches it.
