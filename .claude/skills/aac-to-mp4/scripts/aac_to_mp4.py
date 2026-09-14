#!/usr/bin/env python3
"""音声ファイル(aac 等)を YouTube がそのまま受け付ける mp4 に変換する。

YouTube は音声のみのファイルを受け付けないため、映像トラックを足す必要がある。
既定では単色背景の静止画映像を生成し、音声はそのまま使える形式なら再エンコード
せずにコピーする(無劣化・高速)。最後に ffprobe で出来上がりを検証し、
アップロードで弾かれる条件を潰してあることを確認する。
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
from pathlib import Path

# YouTube がそのまま受け取れる AAC の条件。ここから外れる入力だけ再エンコードする。
SAFE_AAC_PROFILES = {"LC"}
SAFE_SAMPLE_RATES = {44100, 48000}
SAFE_CHANNELS = {1, 2}


def die(msg: str) -> None:
    print(f"エラー: {msg}", file=sys.stderr)
    sys.exit(1)


def require_ffmpeg() -> None:
    missing = [b for b in ("ffmpeg", "ffprobe") if shutil.which(b) is None]
    if not missing:
        return
    die(
        f"{' と '.join(missing)} が見つかりません。先にインストールしてください:\n"
        "  macOS       : brew install ffmpeg\n"
        "  Ubuntu/Debian: sudo apt install ffmpeg\n"
        "  Windows     : winget install Gyan.FFmpeg"
    )


def run_ffprobe(path: Path, extra: list[str]) -> subprocess.CompletedProcess:
    return subprocess.run(
        ["ffprobe", "-v", "warning", "-print_format", "json",
         "-show_format", "-show_streams", *extra, str(path)],
        capture_output=True, text=True,
    )


def probe(path: Path) -> dict:
    """ffprobe の JSON を返す。読めないファイルはここで理由つきで弾く。"""
    attempts = [
        [],
        # コンテナ先頭だけでは判別できない入力向けに、解析範囲を広げてもう一度試す
        ["-analyzeduration", "100M", "-probesize", "100M"],
    ]
    last = None
    for extra in attempts:
        last = run_ffprobe(path, extra)
        try:
            info = json.loads(last.stdout)
        except json.JSONDecodeError:
            continue
        if info.get("streams"):
            return info

    detail = "\n".join(
        line for line in (last.stderr or "").splitlines()
        if line.strip() and "Consider increasing" not in line
    )
    die(
        f"{path.name} を読み取れませんでした。ffmpeg がこのファイルの中身を扱えません。\n"
        + (f"ffprobe の出力:\n{detail}\n" if detail else "")
        + "ffmpeg を新しいバージョンに更新すると解決することがあります。"
    )


def first_stream(info: dict, kind: str) -> dict | None:
    return next((s for s in info.get("streams", []) if s.get("codec_type") == kind), None)


def duration_of(info: dict, stream: dict | None) -> float | None:
    """raw ADTS は format.duration が入らないことがあるので両方から拾う。"""
    for src in (info.get("format", {}), stream or {}):
        try:
            value = float(src.get("duration"))
        except (TypeError, ValueError):
            continue
        if value > 0:
            return value
    return None


def decide_audio_mode(audio: dict, requested: str) -> tuple[str, str]:
    """(mode, 理由) を返す。auto のときだけ内容を見て判断する。"""
    codec = audio.get("codec_name")
    profile = audio.get("profile")
    rate = int(audio.get("sample_rate") or 0)
    channels = int(audio.get("channels") or 0)

    if requested != "auto":
        return requested, f"--audio {requested} が指定されました"

    reasons = []
    if codec != "aac":
        reasons.append(f"コーデックが {codec}")
    if profile not in SAFE_AAC_PROFILES:
        reasons.append(f"プロファイルが {profile}")
    if rate not in SAFE_SAMPLE_RATES:
        reasons.append(f"サンプルレートが {rate}Hz")
    if channels not in SAFE_CHANNELS:
        reasons.append(f"チャンネル数が {channels}")

    if reasons:
        return "reencode", "、".join(reasons) + " のため安全側に再エンコード"
    return "copy", f"AAC-LC {rate}Hz {channels}ch なので無劣化コピー"


def even(n: int) -> int:
    """yuv420p は幅・高さが偶数でないと成立しない。"""
    return n if n % 2 == 0 else n + 1


def parse_resolution(text: str) -> tuple[int, int]:
    try:
        w, h = (int(v) for v in text.lower().split("x"))
    except ValueError:
        die(f"解像度の書式が不正です: {text} (例: 1920x1080)")
    if w < 128 or h < 128:
        die(f"解像度が小さすぎます: {text}")
    return even(w), even(h)


def normalize_color(text: str) -> str:
    """#RRGGBB / RRGGBB / 色名 のいずれでも ffmpeg が解釈できる形に寄せる。"""
    value = text.strip().lstrip("#")
    if len(value) == 6 and all(c in "0123456789abcdefABCDEF" for c in value):
        return f"0x{value}"
    return text.strip()


def build_command(args, src: Path, dst: Path, audio_mode: str, w: int, h: int) -> list[str]:
    cmd = ["ffmpeg", "-y", "-hide_banner", "-loglevel", "error", "-stats"]

    if args.image:
        # 静止画を敷き詰める。アスペクト比は保ったまま余白を背景色で埋める。
        cmd += ["-loop", "1", "-framerate", str(args.fps), "-i", str(args.image)]
        vf = (
            f"scale={w}:{h}:force_original_aspect_ratio=decrease,"
            f"pad={w}:{h}:(ow-iw)/2:(oh-ih)/2:color={normalize_color(args.color)},"
            "format=yuv420p"
        )
    else:
        cmd += ["-f", "lavfi", "-i",
                f"color=c={normalize_color(args.color)}:s={w}x{h}:r={args.fps}"]
        vf = "format=yuv420p"

    # 映像は最初のフレーム以降ずっと同じなので、動き探索に時間をかけても得がない。
    # 単色なら最速設定で十分。画像を敷くときだけ、絵が甘くならない設定に寄せる。
    preset, crf = ("veryfast", "18") if args.image else ("ultrafast", "20")

    cmd += ["-i", str(src)]
    cmd += [
        "-map", "0:v:0", "-map", "1:a:0",
        "-vf", vf,
        "-c:v", "libx264",
        "-preset", preset,
        "-tune", "stillimage",
        "-crf", crf,
        "-profile:v", "high",
        "-r", str(args.fps),
        "-g", str(args.fps * 4),  # 動きがないぶんキーフレームは疎でよく、容量が軽くなる
    ]

    if audio_mode == "copy":
        cmd += ["-c:a", "copy"]
    else:
        cmd += ["-c:a", "aac", "-b:a", args.bitrate, "-ar", "48000", "-ac", "2"]

    cmd += ["-shortest", "-movflags", "+faststart", str(dst)]
    return cmd


def moov_before_mdat(path: Path) -> bool:
    """faststart が効いているか。moov が mdat より前にあれば OK。"""
    head = path.read_bytes()[:2_000_000]
    moov, mdat = head.find(b"moov"), head.find(b"mdat")
    if moov == -1:
        return False
    return mdat == -1 or moov < mdat


def verify(dst: Path, source_duration: float | None) -> bool:
    """YouTube が弾く条件を一つずつ潰せているか確認する。"""
    info = probe(dst)
    video = first_stream(info, "video")
    audio = first_stream(info, "audio")
    out_duration = duration_of(info, audio)

    checks: list[tuple[str, bool, str]] = []
    checks.append(("映像トラックがある", video is not None,
                   "音声のみのファイルは YouTube が受け付けない"))
    if video:
        w, h = int(video.get("width", 0)), int(video.get("height", 0))
        checks.append(("映像コーデックが H.264", video.get("codec_name") == "h264",
                       str(video.get("codec_name"))))
        checks.append(("ピクセル形式が yuv420p", video.get("pix_fmt") == "yuv420p",
                       str(video.get("pix_fmt"))))
        checks.append(("解像度が偶数", w % 2 == 0 and h % 2 == 0, f"{w}x{h}"))
    checks.append(("音声トラックがある", audio is not None, ""))
    if audio:
        checks.append(("音声コーデックが AAC", audio.get("codec_name") == "aac",
                       str(audio.get("codec_name"))))
    checks.append(("再生時間が 0 でない", bool(out_duration and out_duration > 0),
                   f"{out_duration:.2f}秒" if out_duration else "不明"))
    if source_duration and out_duration:
        # raw ADTS の .aac は再生時間がビットレートからの概算になるため厳密には一致しない。
        # 取りこぼしは検出しつつ誤検知は避けたいので、長さに応じた許容幅を持たせる。
        gap = abs(source_duration - out_duration)
        tolerance = max(1.0, min(source_duration * 0.02, 10.0))
        checks.append(("元の音声と長さが一致", gap <= tolerance,
                       f"差 {gap:.2f}秒 (元 {source_duration:.2f}秒)"))
    checks.append(("faststart が有効", moov_before_mdat(dst),
                   "再生開始が速くなる"))

    print("\n--- 検証結果 ---")
    for label, ok, note in checks:
        mark = "OK  " if ok else "NG  "
        print(f"{mark}{label}" + (f"  ({note})" if note else ""))
    return all(ok for _, ok, _ in checks)


def main() -> None:
    parser = argparse.ArgumentParser(
        description="音声ファイルを YouTube にそのままアップできる mp4 に変換する")
    parser.add_argument("input", help="入力の音声ファイル (.aac / .m4a / .mp3 など)")
    parser.add_argument("-o", "--output", help="出力する mp4 のパス")
    parser.add_argument("--color", default="#0B1220",
                        help="背景色。#RRGGBB か色名 (既定: #0B1220 の濃紺)")
    parser.add_argument("--image", help="背景に使う静止画。指定すると単色の代わりに敷く")
    parser.add_argument("--resolution", default="1920x1080", help="既定: 1920x1080")
    parser.add_argument("--fps", type=int, default=30, help="既定: 30")
    parser.add_argument("--audio", choices=["auto", "copy", "reencode"], default="auto",
                        help="auto=中身を見て判断 (既定) / copy=無劣化 / reencode=必ず変換")
    parser.add_argument("--bitrate", default="320k", help="再エンコード時のビットレート")
    args = parser.parse_args()

    require_ffmpeg()

    src = Path(args.input).expanduser()
    if not src.is_file():
        die(f"入力ファイルが見つかりません: {src}")
    if args.image and not Path(args.image).expanduser().is_file():
        die(f"画像が見つかりません: {args.image}")
    if args.image:
        args.image = Path(args.image).expanduser()
    if args.fps < 1 or args.fps > 60:
        die(f"fps は 1〜60 で指定してください: {args.fps}")

    info = probe(src)
    audio = first_stream(info, "audio")
    if audio is None:
        die(f"{src.name} に音声トラックがありません。")
    if first_stream(info, "video") is not None:
        print(f"注意: {src.name} には既に映像が入っています。"
              "その映像は使わず、背景を作り直して音声だけ載せ替えます。")

    src_duration = duration_of(info, audio)
    audio_mode, reason = decide_audio_mode(audio, args.audio)

    dst = Path(args.output).expanduser() if args.output else src.with_suffix(".mp4")
    if dst.resolve() == src.resolve():
        dst = src.with_name(f"{src.stem}_youtube.mp4")
    dst.parent.mkdir(parents=True, exist_ok=True)

    w, h = parse_resolution(args.resolution)

    print(f"入力  : {src.name}")
    print(f"音声  : {audio.get('codec_name')} / {audio.get('profile')} / "
          f"{audio.get('sample_rate')}Hz / {audio.get('channels')}ch")
    print(f"処理  : {audio_mode} — {reason}")
    print(f"映像  : {'画像 ' + Path(args.image).name if args.image else '単色 ' + args.color}"
          f" / {w}x{h} / {args.fps}fps")
    print(f"出力  : {dst}\n")

    cmd = build_command(args, src, dst, audio_mode, w, h)
    result = subprocess.run(cmd)

    if result.returncode != 0 and audio_mode == "copy":
        # コピーできない中身だった場合の保険。ここで諦めず再エンコードで通す。
        print("\n音声のコピーに失敗したため、再エンコードでやり直します。")
        cmd = build_command(args, src, dst, "reencode", w, h)
        result = subprocess.run(cmd)
        audio_mode = "reencode"

    if result.returncode != 0:
        die("ffmpeg での変換に失敗しました。上のログを確認してください。")

    ok = verify(dst, src_duration)
    size_mb = dst.stat().st_size / 1_048_576
    print(f"\n{dst}  ({size_mb:.1f} MB)")
    if not ok:
        die("検証で問題が見つかりました。このままアップロードすると弾かれる可能性があります。")
    print("YouTube にそのままアップロードできます。")


if __name__ == "__main__":
    main()
