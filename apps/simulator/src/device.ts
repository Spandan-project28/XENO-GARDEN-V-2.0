/**
 * SimDevice — behaves like the ESP32 firmware at the MQTT level:
 *  • publishes `status` online (retained) on connect, LWT `offline`
 *  • runs the shared automation every tick (works while disconnected)
 *  • telemetry every settings.telemetryIntervalSec + immediately on pump change
 *  • reported on every state change + 60 s heartbeat
 *  • applies retained `desired` by version; manual commands expire locally
 *  • answers one-shot `cmd`s with `cmd/ack`
 *  • buffers telemetry while offline and flushes on reconnect
 */
import {
  commandPayload,
  defaultSettings,
  desiredPayload,
  evaluateAutomation,
  topicFor,
  type ActiveManual,
  type DesiredState,
  type DeviceMode,
  type DeviceSettings,
  type EventPayload,
  type PumpReason,
  type ReportedState,
  type TelemetryPayload,
  type TopicKind,
} from '@xeno/shared';
import { readSensors, step, type GardenState, type Rng } from './physics.js';
import type { Scenario, ScenarioContext } from './scenarios.js';

export const SIM_FW_VERSION = '2.0.0-sim';
const REPORTED_HEARTBEAT_MS = 60_000;
const MAX_BUFFER = 50;

export interface SimTransport {
  connect(): Promise<void>;
  publish(topic: string, payload: string, opts: { retain?: boolean; qos?: 0 | 1 }): void;
  onMessage(handler: (topic: string, payload: string) => void): void;
  onConnectionChange(handler: (connected: boolean) => void): void;
  subscribe(topics: string[]): Promise<void>;
  isConnected(): boolean;
  /** Simulates a power cut / network loss: no DISCONNECT, so the broker fires the LWT. */
  drop(reconnectAfterMs: number | null): void;
  end(): Promise<void>;
}

export interface SimClock {
  /** Monotonic ms (like millis()). */
  mono(): number;
  /** Wall-clock epoch ms (like NTP time). */
  epoch(): number;
}

export interface SimDeviceOptions {
  hardwareId: string;
  transport: SimTransport;
  scenario: Scenario;
  clock: SimClock;
  rng: Rng;
  /** Physics speed-up: simulated seconds per real second. */
  speed?: number;
  log?: (msg: string) => void;
}

export class SimDevice {
  readonly hardwareId: string;
  garden: GardenState;
  mode: DeviceMode = 'manual'; // like the real board: nothing waters until the user picks Auto
  settings: DeviceSettings = { ...defaultSettings };
  appliedVersion = 0;
  manual: ActiveManual | null = null;
  pumpOn = false;
  pumpSince = 0;
  pumpReason: PumpReason = 'idle';
  cooldownUntil: number | null = null;
  sensorFault = false;
  fwVersion = SIM_FW_VERSION;
  readonly acks: string[] = [];

  private readonly t: SimTransport;
  private readonly clock: SimClock;
  private readonly rng: Rng;
  private readonly speed: number;
  private readonly scenario: Scenario;
  private readonly startMono: number;
  private lastTickMono: number;
  private lastTelemetryMono = -Infinity;
  private lastReportedMono = -Infinity;
  private lastReportedJson = '';
  private buffer: TelemetryPayload[] = [];
  private simSec = 0;
  private lastScriptSec = -1;
  private readonly log: (msg: string) => void;

  constructor(opts: SimDeviceOptions) {
    this.hardwareId = opts.hardwareId;
    this.t = opts.transport;
    this.clock = opts.clock;
    this.rng = opts.rng;
    this.speed = opts.speed ?? 1;
    this.scenario = opts.scenario;
    this.garden = { ...opts.scenario.initial };
    this.startMono = this.clock.mono();
    this.lastTickMono = this.startMono;
    this.pumpSince = this.startMono;
    this.log = opts.log ?? (() => {});

    this.t.onMessage((topic, payload) => this.onMessage(topic, payload));
    this.t.onConnectionChange((connected) => {
      if (connected) this.onConnected();
    });
  }

  async start() {
    await this.t.connect();
  }

  async stop() {
    await this.t.end();
  }

  /** Pulls the plug: no DISCONNECT is sent, so the broker publishes the LWT. */
  powerCut(reconnectAfterSec: number | null = null) {
    this.t.drop(reconnectAfterSec === null ? null : reconnectAfterSec * 1000);
  }

  private topic(kind: TopicKind) {
    return topicFor(this.hardwareId, kind);
  }

  private onConnected() {
    this.t.publish(this.topic('status'), 'online', { retain: true, qos: 1 });
    void this.t.subscribe([this.topic('desired'), this.topic('cmd')]);
    this.emitEvent({ type: 'boot', data: { fw: SIM_FW_VERSION } });
    // flush telemetry buffered while offline
    const pending = this.buffer;
    this.buffer = [];
    for (const p of pending) this.t.publish(this.topic('telemetry'), JSON.stringify(p), { qos: 0 });
    this.publishReported(true);
  }

  private onMessage(topic: string, raw: string) {
    if (!raw) return;
    try {
      if (topic === this.topic('desired')) this.applyDesired(desiredPayload.parse(JSON.parse(raw)));
      else if (topic === this.topic('cmd')) this.handleCommand(raw);
    } catch (err) {
      this.log(`${this.hardwareId}: bad ${topic} payload: ${String(err)}`);
    }
  }

  applyDesired(d: DesiredState) {
    if (d.version <= this.appliedVersion) return;
    this.mode = d.mode;
    this.settings = d.settings;
    if (!d.manual) {
      this.manual = null;
    } else if (d.manual.cmdId !== this.manual?.cmdId) {
      const remaining = d.manual.expiresAt - this.clock.epoch();
      this.manual =
        remaining > 0 ? { cmdId: d.manual.cmdId, pump: d.manual.pump, expiresAt: this.clock.mono() + remaining } : null;
    }
    this.appliedVersion = d.version;
    this.log(`${this.hardwareId}: applied desired v${d.version} (mode=${d.mode}, manual=${d.manual?.pump ?? '-'})`);
    this.tick(); // react immediately, like the firmware does
    this.publishReported(true);
  }

  private handleCommand(raw: string) {
    const cmd = commandPayload.parse(JSON.parse(raw));
    this.acks.push(cmd.type);
    if (cmd.type === 'ota') {
      // Simulated update: "install" the new version, ack, then reboot like the firmware does.
      this.fwVersion = cmd.version ?? this.fwVersion;
      this.t.publish(this.topic('cmdAck'), JSON.stringify({ cmdId: cmd.cmdId, ok: true }), { qos: 1 });
      this.t.drop(1500);
      return;
    }
    this.t.publish(this.topic('cmdAck'), JSON.stringify({ cmdId: cmd.cmdId, ok: true }), { qos: 1 });
    if (cmd.type === 'reboot') this.t.drop(2000);
  }

  private emitEvent(e: EventPayload) {
    if (this.t.isConnected()) {
      this.t.publish(this.topic('event'), JSON.stringify({ ...e, ts: this.clock.epoch() }), { qos: 1 });
    }
  }

  /** One control-loop iteration (the firmware runs this every second). */
  tick() {
    const now = this.clock.mono();
    const dtSec = ((now - this.lastTickMono) / 1000) * this.speed;
    this.lastTickMono = now;
    this.simSec += dtSec;

    const sec = Math.floor((now - this.startMono) / 1000);
    if (this.scenario.script && sec !== this.lastScriptSec) {
      this.lastScriptSec = sec;
      this.scenario.script(sec, this.scenarioCtx);
    }

    if (dtSec > 0) this.garden = step(this.garden, dtSec, this.pumpOn, new Date(this.clock.epoch()), this.scenario.physics, this.rng);
    const sensors = readSensors(this.garden, this.rng);
    const soil = this.sensorFault ? null : sensors.soilMoisture;

    const prev = { pumpOn: this.pumpOn, reason: this.pumpReason, manual: this.manual?.cmdId ?? null };
    const out = evaluateAutomation({
      now,
      mode: this.mode,
      settings: this.settings,
      soilMoisture: soil,
      rain: sensors.rain,
      pumpOn: this.pumpOn,
      pumpSince: this.pumpSince,
      cooldownUntil: this.cooldownUntil,
      manual: this.manual,
    });
    this.pumpOn = out.pumpOn;
    this.pumpSince = out.pumpSince;
    this.pumpReason = out.reason;
    this.cooldownUntil = out.cooldownUntil;
    this.manual = out.manual;

    if (out.reason === 'max_runtime' && prev.reason !== 'max_runtime') {
      this.emitEvent({ type: 'max_runtime', data: { maxPumpRunSec: this.settings.maxPumpRunSec } });
    }

    const telemetry: TelemetryPayload = {
      ts: this.clock.epoch(),
      soilMoisture: soil,
      soilRaw: this.sensorFault ? null : sensors.soilRaw,
      temperature: sensors.temperature,
      humidity: sensors.humidity,
      rain: sensors.rain,
      pump: this.pumpOn,
    };
    const pumpChanged = prev.pumpOn !== this.pumpOn;
    if (pumpChanged || now - this.lastTelemetryMono >= this.settings.telemetryIntervalSec * 1000) {
      this.lastTelemetryMono = now;
      this.sendTelemetry(telemetry);
    }

    const changed = pumpChanged || prev.reason !== this.pumpReason || prev.manual !== (this.manual?.cmdId ?? null);
    this.publishReported(changed);
  }

  private sendTelemetry(p: TelemetryPayload) {
    if (this.t.isConnected()) {
      this.t.publish(this.topic('telemetry'), JSON.stringify(p), { qos: 0 });
    } else {
      this.buffer.push(p);
      if (this.buffer.length > MAX_BUFFER) this.buffer.shift();
    }
  }

  reported(): ReportedState {
    const now = this.clock.mono();
    return {
      appliedVersion: this.appliedVersion,
      mode: this.mode,
      pump: this.pumpOn,
      pumpReason: this.pumpReason,
      manualCmdId: this.manual?.cmdId ?? null,
      manualRemainingSec: this.manual ? Math.max(0, Math.round((this.manual.expiresAt - now) / 1000)) : null,
      cooldownRemainingSec:
        this.cooldownUntil !== null ? Math.max(0, Math.round((this.cooldownUntil - now) / 1000)) : null,
      fwVersion: this.fwVersion,
      rssi: -45 - Math.round(this.rng.next() * 30),
      ssid: 'Simulated-WiFi',
      ip: null,
      uptimeSec: Math.round((now - this.startMono) / 1000),
      heapFree: 180_000,
      soilCalibrated: true,
    };
  }

  private publishReported(force: boolean) {
    if (!this.t.isConnected()) return;
    const now = this.clock.mono();
    const r = this.reported();
    // compare without the always-changing fields
    const { uptimeSec: _u, rssi: _r, manualRemainingSec: _m, cooldownRemainingSec: _c, ...stable } = r;
    const json = JSON.stringify(stable);
    if (!force && json === this.lastReportedJson && now - this.lastReportedMono < REPORTED_HEARTBEAT_MS) return;
    this.lastReportedJson = json;
    this.lastReportedMono = now;
    this.t.publish(this.topic('reported'), JSON.stringify(r), { retain: true, qos: 1 });
  }

  private get scenarioCtx(): ScenarioContext {
    return {
      garden: this.garden,
      setSensorFault: (faulty) => {
        if (faulty === this.sensorFault) return;
        this.sensorFault = faulty;
        this.emitEvent({ type: faulty ? 'sensor_fault' : 'sensor_recovered', data: { sensor: 'soil' } });
      },
      dropConnection: (sec) => {
        if (this.t.isConnected()) this.t.drop(sec === null ? null : sec * 1000);
      },
      random: () => this.rng.next(),
    };
  }
}
