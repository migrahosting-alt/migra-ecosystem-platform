#!/usr/bin/env python3
"""Conservative, traceable orthographic normalizer for Kreyòl ASR output.

GOVERNING RULE: normalize SPELLING; never silently repair SEMANTICS. If Whisper heard
the wrong word, the normalizer must not invent the intended one because it yields a
nicer sentence.

Every change is attested and traceable. A replacement is emitted only when:
  - the candidate form is IN the CMU-derived attested lexicon, AND
  - it is the UNIQUE candidate produced by the rule, AND
  - the source token is NOT a proper name.
No confidence -> no change. Precision is preferred over recall: leaving five
French-looking spellings untouched is better than corrupting one valid Kreyòl word.

Reason codes:
  FRENCH_ORTHOGRAPHY_TO_IPN      é/ê/ç/â/î/ô/û mapped to IPN, result attested
  APOSTROPHE_CLITIC_NORMALIZATION  l'espri -> lespri style joins, result attested
  ACCENT_NORMALIZATION           accent added/removed, unique attested candidate
  NASAL_OR_GLIDE_RESTORATION     dev-mined family (n-insertion, i->y, er->è), attested+unique
  LEXICON_CANONICALIZATION       retired label; kept only so historical records still parse
  PROPER_NAME_PRESERVED          capitalised mid-sentence, left untouched
  AMBIGUOUS_NO_CHANGE            more than one attested candidate; left untouched

The raw ASR string is retained forever alongside the normalized text.

VENDORED, FROZEN COPY - v1, qualified 2026-09-20.

Qualification record: MigraAI-Engineer/evaluations/kreyol/NORMALIZER-QUALIFICATION-v1-FROZEN.json
  VERDICT: QUALIFIED FOR STT POST-PROCESSING - high precision, low harm, limited recall.
  Sealed holdout (33 clips never inspected during rule design):
    WER 0.524 -> 0.481, CER 0.130 -> 0.106, precision 1.000, harm rate on already-correct
    tokens 0.000, recall on the orthographic error subset 0.217.

WHAT THAT MEANS HERE. It is safe to show a user: across 94 clips it has never once damaged a
token that was already correct. It is NOT good enough to author a corpus from: at 0.48 WER a
native author would still be correcting about one word in two, which is slower than typing.

DO NOT "improve" this file in place. Every remaining miss is a token where either no attested
candidate exists, or SEVERAL do and the rule correctly refuses. Raising recall means choosing
between attested candidates - that is semantic guessing, a different instrument, and it needs
its own sealed holdout. Any edit that changes normalized_text for any vector in
normalizer-frozen-vectors.jsonl is a NEW VERSION; verify_normalizer.py fails closed on it.
"""
from __future__ import annotations
import json
import re
import unicodedata
from pathlib import Path

# SELF-CONTAINED BY DESIGN. The evaluation copy of this module imports its lexicon from two
# files that are gitignored in the dev tree. A runtime that did the same would behave
# differently on any machine that happens not to have them, and would silently change
# behaviour whenever they were edited. Here the lexicon is a frozen, checksummed snapshot.
_SNAPSHOT = json.loads((Path(__file__).parent / "ht_lexicon.json").read_text(encoding="utf-8"))
HT_LEXICON = set(_SNAPSHOT["lexicon"])
HT_FUNCTION = set(_SNAPSHOT["function_words"])


def proper_noun_spans(text):
    """Capitalised tokens mid-sentence, plus hyphenated names, are treated as NAMES and
    exempted. Otherwise 'Port-au-Prince' inside perfectly good Kreyol would be rewritten."""
    names = set()
    for m in re.finditer(r"([A-ZÀ-Þ][\wÀ-ÿ]*(?:[-'][A-Za-zÀ-ÿ][\wÀ-ÿ]*)+)", text):
        names.add(m.group(1).lower())
        for part in re.split(r"[-']", m.group(1)):
            if part:
                names.add(part.lower())
    for m in re.finditer(r"(?<![.!?]\s)(?<!^)([A-ZÀ-Þ][a-zà-ÿ]{2,})", text):
        names.add(m.group(1).lower())
    return names

# French graphemes that cannot occur in IPN 1979 Kreyòl, and their plausible IPN images.
FRENCH_MAP = str.maketrans({"é": "e", "ê": "è", "ç": "s", "â": "a", "î": "i",
                            "ô": "o", "ë": "e", "ï": "i", "ü": "i", "ù": "ou"})
TOKEN_RE = re.compile(r"(\w+(?:'\w+)?|\W+)", re.UNICODE)


def _attested(w):
    return w.lower() in HT_LEXICON or w.lower() in HT_FUNCTION


def _nasal_and_glide_variants(w):
    """High-confidence families mined from the DEV split only:
        e->è (8)   nasal n-insertion (7)   i->y (7)   o->ò (7)   er->è (2)
    Noise families seen in dev (p->b, t->d, ut->d) are DELIBERATELY EXCLUDED - they are
    acoustic confusions, not orthographic rules, and encoding them would start repairing
    semantics. Every candidate is still gated on attestation and uniqueness by the caller.
    """
    out = set()
    # nasal restoration: an/on/en before m or a consonant often loses its n in ASR
    for i in range(1, len(w)):
        if w[i] in "mbpf" and w[i - 1] in "aeo":
            out.add(w[:i] + "n" + w[i:])
    for a, b in (("am", "anm"), ("om", "onm"), ("em", "enm"),
                 ("an", "ann"), ("on", "onn")):
        if a in w:
            out.add(w.replace(a, b))
    # glide: i -> y between/adjacent to vowels (juif -> jwif, pie -> pye)
    for i, ch in enumerate(w):
        if ch == "i" and 0 < i < len(w) - 1:
            out.add(w[:i] + "y" + w[i + 1:])
        if ch == "u" and 0 < i < len(w) - 1:
            out.add(w[:i] + "w" + w[i + 1:])
    # er -> è  (konverti -> konvèti)
    if "er" in w:
        out.add(w.replace("er", "è"))
    if "en" in w:
        out.add(w.replace("en", "èn"))
    out.discard(w)
    return out


def _edits1(w):
    """Single-edit neighbourhood restricted to Kreyòl-plausible operations only:
    accent toggles and a small set of French->Kreyòl grapheme swaps. NOT full
    Levenshtein - an unconstrained edit space would start inventing words.

    Returns {candidate: reason_code}. The FAMILY that produced a candidate is carried
    with it, because a reason code that is documented but never emitted is not
    traceability - every rule-3 change used to be reported as LEXICON_CANONICALIZATION
    regardless of which rule actually fired, so the audit trail could not distinguish an
    accent repair from a nasal restoration. A candidate reachable from two families keeps
    the first-listed one; the ordering below is the declared precedence."""
    out = {}

    def add(cand, reason):
        out.setdefault(cand, reason)

    pairs = [("s", "z"), ("c", "k"), ("qu", "k"), ("ch", "ch"), ("ss", "s"),
             ("tion", "syon"), ("ance", "ans"), ("ence", "ans"), ("eau", "o"),
             ("ai", "è"), ("au", "o"), ("ou", "ou"), ("gn", "y"), ("ph", "f")]
    for a, b in pairs:
        if a in w:
            add(w.replace(a, b), "FRENCH_ORTHOGRAPHY_TO_IPN")
    for i, ch in enumerate(w):
        if ch in "aeo":
            for acc in ("à", "è", "ò"):
                if unicodedata.normalize("NFD", acc)[0] == ch:
                    add(w[:i] + acc + w[i + 1:], "ACCENT_NORMALIZATION")
        if ch in "àèò":
            add(w[:i] + unicodedata.normalize("NFD", ch)[0] + w[i + 1:], "ACCENT_NORMALIZATION")
    for cand in _nasal_and_glide_variants(w):
        add(cand, "NASAL_OR_GLIDE_RESTORATION")
    out.pop(w, None)
    return out


def normalize(text: str) -> dict:
    names = proper_noun_spans(text or "")
    parts = TOKEN_RE.findall(text or "")
    changes, out = [], []

    for tok in parts:
        if not re.match(r"\w", tok):
            out.append(tok)
            continue
        low = tok.lower()

        if low in names or (tok[:1].isupper() and len(tok) > 2 and not _attested(low)):
            # a capitalised, unattested token is treated as a NAME and preserved.
            if any(c in tok.lower() for c in "éêçâîôûëïüù"):
                changes.append({"source": tok, "replacement": tok,
                                "reason": "PROPER_NAME_PRESERVED",
                                "evidence": "capitalised and unattested; French graphemes left intact"})
            out.append(tok)
            continue

        if _attested(low):
            out.append(tok)
            continue

        # rule 1: apostrophe clitic join  (l'espri -> lespri)
        if "'" in low:
            joined = low.replace("'", "")
            cands = {c for c in {joined, joined.translate(FRENCH_MAP)} if _attested(c)}
            if len(cands) == 1:
                rep = cands.pop()
                out.append(_match_case(tok, rep))
                changes.append({"source": tok, "replacement": rep,
                                "reason": "APOSTROPHE_CLITIC_NORMALIZATION",
                                "evidence": "apostrophe removed; result attested in lexicon"})
                continue

        # rule 2: French graphemes -> IPN, only if the result is attested
        if any(c in low for c in "éêçâîôûëïüù"):
            cand = low.translate(FRENCH_MAP)
            if _attested(cand):
                out.append(_match_case(tok, cand))
                changes.append({"source": tok, "replacement": cand,
                                "reason": "FRENCH_ORTHOGRAPHY_TO_IPN",
                                "evidence": "French-only grapheme mapped to IPN; result attested"})
                continue

        # rule 3: constrained single edit, unique attested candidate only
        cands = {c: r for c, r in _edits1(low).items() if _attested(c)}
        if len(cands) == 1:
            rep, reason = next(iter(cands.items()))
            out.append(_match_case(tok, rep))
            changes.append({"source": tok, "replacement": rep,
                            "reason": reason,
                            "evidence": "unique attested candidate under constrained edit (%s)"
                                        % reason.lower()})
            continue
        if len(cands) > 1:
            changes.append({"source": tok, "replacement": tok,
                            "reason": "AMBIGUOUS_NO_CHANGE",
                            "evidence": "%d attested candidates: %s" % (len(cands), sorted(cands)[:4])})
        out.append(tok)

    return {"asr_raw": text, "normalized_text": "".join(out),
            "changes": [c for c in changes if c["reason"] not in
                        ("PROPER_NAME_PRESERVED", "AMBIGUOUS_NO_CHANGE")],
            "no_change_records": [c for c in changes if c["reason"] in
                                  ("PROPER_NAME_PRESERVED", "AMBIGUOUS_NO_CHANGE")]}


def _match_case(src, rep):
    if src.isupper():
        return rep.upper()
    if src[:1].isupper():
        return rep[:1].upper() + rep[1:]
    return rep
