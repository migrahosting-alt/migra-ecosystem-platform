// Gate: the Kreyòl orthographic normalizer shipping in the voice path is still the one that
// was qualified.
//
// WHY THIS IS IN pilot:verify AND NOT A SIDE SCRIPT. The normalizer edits a user's own words
// before they are shown back as a transcript. Its licence to do that is a sealed-holdout
// measurement — precision 1.000, harm rate 0.000 on 94 clips — and that measurement describes
// ONE exact version of the code. An edit that improved recall a little and damaged one token
// in fifty would still read as a sensible diff, still pass tsc, and quietly invalidate the
// numbers the feature was approved on. Only replaying the qualified vectors catches it.
//
// Spawns the same interpreter the transcription route uses, so a machine where voice input
// works and a machine where this gate runs cannot diverge. The module under test is the
// SHARED packages/kreyol-normalizer — the same bytes services/speech-runtime loads, so this
// one gate covers both surfaces.

import { spawnSync } from "node:child_process";
import path from "node:path";

const python = process.env.PILOT_PYTHON || "python3";
const script = path.join(process.cwd(), "..", "..", "packages", "kreyol-normalizer",
  "verify_normalizer.py");

const r = spawnSync(python, [script], { stdio: "inherit", env: process.env });

if (r.error?.code === "ENOENT") {
  // NOT a skip. The voice path itself shells out to this interpreter — if it is missing,
  // transcription is broken, and reporting "gate skipped" would hide that behind a green run.
  console.error(`\nFAIL — ${python} not found. The transcription worker needs it too, so this ` +
    `is a broken voice pipeline, not an absent optional dependency.`);
  process.exit(1);
}
process.exit(r.status ?? 1);
