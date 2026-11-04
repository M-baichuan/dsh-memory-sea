#!/usr/bin/env python3
"""Scan a DSH session.v4.jsonl.zstd for image-bearing lines."""
from __future__ import annotations

import sys
from pathlib import Path

import zstandard as zstd


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: scan-session-images.py <session.v4.jsonl.zstd>")
        return 2
    p = Path(sys.argv[1])
    dctx = zstd.ZstdDecompressor()
    with p.open("rb") as f:
        with dctx.stream_reader(f) as reader:
            data = reader.read()
    text = data.decode("utf-8", errors="replace")
    lines = text.splitlines()
    print(f"lines={len(lines)} bytes={len(data)}")
    hits = 0
    for i, line in enumerate(lines):
        low = line.lower()
        if (
            "mediatype" in low
            or '"type":"image"' in low
            or '"type": "image"' in low
            or "image/jpeg" in low
            or "image/png" in low
            or "base64" in low and "image" in low
        ):
            hits += 1
            print(f"hit line={i} len={len(line)}")
            print(line[:240])
            print("---")
    print(f"hits={hits}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
