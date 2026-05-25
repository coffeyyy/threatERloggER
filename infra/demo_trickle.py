"""Live log trickle for demo purposes.

Reads lines from an HDFS log file and POSTs small batches to the /ingest
endpoint at a configurable interval. The worker will embed and enrich
each batch in near-real-time, making the dashboard look alive.

Usage (from repo root, with venv active):
    python infra/demo_trickle.py
    python infra/demo_trickle.py --file infra/data/Linux_2k.log --source linux-prod
    python infra/demo_trickle.py --min 3 --max 8 --interval 4
    python infra/demo_trickle.py --shuffle --loop

Keep this running in a side terminal during the demo. Ctrl+C to stop.
"""
import argparse
import random
import sys
import time
from datetime import datetime
from pathlib import Path
import requests


DEFAULT_FILE = Path("infra/data/SSH.log")
DEFAULT_URL = "http://localhost:8000/ingest"
DEFAULT_SOURCE = "live-stream"


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description=__doc__,
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    p.add_argument("--file", type=Path, default=DEFAULT_FILE, help=f"Log file to read from (default: {DEFAULT_FILE})")
    p.add_argument("--url", default=DEFAULT_URL, help=f"Ingest endpoint (default: {DEFAULT_URL})")
    p.add_argument("--source", default=DEFAULT_SOURCE, help=f"Source label (default: {DEFAULT_SOURCE})")
    p.add_argument("--min", type=int, default=5, help="Min lines per batch (default: 5)")
    p.add_argument("--max", type=int, default=10, help="Max lines per batch (default: 10)")
    p.add_argument("--interval", type=float, default=5.0, help="Seconds between batches (default: 5)")
    p.add_argument("--jitter", type=float, default=2.0, help="Random ± seconds added to interval (default: 2)")
    p.add_argument("--shuffle", action="store_true", help="Randomize line order (default: sequential)")
    p.add_argument("--loop", action="store_true", help="Restart from the top when file is exhausted")
    p.add_argument("--start", type=int, default=0, help="Skip the first N lines (default: 0)")
    return p.parse_args()


def read_lines(path: Path) -> list[str]:
    if not path.exists():
        sys.exit(f"File not found: {path}")
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        return [ln.rstrip("\n") for ln in f if ln.strip()]


def post_batch(url: str, logs: list[str], source: str) -> bool:
    try:
        r = requests.post(
            url,
            json={"logs": logs, "source": source},
            timeout=10,
        )
        r.raise_for_status()
        return True
    except requests.exceptions.ConnectionError:
        print(f"[{datetime.now():%H:%M:%S}] connection refused — is FastAPI running?", file=sys.stderr)
        return False
    except Exception as e:
        print(f"[{datetime.now():%H:%M:%S}] error: {e}", file=sys.stderr)
        return False


def main() -> None:
    args = parse_args()
    lines = read_lines(args.file)

    if args.shuffle:
        random.shuffle(lines)

    if args.start:
        lines = lines[args.start:]

    if not lines:
        sys.exit("No lines to send.")

    print(f"Streaming from {args.file} ({len(lines)} lines available)")
    print(f"Posting {args.min}–{args.max} lines every {args.interval}±{args.jitter}s as source='{args.source}'")
    print(f"POST {args.url}")
    print("Press Ctrl+C to stop.\n")

    cursor = 0
    total_sent = 0

    try:
        while cursor < len(lines):
            batch_size = random.randint(args.min, args.max)
            batch = lines[cursor : cursor + batch_size]
            cursor += batch_size

            ok = post_batch(args.url, batch, args.source)
            if ok:
                total_sent += len(batch)
                print(f"[{datetime.now():%H:%M:%S}] sent {len(batch)} lines  [total: {total_sent}]  next in ~{args.interval}s")

            if cursor >= len(lines):
                if args.loop:
                    cursor = 0
                    if args.shuffle:
                        random.shuffle(lines)
                    print(f"[{datetime.now():%H:%M:%S}] looped — restarting from top")
                else:
                    print(f"\nDone — sent {total_sent} lines.")
                    break

            sleep_for = args.interval + random.uniform(-args.jitter, args.jitter)
            sleep_for = max(0.5, sleep_for)
            time.sleep(sleep_for)

    except KeyboardInterrupt:
        print(f"\nStopped — sent {total_sent} lines.")


if __name__ == "__main__":
    main()