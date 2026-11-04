#!/usr/bin/env python3
"""Diagnose DSH session.v4.jsonl.zstd framing. Usage: python check-session-zstd.py <path>"""
from __future__ import annotations

import sys
from pathlib import Path

import zstandard as zstd


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: check-session-zstd.py <session.v4.jsonl.zstd>")
        return 2
    p = Path(sys.argv[1])
    b = Path(str(p) + ".bak")
    print("now", p.exists(), p.stat().st_size if p.exists() else None)
    print("bak", b.exists(), b.stat().st_size if b.exists() else None)

    for name, path in [("now", p), ("bak", b)]:
        if not path.exists():
            continue
        data = path.read_bytes()
        print(name, "head", data[:8].hex())
        try:
            dctx = zstd.ZstdDecompressor()
            with path.open("rb") as f:
                with dctx.stream_reader(f) as r:
                    out = r.read()
            print(name, "stream_ok", len(out))
        except Exception as e:
            print(name, "stream_fail", e)
        try:
            out2 = zstd.ZstdDecompressor().decompress(data)
            print(name, "oneshot_ok", len(out2))
        except Exception as e:
            print(name, "oneshot_fail", type(e).__name__, str(e)[:120])
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
