#!/usr/bin/env python3
"""
Build the vision benchmark's page fixtures: real PDFs, rasterised to PNG.

🚨 WHY PDFs AND NOT PNGs OF TEXT I DREW MYSELF.

The transcription suite scores a model's reading against GROUND TRUTH TAKEN FROM
THE DOCUMENT — `extractPdf` on the same PDF the raster came from. That keeps the
truth out of the harness author's hands: if these pages were PNGs with text drawn
by this script, the expected answer would be a string I typed, and the whole
measurement would rest on my own bookkeeping rather than on the file.

It also means a malformed PDF cannot silently produce an easy benchmark. If the
text layer does not say what the page shows, `extractPdf` disagrees with the
raster and the fixture fails its own check (see --verify).

🚨 WHY HAITIAN CREOLE IS IN HERE.

The first vision measurement scored one English page of ~40 content words. A model
that reads English operations prose perfectly has not been shown to read the thing
this product exists for. Creole carries diacritics (è ò à é) that a reader can drop
without looking wrong — "Bonswa" vs "Bònswa" — so a page of it is where a
transcription score stops being generous. Those characters live in
WinAnsiEncoding, so a Type1 Helvetica page carries them without font embedding.

No ghostscript, no reportlab and no groff PDF device exist on the target host,
which is why this writes the PDF by hand rather than shelling out.
"""

import argparse
import subprocess
import sys
from pathlib import Path

PAGES: dict[str, list[str]] = {
    # English operations prose, in the register the product actually sees.
    "page-en-ops": [
        "RELEASE CONTROL NOTE 4471",
        "",
        "Every release directory is immutable once published. A rollback restores",
        "the previous directory and restarts the service against it.",
        "Operators confirm checksum parity before flipping the current symlink.",
        "A release that cannot report its own build identity is not deployable.",
        "",
        "Escalation: call the duty operator before altering a production symlink.",
    ],
    # Haitian Creole prose. Diacritics are the point.
    "page-ht-prose": [
        "NÒT SOU JESYON DOSYE",
        "",
        "Chak dosye ki antre nan sistèm nan dwe gen yon non ki klè.",
        "Lè yon moun mande yon rapò, nou reponn ak sa nou jwenn nan dosye a.",
        "Si nou pa ka li yon paj, nou di sa — nou pa envante repons.",
        "Responsab la dwe verifye chif yo anvan li siyen rapò a.",
        "",
        "Atansyon: pa efase anyen san otorizasyon alekri.",
    ],
    # Creole with figures and dates: numerals are transcribed differently from prose
    # and are where a plausible-looking misreading does real damage.
    "page-ht-figures": [
        "FAKTI 2026-0918",
        "",
        "Dat: 18 septanm 2026",
        "Kliyan: Koperativ Agrikol Latibonit",
        "",
        "Depo inisyal ............ 12,450.00 HTG",
        "Frè sèvis .................. 875.50 HTG",
        "Rabè ...................... -1,200.00 HTG",
        "Total ................... 12,125.50 HTG",
        "",
        "Kondisyon: peman nan 30 jou. Kòd anilasyon: DELTA-9981.",
    ],
    # Mixed languages on one page, which is how real MigraTeck documents arrive.
    "page-mixed": [
        "BILINGUAL NOTICE / AVI NAN DE LANG",
        "",
        "English: this account was reconciled on 12 September and the balance",
        "carried forward without adjustment.",
        "",
        "Kreyòl: kont sa a te rekonsilye 12 septanm e balans lan te pase",
        "san chanjman.",
        "",
        "Reference / Referans: ANCHOR-MIXED-OMEGA",
    ],
}


def escape(text: str) -> bytes:
    """PDF string escaping, in WinAnsi bytes so Creole diacritics survive."""
    out = text.replace("\\", r"\\").replace("(", r"\(").replace(")", r"\)")
    return out.encode("cp1252", errors="replace")


def build_pdf(lines: list[str]) -> bytes:
    """A one-page Type1 Helvetica PDF with a correct xref table."""
    body = [b"BT", b"/F1 12 Tf", b"1 0 0 1 56 730 Tm", b"16 TL"]
    for line in lines:
        body.append(b"(" + escape(line) + b") Tj T*")
    body.append(b"ET")
    stream = b"\n".join(body)

    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] "
        b"/Resources << /Font << /F1 5 0 R >> >> /Contents 4 0 R >>",
        b"<< /Length " + str(len(stream)).encode() + b" >>\nstream\n" + stream + b"\nendstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>",
    ]

    out = bytearray(b"%PDF-1.4\n")
    offsets = []
    for i, obj in enumerate(objects, start=1):
        offsets.append(len(out))
        out += str(i).encode() + b" 0 obj\n" + obj + b"\nendobj\n"

    xref_at = len(out)
    out += b"xref\n0 " + str(len(objects) + 1).encode() + b"\n"
    out += b"0000000000 65535 f \n"
    for off in offsets:
        out += f"{off:010d} 00000 n \n".encode()
    out += (
        b"trailer\n<< /Size " + str(len(objects) + 1).encode() + b" /Root 1 0 R >>\n"
        b"startxref\n" + str(xref_at).encode() + b"\n%%EOF\n"
    )
    return bytes(out)


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dir", default="/tmp/vision-bench")
    ap.add_argument("--dpi", default="150")
    ap.add_argument("--verify", action="store_true",
                    help="require every page to rasterise, and report its char count")
    args = ap.parse_args()

    out = Path(args.dir)
    out.mkdir(parents=True, exist_ok=True)

    failures = []
    for name, lines in PAGES.items():
        pdf = out / f"{name}.pdf"
        pdf.write_bytes(build_pdf(lines))
        # One PNG per page, named so the runner can pair raster with source PDF.
        r = subprocess.run(
            ["pdftoppm", "-png", "-r", args.dpi, "-singlefile", str(pdf), str(out / name)],
            capture_output=True,
        )
        png = out / f"{name}.png"
        ok = r.returncode == 0 and png.exists() and png.stat().st_size > 2000
        print(f"   {name}: pdf={pdf.stat().st_size}B png={'%dB' % png.stat().st_size if png.exists() else 'MISSING'}"
              f" {'ok' if ok else 'FAILED'}")
        if not ok:
            failures.append(name)
            if r.stderr:
                print(f"      {r.stderr.decode()[:160]}")

    if args.verify and failures:
        print(f"\n   FIXTURES UNUSABLE: {', '.join(failures)}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
