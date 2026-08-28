"""Speaking an answer aloud.

Lives beside the ASR runtime on purpose: same process, same auth, same capability
seam. A second service would have meant a second secret, a second unit and a
second thing to forget to start.

WHAT THE PRODUCT SEES, AND WHAT IT MUST NOT
-------------------------------------------
🚨 Engine names are PRIVATE ROUTING METADATA. A user picks a *voice* — "Warm",
"Bright", "Steady" — and never learns which synthesiser produced it. The mapping
below is the only place the two vocabularies meet, which is what makes the engine
replaceable without touching the product.

ENGINE CHOICE (measured 2026-08-27, CPU only, both free for commercial use)
--------------------------------------------------------------------------
Kokoro (Apache-2.0) is PRIMARY, chosen on voice quality. It costs about a second
to first audio and ~2 GB resident, against Piper's ~120 ms and 358 MB — and those
are hardware-scale costs a real deployment absorbs, not reasons to ship a worse
voice.

Piper (MIT) is the FALLBACK: dramatically lighter, and the route when Kokoro is
unavailable or fails. Falling back is recorded with a reason, internally. The user
hears a voice; they are never told which engine lost.

Neither touches the GPU, so speaking an answer never competes with vision.
"""

from __future__ import annotations

import base64
import io
import json
import os
import re
import subprocess
import tempfile
import threading
import time
import wave

# Sentence splitting matters more than it looks: synthesising a whole answer as
# one block measured 9,978 ms to first audio, and per sentence 1,243 ms. Same
# engine, same text — only the unit of work changed.
_SENTENCE = re.compile(r"(?<=[.!?…])\s+")

# A ceiling on what will be spoken in one request. Not a quality decision: an
# unbounded answer would hold the runtime for minutes and the caller has no way
# to cancel it yet.
MAX_CHARS = int(os.environ.get("SPEECH_TTS_MAX_CHARS", "4000"))

PIPER_VOICE_PATH = os.environ.get(
    "SPEECH_PIPER_VOICE",
    os.path.join(os.path.dirname(__file__), "voices", "en_US-lessac-medium.onnx"),
)

# ── the only place voices and engines meet ──────────────────────────────────
#
# `id` is the product's vocabulary and is safe to show. Everything else is
# internal. Adding an engine means editing this table and nothing else.
VOICES: dict[str, dict] = {
    "warm":   {"label": "Warm",   "kokoro": "af_heart",   "lang": "a"},
    "bright": {"label": "Bright", "kokoro": "af_bella",   "lang": "a"},
    "steady": {"label": "Steady", "kokoro": "am_michael", "lang": "a"},
}
DEFAULT_VOICE = "warm"

_kokoro = None
_kokoro_error: str | None = None
_piper = None
_piper_error: str | None = None
_load_lock = threading.Lock()


def _load_kokoro():
    """Load once, lazily. Import cost is real (~5.5 s) and must not delay ASR
    startup, which is the runtime's other job."""
    global _kokoro, _kokoro_error
    if _kokoro is not None or _kokoro_error is not None:
        return _kokoro
    with _load_lock:
        if _kokoro is not None or _kokoro_error is not None:
            return _kokoro
        try:
            # Kokoro's bundled espeak loader points at the path it was BUILT on,
            # which exists on no deployed machine. Redirected before import or
            # phonemisation dies with an error that reads like a model fault.
            import espeakng_loader

            lib = os.environ.get("SPEECH_ESPEAK_LIB", "/usr/lib/x86_64-linux-gnu/libespeak-ng.so.1")
            data = os.environ.get("SPEECH_ESPEAK_DATA", "/usr/lib/x86_64-linux-gnu/espeak-ng-data")
            if os.path.exists(lib) and os.path.isdir(data):
                espeakng_loader.get_library_path = lambda: lib
                espeakng_loader.get_data_path = lambda: data
                from phonemizer.backend.espeak.wrapper import EspeakWrapper

                EspeakWrapper.set_library(lib)
                EspeakWrapper.set_data_path(data)

            import torch
            from kokoro import KPipeline

            torch.set_num_threads(int(os.environ.get("SPEECH_TTS_THREADS", "4")))
            _kokoro = KPipeline(lang_code="a", device="cpu")
        except Exception as exc:  # noqa: BLE001
            _kokoro_error = f"{type(exc).__name__}: {exc}"
    return _kokoro


def _load_piper():
    global _piper, _piper_error
    if _piper is not None or _piper_error is not None:
        return _piper
    with _load_lock:
        if _piper is not None or _piper_error is not None:
            return _piper
        try:
            if not os.path.exists(PIPER_VOICE_PATH):
                raise FileNotFoundError(f"no piper voice at {PIPER_VOICE_PATH}")
            from piper import PiperVoice

            _piper = PiperVoice.load(PIPER_VOICE_PATH)
        except Exception as exc:  # noqa: BLE001
            _piper_error = f"{type(exc).__name__}: {exc}"
    return _piper


def _wav_bytes(samples, rate: int) -> bytes:
    import numpy as np

    pcm = (np.clip(samples, -1.0, 1.0) * 32767).astype("<i2").tobytes()
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(pcm)
    return buf.getvalue()


def _to_mp3(wav: bytes) -> tuple[bytes, str]:
    """Compress for transport. A 45-second answer is ~2 MB as WAV and ~350 KB as
    MP3, and it crosses a tailnet plus two services before reaching a browser.
    Falls back to WAV rather than failing the whole request if ffmpeg is absent —
    the user gets audio either way."""
    try:
        with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as f:
            f.write(wav)
            src = f.name
        dst = src + ".mp3"
        subprocess.run(
            ["ffmpeg", "-y", "-loglevel", "error", "-i", src, "-codec:a", "libmp3lame", "-b:a", "64k", dst],
            check=True, timeout=120,
        )
        data = open(dst, "rb").read()
        os.unlink(src)
        os.unlink(dst)
        return data, "audio/mpeg"
    except Exception:  # noqa: BLE001
        return wav, "audio/wav"


def _kokoro_synth(text: str, voice: str) -> tuple[bytes, int]:
    import numpy as np

    pipe = _load_kokoro()
    if pipe is None:
        raise RuntimeError(_kokoro_error or "kokoro unavailable")
    split = "\n".join(s.strip() for s in _SENTENCE.split(text) if s.strip())
    parts = [a for _g, _p, a in pipe(split, voice=voice)]
    if not parts:
        raise RuntimeError("kokoro produced no audio")
    return _wav_bytes(np.concatenate(parts), 24000), 24000


def _piper_synth(text: str) -> tuple[bytes, int]:
    voice = _load_piper()
    if voice is None:
        raise RuntimeError(_piper_error or "piper unavailable")
    frames = bytearray()
    rate = 22050
    for chunk in voice.synthesize(text):
        frames.extend(chunk.audio_int16_bytes)
        rate = chunk.sample_rate
    if not frames:
        raise RuntimeError("piper produced no audio")
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(rate)
        w.writeframes(bytes(frames))
    return buf.getvalue(), rate


def warm_up() -> None:
    """Load the synthesiser in the background at startup.

    🚨 Without this the FIRST person to press Read aloud after any restart pays
    the model load — measured at ~5.5 s — on top of their synthesis, and
    experiences the product as far slower than it is. That is a bad number to
    judge a voice by, and it is entirely avoidable: the load happens once and
    nothing is waiting on it here.

    Deliberately silent about failure. A synthesiser that cannot load must not
    stop the ASR service from starting; `synthesis_capability` and the first real
    request will both report the problem honestly when asked.
    """
    def _load() -> None:
        started = time.time()
        engine = "kokoro" if _load_kokoro() is not None else ("piper" if _load_piper() is not None else None)
        print(json.dumps({"event": "tts.warm", "engine": engine,
                          "ms": int((time.time() - started) * 1000),
                          **({"error": _kokoro_error} if engine != "kokoro" and _kokoro_error else {})}),
              flush=True)
    threading.Thread(target=_load, name="tts-warmup", daemon=True).start()


def synthesis_capability() -> dict:
    """What this runtime can speak, without loading anything.

    Reports readiness as *configured*, not as proven — the engines load on first
    use. Claiming ready here would be the same lie the ASR capability refuses to
    tell, so the wording is about what is installed.
    """
    import importlib.util as u

    kokoro_installed = u.find_spec("kokoro") is not None
    piper_installed = u.find_spec("piper") is not None
    voices = [{"id": k, "label": v["label"]} for k, v in VOICES.items()]
    if not kokoro_installed and not piper_installed:
        return {"ready": False, "voices": [],
                "unavailableReason": "No speech synthesis engine is installed on this runtime."}
    return {
        "ready": True,
        "voices": voices,
        "defaultVoice": DEFAULT_VOICE,
        "maxChars": MAX_CHARS,
        # Internal only. The Brain strips this before the product sees it.
        "_engines": {"primary": "kokoro" if kokoro_installed else "piper",
                     "fallback": "piper" if piper_installed else None},
    }


def synthesize(text: str, voice_id: str | None) -> dict:
    """Speak `text` in `voice_id`.

    Tries the primary engine, falls back to the secondary, and records WHY it
    fell back. The caller gets audio and a provenance record; the user gets
    audio and no engine names at all.
    """
    text = (text or "").strip()
    if not text:
        raise ValueError("text is empty")
    if len(text) > MAX_CHARS:
        raise ValueError(f"text exceeds {MAX_CHARS} characters")

    chosen = voice_id if voice_id in VOICES else DEFAULT_VOICE
    started = time.time()
    fallback_reason: str | None = None

    try:
        wav, rate = _kokoro_synth(text, VOICES[chosen]["kokoro"])
        engine = "kokoro"
    except Exception as exc:  # noqa: BLE001
        # Recorded, never surfaced as branding. "The warm voice was unavailable
        # so you got a different engine" is not something a user can act on.
        fallback_reason = f"{type(exc).__name__}: {exc}"[:200]
        wav, rate = _piper_synth(text)
        engine = "piper"

    audio, mime = _to_mp3(wav)
    frames = len(wav) - 44
    return {
        "audioBase64": base64.b64encode(audio).decode("ascii"),
        "mimeType": mime,
        "durationSec": round(max(frames, 0) / 2 / rate, 2),
        "voice": chosen,
        "synthesisMs": int((time.time() - started) * 1000),
        # Provenance for us, stripped before the product.
        "_engine": engine,
        **({"_fallbackReason": fallback_reason} if fallback_reason else {}),
    }
