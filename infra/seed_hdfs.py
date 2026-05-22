"""Seed the database with HDFS logs from LogHub.

Reads infra/data/HDFS_2k.log (or whatever you pass via --file) and POSTs
batches of lines to the running FastAPI /ingest endpoint.

Prereqs:
    - FastAPI server running on http://localhost:8000 (or override with --url)
    - HDFS_2k.log downloaded to infra/data/ (or pass --file)

Usage:
    # from repo root, with venv active:
    python infra/seed_hdfs.py
    python infra/seed_hdfs.py --limit 500       # only first 500 lines
    python infra/seed_hdfs.py --batch-size 50   # smaller batches
    python infra/seed_hdfs.py --file path/to/other.log
"""
import argparse
import sys
import time
from pathlib import Path

try:
    import requests
except ImportError:
    sys.exit("Missing dependency: pip install requests")


DEFAULT_FILE = Path("infra/data/HDFS_2k.log")
DEFAULT_URL = "http://localhost:8000/ingest"
DEFAULT_BATCH = 100
DEFAULT_SOURCE = "hdfs-seed"


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("--file", type=Path, default=DEFAULT_FILE, help=f"Log file to read (default: {DEFAULT_FILE})")
    p.add_argument("--url", default=DEFAULT_URL, help=f"Ingest endpoint (default: {DEFAULT_URL})")
    p.add_argument("--batch-size", type=int, default=DEFAULT_BATCH, help=f"Lines per POST (default: {DEFAULT_BATCH})")
    p.add_argument("--limit", type=int, default=None, help="Cap total lines sent (default: all)")
    p.add_argument("--source", default=DEFAULT_SOURCE, help=f"Source label for these logs (default: {DEFAULT_SOURCE})")
    p.add_argument("--sleep", type=float, default=0.0, help="Seconds to sleep between batches (default: 0)")
    return p.parse_args()


def read_lines(path: Path, limit: int | None) -> list[str]:
    if not path.exists():
        sys.exit(
            f"File not found: {path}\n"
            f"Download with:\n"
            f"  mkdir -p infra/data\n"
            f"  curl -L -o {path} "
            f"https://raw.githubusercontent.com/logpai/loghub/master/HDFS/HDFS_2k.log"
        )
    with open(path, "r", encoding="utf-8", errors="replace") as f:
        lines = [ln.rstrip("\n") for ln in f if ln.strip()]
    if limit:
        lines = lines[:limit]
    return lines


def batched(lines: list[str], size: int):
    for i in range(0, len(lines), size):
        yield lines[i : i + size]


def post_batch(url: str, logs: list[str], source: str) -> int:
    r = requests.post(
        url,
        json={"logs": logs, "source": source},
        timeout=30,
    )
    r.raise_for_status()
    return r.json().get("count", 0)


def main() -> None:
    args = parse_args()

    lines = read_lines(args.file, args.limit)
    print(f"Read {len(lines)} lines from {args.file}")
    if not lines:
        sys.exit("Nothing to seed.")

    total_batches = (len(lines) + args.batch_size - 1) // args.batch_size
    print(f"Sending {total_batches} batches of up to {args.batch_size} to {args.url}")

    sent = 0
    failed = 0
    start = time.time()
    for i, batch in enumerate(batched(lines, args.batch_size), 1):
        try:
            count = post_batch(args.url, batch, args.source)
            sent += count
            print(f"  batch {i}/{total_batches}: ok ({count} rows)  [total: {sent}]")
        except Exception as e:
            failed += len(batch)
            print(f"  batch {i}/{total_batches}: FAILED — {e}", file=sys.stderr)
        if args.sleep:
            time.sleep(args.sleep)

    elapsed = time.time() - start
    print(f"\nDone in {elapsed:.1f}s. Sent: {sent}, failed: {failed}")
    if sent:
        print("\nNext steps:")
        print("  1. Watch the worker logs — it should start embedding these.")
        print("  2. Once all are embedded, fit the anomaly model:")
        print("       cd worker && python fit_anomaly_model.py")
        print("  3. Restart the worker — enrichment will now run on anomalies.")


if __name__ == "__main__":
    main()