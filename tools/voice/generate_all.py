#!/usr/bin/env python3
"""Generate, normalize and encode every Frost Story dialogue clip locally."""
from __future__ import annotations

import argparse
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import time


ROOT = Path(__file__).resolve().parents[2]
DEFAULT_AI_ROOT = Path("/Users/jacklee/develop/embedded/ai_speaker")


def runtime_executable(value: str) -> Path:
    """Return an absolute executable path without dereferencing a venv symlink."""
    return Path(os.path.abspath(os.path.expanduser(value)))


def usable_clip(path: Path, generated_after_ns: int = 0) -> bool:
    """Accept only a nontrivial Ogg created for the current voice manifest."""
    if not path.exists() or path.stat().st_size <= 1000 or path.stat().st_mtime_ns < generated_after_ns:
        return False
    with path.open("rb") as handle:
        return handle.read(4) == b"OggS"


def args() -> argparse.Namespace:
    parser = argparse.ArgumentParser()
    parser.add_argument("--manifest", default=str(ROOT / "tools/voice/voice-manifest.json"))
    parser.add_argument("--ai-root", default=os.getenv("AI_SPEAKER_ROOT", str(DEFAULT_AI_ROOT)))
    parser.add_argument("--melo-python", default=os.getenv("MELO_PYTHON", str(DEFAULT_AI_ROOT / ".venv-melo/bin/python")))
    parser.add_argument("--force", action="store_true")
    parser.add_argument("--limit", type=int)
    parser.add_argument("--match", help="Only generate clip IDs containing this text")
    return parser.parse_args()


def run() -> int:
    options = args()
    manifest_path = Path(options.manifest).expanduser().resolve()
    manifest = json.loads(manifest_path.read_text(encoding="utf-8"))
    manifest_generated_ns = manifest_path.stat().st_mtime_ns
    clips = manifest["clips"]
    if options.match:
        clips = [clip for clip in clips if options.match in clip["id"]]
    if options.limit:
        clips = clips[: options.limit]
    ai_root = Path(options.ai_root).expanduser().resolve()
    kokoro_python = ai_root / ".venv-tts/bin/python"
    kokoro_worker = ROOT / "tools/voice/kokoro_multilang_worker.py"
    # Resolving this symlink launches the base interpreter and silently drops
    # the virtualenv site-packages (including MeloTTS and soundfile).
    melo_python = runtime_executable(options.melo_python)
    melo_worker = ROOT / "tools/voice/melo_worker.py"
    if not kokoro_python.exists() or not kokoro_worker.exists():
        raise RuntimeError(f"Kokoro runtime is incomplete under {ai_root}")
    workers: dict[str, subprocess.Popen] = {}
    def get_worker(provider: str) -> subprocess.Popen:
        if provider in workers:
            return workers[provider]
        if provider == "kokoro":
            command = [str(kokoro_python), str(kokoro_worker)]
        elif provider == "melo":
            if not melo_python.exists():
                raise RuntimeError(f"MeloTTS runtime is missing: {melo_python}")
            command = [str(melo_python), str(melo_worker)]
        else:
            raise RuntimeError(f"unsupported voice provider: {provider}")
        worker_env = os.environ.copy()
        worker_env.setdefault("TOKENIZERS_PARALLELISM", "false")
        if provider == "melo":
            # Melo's high-dimensional constant padding currently falls back on
            # Apple MPS; CPU is faster and more deterministic for these clips.
            worker_env.setdefault("MELO_DEVICE", "cpu")
        workers[provider] = subprocess.Popen(command, cwd=ROOT, env=worker_env, text=True,
                                             stdin=subprocess.PIPE, stdout=subprocess.PIPE)
        return workers[provider]
    made = skipped = 0
    durations: list[float] = []
    started = time.perf_counter()
    try:
        for index, clip in enumerate(clips, 1):
            output = ROOT / "web" / clip["path"]
            if usable_clip(output, manifest_generated_ns) and not options.force:
                skipped += 1
                print(f"[{index}/{len(clips)}] skip {clip['id']}", flush=True)
                continue
            output.parent.mkdir(parents=True, exist_ok=True)
            with tempfile.NamedTemporaryFile(suffix=".wav", delete=False) as handle:
                wav = Path(handle.name)
            worker = get_worker(clip.get("provider", "kokoro"))
            payload = {
                "text": clip["spoken"], "output_file": str(wav),
                "voice": clip["voice"], "speed": clip["speed"],
                "lang_code": clip.get("langCode"), "language": clip.get("language"),
            }
            assert worker.stdin and worker.stdout
            worker.stdin.write(json.dumps(payload, ensure_ascii=False) + "\n")
            worker.stdin.flush()
            response = json.loads(worker.stdout.readline())
            if not response.get("ok"):
                raise RuntimeError(f"{clip['id']}: {response.get('error')}")
            durations.append(float(response.get("audio_seconds", 0)))
            filters: list[str] = []
            pitch = float(clip.get("pitch", 0) or 0)
            if clip.get("provider") == "melo" and abs(pitch) > 0.01:
                # MeloTTS-Korean ships one base speaker. A restrained,
                # duration-preserving pitch offset gives each story role a
                # recognizable register without cloning a real person's voice.
                factor = 2 ** (pitch / 12)
                filters.extend([f"asetrate=44100*{factor:.8f}", "aresample=44100", f"atempo={1 / factor:.8f}"])
            filters.extend(["highpass=f=65", "equalizer=f=6500:t=q:w=0.9:g=-1.2",
                            "loudnorm=I=-16:TP=-1.5:LRA=9", "afade=t=in:st=0:d=0.025",
                            "areverse", "afade=t=in:st=0:d=0.04", "areverse", "apad=pad_dur=0.06"])
            ffmpeg = [
                "ffmpeg", "-y", "-v", "error", "-i", str(wav),
                "-af", ",".join(filters),
                "-ar", "48000", "-ac", "1", "-c:a", "libopus", "-b:a", "48k",
                "-vbr", "on", "-application", "voip", str(output),
            ]
            try:
                subprocess.run(ffmpeg, check=True)
            finally:
                wav.unlink(missing_ok=True)
            made += 1
            print(f"[{index}/{len(clips)}] made {clip['id']} ({response.get('audio_seconds')}s)", flush=True)
    finally:
        for worker in workers.values():
            if worker.stdin:
                try:
                    worker.stdin.write("__quit__\n")
                    worker.stdin.flush()
                except BrokenPipeError:
                    pass
            worker.wait(timeout=20)
    seconds = round(time.perf_counter() - started, 1)
    print(json.dumps({"ok": True, "made": made, "skipped": skipped, "clips": len(clips),
                      "audio_seconds": round(sum(durations), 1), "wall_seconds": seconds}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    raise SystemExit(run())
