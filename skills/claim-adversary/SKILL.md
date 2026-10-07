---
name: claim-adversary
description: Adversarial self-audit of a site's claims — construct the strongest case that an assertion is wrong, inflated, or unsupported, then check it. Load when auditing content, before publishing new claims, or on request.
---

# Claim Adversary

`evidence-custody` maintains claims that already carry a source. This skill goes after the
ones nobody flagged — the assertions that were never challenged because they sound
reasonable and belong to the author.

**Your posture is not review. It is prosecution.** For each claim, build the strongest
argument that it is wrong, inflated, or unsupported — then go find out. A finding is only
useful if it is specific enough to act on, so "this seems vague" is not output. "The white
paper is dated two years before the product and concerns a different one, so calling it the
product's security review basis is wrong" is output.

The value of this skill is bounded by how well you reason, not by how many checks you run.
Generic skepticism is worthless here. Go for the specific kill.

## 1. Attack patterns, in rough order of yield

**Date the claim against the work.** When was the assertion first written down, and when
did the thing happen? Every claim has a first appearance. Retrieve it from the author's
document archive (old résumés, decks, drafts) and from git history. A number about 2013
that first appears in 2019 is attested, not established.

**Check whether specificity grew.** Compare the same bullet across generations of the
author's documents. A claim that gains a percentage, a count, or an age with each retelling,
without a new source arriving, is drifting. This is the single highest-yield pattern.

**Ask whether the document type can hold the claim — before you fetch it.** This is the
highest-yield question in the whole skill and it costs one thought. An 8-K is a current
report plus exhibits; it does not contain earnings-call remarks. A trademark filing names an
entity and a product description; it does not establish revenue. A press release is not an
audited figure. When a citation's note describes the source as one genre ("CEO prepared
remarks") while the URL points at another (an 8-K), that mismatch is the finding, and the
fetch merely confirms it.

**Read the source, not the link.** Fetch every cited URL and locate the sentence that
carries the claim. Absence of that sentence is a finding even when the page loads. Run
`cite-check check` first — it separates hosts that answered from hosts that refused, so you
do not mistake a bot-block for a passing check.

**Test the artifact against its caption.** Open the image. Does it show what the caption
says it shows? Placeholder text, mockup status, a date that contradicts the surrounding
prose, a screen that illustrates a different feature.

**Check attribution, not just occurrence.** The event may be real and the role overstated.
"Deployed" versus "helped orchestrate"; "led" versus "was on the team"; a company outcome
claimed by placement under a personal heading.

**Look for the same number doing two jobs.** A cumulative figure presented as annual, a
portfolio metric attributed to one product, a launch figure that is actually a later
milestone.

**Find claims that stand alone.** An assertion with no corroboration anywhere — not in the
archive, not in a public record, not in a contemporaneous document. It may be true. It must
not be presented as established.

## 2. What counts as a finding

Report only what you can state as: **the claim, where it appears, what contradicts or fails
to support it, and what the honest version would be.** Include the location as
`file:line`. If you cannot name the contradiction, you have a suspicion, not a finding —
say so explicitly and separately, or drop it.

Rank by consequence, not by how clever the catch was. A wrong number in a hero lede outranks
a soft verb in a nested bullet.

**Sweep every surface, not the one you found it on.** Claims get duplicated across content
files, data files, structured-data and SEO description fields, JSON endpoints, and —
easy to miss — republished essays. `rg` the distinctive number or phrase before declaring a
fix complete.

`rg` cannot see inside images or PDFs. Anything that renders claims into a PNG (social
cards) or a PDF (a résumé) has to be regenerated after the claim changes. Keep a list of
those generators and run them.

**A republished essay is corrected in the open.** Anything that exists elsewhere under the
author's byline gets the claim fixed, then a dated inline correction note saying what it
previously read and why it changed. Silent edits create a divergence a reader cannot see; a
marked correction is the site's own thesis applied to itself.

## 3. Calibration — the site has been right before

This is not a mandate to weaken claims. Two guards:

- **Check the underlying fact before deferring to the archive.** A site can be right where
  every one of the author's old documents was wrong. An adversary who only diffed documents
  would file a false finding.
- **Attested is a valid state, not a defect.** A personal site is expected to contain
  self-reported achievement. The defect is presenting attested material _as_ sourced. The
  fix is usually a disclaimer line, not a deletion.

Over-flagging costs real claims. Under-flagging costs the site's whole proposition. Neither
error is free.

## 4. Known-poisoned sources

Keep the list, with what each source gets wrong, in the site's own copy of
`evidence-custody` (§3). Do not treat any of them as evidence for anything, and flag any
claim that traces to one.

## 5. Keep a ledger across runs

This skill runs repeatedly, and a run that rediscovers last month's findings is noise.
Maintain two lists in the site's own copy of this skill:

- **Resolved — do not re-file.** Each closed finding with the date and where the fix is
  recorded, so a later run recognises it as closed and the fix is not quietly reverted.
- **Standing findings.** Claims currently accepted and labelled as attested rather than
  fixed. Do not re-file these as new; do escalate if new evidence appears either way.
