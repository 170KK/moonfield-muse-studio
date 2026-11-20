#!/usr/bin/env python3
"""Muse Studio 连续镜头抽帧与接缝 PSNR (>= 25 dB) 自动验收脚本。

基于 masonmosen/muse-video-prompt-skill (MIT, Copyright (c) 2026 Mason Mosen) 抽帧思路，
适配月域画布（尾帧接力 + 多段连续镜头）：
1. 每段按时间均匀抽取 3 帧（f1/f2/f3）用于核对吃进项与偏差项。
2. 段交界 ±1 秒抽帧（前段末帧前 1s / 末帧，后段首帧 / 首帧后 1s）。
3. 计算相邻段接缝首末帧 RGB24 PSNR（验收阈值 >= 25.0 dB）。
"""
from __future__ import annotations

import argparse
import json
import math
import os
import subprocess
import sys
from pathlib import Path

from PIL import Image

from extract_frames import _probe_duration, _resolve_ffmpeg


def _extract_at(ffmpeg_exe: str, video: str, t_sec: float, out_path: Path) -> Path:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [ffmpeg_exe, "-y", "-loglevel", "error", "-ss", f"{max(0.0, t_sec):.3f}",
         "-i", video, "-vframes", "1", str(out_path)],
        check=True,
    )
    return out_path


def _extract_exact_last(ffmpeg_exe: str, video: str, dur: float, out_path: Path) -> Path:
    out_path.parent.mkdir(parents=True, exist_ok=True)
    r = subprocess.run(
        [ffmpeg_exe, "-y", "-loglevel", "error", "-sseof", "-0.08",
         "-i", video, "-fps_mode", "passthrough", "-frames:v", "1", "-update", "1", str(out_path)],
        check=False,
    )
    if r.returncode != 0 or not out_path.exists() or out_path.stat().st_size == 0:
        _extract_at(ffmpeg_exe, video, max(0.0, dur - 0.1), out_path)
    return out_path


def compute_psnr_db(img_a_path: Path, img_b_path: Path) -> tuple[float | None, tuple[int, int], tuple[int, int]]:
    with Image.open(img_a_path) as im_a, Image.open(img_b_path) as im_b:
        rgb_a = im_a.convert("RGB")
        rgb_b = im_b.convert("RGB")
        size_a, size_b = rgb_a.size, rgb_b.size
        if size_a != size_b:
            rgb_b = rgb_b.resize(size_a, Image.Resampling.BILINEAR)
        bytes_a = rgb_a.tobytes()
        bytes_b = rgb_b.tobytes()
        sq = sum((x - y) ** 2 for x, y in zip(bytes_a, bytes_b))
        if sq == 0:
            return None, size_a, size_b
        mse = sq / len(bytes_a)
        return round(10.0 * math.log10((255.0 ** 2) / mse), 3), size_a, size_b


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("videos", nargs="+", help="Ordered segment video files (S01.mp4 S02.mp4 ...)")
    parser.add_argument("--out-dir", required=True, help="Output directory for extracted frames and report.json")
    parser.add_argument("--psnr-threshold", type=float, default=25.0)
    args = parser.parse_args()

    ffmpeg_exe = _resolve_ffmpeg()
    out_dir = Path(args.out_dir)
    out_dir.mkdir(parents=True, exist_ok=True)

    segments_info = []
    for idx, video in enumerate(args.videos, start=1):
        seg_id = f"S{idx:02d}"
        dur = _probe_duration(video, ffmpeg_exe)
        seg_dir = out_dir / seg_id

        # 1. 每段均匀 3 帧
        mid_frames = []
        for fi in range(3):
            t = dur * (fi + 0.5) / 3.0
            fp = _extract_at(ffmpeg_exe, video, t, seg_dir / f"{seg_id}-f{fi + 1}.png")
            mid_frames.append({"frame": fp.name, "time_s": round(t, 2), "path": str(fp)})

        # 2. 边界 ±1s + 首帧/末帧
        first_p = _extract_at(ffmpeg_exe, video, 0.0, seg_dir / f"{seg_id}-first.png")
        plus1_p = _extract_at(ffmpeg_exe, video, min(dur - 0.1, 1.0), seg_dir / f"{seg_id}-plus1s.png")
        minus1_p = _extract_at(ffmpeg_exe, video, max(0.0, dur - 1.0), seg_dir / f"{seg_id}-minus1s.png")
        last_p = _extract_exact_last(ffmpeg_exe, video, dur, seg_dir / f"{seg_id}-last.png")

        segments_info.append({
            "segment": seg_id,
            "video": str(Path(video).resolve()),
            "duration_s": round(dur, 3),
            "sample_frames": mid_frames,
            "boundary_frames": {
                "first": str(first_p),
                "plus1s": str(plus1_p),
                "minus1s": str(minus1_p),
                "last": str(last_p),
            },
        })

    seams = []
    for idx in range(len(segments_info) - 1):
        prev_seg = segments_info[idx]
        next_seg = segments_info[idx + 1]
        last_p = Path(prev_seg["boundary_frames"]["last"])
        first_p = Path(next_seg["boundary_frames"]["first"])
        psnr_db, size_a, size_b = compute_psnr_db(last_p, first_p)
        passed = True if psnr_db is None else psnr_db >= args.psnr_threshold
        seams.append({
            "seam": f"{prev_seg['segment']}->{next_seg['segment']}",
            "prev_last": str(last_p),
            "prev_minus1s": prev_seg["boundary_frames"]["minus1s"],
            "next_first": str(first_p),
            "next_plus1s": next_seg["boundary_frames"]["plus1s"],
            "prev_size": list(size_a),
            "next_size": list(size_b),
            "psnr_db": "inf" if psnr_db is None else psnr_db,
            "threshold_db": args.psnr_threshold,
            "passed": passed,
        })

    report = {
        "segments": segments_info,
        "seams": seams,
        "all_seams_passed": all(s["passed"] for s in seams) if seams else True,
    }
    report_path = out_dir / "verification_report.json"
    report_path.write_text(json.dumps(report, ensure_ascii=False, indent=2), encoding="utf-8")
    print(json.dumps(report, ensure_ascii=False, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
