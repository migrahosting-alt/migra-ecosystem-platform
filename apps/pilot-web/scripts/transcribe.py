#!/usr/bin/env python3
"""Local speech-to-text worker for MigraPilot voice input.

Reads a 16kHz mono WAV path from argv[1], runs faster-whisper entirely on-device
(no cloud, no per-use cost), and prints {"text": "..."} as JSON on stdout.
The model (default base.en) is cached under ~/.cache/huggingface after first run.

🚨 LANGUAGE IS NOT HARDCODED ANY MORE, AND THE REASON MATTERS.

This worker used to pass language="en" unconditionally. Whisper forced to a language it is
not hearing does not produce obvious errors — it produces CONFIDENT, FLUENT TEXT FROM ITS
TRAINING DATA. Measured here: French speech saying "Bonjour, je voudrais un resume du
document." came back as "I hope you enjoyed this video and like and subscribe to my
channel." A user dictating in Haitian Creole would have had an English sentence they never
said placed in their message, with nothing to indicate it was invented.

So: an English-only model (name ending .en) still pins to English, but SAYS SO via
english_only, because it cannot detect anything else. A multilingual model auto-detects and
reports what it heard and how sure it was. Callers must refuse or confirm low-confidence
results rather than sending them — see PILOT_WHISPER_MIN_CONFIDENCE.

Env:
  PILOT_WHISPER_MODEL       whisper model size (tiny.en|base.en|large-v3|...) default base.en
  PILOT_WHISPER_DEVICE      cpu|cuda   default cpu
  PILOT_WHISPER_LANGUAGE    force a language code (e.g. ht, fr). Default: auto-detect on a
                            multilingual model, "en" on a .en model.
  PILOT_WHISPER_MIN_CONFIDENCE  below this detection probability the result is flagged
                            low_confidence (default 0.6). Haitian Creole needs a
                            multilingual model: base.en cannot produce it at all.
  PILOT_KREYOL_NORMALIZE    "0" disables Kreyòl orthographic post-processing (default on).

KREYÒL ORTHOGRAPHIC POST-PROCESSING.

Whisper transcribes Haitian Creole into a mix of French spellings and IPN 1979 spellings,
because that is what its training data looks like. Measured on the evaluation corpus: missing
accents dominate (fet -> fèt, korek -> korèk, chef -> chèf), then lost nasals and glides
(ansam -> ansanm, zami -> zanmi, radio -> radyo), then French graphemes (bas -> baz,
leglis -> legliz). Those are SPELLING errors on words the model heard correctly, and they are
mechanically repairable.

packages/kreyol-normalizer repairs them under one rule: a replacement is emitted only
when the candidate is attested in a frozen lexicon AND is the unique candidate AND the source
is not a proper name. Measured on a sealed holdout of 33 clips it never once damaged a token
that was already correct (precision 1.000, harm rate 0.000, WER 0.524 -> 0.481).

It is NOT a semantic repair and must never become one. If Whisper heard the wrong WORD, this
leaves it alone — a nicer-reading sentence that the speaker did not say is the exact failure
the language work in this file exists to prevent.

The raw ASR string is always returned alongside, never replaced.
"""
import json
import os
import sys

_model = None

_KREYOL = "ht"
# ONE copy, shared with services/speech-runtime. A second vendored copy per app is how two
# surfaces start disagreeing about what a speaker said.
_NORMALIZER_DIR = os.path.abspath(os.path.join(
    os.path.dirname(os.path.abspath(__file__)), "..", "..", "..",
    "packages", "kreyol-normalizer"))


def normalize_kreyol(text):
    """Return (text_to_present, normalization_record).

    FAILS OPEN ON PURPOSE. If the normalizer is missing or raises, the user still gets their
    transcript — an orthographic nicety must never be able to take down voice input. The
    record then says so explicitly rather than silently looking like "nothing to fix".
    """
    if os.environ.get("PILOT_KREYOL_NORMALIZE", "1") == "0":
        return text, {"applied": False, "skipped_reason": "disabled by PILOT_KREYOL_NORMALIZE=0"}
    if not text.strip():
        return text, {"applied": False, "skipped_reason": "empty transcript"}
    try:
        if _NORMALIZER_DIR not in sys.path:
            sys.path.insert(0, _NORMALIZER_DIR)
        import asr_normalizer

        out = asr_normalizer.normalize(text)
        return out["normalized_text"], {
            "applied": True,
            "engine": "kreyol-asr-orthographic-normalizer",
            "version": "v1",
            "language": _KREYOL,
            "raw_text": text,
            "changes": out["changes"],
        }
    except Exception as exc:  # noqa: BLE001 — never let post-processing break transcription
        return text, {"applied": False, "skipped_reason": "normalizer unavailable: %s" % exc}


def load_model():
    global _model
    if _model is None:
        from faster_whisper import WhisperModel

        name = os.environ.get("PILOT_WHISPER_MODEL", "base.en")
        device = os.environ.get("PILOT_WHISPER_DEVICE", "cpu")
        compute = "int8" if device == "cpu" else "float16"
        _model = WhisperModel(name, device=device, compute_type=compute)
    return _model


def main():
    if len(sys.argv) < 2:
        print(json.dumps({"error": "usage: transcribe.py <audio.wav>"}))
        sys.exit(2)
    audio_path = sys.argv[1]
    if not os.path.isfile(audio_path):
        print(json.dumps({"error": f"audio file not found: {audio_path}"}))
        sys.exit(2)
    try:
        model = load_model()
        model_name = os.environ.get("PILOT_WHISPER_MODEL", "base.en")
        english_only = model_name.endswith(".en")

        # An .en model can only ever produce English, so pinning it is honest. A
        # multilingual model must DETECT rather than be told, or it will hallucinate
        # fluently in the language it was forced into.
        # WHAT THE USER ASKED FOR vs WHAT THIS WORKER PINNED ARE DIFFERENT FACTS.
        # Only PILOT_WHISPER_LANGUAGE is a request. The "en" an .en model gets is this
        # worker's own default, and reporting it as a request let a caller conclude the
        # speaker had chosen English — which silently re-opened the fabrication hole the
        # language fix was meant to close.
        requested = os.environ.get("PILOT_WHISPER_LANGUAGE") or None
        forced = requested or ("en" if english_only else None)

        segments, info = model.transcribe(
            audio_path,
            language=forced,
            beam_size=1,
            vad_filter=True,
            condition_on_previous_text=False,
        )
        text = "".join(seg.text for seg in segments).strip()

        # Orthographic cleanup applies to Kreyòl ONLY, and only when the model could
        # actually have produced Kreyòl. An .en build reporting "en" is reporting its own
        # pin, not a detection, so it can never route here.
        effective_language = forced or (None if english_only else info.language)
        if (not english_only) and effective_language == _KREYOL:
            text, normalization = normalize_kreyol(text)
        else:
            normalization = {"applied": False,
                             "skipped_reason": "language is %s, not %s"
                                               % (effective_language or "undetected", _KREYOL)}

        probability = float(getattr(info, "language_probability", 0.0) or 0.0)
        threshold = float(os.environ.get("PILOT_WHISPER_MIN_CONFIDENCE", "0.6"))
        # english_only pins the answer, so its "probability" describes nothing; never let
        # it read as a confident detection.
        low_confidence = (not english_only) and (not forced) and probability < threshold

        print(json.dumps({
            "text": text,
            "language": info.language,
            "language_probability": round(probability, 3),
            "model": model_name,
            # True => this transcript is only meaningful if the speaker was speaking English.
            "english_only": english_only,
            "forced_language": forced,
            "requested_language": requested,
            "low_confidence": low_confidence,
            # The transcript as the ASR produced it, before any orthographic cleanup. Kept
            # unconditionally: a caller must always be able to see what was actually heard.
            "raw_text": normalization.get("raw_text", text),
            "normalization": normalization,
        }, ensure_ascii=False))
    except Exception as exc:  # noqa: BLE001 — worker surfaces any failure to the caller
        print(json.dumps({"error": str(exc)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
