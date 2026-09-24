# Xeno Garden v2 — Hardware Guide

The firmware in `firmware/` targets a standard **ESP32 DevKit (ESP32-WROOM-32)**. v1's pH sensor has been dropped completely.

## Parts

| Part | Notes |
|---|---|
| ESP32 DevKit v1 (WROOM-32) | Any 30/38-pin DevKit works |
| Capacitive soil moisture sensor v1.2 (or v2.0) | **Capacitive, not resistive**: it doesn't corrode |
| DHT11 (or DHT22) temperature + humidity | For DHT22, set `DHT_TYPE DHT22` in `include/config.h` |
| Rain sensor module (FC-37/YL-83 + comparator board) | Use its digital `DO` output |
| 1-channel 5 V relay module (optocoupled, active-LOW input) | Switches the pump supply only |
| 12 V DC diaphragm pump + tubing + drippers | Or any pump suited to your supply |
| Power: 12 V battery/adapter (optionally solar + charge controller) | See "Power" below |
| Buck converter 12 V → 5 V (≥ 1 A) | Powers the ESP32 through its 5V/VIN pin |
| Flyback diode (1N4007) across the pump, if the relay board doesn't have one | Protects the relay contacts |

## Wiring

| Signal | ESP32 pin | Module pin | Why this pin |
|---|---|---|---|
| Soil moisture (analog) | **GPIO34** | AOUT | ADC1 pin: keeps working while WiFi is on (ADC2 doesn't) |
| DHT data | **GPIO4** | DATA (10 kΩ pull-up to 3.3 V if your board lacks one) | |
| Rain (digital) | **GPIO27** | DO | Internal pull-up enabled; LOW = rain |
| Relay input | **GPIO26** | IN | Driven HIGH at boot, before anything else, so the pump stays **off** |
| Status LED | GPIO2 | on-board LED | |
| Button | GPIO0 | on-board **BOOT** button | Hold 5 s = pairing, 15 s = factory reset |
| 3.3 V | 3V3 | soil VCC, DHT VCC | Sensors on 3.3 V keep signal levels safe for the ESP32 |
| 5 V | VIN/5V | relay VCC (and JD-VCC) | Most relay modules need 5 V for the coil |
| GND | GND | all module GNDs + buck converter GND | **Common ground is required** |

Pump circuit, isolated from the logic by the relay contacts:

```
+12 V ──► relay COM ──► relay NO ──► pump (+) ── pump (−) ──► GND 12 V
                                   (diode across the pump: cathode to +)
```

The ESP32 never carries pump current. With an active-LOW module, `digitalWrite(26, LOW)` closes the relay. If your module is active-HIGH, set `RELAY_ACTIVE_LOW 0` in `include/config.h`.

## Power (from v1's solar build)

```
Solar panel ──► charge controller ──► 12 V battery
                     │ LOAD
                     ├──► relay COM (pump circuit above)
                     └──► buck converter ──► 5 V ──► ESP32 VIN + relay VCC
```

Put a 2–3 A fuse on the pump line.

## First start

1. Flash the firmware: `pio run -e esp32dev -d firmware -t upload` (or ask whoever built the app for a `.bin`).
2. Power on. The LED double-blinks, which means **pairing mode**.
3. In the app: **Add device**. It finds `XenoGarden-XXXX` over Bluetooth, links it to your account and asks for your WiFi (2.4 GHz). No IP addresses anywhere.
4. When the app says **Online**, you're done. The device remembers up to 5 networks and moves between them on its own.

To change WiFi later, use **Settings → Change WiFi network** in the app, or hold BOOT for 5 s to reopen pairing.

## Soil sensor calibration (recommended, 1 minute)

Every capacitive sensor reads a little differently. In the app: **Device → Settings → Calibrate soil sensor**.

1. Pull the sensor out, wipe it dry, hold it in the air, then tap **measure dry**.
2. Dip it in a glass of water up to the line, then tap **measure wet**.

The values are stored on the device. The firmware handles either sensor direction (capacitive sensors read *higher* when dry). A reading pinned at 0 or 4095 is treated as **sensor disconnected**: automatic watering pauses and you get an alert.

## Status LED

| Pattern | Meaning |
|---|---|
| Fast double blink | Pairing mode, waiting for the app |
| Slow blink (1/s) | Joining WiFi |
| Quick blink (2/s) | Reaching the cloud |
| Short blip every 3 s | Online, all good |
| 4 rapid blinks | Soil sensor fault |
| Strobe for 10 s | "Identify" pressed in the app |
| Solid | Factory reset in progress |

## Safety behaviour (built into the firmware)

- The pump is forced **off** at power-up, before WiFi or anything else starts.
- The pump can never run longer than **Longest single watering** (maxPumpRunSec). Then it rests for the cooldown, for every source, manual included.
- Rain pauses automatic watering (optional).
- Sensor fault pauses automatic watering.
- Automatic watering keeps working **with no internet**. Readings are buffered and uploaded when the connection returns.
- A manual command is cancelled if the cloud has been unreachable for 5 minutes, so nothing runs that you can't see.

## Building & testing without hardware

```sh
python firmware/test/run_native.py              # logic tests on your PC (automation, parsing, framing)
pio run -e esp32dev -d firmware                  # compile the firmware
npm run sim -w @xeno/simulator -- --scenario drying   # full fake device against the backend
```

`run_native.py` needs a C++ compiler; `pip install ziglang` provides one on any OS.

## Production TLS

Put your MQTT broker's root CA certificate in `firmware/certs/ca.pem` before building. Without it, TLS still encrypts but can't verify the server (the firmware logs a warning).
