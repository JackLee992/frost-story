#!/usr/bin/env python3
"""Long-lived JSONL MeloTTS worker for the Korean offline voice pack."""
from __future__ import annotations

import json
from contextlib import redirect_stdout
import copy
import os
from pathlib import Path
import sys
import time
import traceback
import types

import soundfile as sf

# MeloTTS eagerly imports every language cleaner. On a case-insensitive macOS
# filesystem the Japanese `MeCab` and Korean `mecab` wheels occupy the same
# package directory and cannot coexist. This worker is intentionally Korean-
# only, so install a small lazy cleaner module before importing the public API.
from melo import text as melo_text
from melo.text import korean

def korean_get_bert(value, word2ph, language, device):
    if language != "KR":
        raise ValueError(f"Korean worker cannot encode {language}")
    return korean.get_bert_feature(value, word2ph, device=device)
melo_text.get_bert = korean_get_bert

cleaner = types.ModuleType("melo.text.cleaner")
def clean_text(value, language):
    if language != "KR":
        raise ValueError(f"Korean worker cannot clean {language}")
    normalized = korean.text_normalize(value)
    phones, tones, word2ph = korean.g2p(normalized)
    return normalized, phones, tones, word2ph
def clean_text_bert(value, language, device=None):
    normalized, phones, tones, word2ph = clean_text(value, language)
    doubled = copy.deepcopy(word2ph)
    for index in range(len(doubled)):
        doubled[index] *= 2
    doubled[0] += 1
    bert = korean.get_bert_feature(normalized, doubled, device=device)
    return normalized, phones, tones, word2ph, bert
def text_to_sequence(value, language):
    normalized, phones, tones, _ = clean_text(value, language)
    return melo_text.cleaned_text_to_sequence(phones, tones, language)
cleaner.clean_text = clean_text
cleaner.clean_text_bert = clean_text_bert
cleaner.text_to_sequence = text_to_sequence
sys.modules["melo.text.cleaner"] = cleaner

from melo.api import TTS


MODELS: dict[str, TTS] = {}


def synthesize(payload: dict) -> dict:
    started = time.perf_counter()
    text = str(payload.get("text", "")).strip()
    output_file = str(payload.get("output_file", "")).strip()
    language = str(payload.get("language") or "KR")
    speed = float(payload.get("speed") or 1.0)
    device = str(payload.get("device") or os.getenv("MELO_DEVICE", "auto"))
    if not text or not output_file:
        raise ValueError("text and output_file are required")
    if language not in MODELS:
        with redirect_stdout(sys.stderr):
            MODELS[language] = TTS(language=language, device=device)
    model = MODELS[language]
    speakers = dict(model.hps.data.spk2id)
    requested = str(payload.get("voice") or language)
    speaker_id = speakers.get(requested, next(iter(speakers.values())))
    path = Path(output_file)
    path.parent.mkdir(parents=True, exist_ok=True)
    with redirect_stdout(sys.stderr):
        model.tts_to_file(text, speaker_id, str(path), speed=speed, quiet=True)
    info = sf.info(str(path))
    return {"ok": True, "speaker": requested, "audio_seconds": round(info.duration, 3),
            "wall_seconds": round(time.perf_counter() - started, 3)}


def main() -> int:
    print("[frost-melo-worker] ready", file=sys.stderr, flush=True)
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
