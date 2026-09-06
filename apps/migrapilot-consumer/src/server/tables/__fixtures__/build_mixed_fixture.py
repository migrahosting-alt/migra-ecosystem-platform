"""
matrix_mixed.xlsx — a column where SCARCITY is genuinely the refusal reason.

🚨 THE SHAPE MATTERS, and my first attempt got it wrong. A column of one number
plus four BLANKS is not scarce: blanks are excluded from the ratio, so of the
values actually present 100% are quantities, and the column is legitimately
summable. Totalling it gives that one number, correctly.

"Too few to total" is reachable only for a MIXED column — mostly text with a few
numbers — where the values present are not overwhelmingly quantities. Here
"Readings" holds one number among four text entries, so it is not quantitative
and scarcity IS the true cause. This is the negative half of the refusal-cause
fix: the date column stopped saying "too few" because that was never why it was
refused, and this column must keep saying it because that is exactly why.
"""
import sys, pathlib
sys.argv = [sys.argv[0], str(pathlib.Path(__file__).parent)]

src = (pathlib.Path(__file__).parent / "build_fixtures.py").read_text()
ns = {}
exec(compile(src.split("# ---", 1)[0] if "# ---" in src else src, "build_fixtures.py", "exec"), ns)
build, row, s, n, blank = ns["build"], ns["row"], ns["s"], ns["n"], ns["blank"]

shared = ["Site", "Readings", "North", "South", "East", "West", "Central",
          "pending", "not taken", "sensor offline", "awaiting calibration"]
idx = {v: i for i, v in enumerate(shared)}

rows = [row(1, [s("A1", idx["Site"]), s("B1", idx["Readings"])])]
data = [("North", 42), ("South", "pending"), ("East", "not taken"),
        ("West", "sensor offline"), ("Central", "awaiting calibration")]
for r, (site, val) in enumerate(data, start=2):
    cells = [s(f"A{r}", idx[site])]
    cells.append(n(f"B{r}", val) if isinstance(val, int) else s(f"B{r}", idx[val]))
    rows.append(row(r, cells))

build("matrix_mixed.xlsx", [("Readings", rows)], shared)
print("wrote matrix_mixed.xlsx — Readings: 1 number among 4 text values")
