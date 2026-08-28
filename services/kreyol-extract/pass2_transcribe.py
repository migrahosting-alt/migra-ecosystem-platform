#!/usr/bin/env python3
"""PASS 2 — page transcription for the Migra Kreyòl Language Platform.

Every page of every source gets a record. No page is skipped for being hard.

WHAT THIS IS NOT ALLOWED TO DO
------------------------------
🚨 It never certifies. Every page leaves here as `machine_extracted`, which is a
claim about WHERE the text came from, not about whether it is right. Only a human
moves a page to `reviewed` or `qualified`.

🚨 It never normalises. Unusual Kreyòl spelling, older orthography, unexpected
punctuation and odd phrasing are LANGUAGE EVIDENCE — the corpus spans historical
and modern stages on purpose. Silently modernising `Kreyol` to `Kreyòl`, or
"fixing" an author's spelling, destroys the very thing these books are being read
for. The transcription is recorded exactly as the engine produced it.

🚨 It never hides uncertainty. Low-confidence pages and low-confidence words are
FLAGGED, not smoothed. A page transcribed at 42% confidence and a page at 95% are
different kinds of evidence and must remain distinguishable.

THE THREE TEXT LAYERS
---------------------
`source_transcription` is written here. `reviewed_transcription` and
`canonical_modern_ht` are created empty and are NEVER written by this script:
overwriting a human's review with a machine pass is the one irreversible mistake
available to it.
"""

from __future__ import annotations

import json
import os
import re
import statistics
import subprocess
import sys
import tempfile
import time
from pathlib import Path

CORPUS = Path(os.environ.get("KREYOL_CORPUS", "/home/bonex/kreyol-corpus"))
OUT = Path(os.environ.get("KREYOL_OUT", "/home/bonex/kreyol-out"))
DPI = int(os.environ.get("KREYOL_DPI", "300"))

# Creole first, French second: several of these books are bilingual teaching
# texts, and French is the language a Creole model most often needs beside it.
LANGS = os.environ.get("KREYOL_LANGS", "hat+fra")

SOURCE_IDS = {
    "liv_kreyol_part1.pdf": "HC-S001",
    "Aprann pale kreyol_part1.pdf": "HC-S002",
    "Aprann pale kreyol_part2.pdf": "HC-S002b",
    "lavi_se_lasante.pdf": "HC-S003",
    "MigraAI_Kreyol1.pdf": "HC-S004",
    "MigraAI_Kreyol2.pdf": "HC-S005",
    "MigraAI_Kreyol3.pdf": "HC-S006",
    "MigraAI_Kreyol4.pdf": "HC-S007",
    "MigraAI_Kreyol5.pdf": "HC-S008",
    "liv_kreyol_AI-Training.pdf": "HC-S009",
}

# Below this mean word confidence a page goes to review rather than being
# presented as a clean transcription.
REVIEW_BELOW = float(os.environ.get("KREYOL_REVIEW_BELOW", "70"))


def run_ocr(png: Path, psm: int) -> tuple[str, list[float]]:
    """One OCR attempt. Returns the text exactly as produced, plus per-word
    confidences so uncertainty survives into the record."""
    with tempfile.TemporaryDirectory() as td:
        base = Path(td) / "o"
        subprocess.run(
            ["tesseract", str(png), str(base), "-l", LANGS, "--psm", str(psm), "tsv"],
            check=True, capture_output=True, timeout=180,
        )
        rows = (base.with_suffix(".tsv")).read_text(encoding="utf-8", errors="replace").splitlines()

    words: list[tuple[int, int, str, float]] = []   # line_num, word_num, text, conf
    for row in rows[1:]:
        parts = row.split("\t")
        if len(parts) < 12:
            continue
        try:
            conf = float(parts[10])
        except ValueError:
            continue
        text = parts[11]
        if conf < 0 or not text.strip():
            continue
        words.append((int(parts[4]), int(parts[5]), text, conf))

    # Reassembled by tesseract's own line numbering rather than by guessing at
    # whitespace — the layout is information and rebuilding it wrongly is a
    # silent corruption of the evidence.
    lines: dict[int, list[str]] = {}
    for line_num, _wn, text, _c in words:
        lines.setdefault(line_num, []).append(text)
    body = "\n".join(" ".join(v) for _k, v in sorted(lines.items()))
    return body, [c for _l, _w, _t, c in words]


def transcribe_page(png: Path) -> dict:
    """Adaptive: automatic layout first, single-block second, keep whichever the
    engine was more confident about. Columns and folios fail differently, and one
    mode cannot serve both."""
    attempts = []
    for psm in (3, 6):
        try:
            text, confs = run_ocr(png, psm)
        except subprocess.TimeoutExpired:
            continue
        except subprocess.CalledProcessError:
            continue
        mean = statistics.mean(confs) if confs else 0.0
        attempts.append({"psm": psm, "text": text, "confs": confs, "mean": mean})

    if not attempts:
        return {"state": "ocr_failed", "source_transcription": "", "ocr_confidence": None,
                "word_count": 0, "psm": None, "low_confidence_words": []}

    best = max(attempts, key=lambda a: (a["mean"], len(a["confs"])))
    low = [t for t, c in zip(best["text"].split(), best["confs"]) if c < 50][:40]

    return {
        # `machine_extracted` is the ONLY state this script may assign to a page
        # that produced text. It says the text came from a machine, nothing more.
        "state": "machine_extracted",
        "review_required": bool(best["mean"] < REVIEW_BELOW or not best["confs"]),
        "source_transcription": best["text"],
        "reviewed_transcription": None,
        "canonical_modern_ht": None,
        "ocr_confidence": round(best["mean"], 2) if best["confs"] else None,
        "word_count": len(best["confs"]),
        "psm": best["psm"],
        "psm_considered": [a["psm"] for a in attempts],
        "low_confidence_words": low,
    }


def printed_page_hint(text: str) -> int | None:
    """A folio number if the page states one. A HINT, never authority: scan order
    is not page order and a mis-read folio must not be able to reorder a book."""
    head = "\n".join(text.splitlines()[:2])
    tail = "\n".join(text.splitlines()[-2:])
    for chunk in (tail, head):
        m = re.search(r"(?<!\d)(\d{1,3})(?!\d)\s*$", chunk.strip())
        if m:
            n = int(m.group(1))
            if 1 <= n <= 999:
                return n
    return None


def process(pdf: Path) -> dict:
    sid = SOURCE_IDS[pdf.name]
    out_dir = OUT / sid
    out_dir.mkdir(parents=True, exist_ok=True)
    record_path = out_dir / "pages.jsonl"
    done = set()
    if record_path.exists():
        for line in record_path.read_text(encoding="utf-8").splitlines():
            try:
                done.add(json.loads(line)["scan_page"])
            except Exception:
                pass

    with tempfile.TemporaryDirectory() as td:
        # Rendered a page at a time and discarded: 726 pages at 300dpi is several
        # gigabytes, and this runs on a box that recently ran out of disk.
        info = subprocess.run(["pdfinfo", str(pdf)], capture_output=True, text=True).stdout
        total = next((int(l.split()[1]) for l in info.splitlines() if l.startswith("Pages:")), 0)

        with record_path.open("a", encoding="utf-8") as sink:
            for n in range(1, total + 1):
                if n in done:
                    continue
                base = Path(td) / f"p{n}"
                subprocess.run(
                    ["pdftoppm", "-r", str(DPI), "-gray", "-png", "-f", str(n), "-l", str(n),
                     str(pdf), str(base)],
                    check=True, capture_output=True, timeout=180,
                )
                pngs = sorted(Path(td).glob(f"p{n}-*.png")) or sorted(Path(td).glob(f"p{n}.png"))
                if not pngs:
                    rec = {"state": "render_failed", "source_transcription": ""}
                else:
                    started = time.time()
                    rec = transcribe_page(pngs[0])
                    rec["ocr_ms"] = int((time.time() - started) * 1000)
                    for p in pngs:
                        p.unlink(missing_ok=True)

                rec.update({
                    "source_id": sid,
                    "source_file": pdf.name,
                    "scan_page": n,
                    "printed_page_hint": printed_page_hint(rec.get("source_transcription") or ""),
                    "provenance": {"engine": "tesseract", "langs": LANGS, "dpi": DPI,
                                   "pass": 2, "certified": False},
                })
                sink.write(json.dumps(rec, ensure_ascii=False) + "\n")
                sink.flush()
                if n % 10 == 0:
                    print(json.dumps({"source": sid, "page": n, "of": total}), flush=True)

    lines = record_path.read_text(encoding="utf-8").splitlines()
    return {"source_id": sid, "pages": len(lines)}


def main() -> None:
    OUT.mkdir(parents=True, exist_ok=True)
    todo = sys.argv[1:] or [p.name for p in sorted(CORPUS.glob("*.pdf"))]
    summary = []
    for name in todo:
        pdf = CORPUS / name
        if not pdf.exists():
            print(json.dumps({"missing": name}), flush=True)
            continue
        started = time.time()
        result = process(pdf)
        result["seconds"] = round(time.time() - started, 1)
        summary.append(result)
        print(json.dumps({"done": result}), flush=True)
    (OUT / "pass2-summary.json").write_text(json.dumps(summary, indent=2))
    print(json.dumps({"pass2_complete": sum(s["pages"] for s in summary)}), flush=True)


if __name__ == "__main__":
    main()
