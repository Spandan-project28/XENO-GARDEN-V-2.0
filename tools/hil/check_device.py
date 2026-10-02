"""
Hardware-in-the-loop check for a real Xeno ESP32 (plug it into this PC by USB).

    py -3.14 tools/hil/check_device.py            # flash + boot log + Bluetooth check
    py -3.14 tools/hil/check_device.py --no-flash # just the checks

Does what the phone app does, from this PC, so problems show up here with the board's own log:
  1. finds the board's USB serial port and flashes the current firmware (PlatformIO)
  2. resets it and captures the boot log (hardware ID, claim code, "BLE setup on")
  3. over Bluetooth: finds Xeno-XXXX, connects (pairing if Windows asks), reads `info`, checks the
     JSON + claim code exactly like the app, then asks the board to scan WiFi
Prints PASS/FAIL per step. Needs: pip install bleak pyserial.
"""
import argparse
import asyncio
import json
import os
import re
import subprocess
import sys
import time

import serial
import serial.tools.list_ports
from bleak import BleakClient, BleakScanner

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVICE = "6b1f0001-5e6a-4c2b-9d3e-8a7c1b2f4e10"
INFO = "6b1f0002-5e6a-4c2b-9d3e-8a7c1b2f4e10"
WIFI_SCAN = "6b1f0003-5e6a-4c2b-9d3e-8a7c1b2f4e10"
STATE = "6b1f0006-5e6a-4c2b-9d3e-8a7c1b2f4e10"
CLAIM_CODE = re.compile(r"^[23456789ABCDEFGHJKMNPQRSTUVWXYZ]{8}$")
HW_ID = re.compile(r"^xg-[0-9a-f]{12}$")
# USB-serial chips used on ESP32 boards: CP210x, CH340/CH9102, FTDI, ESP32-S3 native USB.
USB_VIDS = {0x10C4, 0x1A86, 0x0403, 0x303A}

results = []


def report(ok, step, detail=""):
    results.append(ok)
    print(f"{'PASS' if ok else 'FAIL'}  {step}" + (f"  — {detail}" if detail else ""), flush=True)


def find_port():
    for p in serial.tools.list_ports.comports():
        if p.vid in USB_VIDS:
            return p.device, f"{p.description} (VID {p.vid:04x})"
    return None, None


def flash(port):
    cmd = [sys.executable, "-m", "platformio", "run", "-e", "esp32dev", "-d", os.path.join(ROOT, "firmware"),
           "-t", "upload", "--upload-port", port]
    print("Flashing… (if it stalls at 'Connecting', hold the board's BOOT button)", flush=True)
    r = subprocess.run(cmd, capture_output=True, text=True)
    tail = "\n".join((r.stdout + r.stderr).strip().splitlines()[-6:])
    report(r.returncode == 0, "flash firmware", "" if r.returncode == 0 else tail)
    return r.returncode == 0


def boot_log(port, seconds=8):
    """Resets the board (EN via RTS) and returns what it prints."""
    lines = []
    with serial.Serial(port, 115200, timeout=0.2) as s:
        s.dtr = False
        s.rts = True
        time.sleep(0.15)
        s.rts = False
        end = time.time() + seconds
        buf = b""
        while time.time() < end:
            buf += s.read(512)
        lines = buf.decode("utf-8", "replace").splitlines()
    return lines


async def ble_check(name_hint=None):
    print("Looking for Xeno-XXXX over Bluetooth (15 s)…", flush=True)
    found = await BleakScanner.discover(timeout=15.0, service_uuids=[SERVICE])
    devs = [d for d in found if (d.name or "").startswith("Xeno-") and (not name_hint or d.name == name_hint)]
    if not devs:
        report(False, "Bluetooth: board advertising", "no Xeno-XXXX found (is it in setup mode? LED double-blinking?)")
        return
    dev = devs[0]
    report(True, "Bluetooth: board advertising", dev.name)

    async with BleakClient(dev, timeout=20.0) as client:
        report(client.is_connected, "Bluetooth: connect")
        # No explicit pair(): like the phone, the OS pairs on the first encrypted read.

        raw = None
        for attempt in range(4):
            try:
                raw = bytes(await client.read_gatt_char(INFO))
                break
            except Exception as e:
                print(f"      (read info attempt {attempt + 1}: {e})", flush=True)
                await asyncio.sleep(1 + attempt)
        if raw is None:
            report(False, "read device info", "could not read (encryption/pairing?)")
            return
        try:
            text = raw.decode("utf-8")
            report(True, "info is valid UTF-8", text)
        except UnicodeDecodeError:
            report(False, "info is valid UTF-8", f"garbage bytes: {raw!r}")
            return
        try:
            info = json.loads(text)
        except json.JSONDecodeError as e:
            report(False, "info is JSON", str(e))
            return
        report(HW_ID.match(info.get("hwId", "")) is not None, "hardware ID", info.get("hwId"))
        mode = info.get("mode", "setup")
        report(mode in ("setup", "rejoin"), "mode", mode)
        if mode == "setup":
            report(CLAIM_CODE.match(info.get("claimCode", "")) is not None, "claim code valid", info.get("claimCode"))
        else:
            report(info.get("claimCode", "") == "", "rejoin hides claim code")

        # WiFi scan, exactly like the app: write {"scan":1}, collect notifications until "end".
        nets, done = [], asyncio.Event()

        def on_scan(_, data: bytearray):
            try:
                f = json.loads(bytes(data).decode("utf-8"))
            except Exception:
                return
            if f.get("t") == "net":
                nets.append((f.get("ssid"), f.get("rssi")))
            elif f.get("t") == "end":
                done.set()

        for attempt in range(3):
            try:
                await client.start_notify(WIFI_SCAN, on_scan)
                break
            except OSError as e:
                print(f"      (subscribe attempt {attempt + 1}: {e})", flush=True)
                if attempt == 2:
                    report(False, "subscribe to WiFi scan results", str(e))
                    return
                await asyncio.sleep(2)
        await client.write_gatt_char(WIFI_SCAN, b'0/1:{"scan":1}', response=True)
        try:
            await asyncio.wait_for(done.wait(), 20)
            report(True, "board scans WiFi", f"{len(nets)} networks: " + ", ".join(f"{s} ({r})" for s, r in nets[:6]))
        except asyncio.TimeoutError:
            report(False, "board scans WiFi", "no result within 20 s")
        await client.stop_notify(WIFI_SCAN)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--no-flash", action="store_true")
    ap.add_argument("--port")
    args = ap.parse_args()

    port, desc = (args.port, args.port) if args.port else find_port()
    if not port:
        report(False, "board on USB", "no ESP32 USB-serial port found (data cable? driver CH340/CP210x?)")
    else:
        report(True, "board on USB", f"{port}: {desc}")
        if not args.no_flash and not flash(port):
            sys.exit(1)
        log = boot_log(port)
        interesting = [l for l in log if re.search(r"Xeno Garden|claim code|BLE setup|setup window|pairing|wifi|mqtt|E \(|Guru|panic|abort", l, re.I)]
        print("---- boot log ----\n" + "\n".join(interesting[-25:] or log[-25:]) + "\n------------------", flush=True)
        crashed = any(re.search(r"Guru Meditation|panic|abort\(\)|Backtrace", l) for l in log)
        report(not crashed, "boots without crashing")
        report(any("Xeno Garden" in l for l in log), "firmware banner printed")

    asyncio.run(ble_check())
    print(f"\n{sum(results)}/{len(results)} checks passed", flush=True)
    sys.exit(0 if all(results) else 1)


if __name__ == "__main__":
    main()
