#!/usr/bin/env python3
"""
The vision qualification battery.

WHAT A PASS HERE MEANS. Every scored case has one literal correct answer that was
fixed before the model saw the image, so grading is a comparison against a known
value rather than a search for encouraging words in prose. Cases that cannot be
scored that way are marked `judgment` and are RECORDED, never counted — a battery
that quietly scores its own opinion is not evidence.

WHY A SECOND MODEL RUNS THE SAME CASES. A score in isolation says nothing about
whether it is good. The comparison model answers the identical prompts against the
identical images, so "qualified" means "measured against an alternative", not
"passed a bar drawn after seeing the result".

DETERMINISM. Sampling is pinned to temperature 0, which is how a production
extraction path would run it. Repeated-run variance at temperature 0 is therefore
a finding about the model and the runtime, not about sampling.

TWO MEASUREMENT TRAPS THIS AVOIDS, BOTH HIT ON THE FIRST RUN.

Baseline VRAM was read while a model from an earlier smoke test was still
resident, so peak-over-baseline came out as "+5 MiB" for a 7B model. Every model
is now unloaded and the runtime given time to release before the baseline is
taken.

Latency was reported as a 0.13s median, which is a prompt-cache measurement, not
an inference one: the repeat loop re-sends an identical prompt and image, and
consecutive cases share a fixture. Latency is now reported for the FIRST time
each distinct image is seen — what a user sending a new picture actually waits —
with warm repeats reported separately rather than blended in.
"""

import base64
import json
import os
import statistics
import subprocess
import sys
import threading
import time
import urllib.request

FIXTURES = sys.argv[1]
OUT = sys.argv[2]
MODELS = sys.argv[3].split(",")
REPEATS = int(os.environ.get("REPEATS", "3"))
OLLAMA = os.environ.get("OLLAMA_URL", "http://127.0.0.1:11434")

cases = json.load(open(f"{FIXTURES}/cases.json"))
scored = [c for c in cases if c["kind"] != "judgment"]
judgment = [c for c in cases if c["kind"] == "judgment"]

# Answers that are the same fact in different words. Kept here, beside the
# battery, so widening acceptance is a visible edit and not a quiet regrade.
ALSO_ACCEPT = {
    "chart_max": ["mar"],            # the axis is labelled Jan/Feb/Mar
    "real_photo_flowers": ["tulips"],
    "ocr_invoice_total": ["1284.50"],
}


def normalise(text):
    return " ".join(str(text).lower().replace("’", "'").split()).strip(" .!\"'")


def grade(case, answer):
    """True/False for scored cases. Hallucination probes are graded differently:
    the ONLY correct behaviour is declining, so an answer that also volunteers a
    plausible value is a failure even though it contains the right words."""
    a = normalise(answer)
    if case["kind"] == "hallucination":
        return a.startswith("not present") or a == "not present"
    accepted = [case["expected"]] + ALSO_ACCEPT.get(case["id"], [])
    return any(normalise(x) in a for x in accepted)


def vram_mib():
    try:
        out = subprocess.run(
            ["nvidia-smi", "--query-gpu=memory.used", "--format=csv,noheader,nounits"],
            capture_output=True, text=True, timeout=5)
        return int(out.stdout.strip().splitlines()[0])
    except Exception:
        return None


class VramWatch(threading.Thread):
    """Peak VRAM is the number that decides whether a model fits beside the rest
    of the stack; an average would hide the moment it does not."""

    def __init__(self):
        super().__init__(daemon=True)
        self.peak = 0
        self.stop = threading.Event()

    def run(self):
        while not self.stop.wait(0.25):
            v = vram_mib()
            if v and v > self.peak:
                self.peak = v


def ask(model, prompt, image_path, keep_alive="5m"):
    with open(image_path, "rb") as fh:
        b64 = base64.b64encode(fh.read()).decode()
    body = json.dumps({
        "model": model, "prompt": prompt, "images": [b64], "stream": False,
        "keep_alive": keep_alive,
        "options": {"temperature": 0, "seed": 7, "num_predict": 160},
    }).encode()
    req = urllib.request.Request(f"{OLLAMA}/api/generate", data=body,
                                 headers={"content-type": "application/json"})
    started = time.time()
    with urllib.request.urlopen(req, timeout=300) as resp:
        payload = json.load(resp)
    return payload.get("response", "").strip(), time.time() - started


def unload(model):
    """Evict the weights. `keep_alive: 0` is the runtime's own eviction signal;
    without it the next model's baseline includes this one."""
    try:
        ask(model, "hi", f"{FIXTURES}/ocr_serial.png", keep_alive="0s")
    except Exception:
        pass


def settle_baseline(models, label):
    """Unload everything and wait for the allocator to actually give memory back.
    A baseline taken a moment too early makes a 7B model look like it costs 5 MiB."""
    for m in models:
        unload(m)
    for _ in range(20):
        time.sleep(1)
        v = vram_mib()
        if v is not None and v < 6000:
            break
    print(f"# baseline VRAM ({label}): {v} MiB", flush=True)
    return v


results = {}
baseline_vram = settle_baseline(MODELS, "before any model loads")

for model in MODELS:
    print(f"\n# ── {model} " + "─" * 40, flush=True)
    settle_baseline(MODELS, f"before {model}")
    watch = VramWatch()
    watch.start()
    per_case = {}
    cold_latency = None
    seen_images = set()
    first_touch = {}     # image -> seconds, the honest "a new picture arrived" cost
    warm = []            # every repeat of an already-seen prompt+image

    for rep in range(REPEATS):
        for case in cases:
            path = f"{FIXTURES}/{case['image']}"
            try:
                answer, secs = ask(model, case["prompt"], path)
                err = None
            except Exception as exc:                     # a refusal to answer is data
                answer, secs, err = "", 0.0, f"{type(exc).__name__}: {exc}"
            if cold_latency is None:
                cold_latency = secs                      # first call carries the model load
            elif case["image"] not in seen_images:
                first_touch[case["image"]] = secs
            else:
                warm.append(secs)
            seen_images.add(case["image"])
            rec = per_case.setdefault(case["id"], {"answers": [], "latencies": [], "errors": []})
            rec["answers"].append(answer)
            rec["latencies"].append(secs)
            if err:
                rec["errors"].append(err)
            if rep == 0:
                ok = "—" if case["kind"] == "judgment" else ("ok  " if grade(case, answer) else "MISS")
                print(f"  {ok} {case['id']:22} {secs:5.1f}s  {answer[:64]!r}", flush=True)

    watch.stop.set()
    watch.join(timeout=2)

    graded = []
    for case in scored:
        rec = per_case[case["id"]]
        passes = [grade(case, a) for a in rec["answers"]]
        graded.append({
            "id": case["id"], "kind": case["kind"], "expected": case["expected"],
            "answers": rec["answers"],
            "passed_runs": sum(passes), "runs": len(passes),
            "stable": len(set(normalise(a) for a in rec["answers"])) == 1,
            "median_latency_s": round(statistics.median(rec["latencies"]), 2),
            "errors": rec["errors"],
        })

    fresh = [v for v in first_touch.values() if v > 0]
    warm_only = [v for v in warm if v > 0]
    med = lambda xs: round(statistics.median(xs), 2) if xs else None
    results[model] = {
        "cases": graded,
        "judgment": [{"id": c["id"], "prompt": c["prompt"], "note": c["note"],
                      "answers": per_case[c["id"]]["answers"]} for c in judgment],
        "peak_vram_mib": watch.peak,
        "vram_over_baseline_mib": (watch.peak - baseline_vram) if watch.peak else None,
        "cold_start_latency_s": round(cold_latency or 0, 2),
        "new_image_latency_median_s": med(fresh),
        "new_image_latency_max_s": round(max(fresh), 2) if fresh else None,
        "warm_repeat_latency_median_s": med(warm_only),
        "repeats": REPEATS,
    }
    unload(model)
    time.sleep(3)

# ── summary ───────────────────────────────────────────────────────────────
print("\n" + "=" * 74)
for model, r in results.items():
    total = sum(c["runs"] for c in r["cases"])
    won = sum(c["passed_runs"] for c in r["cases"])
    every_run = sum(1 for c in r["cases"] if c["passed_runs"] == c["runs"])
    unstable = [c["id"] for c in r["cases"] if not c["stable"]]
    halluc = [c for c in r["cases"] if c["kind"] == "hallucination"]
    print(f"{model}")
    print(f"  scored answers      {won}/{total} ({100*won/total:.0f}%)")
    print(f"  cases passing EVERY run  {every_run}/{len(r['cases'])}")
    print(f"  hallucination probes declined  "
          f"{sum(c['passed_runs'] for c in halluc)}/{sum(c['runs'] for c in halluc)}")
    print(f"  unstable across runs  {unstable or 'none'}")
    print(f"  latency: cold start {r['cold_start_latency_s']}s | "
          f"new image median {r['new_image_latency_median_s']}s "
          f"(max {r['new_image_latency_max_s']}s) | "
          f"warm repeat median {r['warm_repeat_latency_median_s']}s")
    print(f"  peak VRAM {r['peak_vram_mib']} MiB (+{r['vram_over_baseline_mib']} over baseline)")

os.makedirs(os.path.dirname(OUT) or ".", exist_ok=True)
json.dump({"baseline_vram_mib": baseline_vram, "models": results,
           "case_count": len(cases), "scored_count": len(scored)},
          open(OUT, "w"), indent=1)
print(f"\nraw results → {OUT}")
