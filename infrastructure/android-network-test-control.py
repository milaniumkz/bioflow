"""Control only the disposable CI emulator network; never an application API."""

import json
import hashlib
import xml.etree.ElementTree as ET
import os
import re
from pathlib import Path
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
document_lock = threading.Lock()
document_result = {"state": "IDLE", "id": 0}


def stop_launcher_after_app_start():
    # AOSP Quickstep can ANR on a headless CI GPU and obscure unrelated app UI.
    # Stop only this emulator launcher after BIOFLOW starts; never dismiss an app ANR.
    for _ in range(600):
        probe = subprocess.run([adb, "-s", serial, "shell", "pidof", "kz.milanium.bioflow_mobile"], capture_output=True, text=True, timeout=10)
        if probe.returncode == 0 and probe.stdout.strip():
            for package in ("com.android.launcher3", "com.google.android.apps.nexuslauncher"):
                subprocess.run([adb, "-s", serial, "shell", "am", "force-stop", package], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10)
            print("Disposable emulator launcher stopped after BIOFLOW start (app/system dialogs untouched)", flush=True)
            return
        time.sleep(1)

threading.Thread(target=stop_launcher_after_app_start, daemon=True).start()


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


def ui_nodes():
    subprocess.run([adb, "-s", serial, "shell", "uiautomator", "dump", "/sdcard/bioflow-ui.xml"], check=True, stdout=subprocess.DEVNULL, timeout=20)
    raw = subprocess.check_output([adb, "-s", serial, "exec-out", "cat", "/sdcard/bioflow-ui.xml"], timeout=10)
    return list(ET.fromstring(raw).iter("node"))


def tap_node(node):
    bounds = re.fullmatch(r"\[(\d+),(\d+)\]\[(\d+),(\d+)\]", node.get("bounds", ""))
    if not bounds:
        raise RuntimeError("Native UI bounds missing")
    x1, y1, x2, y2 = map(int, bounds.groups())
    subprocess.run([adb, "-s", serial, "shell", "input", "tap", str((x1+x2)//2), str((y1+y2)//2)], check=True, timeout=10)


def save_system_document():
    for _ in range(12):
        for node in ui_nodes():
            if "documentsui" not in node.get("package", "") or node.get("enabled") != "true":
                continue
            text = node.get("text", "").casefold()
            resource = node.get("resource-id", "")
            if text in ("save", "сохранить") or resource.endswith("/action_menu_save") or resource.endswith("/button1"):
                tap_node(node)
                return
        time.sleep(1)
    raise RuntimeError("System document Save button not found")


def print_system_pdf():
    destinations_open = False
    pdf_selected = False
    for _ in range(20):
        nodes = ui_nodes()
        for node in nodes:
            if "printspooler" in node.get("package", "") and node.get("resource-id", "").endswith("/print_button") and node.get("enabled") == "true":
                output = Path(__file__).resolve().parent.parent / "apps/mobile/artifacts/screenshots"
                output.mkdir(parents=True, exist_ok=True)
                (output / "full-cabinet-print-preview.png").write_bytes(subprocess.check_output([adb, "-s", serial, "exec-out", "screencap", "-p"], timeout=15))
                tap_node(node)
                save_system_document()
                return
        if destinations_open and not pdf_selected:
            for node in nodes:
                if node.get("text", "").casefold() in ("save as pdf", "сохранить как pdf", "сохранить в pdf"):
                    tap_node(node)
                    pdf_selected = True
                    break
        elif not destinations_open:
            for node in nodes:
                if "printspooler" in node.get("package", "") and node.get("text", "").casefold() in ("select a printer", "выберите принтер", "выбрать принтер"):
                    tap_node(node)
                    destinations_open = True
                    break
        time.sleep(1)
    raise RuntimeError("Native QR print button not ready")


def collect_document(extension):
    for _ in range(12):
        files = subprocess.check_output([adb, "-s", serial, "shell", "find", "/sdcard/Download", "-type", "f", "-name", "*." + extension], text=True, timeout=10).splitlines()
        if files:
            source = files[-1].strip()
            if not source.startswith("/sdcard/Download/") or "/../" in source:
                raise RuntimeError("Unexpected test document location")
            data = subprocess.check_output([adb, "-s", serial, "exec-out", "cat", source], timeout=15)
            if not data:
                time.sleep(1)
                continue
            output = Path(__file__).resolve().parent.parent / "apps/mobile/artifacts/downloads"
            output.mkdir(parents=True, exist_ok=True)
            target = output / ("mobile-report.csv" if extension == "csv" else "mobile-QR.pdf")
            target.write_bytes(data)
            result = {"status":"PASS", "bytes":len(data), "sha256":hashlib.sha256(data).hexdigest()}
            if extension == "pdf":
                info = subprocess.check_output(["pdfinfo", str(target)], text=True)
                if not re.search(r"Pages:\s+1\b", info):
                    raise RuntimeError("QR PDF is not one page")
                if subprocess.check_output(["pdftotext", str(target), "-"]).strip():
                    raise RuntimeError("QR PDF unexpectedly contains interface text")
                images = subprocess.check_output(["pdfimages", "-list", str(target)], text=True)
                count = len(re.findall(r"^\s*1\s+\d+\s+image\s", images, flags=re.MULTILINE))
                if not count:
                    raise RuntimeError("QR PDF contains no image")
                result["images"] = count
                result["pages"] = 1
                result["textLayer"] = "empty"
            (output / (extension + "-verification.json")).write_text(json.dumps(result, indent=2))
            return result
        time.sleep(1)
    raise RuntimeError("Saved system document not found")


class Handler(BaseHTTPRequestHandler):
    def do_POST(self):
        if (
            self.path not in ("/offline", "/screenshot", "/save-document", "/print-to-pdf")
            or self.headers.get("X-Bioflow-Test") != "isolated-android-ui"
        ):
            self.send_error(403)
            return
        if self.path in ("/save-document", "/print-to-pdf"):
            if not document_lock.acquire(blocking=False):
                self.send_error(409)
                return
            document_result.clear()
            document_result.update({"state": "PENDING", "id": time.monotonic_ns()})
            action = self.path
            def run_document():
                try:
                    if action == "/print-to-pdf":
                        print_system_pdf()
                        result = collect_document("pdf")
                    else:
                        save_system_document()
                        result = collect_document("csv")
                    document_result.update({**result, "state": "PASS"})
                except Exception as error:
                    print("Native document UI failed: " + str(error), flush=True)
                    document_result.update({"state": "FAIL"})
                    output = Path(__file__).resolve().parent.parent / "apps/mobile/artifacts/screenshots"
                    output.mkdir(parents=True, exist_ok=True)
                    (output / "native-document-error.png").write_bytes(subprocess.check_output([adb, "-s", serial, "exec-out", "screencap", "-p"], timeout=15))
                    (output / "native-document-error-nodes.json").write_text(json.dumps([node.attrib for node in ui_nodes()], indent=2))
                finally:
                    document_lock.release()
            body = json.dumps(dict(document_result)).encode()
            self.send_response(202)
            self.send_header("Content-Type", "application/json")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            self.wfile.flush()
            threading.Thread(target=run_document, daemon=True).start()
            return
        if self.path == "/screenshot":
            size = int(self.headers.get("Content-Length", "0"))
            if size < 1 or size > 200:
                self.send_error(400)
                return
            name = json.loads(self.rfile.read(size)).get("name", "")
            if not re.fullmatch(r"[A-Za-zА-Яа-яЁё0-9_-]{1,80}", name):
                self.send_error(400)
                return
            output = Path(__file__).resolve().parent.parent / "apps/mobile/artifacts/screenshots"
            output.mkdir(parents=True, exist_ok=True)
            image = subprocess.check_output([adb, "-s", serial, "exec-out", "screencap", "-p"], timeout=15)
            (output / (name + ".png")).write_bytes(image)
            if any(any(message in node.get("text", "").casefold() for message in ("isn't responding", "is not responding", "не отвечает")) for node in ui_nodes()):
                print("Unexpected system/app ANR obscures BIOFLOW; screenshot preserved", flush=True)
                self.send_error(500, "ANR obscures the tested application")
                return
            self.send_response(200)
            self.send_header("Content-Length", "0")
            self.end_headers()
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

    def do_GET(self):
        if self.path != "/document-status" or self.headers.get("X-Bioflow-Test") != "isolated-android-ui":
            self.send_error(403)
            return
        body = json.dumps(dict(document_result)).encode()
        self.send_response(200)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, *_args):
        pass


print(f"Disposable emulator control ready on localhost:4200 ({serial})", flush=True)
ThreadingHTTPServer(("127.0.0.1", 4200), Handler).serve_forever()
