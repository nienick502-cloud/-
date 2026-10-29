"""建立真实 CLAP 音频段落索引，支持按歌曲恢复缓存。"""
from pathlib import Path
import argparse
import json
import sys

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT))
from server.semantic import build_audio_index


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--device", choices=["auto", "cpu", "cuda"], default="auto")
    parser.add_argument("--force", action="store_true", help="忽略现有音频特征缓存并重新计算")
    args = parser.parse_args()
    metadata = build_audio_index(ROOT, args.device, args.force, lambda message: print(message, flush=True))
    print(json.dumps({k: v for k, v in metadata.items() if k != "identity"}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
