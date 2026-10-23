#!/usr/bin/env python3
"""
Robust video stream, YouTube, and cloud storage link ingestion utility.
Supports:
1. YouTube (youtube.com, youtu.be, shorts) with automatic static ffmpeg integration.
2. Cloud Storage links (Google Drive, Dropbox, AWS S3, Azure Blob, Direct CDNs).
3. Direct HTTP/HTTPS MP4/WebM video links with stream downloading.
"""
import sys
import os
import re
import json
import argparse
import urllib.request
import urllib.parse

# 1. Locate static ffmpeg binary (from imageio-ffmpeg)
FFMPEG_EXE = None
try:
    import imageio_ffmpeg
    FFMPEG_EXE = imageio_ffmpeg.get_ffmpeg_exe()
    if FFMPEG_EXE and os.path.exists(FFMPEG_EXE):
        ffmpeg_dir = os.path.dirname(FFMPEG_EXE)
        if ffmpeg_dir not in os.environ.get("PATH", ""):
            os.environ["PATH"] = ffmpeg_dir + os.pathsep + os.environ.get("PATH", "")
except Exception:
    pass

try:
    import yt_dlp
    HAVE_YTDLP = True
except ImportError:
    HAVE_YTDLP = False

try:
    import cv2
    HAVE_CV2 = True
except ImportError:
    HAVE_CV2 = False


def transform_cloud_url(url):
    """
    Transforms standard cloud share links into direct downloadable video streams.
    """
    # Dropbox: change ?dl=0 to ?dl=1 or raw=1
    if "dropbox.com" in url:
        if "dl=0" in url:
            return url.replace("dl=0", "dl=1")
        elif "raw=1" in url:
            return url
        elif "?" not in url:
            return url + "?dl=1"
        return url

    # Google Drive share link: drive.google.com/file/d/<FILE_ID>/view
    gdrive_match = re.search(r"drive\.google\.com/file/d/([a-zA-Z0-9_-]+)", url)
    if gdrive_match:
        file_id = gdrive_match.group(1)
        return f"https://drive.google.com/uc?export=download&id={file_id}"

    return url


def download_direct_stream(url, out_dir, title_hint=None, max_size_mb=250):
    """
    Directly streams an HTTP/HTTPS video file (cloud storage, S3, Dropbox, CDN)
    into a local MP4 file without needing yt-dlp or ffmpeg.
    """
    os.makedirs(out_dir, exist_ok=True)
    clean_url = transform_cloud_url(url)
    
    # Generate clean stem
    parsed = urllib.parse.urlparse(clean_url)
    path_name = os.path.basename(parsed.path) or "cloud_video"
    stem = re.sub(r'[^a-zA-Z0-9_-]', '_', os.path.splitext(path_name)[0])
    if not stem or stem == "_":
        stem = f"cloud_stream_{int(os.times().system * 1000)}"
    
    dest_path = os.path.join(out_dir, f"{stem}.mp4")

    # Request headers to prevent 403 blocks from CDNs
    req = urllib.request.Request(
        clean_url,
        headers={
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36",
            "Accept": "*/*",
            "Accept-Encoding": "identity"
        }
    )

    max_bytes = max_size_mb * 1024 * 1024
    downloaded_bytes = 0

    with urllib.request.urlopen(req, timeout=40) as response, open(dest_path, "wb") as out_file:
        content_length = response.headers.get("Content-Length")
        if content_length and int(content_length) > max_bytes:
            raise ValueError(f"Video file exceeds maximum allowable size of {max_size_mb}MB.")

        while True:
            chunk = response.read(64 * 1024)
            if not chunk:
                break
            downloaded_bytes += len(chunk)
            if downloaded_bytes > max_bytes:
                raise ValueError(f"Download exceeded maximum size limit of {max_size_mb}MB.")
            out_file.write(chunk)

    # Validate with OpenCV if available
    duration = 15.0
    if HAVE_CV2:
        try:
            cap = cv2.VideoCapture(dest_path)
            if cap.isOpened():
                fps = cap.get(cv2.CAP_PROP_FPS) or 24.0
                total_frames = cap.get(cv2.CAP_PROP_FRAME_COUNT) or 0
                if fps > 0 and total_frames > 0:
                    duration = round(total_frames / fps, 2)
                cap.release()
        except Exception:
            pass

    return {
        "id": stem,
        "title": title_hint or stem.replace("_", " ").title(),
        "filename": os.path.basename(dest_path),
        "filepath": os.path.abspath(dest_path),
        "duration": duration,
        "thumbnail": None
    }


class YtDlpSilentLogger:
    def debug(self, msg):
        pass
    def info(self, msg):
        pass
    def warning(self, msg):
        pass
    def error(self, msg):
        sys.stderr.write(f"[yt-dlp:error] {msg}\n")


def download_ytdlp_video(url, out_dir, max_duration=600):
    """
    Downloads video using yt-dlp with automatic ffmpeg binary integration,
    cloud datacenter anti-bot routing, and single pre-muxed format fallback.
    """
    if not HAVE_YTDLP:
        raise RuntimeError("yt-dlp is not installed in the server Python runtime. Please install dependencies with: pip install -r requirements.txt")

    os.makedirs(out_dir, exist_ok=True)

    client_strategies = [
        ['android'],
        ['mweb'],
        ['web']
    ]

    last_error = None

    for client_list in client_strategies:
        ydl_opts = {
            'quiet': True,
            'no_warnings': True,
            'noprogress': True,
            'noplaylist': True,
            'logger': YtDlpSilentLogger(),
            'outtmpl': os.path.join(out_dir, '%(id)s.%(ext)s'),
            'extractor_args': {
                'youtube': {
                    'player_client': client_list
                }
            },
            'socket_timeout': 35,
            'retries': 3,
            'format': 'best[ext=mp4]/best/18',
        }

        # If static ffmpeg is present, supply it to yt-dlp
        if FFMPEG_EXE and os.path.exists(FFMPEG_EXE):
            ydl_opts['ffmpeg_location'] = FFMPEG_EXE
            ydl_opts['format'] = 'bestvideo[ext=mp4][height<=720]+bestaudio[ext=m4a]/best[ext=mp4]/b[ext=mp4]/18/22/best'
            ydl_opts['merge_output_format'] = 'mp4'

        try:
            with yt_dlp.YoutubeDL(ydl_opts) as ydl:
                info = ydl.extract_info(url, download=True)
                if not info:
                    continue

                duration = info.get('duration') or 0
                stem = info.get('id', 'video_stream')
                filename = ydl.prepare_filename(info)

                if duration and duration > max_duration:
                    if os.path.exists(filename):
                        try:
                            os.remove(filename)
                        except Exception:
                            pass
                    raise ValueError(
                        f"Video duration ({duration}s) exceeds maximum allowed limit of {max_duration}s ({max_duration // 60} mins)."
                    )

                # Locate actual file on disk
                if not os.path.exists(filename):
                    base, _ = os.path.splitext(filename)
                    if os.path.exists(base + '.mp4'):
                        filename = base + '.mp4'
                    else:
                        candidates = [
                            os.path.join(out_dir, f) for f in os.listdir(out_dir)
                            if f.startswith(stem) and not f.endswith('.part') and not f.endswith('.ytdl')
                        ]
                        if candidates:
                            filename = candidates[0]

                if not os.path.exists(filename):
                    continue

                title = info.get('title', stem)
                thumbnail = info.get('thumbnail')

                return {
                    "id": stem,
                    "title": title,
                    "filename": os.path.basename(filename),
                    "filepath": os.path.abspath(filename),
                    "duration": round(float(duration or 15.0), 2),
                    "thumbnail": thumbnail
                }
        except ValueError:
            raise
        except Exception as err:
            last_error = err
            continue

    # If all client strategies failed, throw a descriptive, actionable error
    err_msg = str(last_error) if last_error else "Download failed across all stream extractors."
    if "bot" in err_msg.lower() or "player response" in err_msg.lower() or "429" in err_msg:
        raise RuntimeError(
            "YouTube has restricted downloads from this cloud server IP. "
            "Please use the 'Direct Upload' tab to upload your MP4 file directly, or provide a direct cloud video stream link."
        )
    raise RuntimeError(err_msg)


def ingest_any_url(url, out_dir, title=None, max_duration=600):
    """
    Smart router: detects whether the link is a cloud file / direct media stream
    or a video platform (YouTube, Vimeo, etc.) and uses the optimal ingestion path.
    """
    clean_url = url.strip()
    lower_url = clean_url.lower()

    # Cloud providers or direct stream indicators
    is_cloud_or_direct = (
        "drive.google.com" in lower_url or
        "dropbox.com" in lower_url or
        "amazonaws.com" in lower_url or
        "blob.core.windows.net" in lower_url or
        lower_url.endswith(".mp4") or
        lower_url.endswith(".mov") or
        lower_url.endswith(".webm")
    )

    # 1. If it's a cloud file or direct media stream, try direct download first
    if is_cloud_or_direct:
        try:
            return download_direct_stream(clean_url, out_dir, title_hint=title)
        except Exception as err:
            sys.stderr.write(f"Direct stream download notice: {err}. Attempting yt-dlp fallback...\n")

    # 2. Use yt-dlp (with static ffmpeg & pre-muxed fallback)
    try:
        return download_ytdlp_video(clean_url, out_dir, max_duration=max_duration)
    except Exception as ytdlp_err:
        # If yt-dlp failed on a cloud URL, attempt direct download as ultimate fallback
        if not is_cloud_or_direct:
            try:
                return download_direct_stream(clean_url, out_dir, title_hint=title)
            except Exception:
                pass
        raise ytdlp_err


def main():
    parser = argparse.ArgumentParser(description="Ingest video URL (YouTube, Cloud storage, Direct stream)")
    parser.add_argument("--url", required=True, help="YouTube, Cloud, or direct video URL")
    parser.add_argument("--out-dir", required=True, help="Directory to save downloaded video")
    parser.add_argument("--title", required=False, default=None, help="Optional title")
    parser.add_argument("--max-duration", type=int, default=600, help="Max duration in seconds")
    args = parser.parse_args()

    try:
        res = ingest_any_url(args.url, args.out_dir, title=args.title, max_duration=args.max_duration)
        print(json.dumps(res))
    except Exception as e:
        sys.stderr.write(f"Error: {str(e)}\n")
        sys.exit(1)


if __name__ == "__main__":
    main()
