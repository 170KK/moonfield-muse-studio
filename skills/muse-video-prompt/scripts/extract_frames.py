#!/usr/bin/env python3
# MIT License
# Copyright (c) 2026 Mason Mosen
# Adapted from masonmosen/muse-video-prompt-skill (bin/extract_frames.py)
# https://github.com/masonmosen/muse-video-prompt-skill
"""抽帧自查：从视频中按时间均匀抽 N 帧，用于验证提示词是否被吃进。

用法: extract_frames.py <video> [n=4] [out_prefix]
输出: <out_prefix>-f1.png ... <out_prefix>-fN.png
"""
import os
import re
import shutil
import subprocess
import sys


def _resolve_ffmpeg() -> str:
    exe = shutil.which("ffmpeg")
    if exe:
        return exe
    try:
        import imageio_ffmpeg
        return imageio_ffmpeg.get_ffmpeg_exe()
    except Exception:
        return "ffmpeg"


def _probe_duration(video: str, ffmpeg_exe: str) -> float:
    ffprobe_exe = shutil.which("ffprobe")
    if ffprobe_exe:
        r = subprocess.run(
            [ffprobe_exe, "-v", "error", "-show_entries", "format=duration",
             "-of", "default=noprint_wrappers=1:nokey=1", video],
            capture_output=True, text=True, check=True,
        )
        return float(r.stdout.strip())
    r = subprocess.run(
        [ffmpeg_exe, "-i", video],
        capture_output=True, text=True, check=False,
    )
    m = re.search(r"Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)", r.stderr or "")
    if not m:
        raise RuntimeError(f"无法读取视频时长: {video}")
    return int(m.group(1)) * 3600 + int(m.group(2)) * 60 + float(m.group(3))


def main():
    if len(sys.argv) < 2:
        print("usage: extract_frames.py <video> [n=4] [out_prefix]")
        sys.exit(1)
    video = sys.argv[1]
    n = int(sys.argv[2]) if len(sys.argv) > 2 else 4
    prefix = sys.argv[3] if len(sys.argv) > 3 else os.path.splitext(os.path.basename(video))[0]

    ffmpeg_exe = _resolve_ffmpeg()
    dur = _probe_duration(video, ffmpeg_exe)
    out_dir = os.path.dirname(prefix)
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
    for i in range(n):
        t = dur * (i + 0.5) / n
        out = f"{prefix}-f{i + 1}.png"
        subprocess.run(
            [ffmpeg_exe, "-y", "-loglevel", "error", "-ss", str(t),
             "-i", video, "-vframes", "1", out],
            check=True,
        )
        print(out)


if __name__ == "__main__":
    main()
