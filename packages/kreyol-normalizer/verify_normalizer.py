#!/usr/bin/env python3
"""Fail-closed regression gate for the vendored Kreyòl ASR normalizer.

The normalizer was qualified on a sealed holdout ONCE. This asserts that the copy running in
MigraPilot still produces exactly the text that was qualified — every vector, byte for byte.

WHY A VECTOR FILE AND NOT UNIT TESTS. Unit tests assert the rules someone remembered to write
down. These vectors are the actual 94 transcripts the qualification numbers were computed
from, so "the tests pass but the instrument drifted" cannot happen: if a single character of
output changes, the precision and harm-rate figures on the tin stop describing this code.

  python3 verify_normalizer.py      -> exit 0 on match, 1 on ANY divergence
"""
from __future__ import annotations
import hashlib
import json
import sys
from pathlib import Path

HERE = Path(__file__).parent
sys.path.insert(0, str(HERE))
import asr_normalizer as N  # noqa: E402


def main() -> int:
    vectors = [json.loads(l) for l in
               (HERE / "normalizer-frozen-vectors.jsonl").read_text(encoding="utf-8").splitlines()
               if l.strip()]
    if not vectors:
        print("FAIL  no regression vectors found — the gate cannot pass vacuously")
        return 1

    text_drift, reason_drift = [], []
    for v in vectors:
        out = N.normalize(v["asr_raw"])
        if out["normalized_text"] != v["normalized_text"]:
            text_drift.append(v["audioId"])
        if [c["reason"] for c in out["changes"]] != [c["reason"] for c in v["changes"]]:
            reason_drift.append(v["audioId"])

    lex = json.loads((HERE / "ht_lexicon.json").read_text(encoding="utf-8"))
    print("vectors            %d" % len(vectors))
    print("lexicon            %d words + %d function words"
          % (len(lex["lexicon"]), len(lex["function_words"])))
    print("normalizer sha256  %s"
          % hashlib.sha256((HERE / "asr_normalizer.py").read_bytes()).hexdigest()[:16])
    print("text divergence    %d" % len(text_drift))
    print("reason divergence  %d" % len(reason_drift))

    if text_drift:
        print("\nFAIL  normalized_text changed for %d vector(s): %s"
              % (len(text_drift), text_drift[:5]))
        print("      The shipped normalizer no longer matches the one that was qualified.")
        print("      This is a NEW VERSION and needs a fresh sealed holdout, not a vector update.")
        return 1
    if reason_drift:
        print("\nFAIL  reason codes changed for %d vector(s): %s"
              % (len(reason_drift), reason_drift[:5]))
        print("      Output text is intact but the audit trail no longer explains it.")
        return 1

    print("\nPASS  vendored normalizer reproduces the qualified output exactly")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
