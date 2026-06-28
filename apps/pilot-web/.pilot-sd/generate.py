#!/usr/bin/env python3
"""MigraPilot local text-to-image worker (Stable Diffusion via diffusers).
Called by the image.generate tool. Prints a JSON line on success."""
import argparse
import json
import os

import torch
from diffusers import AutoPipelineForText2Image

# Cache the loaded pipeline across calls within a single process (not across calls
# from the tool, which spawns a fresh process — a persistent server is a future upgrade).
_PIPE = None


def load(model: str):
    global _PIPE
    if _PIPE is None:
        device = "cuda" if torch.cuda.is_available() else "cpu"
        dtype = torch.float16 if device == "cuda" else torch.float32
        pipe = AutoPipelineForText2Image.from_pretrained(model, torch_dtype=dtype)
        _PIPE = pipe.to(device)
    return _PIPE


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--prompt", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--model", default="stabilityai/sd-turbo")
    ap.add_argument("--steps", type=int, default=2)
    ap.add_argument("--width", type=int, default=512)
    ap.add_argument("--height", type=int, default=512)
    args = ap.parse_args()

    pipe = load(args.model)
    # sd-turbo / *-turbo models use guidance_scale=0.0 and very few steps.
    image = pipe(
        prompt=args.prompt,
        num_inference_steps=max(1, args.steps),
        guidance_scale=0.0,
        width=args.width,
        height=args.height,
    ).images[0]

    os.makedirs(os.path.dirname(os.path.abspath(args.out)), exist_ok=True)
    image.save(args.out)
    print(json.dumps({"ok": True, "out": args.out, "device": "cuda" if torch.cuda.is_available() else "cpu"}))


if __name__ == "__main__":
    main()
