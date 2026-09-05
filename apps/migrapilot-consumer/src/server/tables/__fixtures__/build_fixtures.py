#!/usr/bin/env python3
"""Build the .xlsx acceptance fixtures.

Deliberately written with python's zipfile so the bytes under test come from an
implementation other than the reader being tested.
"""
import pathlib
import sys
import zipfile

F = pathlib.Path(sys.argv[1])
F.mkdir(parents=True, exist_ok=True)

CT = ('<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
      '<Default Extension="xml" ContentType="application/xml"/>'
      '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
      '</Types>')
RELS = ('<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>'
        '</Relationships>')
# style 0 general, 1 currency, 2 percent, 3 date
STYLES = ('<?xml version="1.0"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
          '<numFmts count="3">'
          '<numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0.00"/>'
          '<numFmt numFmtId="165" formatCode="0.00%"/>'
          '<numFmt numFmtId="166" formatCode="yyyy-mm-dd"/>'
          '</numFmts>'
          '<cellXfs count="4">'
          '<xf numFmtId="0"/><xf numFmtId="164" applyNumberFormat="1"/>'
          '<xf numFmtId="165" applyNumberFormat="1"/><xf numFmtId="166" applyNumberFormat="1"/>'
          '</cellXfs></styleSheet>')


def workbook_xml(names):
    parts = "".join(
        '<sheet name="%s" sheetId="%d" r:id="rId%d"/>' % (n, i + 1, i + 1)
        for i, n in enumerate(names)
    )
    return ('<?xml version="1.0"?><workbook '
            'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" '
            'xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">'
            '<sheets>%s</sheets></workbook>' % parts)


def workbook_rels(count):
    parts = "".join(
        '<Relationship Id="rId%d" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet%d.xml"/>'
        % (i + 1, i + 1)
        for i in range(count)
    )
    return ('<?xml version="1.0"?><Relationships '
            'xmlns="http://schemas.openxmlformats.org/package/2006/relationships">%s</Relationships>' % parts)


def build(name, sheets, shared):
    """sheets: list of (sheet_name, rows_xml)."""
    with zipfile.ZipFile(F / name, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", CT)
        z.writestr("_rels/.rels", RELS)
        z.writestr("xl/workbook.xml", workbook_xml([n for n, _ in sheets]))
        z.writestr("xl/_rels/workbook.xml.rels", workbook_rels(len(sheets)))
        items = "".join("<si><t>%s</t></si>" % v for v in shared)
        z.writestr("xl/sharedStrings.xml",
                   '<?xml version="1.0"?><sst xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" count="%d">%s</sst>'
                   % (len(shared), items))
        z.writestr("xl/styles.xml", STYLES)
        for i, (_, rows) in enumerate(sheets):
            z.writestr("xl/worksheets/sheet%d.xml" % (i + 1),
                       '<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">'
                       '<sheetData>%s</sheetData></worksheet>' % rows)


def row(n, cells):
    return '<row r="%d">%s</row>' % (n, "".join(cells))


def s(ref, idx):
    """shared-string cell"""
    return '<c r="%s" t="s"><v>%d</v></c>' % (ref, idx)


def n(ref, value, style=None):
    """numeric cell"""
    st = ' s="%d"' % style if style is not None else ""
    return '<c r="%s"%s><v>%s</v></c>' % (ref, st, value)


def f(ref, formula, cached, style=None):
    st = ' s="%d"' % style if style is not None else ""
    return '<c r="%s"%s><f>%s</f><v>%s</v></c>' % (ref, st, formula, cached)


def blank(ref):
    return '<c r="%s"/>' % ref


COL = "ABCDEFGH"

# ── the matrix workbook: mirrors the CSV matrix's sales.csv shape ──────────
# Region | Revenue($) | Margin(%) | Units | ZipCode | ORDERID | Booked(date)
shared = ["Region", "Revenue", "Margin", "Units", "ZipCode", "ORDERID", "Booked",
          "North", "South", "East", "West"]
DATA = [
    # region_idx, revenue, margin, units, zip, orderid, booked-serial
    (7, "100000", "0.1275", "40", "10001", "4821", "46264"),
    (8, "156500", "-0.0325", "62", "33101", "4822", "46265"),
    (9, "156250", None,     "55", "44601", "4823", "46266"),
    (10, "61250", "0.0810", "18", "45034", "4824", "46267"),
]
rows = row(1, [s("A1", 0), s("B1", 1), s("C1", 2), s("D1", 3), s("E1", 4), s("F1", 5), s("G1", 6)])
for i, (region, rev, margin, units, zipc, oid, booked) in enumerate(DATA, start=2):
    cells = [s("A%d" % i, region), n("B%d" % i, rev, 1)]
    cells.append(n("C%d" % i, margin, 2) if margin is not None else blank("C%d" % i))
    cells += [n("D%d" % i, units), n("E%d" % i, zipc), n("F%d" % i, oid), n("G%d" % i, booked, 3)]
    rows += row(i, cells)
build("matrix_sales.xlsx", [("Sales", rows)], shared)

# ── ambiguous: two quantitative columns, neither named ────────────────────
amb_shared = ["Item", "Revenue", "Cost", "A", "B", "C"]
amb = row(1, [s("A1", 0), s("B1", 1), s("C1", 2)])
for i, (item, rev, cost) in enumerate([(3, "100", "40"), (4, "200", "90"), (5, "300", "120")], start=2):
    amb += row(i, [s("A%d" % i, item), n("B%d" % i, rev), n("C%d" % i, cost)])
build("matrix_ambiguous.xlsx", [("Data", amb)], amb_shared)

# ── multi-sheet with DIFFERENT totals, to catch a silent substitution ─────
ms_shared = ["Item", "Amount", "Widget", "Gadget"]
q1 = row(1, [s("A1", 0), s("B1", 1)]) + row(2, [s("A2", 2), n("B2", "10")]) + row(3, [s("A3", 3), n("B3", "20")])
q2 = row(1, [s("A1", 0), s("B1", 1)]) + row(2, [s("A2", 2), n("B2", "300")]) + row(3, [s("A3", 3), n("B3", "400")])
build("matrix_multisheet.xlsx", [("Q1", q1), ("Q2", q2)], ms_shared)

# ── formulas with cached results ─────────────────────────────────────────
fm_shared = ["Item", "Amount", "A", "B", "Total"]
fm = row(1, [s("A1", 0), s("B1", 1)])
fm += row(2, [s("A2", 2), n("B2", "7")])
fm += row(3, [s("A3", 3), n("B3", "8")])
fm += row(4, [s("A4", 4), f("B4", "SUM(B2:B3)", "15")])
build("matrix_formula.xlsx", [("Calc", fm)], fm_shared)

# ── large workbook: 5,000 data rows ──────────────────────────────────────
lg_shared = ["Id", "Amount"]
lg = row(1, [s("A1", 0), s("B1", 1)])
total = 0
for i in range(2, 5002):
    v = (i * 7) % 1000
    total += v
    lg += row(i, [n("A%d" % i, str(i)), n("B%d" % i, str(v))])
build("matrix_large.xlsx", [("Big", lg)], lg_shared)
print("large workbook Amount total =", total)

# ── malformed: a zip that is not a workbook ──────────────────────────────
with zipfile.ZipFile(F / "matrix_notaworkbook.xlsx", "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr("hello.txt", "not a workbook")

# ── unsupported: macro-enabled package ───────────────────────────────────
with zipfile.ZipFile(F / "matrix_macro.xlsx", "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr("[Content_Types].xml", CT)
    z.writestr("_rels/.rels", RELS)
    z.writestr("xl/workbook.xml", workbook_xml(["S"]))
    z.writestr("xl/_rels/workbook.xml.rels", workbook_rels(1))
    z.writestr("xl/vbaProject.bin", b"\x00\x01macro")

for p in sorted(F.glob("matrix_*.xlsx")):
    print("  %-30s %d bytes" % (p.name, p.stat().st_size))
