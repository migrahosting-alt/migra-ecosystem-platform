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
"""
import json
import os
import sys

_model = None


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
        forced = os.environ.get("PILOT_WHISPER_LANGUAGE") or ("en" if english_only else None)

        segments, info = model.transcribe(
            audio_path,
            language=forced,
            beam_size=1,
            vad_filter=True,
            condition_on_previous_text=False,
        )
        text = "".join(seg.text for seg in segments).strip()

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
            "low_confidence": low_confidence,
        }, ensure_ascii=False))
    except Exception as exc:  # noqa: BLE001 — worker surfaces any failure to the caller
        print(json.dumps({"error": str(exc)}))
        sys.exit(1)


if __name__ == "__main__":
    main()
