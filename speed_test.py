#!/usr/bin/env python3
"""Measure sequential HTTP download throughput using only Python's standard library."""
import argparse
import time
from http.client import HTTPException
from urllib.error import HTTPError, URLError
from urllib.parse import urlsplit
from urllib.request import Request, urlopen

REQUEST_COUNT = 10
CHUNK_SIZE = 64 * 1024


def http_url(value):
    """Reject unsupported URLs before making a network request."""
    try:
        parsed = urlsplit(value)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname:
            raise ValueError()
        parsed.port  # Validate the port, if provided.
    except ValueError as exc:
        raise argparse.ArgumentTypeError("URL must be an absolute http:// or https:// address") from exc
    return value


def positive_timeout(value):
    try:
        seconds = float(value)
    except ValueError as exc:
        raise argparse.ArgumentTypeError("timeout must be a positive number") from exc
    if not 0 < seconds < float("inf"):
        raise argparse.ArgumentTypeError("timeout must be finite and greater than zero")
    return seconds


def download(url, timeout):
    """Return body bytes and elapsed nanoseconds after fully reading one response."""
    request = Request(url, headers={
        "User-Agent": "download-speed-test/1.0",
        "Accept-Encoding": "identity",
        "Cache-Control": "no-cache",
    })
    size = 0
    started = time.perf_counter_ns()
    with urlopen(request, timeout=timeout) as response:
        while chunk := response.read(CHUNK_SIZE):
            size += len(chunk)
        # Detect truncated responses when the server supplies a Content-Length.
        expected = response.headers.get("Content-Length")
        if expected is not None and size != int(expected):
            raise ValueError(f"incomplete response: expected {expected} bytes, received {size}")
    return size, time.perf_counter_ns() - started


def measure(url, timeout=30):
    total_bytes = 0
    total_ns = 0
    for number in range(1, REQUEST_COUNT + 1):
        try:
            size, elapsed_ns = download(url, timeout)
        except (HTTPError, URLError, HTTPException, OSError, ValueError) as exc:
            raise RuntimeError(f"request {number}/{REQUEST_COUNT} failed: {exc}") from exc
        total_bytes += size
        total_ns += elapsed_ns
    total_seconds = total_ns / 1_000_000_000
    if total_seconds <= 0:
        raise RuntimeError("measured duration must be greater than zero")
    return total_bytes, total_seconds


def main(argv=None):
    parser = argparse.ArgumentParser(description="Download a URL sequentially 10 times and measure throughput.")
    parser.add_argument("url", type=http_url, help="HTTP(S) URL of a file to download")
    parser.add_argument("--timeout", type=positive_timeout, default=30,
                        help="socket operation timeout in seconds (default: 30)")
    args = parser.parse_args(argv)
    try:
        total_bytes, seconds = measure(args.url, args.timeout)
    except (RuntimeError, KeyboardInterrupt) as exc:
        parser.exit(1, f"Error: {exc or 'interrupted'}\n")
    print(f"Completed requests: {REQUEST_COUNT}")
    print(f"Total downloaded: {total_bytes} bytes ({total_bytes / 1_000_000:.3f} MB)")
    print(f"Total request time: {seconds:.6f} s")
    print(f"Average request time: {seconds / REQUEST_COUNT:.6f} s")
    print(f"Download speed: {total_bytes / seconds / 1_000_000:.3f} MB/s")
    print(f"Download speed: {total_bytes * 8 / seconds / 1_000_000:.3f} Mbit/s")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
