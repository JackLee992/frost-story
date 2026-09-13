#!/usr/bin/env python3
"""Long-lived JSONL Kokoro worker with one cached pipeline per language."""
from __future__ import annotations

import json
import os
from pathlib import Path
import sys
import time
import traceback

import numpy as np
import soundfile as sf
from kokoro import KPipeline


PIPELINES: dict[tuple[str, str], KPipeline] = {}
SAMPLE_RATE = 24000


def synthesize(payload: dict) -> dict:
    started = time.perf_counter()
    text = str(payload.get("text", "")).strip()
    output_file = str(payload.get("output_file", "")).strip()
    repo_id = str(payload.get("repo_id") or os.getenv("KOKORO_REPO_ID", "hexgrad/Kokoro-82M"))
    lang_code = str(payload.get("lang_code") or "z")
    voice = str(payload.get("voice") or "zf_xiaoxiao")
    speed = float(payload.get("speed") or 1.0)
    if not text or not output_file:
        raise ValueError("text and output_file are required")
    key = (repo_id, lang_code)
    if key not in PIPELINES:
        PIPELINES[key] = KPipeline(lang_code=lang_code, repo_id=repo_id)
    chunks = [audio for _, _, audio in PIPELINES[key](text, voice=voice, speed=speed)]
    if not chunks:
        raise RuntimeError("Kokoro generated no audio")
    audio = np.concatenate(chunks) if len(chunks) > 1 else chunks[0]
    path = Path(output_file)
    path.parent.mkdir(parents=True, exist_ok=True)
    sf.write(str(path), audio, SAMPLE_RATE)
    return {"ok": True, "audio_seconds": round(len(audio) / SAMPLE_RATE, 3),
            "wall_seconds": round(time.perf_counter() - started, 3)}


def main() -> int:
    print("[frost-kokoro-worker] ready", file=sys.stderr, flush=True)
    for raw in sys.stdin:
        raw = raw.strip()
        if not raw:
            continue
        if raw == "__quit__":
            return 0
        try:
            result = synthesize(json.loads(raw))
        except Exception as exc:
            traceback.print_exc(file=sys.stderr)
            result = {"ok": False, "error": str(exc)}
        print(json.dumps(result, ensure_ascii=False), flush=True)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
