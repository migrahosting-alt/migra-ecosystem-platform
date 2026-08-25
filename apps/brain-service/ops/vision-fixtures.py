#!/usr/bin/env python3
"""
Fixtures for the vision qualification battery.

GROUND TRUTH BY CONSTRUCTION. Every synthetic image is drawn from the same
constants the expected answer is derived from, so "7 red circles" is not a
description of the image — it is what the loop drew. A battery graded against a
human's reading of its own fixtures measures the reading.

SYNTHETIC IS NOT SUFFICIENT ON ITS OWN. Rendered shapes and crisp rasterised text
are easier than photographs and real interfaces, and a model that aces them can
still fail a screenshot. The real-image cases come from an actual product page
whose content was verified by eye before the expected answers were written down.

The literal-answer format ("reply with only the number") is deliberate: it makes
grading an exact comparison against a known value rather than a keyword search
through prose, which would only be a proxy for whether the model understood.
"""

import json
import os
import sys
from PIL import Image, ImageDraw, ImageFont

OUT = sys.argv[1] if len(sys.argv) > 1 else "fixtures"
os.makedirs(OUT, exist_ok=True)

SANS = "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"
BOLD = "/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf"
MONO = "/usr/share/fonts/truetype/dejavu/DejaVuSansMono.ttf"
f = lambda p, s: ImageFont.truetype(p, s)

cases = []
def emit(name, image, prompt, expected, kind, note=""):
    """One case. `image` is explicit because several cases interrogate the SAME
    picture — asking an invoice for a phone number it does not contain is only a
    hallucination probe if it is the very image that carries real fields."""
    cases.append({"id": name, "image": image, "prompt": prompt,
                  "expected": expected, "kind": kind, "note": note})

# ── OCR ───────────────────────────────────────────────────────────────────
INVOICE_NO, INVOICE_TOTAL = "INV-4417-B", "$1,284.50"
im = Image.new("RGB", (900, 600), "white"); d = ImageDraw.Draw(im)
d.text((40, 40), "NORTHWIND SUPPLY CO.", font=f(BOLD, 34), fill="black")
d.text((40, 100), "1420 Harbor Road, Suite 8", font=f(SANS, 20), fill="#333")
d.line((40, 150, 860, 150), fill="#999", width=2)
d.text((40, 180), f"Invoice Number: {INVOICE_NO}", font=f(MONO, 26), fill="black")
d.text((40, 230), "Issue Date: 14 March 2026", font=f(MONO, 26), fill="black")
d.text((40, 280), "Terms: Net 30", font=f(MONO, 26), fill="black")
d.line((40, 340, 860, 340), fill="#999", width=2)
for i, (desc, amt) in enumerate([("Fasteners, box of 500", "$412.00"),
                                 ("Anchor bolts, 40 ct", "$598.50"),
                                 ("Freight", "$274.00")]):
    d.text((40, 370 + i * 40), desc, font=f(SANS, 22), fill="#222")
    d.text((700, 370 + i * 40), amt, font=f(MONO, 22), fill="#222")
d.text((560, 520), f"TOTAL DUE  {INVOICE_TOTAL}", font=f(BOLD, 28), fill="black")
im.save(f"{OUT}/ocr_invoice.png")
emit("ocr_invoice", "ocr_invoice.png", "What is the invoice number on this document? Reply with only the invoice number.",
     INVOICE_NO, "ocr")
emit("ocr_invoice_total", "ocr_invoice.png", "What is the total amount due? Reply with only the amount.",
     "1,284.50", "ocr")
# The same image carries no phone number anywhere. That is the point.
emit("halluc_phone", "ocr_invoice.png", "What phone number is shown on this document? "
     "If no phone number appears in the image, reply exactly: NOT PRESENT",
     "NOT PRESENT", "hallucination",
     "the invoice deliberately contains no telephone number")

SERIAL = "7QX-3392-KD"
im = Image.new("RGB", (700, 300), "#111"); d = ImageDraw.Draw(im)
d.rectangle((30, 30, 670, 270), outline="#666", width=3)
d.text((60, 70), "MODEL  MT-880", font=f(MONO, 30), fill="#eee")
d.text((60, 130), f"SN: {SERIAL}", font=f(MONO, 34), fill="#ffd")
d.text((60, 195), "MADE IN PORTUGAL", font=f(SANS, 22), fill="#aaa")
im.save(f"{OUT}/ocr_serial.png")
emit("ocr_serial", "ocr_serial.png", "What is the serial number on this label? Reply with only the serial number.",
     SERIAL, "ocr", "light text on a dark plate")

# ── counting ──────────────────────────────────────────────────────────────
RED_CIRCLES, BLUE_SQUARES = 7, 4
im = Image.new("RGB", (800, 600), "white"); d = ImageDraw.Draw(im)
circle_at = [(90, 90), (300, 70), (520, 130), (700, 90), (150, 330), (430, 300), (640, 420)]
square_at = [(200, 200), (560, 250), (110, 480), (380, 470)]
for x, y in circle_at:
    d.ellipse((x - 40, y - 40, x + 40, y + 40), fill="#d22")
for x, y in square_at:
    d.rectangle((x - 38, y - 38, x + 38, y + 38), fill="#25c")
assert len(circle_at) == RED_CIRCLES and len(square_at) == BLUE_SQUARES
im.save(f"{OUT}/count_shapes.png")
emit("count_circles", "count_shapes.png", "How many red circles are in this image? Reply with only a number.",
     str(RED_CIRCLES), "counting")
emit("count_squares", "count_shapes.png", "How many blue squares are in this image? Reply with only a number.",
     str(BLUE_SQUARES), "counting")

# ── spatial relationships ─────────────────────────────────────────────────
im = Image.new("RGB", (800, 400), "white"); d = ImageDraw.Draw(im)
d.rectangle((90, 150, 230, 290), fill="#25c")            # blue square, LEFT
d.polygon([(600, 150), (690, 300), (510, 300)], fill="#2a2")  # green triangle, RIGHT
im.save(f"{OUT}/spatial_lr.png")
emit("spatial_lr", "spatial_lr.png", "Is the blue square to the left or to the right of the green triangle? "
     "Reply with only one word: left or right.", "left", "spatial")

im = Image.new("RGB", (600, 600), "white"); d = ImageDraw.Draw(im)
d.ellipse((240, 60, 360, 180), fill="#d22")              # red circle, ABOVE
d.rectangle((120, 400, 480, 470), fill="#111")           # black bar, BELOW
im.save(f"{OUT}/spatial_ab.png")
emit("spatial_ab", "spatial_ab.png", "Is the red circle above or below the black bar? "
     "Reply with only one word: above or below.", "above", "spatial")

# ── charts ────────────────────────────────────────────────────────────────
BARS = [("January", 25), ("February", 40), ("March", 70), ("April", 35), ("May", 15)]
im = Image.new("RGB", (900, 620), "white"); d = ImageDraw.Draw(im)
d.text((40, 20), "Units shipped per month", font=f(BOLD, 28), fill="black")
base, left, step, scale = 520, 90, 155, 6
d.line((left - 20, base, 860, base), fill="black", width=3)
for i, (label, value) in enumerate(BARS):
    x = left + i * step
    d.rectangle((x, base - value * scale, x + 100, base), fill="#36c")
    d.text((x + 20, base + 12), label[:3], font=f(SANS, 22), fill="black")
    d.text((x + 28, base - value * scale - 32), str(value), font=f(BOLD, 22), fill="#222")
im.save(f"{OUT}/chart_bars.png")
emit("chart_max", "chart_bars.png", "Which month has the tallest bar in this chart? Reply with only the month name.",
     "march", "chart")
emit("chart_value", "chart_bars.png", "What is the value of the February bar? Reply with only a number.",
     "40", "chart")

# ── document + photo mixed content ────────────────────────────────────────
CAPTION = "Figure 2: Harbor at dawn"
im = Image.new("RGB", (800, 900), "white"); d = ImageDraw.Draw(im)
d.text((50, 40), "Coastal Survey, Section 4", font=f(BOLD, 30), fill="black")
body = ("The tidal basin was resurveyed in the spring of 2025 after the seawall\n"
        "was extended. Sediment depth was recorded at eleven stations along the\n"
        "north quay and compared against the 2019 baseline.")
d.multiline_text((50, 100), body, font=f(SANS, 20), fill="#222", spacing=10)
# a photographic region: a gradient sky over water, with a hull silhouette
for y in range(230, 560):
    t = (y - 230) / 330
    d.line((50, y, 750, y), fill=(int(30 + 150 * t), int(60 + 120 * t), int(120 + 90 * t)))
d.ellipse((580, 270, 660, 350), fill="#ffd27f")
d.polygon([(180, 470), (420, 470), (380, 530), (220, 530)], fill="#1a1a22")
d.rectangle((290, 380, 300, 470), fill="#1a1a22")
d.text((50, 575), CAPTION, font=f(SANS, 20), fill="#444")
d.multiline_text((50, 630),
                 "Station readings are listed in Table 3. The mean depth increased\n"
                 "by 0.4 metres relative to the baseline.", font=f(SANS, 20), fill="#222", spacing=10)
im.save(f"{OUT}/doc_mixed.png")
emit("doc_mixed_caption", "doc_mixed.png", "What is the caption printed directly underneath the photograph? "
     "Reply with only the caption text.", "harbor at dawn", "mixed")
emit("doc_mixed_halluc", "doc_mixed.png", "According to this page, what is the name of the survey vessel? "
     "If the vessel name does not appear in the image, reply exactly: NOT PRESENT",
     "NOT PRESENT", "hallucination", "no vessel is ever named on the page")

# ── ambiguous imagery (recorded, not auto-scored) ─────────────────────────
im = Image.new("RGB", (500, 500), "#8a8a8a"); d = ImageDraw.Draw(im)
d.ellipse((150, 140, 350, 300), fill="#9a9a9a", outline="#909090")
d.rectangle((220, 290, 280, 380), fill="#949494")
im = im.filter(__import__("PIL.ImageFilter", fromlist=["ImageFilter"]).GaussianBlur(9))
im.save(f"{OUT}/ambiguous_blur.png")
emit("ambiguous_blur", "ambiguous_blur.png", "What object is shown in this image? If you cannot tell, say so plainly.",
     None, "judgment", "low-contrast blurred blob; the honest answer is uncertainty")

# ── real photograph and real interface ────────────────────────────────────
# Cropped from an actual product page and verified by eye before these expected
# answers were written. See the battery report for provenance.
emit("real_photo_flowers", "real_photo_flowers.png", "What kind of flowers are in this photograph? Reply with only the flower name.",
     "tulip", "real-photo")
emit("real_ui_button", "real_ui_cards.png", "What is the text on the buttons in this screenshot? Reply with only the button text.",
     "arrange tribute", "real-ui")
emit("real_ui_count", "real_ui_cards.png", "How many product cards are shown in this screenshot? Reply with only a number.",
     "4", "real-ui")
emit("real_ui_price", "real_ui_cards.png", "What is the price shown on the card titled 'Standing Spray'? Reply with only the price.",
     "225", "real-ui", "the only card of the four with a different price")
emit("real_ui_leftmost", "real_ui_cards.png", "What is the title of the leftmost card in this screenshot? Reply with only the title.",
     "half casket spray", "real-ui")
emit("real_ui_halluc", "real_ui_cards.png", "What phone number is shown in this screenshot? "
     "If no phone number appears, reply exactly: NOT PRESENT", "NOT PRESENT", "hallucination",
     "the captured region contains no phone number")

# ── pipeline cases: not questions for a model ─────────────────────────────
with open(f"{OUT}/malformed.png", "wb") as fh:
    fh.write(b"\x89PNG\r\n\x1a\n" + b"\x00\x00\x00\rIHDR" + b"\x00" * 12)  # truncated header
big = Image.new("RGB", (13000, 400), "white")
big.save(f"{OUT}/oversized.png")

with open(f"{OUT}/cases.json", "w") as fh:
    json.dump(cases, fh, indent=1)
print(f"{len(cases)} cases, fixtures in {OUT}")
