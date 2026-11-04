#!/usr/bin/env python3
"""Remove image payloads from a DSH session.v4.jsonl.zstd (in place, with .bak).

Stop DeepSeek Harness Desktop BEFORE running this, or the host may rewrite the file.
"""
from __future__ import annotations

import json
import shutil
import sys
from pathlib import Path
from typing import Any

import zstandard as zstd

PLACEHOLDER = {"type": "text", "text": "（已删除的眼睛截图）"}


def strip_images(obj: Any) -> tuple[Any, int]:
    removed = 0
    if isinstance(obj, list):
        out = []
        for item in obj:
            cleaned, n = strip_images(item)
            removed += n
            out.append(cleaned)
        return out, removed
    if isinstance(obj, dict):
        # content block: { type: image, ... }
        if obj.get("type") == "image":
            return dict(PLACEHOLDER), 1
        out: dict[str, Any] = {}
        for k, v in obj.items():
            # Drop giant inline blobs that look like image data
            if isinstance(v, str) and k.lower() in {"data", "base64", "bytes"} and len(v) > 2000:
                out[k] = ""
                removed += 1
                continue
            cleaned, n = strip_images(v)
            removed += n
            out[k] = cleaned
        return out, removed
    return obj, 0


def main() -> int:
    if len(sys.argv) < 2:
        print("usage: scrub-session-images.py <session.v4.jsonl.zstd>")
        return 2
    path = Path(sys.argv[1])
    if not path.is_file():
        print(f"missing: {path}")
        return 1

    bak = path.with_suffix(path.suffix + ".bak")
    shutil.copy2(path, bak)
    print(f"backup -> {bak}")

    dctx = zstd.ZstdDecompressor()
    with path.open("rb") as f:
        with dctx.stream_reader(f) as reader:
            raw = reader.read()
    lines = raw.decode("utf-8", errors="replace").splitlines()

    total = 0
    out_lines: list[str] = []
    for line in lines:
        line = line.strip()
        if not line:
            continue
        try:
            obj = json.loads(line)
        except json.JSONDecodeError:
            out_lines.append(line)
            continue
        cleaned, n = strip_images(obj)
        total += n
        out_lines.append(json.dumps(cleaned, ensure_ascii=False, separators=(",", ":")))

    # Match DSH style: streaming zstd frame without content-size (oneshot compress breaks resume).
    payload = ("\n".join(out_lines) + "\n").encode("utf-8")
    cctx = zstd.ZstdCompressor(level=3, write_content_size=False)
    with path.open("wb") as f:
        with cctx.stream_writer(f) as writer:
            writer.write(payload)
    print(f"scrubbed image-ish blocks≈{total}")
    print(f"wrote {path} ({path.stat().st_size} bytes)")
    print("done. Restart DSH Desktop, open the session to verify.")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
