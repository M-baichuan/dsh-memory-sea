#!/usr/bin/env python3
"""Local camera eye for Memory Sea.

Bind 127.0.0.1 only. Bridge calls GET /snapshot → JPEG base64.

Env:
  EYE_HOST=127.0.0.1
  EYE_PORT=8790
  EYE_CAMERA=0
  EYE_MAX_SIDE=1280
  EYE_JPEG_QUALITY=85
  EYE_WARMUP_FRAMES=5
"""
from __future__ import annotations

import base64
import json
import os
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from urllib.parse import parse_qs, urlparse

import cv2

HOST = os.environ.get("EYE_HOST", "127.0.0.1")
PORT = int(os.environ.get("EYE_PORT", "8790"))
CAMERA = int(os.environ.get("EYE_CAMERA", "0"))
MAX_SIDE = int(os.environ.get("EYE_MAX_SIDE", "1280"))
JPEG_QUALITY = int(os.environ.get("EYE_JPEG_QUALITY", "85"))
WARMUP = int(os.environ.get("EYE_WARMUP_FRAMES", "5"))

_lock = threading.Lock()


def _resize(frame):
    h, w = frame.shape[:2]
    side = max(h, w)
    if side <= MAX_SIDE:
        return frame
    scale = MAX_SIDE / float(side)
    return cv2.resize(frame, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)


def capture_jpeg(camera_index: int | None = None) -> tuple[bytes, int, int]:
    idx = CAMERA if camera_index is None else camera_index
    with _lock:
        cap = cv2.VideoCapture(idx, cv2.CAP_DSHOW)
        if not cap.isOpened():
            cap.release()
            cap = cv2.VideoCapture(idx)
        if not cap.isOpened():
            raise RuntimeError(f"无法打开摄像头 index={idx}（检查权限/是否被占用）")
        try:
            # Warm-up: first frames are often black / bad exposure.
            frame = None
            for _ in range(max(1, WARMUP)):
                ok, frame = cap.read()
                if not ok:
                    time.sleep(0.05)
            if frame is None:
                raise RuntimeError("摄像头读帧失败")
            ok, frame = cap.read()
            if not ok or frame is None:
                raise RuntimeError("摄像头抓帧失败")
            frame = _resize(frame)
            h, w = frame.shape[:2]
            ok, buf = cv2.imencode(
                ".jpg",
                frame,
                [int(cv2.IMWRITE_JPEG_QUALITY), max(40, min(95, JPEG_QUALITY))],
            )
            if not ok:
                raise RuntimeError("JPEG 编码失败")
            return buf.tobytes(), w, h
        finally:
            cap.release()


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt: str, *args) -> None:  # quieter
        print(f"[eye] {self.address_string()} {fmt % args}")

    def _json(self, code: int, payload: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self) -> None:  # noqa: N802
        parsed = urlparse(self.path)
        if parsed.path in ("/", "/health"):
            self._json(200, {"ok": True, "camera": CAMERA, "host": HOST, "port": PORT})
            return
        if parsed.path != "/snapshot":
            self._json(404, {"ok": False, "error": "not found"})
            return
        qs = parse_qs(parsed.query or "")
        cam = qs.get("camera", [None])[0]
        try:
            camera_index = int(cam) if cam is not None else None
        except ValueError:
            self._json(400, {"ok": False, "error": "camera must be int"})
            return
        try:
            jpeg, w, h = capture_jpeg(camera_index)
            self._json(
                200,
                {
                    "ok": True,
                    "mediaType": "image/jpeg",
                    "base64": base64.b64encode(jpeg).decode("ascii"),
                    "width": w,
                    "height": h,
                    "bytes": len(jpeg),
                    "ts": time.strftime("%Y-%m-%dT%H:%M:%S"),
                },
            )
        except Exception as err:  # noqa: BLE001
            self._json(500, {"ok": False, "error": str(err)})


def main() -> None:
    if HOST not in ("127.0.0.1", "localhost", "::1"):
        raise SystemExit("拒绝绑定非本机地址（隐私）。请用 EYE_HOST=127.0.0.1")
    httpd = ThreadingHTTPServer((HOST, PORT), Handler)
    print(f"[eye] listening http://{HOST}:{PORT}  camera={CAMERA}")
    print("[eye] GET /health  GET /snapshot")
    httpd.serve_forever()


if __name__ == "__main__":
    main()
