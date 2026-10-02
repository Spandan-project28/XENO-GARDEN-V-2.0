"""
End-to-end setup of a REAL Xeno ESP32 from this PC, doing exactly what the phone app does:

  guest account → claim (claim code read over Bluetooth) → cloud credentials over BLE
  → WiFi credentials over BLE → board reports "online" → server sees it online with readings
  → (default) factory-reset WiFi/server on the board and remove it again, so a phone can add it fresh.

    set XG_WIFI_SSID / XG_WIFI_PASSWORD   (never printed)
    py -3.14 tools/hil/full_setup.py --api http://<this PC's LAN IP>:4000 [--keep]

The API must be reached via this PC's LAN address (not 127.0.0.1): in development the server
hands the board the address the client used.
"""
import argparse
import asyncio
import json
import os
import sys
import time
import urllib.request

from bleak import BleakClient, BleakScanner

SERVICE = "6b1f0001-5e6a-4c2b-9d3e-8a7c1b2f4e10"
INFO = "6b1f0002-5e6a-4c2b-9d3e-8a7c1b2f4e10"
WIFI_CREDS = "6b1f0004-5e6a-4c2b-9d3e-8a7c1b2f4e10"
CLOUD_CREDS = "6b1f0005-5e6a-4c2b-9d3e-8a7c1b2f4e10"
STATE = "6b1f0006-5e6a-4c2b-9d3e-8a7c1b2f4e10"
CHUNK = 160

ok_all = True


def step(ok, name, detail=""):
    global ok_all
    ok_all &= ok
    print(f"{'PASS' if ok else 'FAIL'}  {name}" + (f"  — {detail}" if detail else ""), flush=True)
    return ok


def api(base, method, path, body=None, token=None):
    req = urllib.request.Request(base + path, method=method, data=json.dumps(body).encode() if body is not None else None)
    if body is not None:
        req.add_header("content-type", "application/json")
    if token:
        req.add_header("authorization", f"Bearer {token}")
    try:
        with urllib.request.urlopen(req, timeout=15) as r:
            return r.status, json.loads(r.read() or b"{}")
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read() or b"{}")


def frames(message: str):
    """Same framing as @xeno/shared toFrames: "i/n:chunk", never splitting a UTF-8 character."""
    parts, cur, cur_bytes = [], "", 0
    for ch in message:
        b = len(ch.encode("utf-8"))
        if cur_bytes + b > CHUNK:
            parts.append(cur)
            cur, cur_bytes = "", 0
        cur += ch
        cur_bytes += b
    parts.append(cur)
    return [f"{i}/{len(parts)}:{p}".encode("utf-8") for i, p in enumerate(parts)]


async def write_framed(client, uuid, obj):
    for f in frames(json.dumps(obj, separators=(",", ":"))):
        await client.write_gatt_char(uuid, f, response=True)


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--api", required=True)
    ap.add_argument("--keep", action="store_true", help="leave the board set up (default: reset it afterwards)")
    args = ap.parse_args()
    ssid, pw = os.environ.get("XG_WIFI_SSID"), os.environ.get("XG_WIFI_PASSWORD", "")
    if not ssid:
        sys.exit("set XG_WIFI_SSID (and XG_WIFI_PASSWORD)")

    st, g = api(args.api, "POST", "/v1/auth/guest")
    if not step(st == 201, "guest account (no sign-up)"):
        return
    token = g["accessToken"]

    print("Looking for Xeno-XXXX (up to 2 min — a board that can't reach its server reopens setup after 1 min)…", flush=True)
    found, end = [], time.time() + 120
    while not found and time.time() < end:
        found = [d for d in await BleakScanner.discover(timeout=10.0, service_uuids=[SERVICE]) if (d.name or "").startswith("Xeno-")]
    if not step(bool(found), "board advertising", found[0].name if found else "not found"):
        return

    async with BleakClient(found[0], timeout=25.0) as client:
        info = None
        for attempt in range(4):
            try:
                info = json.loads(bytes(await client.read_gatt_char(INFO)).decode("utf-8"))
                break
            except Exception as e:
                print(f"      (read info {attempt + 1}: {e})", flush=True)
                await asyncio.sleep(1 + attempt)
        if not step(info is not None and info.get("mode") == "setup", "read info (setup mode)", json.dumps(info)):
            return

        st, claim = api(args.api, "POST", "/v1/devices/claim", {"hardwareId": info["hwId"], "claimCode": info["claimCode"]}, token)
        if not step(st == 201, "claim", f"{claim.get('device', {}).get('name')} → broker {claim.get('mqtt', {}).get('host')}:{claim.get('mqtt', {}).get('port')}" if st == 201 else json.dumps(claim)):
            return
        m = claim["mqtt"]
        device_id = claim["device"]["id"]

        states = []
        done = asyncio.Event()

        def on_state(_, data):
            try:
                s = json.loads(bytes(data).decode("utf-8"))
            except Exception:
                return
            states.append(s.get("s") + (f":{s['r']}" if s.get("r") else ""))
            if s.get("s") in ("online", "wifi_failed", "cloud_failed"):
                done.set()

        await client.start_notify(STATE, on_state)
        await write_framed(client, CLOUD_CREDS, {"h": m["host"], "p": m["port"], "t": m["tls"], "u": m["username"], "pw": m["password"]})
        step(True, "cloud credentials sent over Bluetooth")
        await write_framed(client, WIFI_CREDS, {"ssid": ssid, "pw": pw})
        step(True, f"WiFi credentials sent ({ssid})")
        try:
            await asyncio.wait_for(done.wait(), 60)
        except asyncio.TimeoutError:
            pass
        step(bool(states) and states[-1] == "online", "board reports online", " → ".join(states) or "no state updates")
        try:
            await client.stop_notify(STATE)
        except Exception:
            pass

    # Server side: online + a reading arrives.
    deadline = time.time() + 45
    d = {}
    while time.time() < deadline:
        _, d = api(args.api, "GET", f"/v1/devices/{device_id}", token=token)
        if d.get("online") and d.get("latest"):
            break
        time.sleep(2)
    latest = d.get("latest") or {}
    step(bool(d.get("online")), "server sees the board online")
    step(bool(d.get("latest")), "readings arrive", f"soil={latest.get('soilMoisture')} raw={latest.get('soilRaw')} temp={latest.get('temperature')} hum={latest.get('humidity')} pump={latest.get('pump')}")

    if not args.keep:
        st, _ = api(args.api, "POST", f"/v1/devices/{device_id}/commands", {"type": "factory_reset"}, token)
        step(st in (200, 201, 202), "reset board for a fresh phone setup")
        time.sleep(3)
        api(args.api, "DELETE", f"/v1/devices/{device_id}", token=token)

    print("\nALL PASSED" if ok_all else "\nSOME CHECKS FAILED", flush=True)
    sys.exit(0 if ok_all else 1)


asyncio.run(main())
