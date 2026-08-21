#!/usr/bin/env python3
"""MigraPilot speech runtime — a RESIDENT faster-whisper service.

WHY THIS EXISTS. The Brain owns the ASR capability and delegates to a runtime named by
MIGRAPILOT_SPEECH_RUNTIME_URL. Until now the only implementation spawned python per request,
so the model reloaded every single call: measured at ~18.5 s per short clip, which is
unusable for dictation. This loads the model ONCE at startup and keeps it resident.

Standard library only, on purpose. This runs on owned hardware and must not depend on a pip
install succeeding on the box; faster-whisper and ctranslate2 are the only third-party
imports, and they are the thing being served.

THREE LANGUAGE FIELDS, NEVER COLLAPSED:
  requestedLanguage  what the CALLER explicitly asked for; absent unless they did
  forcedLanguage     what the decoder was actually told to assume; null means free to detect
  language           what the model DETECTED; null when it cannot detect at all
Collapsing requested and forced once already disabled the fabrication guard — French audio
came back as fluent invented English marked safe to send.
"""
from __future__ import annotations

import base64
import json
import os
import subprocess
import sys
import tempfile
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

MODEL_NAME = os.environ.get("SPEECH_MODEL", "large-v3")
DEVICE = os.environ.get("SPEECH_DEVICE", "auto")
COMPUTE = os.environ.get("SPEECH_COMPUTE", "")
HOST = os.environ.get("SPEECH_HOST", "127.0.0.1")
PORT = int(os.environ.get("SPEECH_PORT", "4600"))
MAX_AUDIO_BYTES = int(os.environ.get("SPEECH_MAX_AUDIO_BYTES", str(25 * 1024 * 1024)))
# Colon-separated directories holding libcublas.so.12 / libcudnn*.so.9. CTranslate2 dlopens
# them lazily, so a missing lib does NOT surface when the model is constructed — it surfaces
# on the first transcription, which is far too late to be honest about readiness. A
# production deployment should install CUDA properly; this exists so a box that already has
# the libs in a venv can serve without repackaging them.
CUDA_LIB_DIRS = [d for d in os.environ.get("SPEECH_CUDA_LIBS", "").split(":") if d]

# Languages this deployment is willing to CLAIM. Whisper knows ~99; claiming all of them
# would invite a surface to offer a language nobody has ever qualified. Haitian Creole is
# listed because the multilingual model genuinely supports it — that is an infrastructure
# fact, not a quality result, and the qualification gate is separate.
CLAIMED_LANGUAGES = [
    l.strip() for l in os.environ.get("SPEECH_LANGUAGES", "en,fr,es,ht").split(",") if l.strip()
]

_english_only = MODEL_NAME.endswith(".en")
_model = None
_model_error: str | None = None
_device_used = "unknown"
# CTranslate2 releases the GIL and parallelises internally; one transcription at a time
# keeps VRAM predictable and avoids two large decodes fighting over the card.
_lock = threading.Lock()


def _preload_cuda_libs() -> None:
    """Pull the CUDA libraries into this process before CTranslate2 needs them.

    LD_LIBRARY_PATH is read by the dynamic linker at exec, so setting it from inside the
    process is too late. Loading them with RTLD_GLOBAL puts them in the namespace that the
    later dlopen resolves against, which does work.
    """
    if not CUDA_LIB_DIRS:
        return
    import ctypes
    import glob

    for directory in CUDA_LIB_DIRS:
        for pattern in ("libcublas.so.12", "libcublasLt.so.12", "libcudnn*.so.9"):
            for path in sorted(glob.glob(os.path.join(directory, "**", pattern), recursive=True)):
                try:
                    ctypes.CDLL(path, mode=ctypes.RTLD_GLOBAL)
                except OSError:
                    pass


def _resolve_device() -> tuple[str, str]:
    if DEVICE != "auto":
        return DEVICE, (COMPUTE or ("float16" if DEVICE == "cuda" else "int8"))
    try:
        import ctranslate2

        if ctranslate2.get_cuda_device_count() > 0:
            return "cuda", (COMPUTE or "float16")
    except Exception:  # noqa: BLE001 — any failure means fall back to CPU, honestly
        pass
    return "cpu", (COMPUTE or "int8")


def _silent_wav(seconds: float = 0.4) -> str:
    """A tiny real WAV, so the warmup exercises the actual decode path."""
    import struct
    import wave

    fd, path = tempfile.mkstemp(suffix="-warmup.wav")
    os.close(fd)
    frames = int(16000 * seconds)
    with wave.open(path, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(16000)
        w.writeframes(struct.pack("<%dh" % frames, *([0] * frames)))
    return path


def _try_load(device: str, compute: str) -> str | None:
    """Load AND PROVE. Returns None on success, or the failure reason."""
    global _model, _device_used
    from faster_whisper import WhisperModel

    started = time.time()
    model = WhisperModel(MODEL_NAME, device=device, compute_type=compute)

    # READINESS IS PROVEN, NOT ASSUMED. Constructing the model succeeds even when the CUDA
    # libraries it will need are absent — CTranslate2 dlopens them lazily, so the first real
    # request is where "libcublas.so.12 is not found" appears. This runtime reported
    # ready:true in exactly that state, which is the same class of over-claim the whole
    # transcription contract exists to prevent. So: transcribe something before saying yes.
    warmup = _silent_wav()
    try:
        segments, _info = model.transcribe(warmup, beam_size=1, vad_filter=False)
        list(segments)  # the generator is where the kernels actually run
    finally:
        try:
            os.unlink(warmup)
        except OSError:
            pass

    _model = model
    _device_used = device
    print(
        json.dumps({
            "event": "model.ready", "model": MODEL_NAME, "device": device,
            "compute": compute, "seconds": round(time.time() - started, 1),
        }),
        flush=True,
    )
    return None


def load_model() -> None:
    """Load once, at startup. A failure is RECORDED, not raised: the service still answers
    /capability so a caller learns it is unavailable and why, instead of getting a dead
    socket it has to interpret."""
    global _model_error
    _preload_cuda_libs()
    device, compute = _resolve_device()

    try:
        _try_load(device, compute)
        return
    except Exception as exc:  # noqa: BLE001
        first = f"{type(exc).__name__}: {exc}"
        print(json.dumps({"event": "model.failed", "device": device, "error": first}), flush=True)

    if device != "cpu":
        # Degrade to CPU rather than serve nothing — but SAY SO. `device` is reported in the
        # capability, so a caller can see it is running slow rather than guessing.
        try:
            _try_load("cpu", COMPUTE or "int8")
            print(json.dumps({"event": "model.degraded", "from": device, "to": "cpu"}), flush=True)
            return
        except Exception as exc:  # noqa: BLE001
            _model_error = f"{type(exc).__name__}: {exc}"
    else:
        _model_error = first
    print(json.dumps({"event": "model.unavailable", "error": _model_error}), flush=True)


def capability() -> dict:
    if _model is None:
        return {
            "ready": False,
            "model": None,
            "multilingual": False,
            "supportedLanguages": [],
            "unavailableReason": _model_error or "The speech model has not finished loading.",
        }
    return {
        "ready": True,
        "model": MODEL_NAME,
        "multilingual": not _english_only,
        # An English-only build must never claim a language it cannot produce.
        "supportedLanguages": ["en"] if _english_only else CLAIMED_LANGUAGES,
        "device": _device_used,
    }


def to_wav16k(data: bytes) -> str:
    """Normalise to what whisper wants. Input and output paths must differ — they collided
    once for .wav uploads and ffmpeg refused to overwrite its own input."""
    with tempfile.NamedTemporaryFile(delete=False, suffix=".in") as src:
        src.write(data)
        in_path = src.name
    out_path = in_path + "-16k.wav"
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-i", in_path, "-ar", "16000", "-ac", "1", "-f", "wav", out_path],
        check=True, timeout=120,
    )
    os.unlink(in_path)
    return out_path


def transcribe(data: bytes, requested: str | None) -> dict:
    if _model is None:
        return {"error": _model_error or "model not loaded"}

    wav = to_wav16k(data)
    try:
        # An .en model can only be English, so it is pinned whether or not anyone asked —
        # and that pin is reported as `forcedLanguage`, never as the caller's request.
        forced = requested or ("en" if _english_only else None)
        with _lock:
            segments, info = _model.transcribe(
                wav, language=forced, beam_size=1, vad_filter=True, condition_on_previous_text=False,
            )
            text = "".join(seg.text for seg in segments).strip()
        return {
            "text": text,
            # A pinned language is not a detection. Saying otherwise is the same lie in a
            # different field.
            "language": None if _english_only else getattr(info, "language", None),
            "languageProbability": None if _english_only else float(getattr(info, "language_probability", 0.0) or 0.0),
            "model": MODEL_NAME,
            "englishOnly": _english_only,
            "requestedLanguage": requested,
            "forcedLanguage": forced,
        }
    finally:
        try:
            os.unlink(wav)
        except OSError:
            pass


class Handler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _send(self, code: int, body: dict) -> None:
        payload = json.dumps(body).encode()
        self.send_response(code)
        self.send_header("content-type", "application/json")
        self.send_header("content-length", str(len(payload)))
        self.end_headers()
        self.wfile.write(payload)

    def log_message(self, fmt, *args):  # noqa: A003 — quieter, structured logs above
        return

    def do_GET(self):  # noqa: N802
        if self.path == "/capability":
            return self._send(200, capability())
        if self.path == "/health":
            return self._send(200, {"ok": _model is not None})
        self._send(404, {"error": "not found"})

    def do_POST(self):  # noqa: N802
        if self.path != "/transcribe":
            return self._send(404, {"error": "not found"})
        length = int(self.headers.get("content-length") or 0)
        if length <= 0:
            return self._send(400, {"error": "empty body"})
        try:
            body = json.loads(self.rfile.read(length))
        except Exception:  # noqa: BLE001
            return self._send(400, {"error": "invalid JSON body"})

        audio_b64 = body.get("audio")
        if not isinstance(audio_b64, str) or not audio_b64:
            return self._send(400, {"error": "audio must be a non-empty base64 string"})
        try:
            data = base64.b64decode(audio_b64, validate=True)
        except Exception:  # noqa: BLE001
            return self._send(400, {"error": "audio is not valid base64"})
        if len(data) > MAX_AUDIO_BYTES:
            return self._send(413, {"error": "audio is too large"})

        requested = body.get("requestedLanguage")
        if requested is not None and not isinstance(requested, str):
            return self._send(400, {"error": "requestedLanguage must be a string"})

        try:
            return self._send(200, transcribe(data, requested))
        except subprocess.CalledProcessError:
            return self._send(400, {"error": "the audio could not be decoded"})
        except Exception as exc:  # noqa: BLE001
            return self._send(500, {"error": f"{type(exc).__name__}: {exc}"})


def main() -> None:
    load_model()
    server = ThreadingHTTPServer((HOST, PORT), Handler)
    print(json.dumps({"event": "listening", "host": HOST, "port": PORT, "ready": _model is not None}), flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        server.shutdown()


if __name__ == "__main__":
    sys.exit(main())
