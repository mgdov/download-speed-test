"""Integration checks against a local HTTP server: no internet required."""
import contextlib
import io
import threading
import time
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

import speed_test


class Handler(BaseHTTPRequestHandler):
    payload = bytes(range(256)) * 1024
    requests = active = maximum_active = 0
    lock = threading.Lock()

    def log_message(self, *args):
        pass

    def do_GET(self):
        if self.path == "/error":
            self.send_error(503)
            return
        if self.path == "/truncated":
            self.send_response(200)
            self.send_header("Content-Length", "100")
            self.end_headers()
            self.wfile.write(b"short")
            return
        with self.lock:
            Handler.requests += 1
            Handler.active += 1
            Handler.maximum_active = max(Handler.maximum_active, Handler.active)
        try:
            self.send_response(200)
            self.send_header("Content-Length", str(len(self.payload)))
            self.end_headers()
            time.sleep(0.01)
            # Decrement before the final write so the server-side counter measures
            # overlapping downloads rather than handler teardown scheduling.
            self.wfile.write(self.payload[:-1])
            self.wfile.flush()
            with self.lock:
                Handler.active -= 1
            self.wfile.write(self.payload[-1:])
        except OSError:
            with self.lock:
                Handler.active -= 1
            raise


class SpeedTest(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.server = ThreadingHTTPServer(("127.0.0.1", 0), Handler)
        cls.thread = threading.Thread(target=cls.server.serve_forever, daemon=True)
        cls.thread.start()
        cls.url = f"http://127.0.0.1:{cls.server.server_port}"

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.thread.join()

    def test_ten_complete_sequential_downloads(self):
        Handler.requests = Handler.active = Handler.maximum_active = 0
        size, seconds = speed_test.measure(self.url)
        self.assertEqual(size, len(Handler.payload) * 10)
        self.assertEqual(Handler.requests, 10)
        self.assertEqual(Handler.maximum_active, 1)
        self.assertGreaterEqual(seconds, 0.1)

    def test_http_failure_does_not_print_success(self):
        output = io.StringIO()
        with contextlib.redirect_stdout(output), contextlib.redirect_stderr(io.StringIO()):
            with self.assertRaises(SystemExit) as error:
                speed_test.main([self.url + "/error"])
        self.assertEqual(error.exception.code, 1)
        self.assertEqual(output.getvalue(), "")

    def test_truncated_body_fails(self):
        with self.assertRaisesRegex(RuntimeError, "request 1/10 failed"):
            speed_test.measure(self.url + "/truncated")

    def test_units_and_average(self):
        output = io.StringIO()
        with patch.object(speed_test, "measure", return_value=(10_000_000, 2)), contextlib.redirect_stdout(output):
            self.assertEqual(speed_test.main([self.url]), 0)
        self.assertIn("Average request time: 0.200000 s", output.getvalue())
        self.assertIn("5.000 MB/s", output.getvalue())
        self.assertIn("40.000 Mbit/s", output.getvalue())

    def test_invalid_arguments(self):
        for args in (["file:///etc/hosts"], [self.url, "--timeout", "0"],
                     [self.url, "--timeout", "nan"], ["https://example.com:bad/file"]):
            with self.subTest(args=args), contextlib.redirect_stderr(io.StringIO()):
                with self.assertRaises(SystemExit) as error:
                    speed_test.main(args)
                self.assertEqual(error.exception.code, 2)


if __name__ == "__main__":
    unittest.main()
