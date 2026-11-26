#!/usr/bin/env bash
# Optional: face-tracked video effects from github.com/Vibha-Ramprakash/claude-video-effects (MIT; models MIT/Apache-2.0,
# fonts OFL). Cloned at a REVIEWED commit into vendor/ (gitignored) — never copied into this repo — then its own setup
# creates a Python venv with numpy/opencv/pillow/mediapipe. Re-run safely; prints READY.
set -euo pipefail
cd "$(dirname "$0")/.."
REPO=https://github.com/Vibha-Ramprakash/claude-video-effects.git
COMMIT=60840ac   # reviewed: local-only (ffmpeg/ffprobe subprocesses), no network calls; its words.py (Whisper) is NOT used
DIR=vendor/claude-video-effects
if [ ! -d "$DIR/.git" ]; then git clone -q "$REPO" "$DIR"; fi
git -C "$DIR" fetch -q origin && git -C "$DIR" checkout -q "$COMMIT"
bash "$DIR/scripts/setup.sh"
