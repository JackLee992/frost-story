#!/usr/bin/env python3
"""Regression checks for the local multilingual voice generator."""
from __future__ import annotations

import importlib.util
import os
from pathlib import Path
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
SPEC = importlib.util.spec_from_file_location("voice_generator", ROOT / "tools/voice/generate_all.py")
assert SPEC and SPEC.loader
VOICE_GENERATOR = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(VOICE_GENERATOR)


class VoiceGeneratorPathTests(unittest.TestCase):
    def test_runtime_executable_preserves_virtualenv_symlink(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / "python-real"
            target.touch()
            venv_python = root / ".venv-melo/bin/python"
            venv_python.parent.mkdir(parents=True)
            venv_python.symlink_to(target)

            selected = VOICE_GENERATOR.runtime_executable(str(venv_python))

            self.assertEqual(selected, venv_python)
            self.assertNotEqual(selected, target)

    def test_existing_clip_is_reused_only_when_newer_than_manifest(self) -> None:
        with tempfile.TemporaryDirectory() as directory:
            clip = Path(directory) / "voice.ogg"
            clip.write_bytes(b"OggS" + b"\0" * 1_001)
            os.utime(clip, ns=(100, 100))

            self.assertTrue(VOICE_GENERATOR.usable_clip(clip, generated_after_ns=100))
            self.assertFalse(VOICE_GENERATOR.usable_clip(clip, generated_after_ns=101))


if __name__ == "__main__":
    unittest.main()
