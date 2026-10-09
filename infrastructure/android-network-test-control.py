"""Control only the disposable CI emulator network; never an application API."""

import json
import os
import subprocess
import threading
import time
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

sdk = os.environ.get("ANDROID_HOME") or os.environ.get("ANDROID_SDK_ROOT")
adb = os.path.join(sdk, "platform-tools", "adb") if sdk else "adb"
devices = subprocess.check_output([adb, "devices"], text=True).splitlines()[1:]
serials = [line.split()[0] for line in devices if line.endswith("\tdevice")]
if len(serials) != 1 or not serials[0].startswith("emulator-"):
    raise SystemExit("Exactly one disposable emulator is required")
serial = serials[0]
lock = threading.Lock()


def network(state):
    for service in ("wifi", "data"):
        subprocess.run(
            [adb, "-s", serial, "shell", "svc", service, state],
            check=True,
            timeout=10,
        )
    print(f"emulator-network-{state}", flush=True)


def offline_cycle():
    try:
        time.sleep(0.5)  # Deliver the control response before disconnecting.
        network("disable")
        time.sleep(90)
    finally:
        network("enable")
        lock.release()


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if (
            self.path != "/offline"
            or self.headers.get("X-Bioflow-Test") != "isolated-android-ui"
        ):
            self.send_error(403)
            return
        if not lock.acquire(blocking=False):
            self.send_error(409)
            return
        body = json.dumps({"restoreAfterSeconds": 90}).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)
        self.wfile.flush()
        threading.Thread(target=offline_cycle, daemon=True).start()

    def log_message(self, *_args):
        pass


print(f"Disposable emulator control ready on localhost:4200 ({serial})", flush=True)
ThreadingHTTPServer(("127.0.0.1", 4200), Handler).serve_forever()
