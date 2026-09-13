# Document read failures — truthful attribution — 2026-09-13

**Staging only. Production untouched.** Commit `bef9927d`, deployed to staging as
`readfailure-09134` (Brain **and** consumer — the fix spans both).

No OCR was built. This is **attribution**, not capability.

---

## The defect

One sentence answered six different facts:

> "No readable content was found in `<file>`, so there is nothing to answer from. Attach a file
> with text in it, or ask about a different document."

A damaged file, a scan with no text layer, a password-protected file, a file past the parser
ceiling, a genuinely empty document, and **a server missing its PDF renderer** all produce the
same thing downstream: zero indexed chunks.

The renderer case is why this is not cosmetic. The reader had already recorded, in its own
words:

```
failureReason: "the page renderer is not available on this server"
```

It knew the file was fine and the **server** was not — and the chat path discarded that and told
the user their document was empty and to bring a different one. One of those sends a person to
re-scan a perfectly good book. The other is an operator's job and the user should do nothing.

### 🚨 The prose knew. The contract did not.

`describeFailure()` has always drawn this distinction — its own comment reads *"a missing binary
is an operator problem, not the user's document"* — but it said so only in a **string**, while
`classifyFailure()` beside it returned `ocr_failed`. Every caller that branched on the state saw
an OCR attempt that never happened.

`reader_unavailable` is now a **state**, for the same reason `ready_with_unplaced_pages` is one:
a caller must not have to parse prose to find out what happened. One predicate,
`isReaderUnavailable()`, decides both the state and the sentence, so they cannot drift apart.

---

## What the user gets now

`readFailure.ts` maps each state to a **code**, a **reason** and — the half that makes the
distinction worth drawing — **something to do about it**:

| state | code | whose problem |
| --- | --- | --- |
| `reader_unavailable` | `document_reader_unavailable` | **ours** — "Nothing is wrong with your file" |
| `no_text_layer` | `pdf_has_no_text_layer` | needs recognition, not available here |
| `ocr_failed` | `pdf_text_not_recognised` | a clearer scan would work |
| `corrupt` | `document_corrupt` | re-export and attach again |
| `encrypted` | `document_encrypted` | remove the password |
| `too_large_to_process` | `file_too_large_to_read` | split it |

Keyed on the **state**, never the prose — the typed image error taught that the expensive way,
when a mapping matched on message text, shipped twice, and still never applied. `failureReason`
is rendered, never parsed, and it is the reader's own sentence: re-authoring it here would make a
second version of the fact.

### Two refusals to over-claim

- an **unexplained** file falls back to the old generic sentence rather than borrowing a
  neighbour's reason
- a **partial** explanation returns nothing at all, because answering "b.pdf is
  password-protected" would leave the user believing that covered a.pdf too. Mixed causes get a
  per-file list and a code that does not pick a winner.

---

## Verified on the deployed product

Staging has **none** of the readers, which is what made this testable:

```
pdftoppm     NOT INSTALLED
pdfinfo      NOT INSTALLED
tesseract    NOT INSTALLED
pdftotext    NOT INSTALLED
```

Three PDFs were built and validated against `unpdf` — the same library the Brain uses — before
being trusted, because a previous investigation was derailed by a malformed test file that turned
out to be the tester's fault:

| file | `unpdf` says | uploaded and asked about |
| --- | --- | --- |
| **text-layer** (`Tj` operator, real text) | parses, 1 page, text recovered | **answered**: *"a quarterly revenue figure of 41250"*, citing `text-…pdf:1-1` |
| **scanned** (image XObject, no text op) | parses, 1 page, **0 characters** | `document_reader_unavailable` |
| **corrupt** (valid header, broken body) | throws `InvalidPDFException` | `document_reader_unavailable` |

The live message, end to end:

```
error:   document_reader_unavailable
message: scanned-page-….pdf: the page renderer is not available on this server.
         Nothing is wrong with your file — this one is ours to fix, not yours.
```

The reader's own status line now reads the same way:

```
state:         reader_unavailable
description:   This document could not be read: the page renderer is not
               available on this server. The file itself is fine.
failureReason: the page renderer is not available on this server
```

### Two things worth stating plainly

**The text-layer PDF still reads, with a citation.** That is the regression that mattered — the
`unpdf` fast path is untouched, and a readable PDF is still read.

**On staging, `corrupt` cannot be distinguished from `no_text_layer`.** `probePdfTextLayer`
shells out to `pdfinfo` as its very first step, so every PDF fails there before its content is
ever examined, and the job falls through to `pdftoppm`, also absent. Reporting the corrupt file
as "damaged" would be a claim about bytes nothing on this host parsed. `reader_unavailable`
is the honest answer, and it is a property of the fix rather than a gap in it: **the server's own
inability is discovered first, so a file is never blamed for a failure that never reached it.**
The other five classes are covered by unit tests; demonstrating them live needs a host that has
the binaries.

### A correction to my own first run

My first live test reported all three files identically and I nearly filed it as an
over-broad classification. It was a **test artefact**: I had uploaded without running the index
pass, which is where the `unpdf` fast path lives, so nothing had been given its chance to be
read. Running `POST /api/files/index` first produced the table above.

---

## Tests

- Brain `documentJobs.test.ts`: `reader_unavailable` for `pdftoppm` / `pdfinfo` / `tesseract`
  ENOENT in either word order; the state and the sentence agree; **a genuine OCR failure is still
  `ocr_failed`**, and an ENOENT on something that is not a reader binary is not a reader problem.
- Consumer `readFailure.test.ts` (14): every class, both refusals to over-claim, mixed causes,
  and a contract test that no two causes share a code.

**Brain 3241 / 3241. Consumer 1262 / 1262. `tsc` clean both sides. Nothing skipped.**

The Brain gate was run with the engineer lane's three uncommitted files temporarily set aside
and then restored byte-identically — its `unifiedAgent` failure is a working-tree artefact of
that lane, not of HEAD, exactly as established on 2026-09-12.

---

## Release chain

```
Brain     expected commit bef9927d → buildId sha256:cda01768da9b87d0…
          schema built 28 / 28, boot-tested on 3987 as a copy of the real unit
          activated → readfailure-09134, running process reports the same

Consumer  expected commit bef9927d → buildId OcMdae1inxnT1kkVSZRlS
          boot-tested on 3097, activated → readfailure-09134, same reported
```

The Brain was deployed from a **detached worktree at `bef9927d`** because its deploy guard
refuses a dirty `apps/brain-service`, and another lane has uncommitted work there. That ships
exactly the committed code and touches no other lane's files. The worktree has been removed.

---

**READY FOR OWNER VALIDATION.** Nothing is OWNER VERIFIED. Production was not promoted.
