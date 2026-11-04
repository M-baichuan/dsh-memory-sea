#!/usr/bin/env python3
"""Synthesize speech with edge-tts → write mp3 to --out path."""
from __future__ import annotations

import argparse
import asyncio
import sys


async def main() -> int:
    parser = argparse.ArgumentParser()
    parser.add_argument("--text", required=True)
    parser.add_argument("--voice", default="zh-CN-XiaoyiNeural")
    parser.add_argument("--out", required=True)
    parser.add_argument("--rate", default="+0%")
    parser.add_argument("--pitch", default="+0Hz")
    args = parser.parse_args()

    text = (args.text or "").strip()
    if not text:
        print("empty text", file=sys.stderr)
        return 2
    # Keep QQ voice bubbles short
    if len(text) > 120:
        text = text[:120]

    try:
        import edge_tts
    except ImportError:
        print("missing edge-tts; pip install -r scripts/tts/requirements.txt", file=sys.stderr)
        return 3

    voices = [args.voice]
    # Fallbacks when a Neural voice is unavailable / returns no audio
    for alt in ("zh-CN-XiaoxiaoNeural", "zh-CN-XiaoyiNeural", "zh-CN-YunxiNeural"):
        if alt not in voices:
            voices.append(alt)

    last_err: Exception | None = None
    for voice in voices:
        try:
            communicate = edge_tts.Communicate(text, voice, rate=args.rate, pitch=args.pitch)
            await communicate.save(args.out)
            if voice != args.voice:
                print(f"fallback voice={voice}", file=sys.stderr)
            return 0
        except Exception as err:  # noqa: BLE001 — try next voice
            last_err = err
            continue
    print(last_err or "tts failed", file=sys.stderr)
    return 1


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
