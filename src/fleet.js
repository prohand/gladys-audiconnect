// -----------------------------------------------------------------------------
// The cars of the linked account, and everything done to them.
//
//   - reads: one car at a time, through the Audi cloud, merged with the last
//     known state (a job missing from one answer does not erase a value);
//   - publication: the states to Gladys (only the values that changed, with a
//     heartbeat), the transport badge (cloud, or unreachable after a failed
//     read), and the device list again when a car starts reporting a new
//     feature;
//   - scene triggers: a charging state or a lock state that changed between
//     two reads, a command the car refused;
//   - commands: queued per car (the cloud takes one order at a time per car)
//     and run in the background, because Gladys waits 5 s for a command ack
//     and a car takes up to a minute to carry an order out.
// -----------------------------------------------------------------------------

import { createLogger, DEVICE_TRANSPORTS } from '@gladysassistant/integration-sdk';
import { CommandRefusedError } from './audi/api.js';
import { mergeVehicleState, parseVehicleState } from './audi/vehicleState.js';
import {
  buildCarDevice,
  carIds,
  carStates,
  featureByExternalId,
  featuresOf,
} from './devices/car.js';

const logger = createLogger({ name: 'fleet' });

/** Scene trigger keys, as declared in the manifest `scene_triggers`. Forever. */
export const TRIGGERS = {
  CHARGING_STATE_CHANGED: 'charging_state_changed',
  LOCK_STATE_CHANGED: 'lock_state_changed',
  COMMAND_FAILED: 'command_failed',
};
export const SCENE_TRIGGER_KEYS = Object.values(TRIGGERS);

/** Command names: the `command` values of the scene trigger filter. */
export const COMMANDS = [
  'lock',
  'unlock',
  'start_charging',
  'stop_charging',
  'target_soc',
  'start_climate',
  'stop_climate',
];

/** Unchanged values are re-sent this often, so they stay recently dated. */
const STATE_HEARTBEAT_MS = 30 * 60 * 1000;

/** After a command, the car is read again this much later, to show what it did. */
export const READ_AFTER_COMMAND_MS = 20_000;

export class Fleet {
  /**
   * @param {object} options
   * @param {object} options.gladys the SDK client
   * @param {import('./audi/api.js').AudiClient} options.client
   * @param {() => object} options.getConfig current normalized config
   * @param {(vin: string) => void} [options.onRead] after every successful read
   */
  constructor({ gladys, client, getConfig, onRead = () => {} }) {
    this.gladys = gladys;
    this.onRead = onRead;
    this.client = client;
    this.getConfig = getConfig;
    this.vehicles = new Map();
    this.states = new Map();
    this.errors = new Map();
    this.readAt = new Map();
    this.featureSets = new Map();
    this.queues = new Map();
    this.pendingTemperature = new Map();
    this.timers = new Set();
  }

  /** Replace the Audi client (a new session after a market change or a new link). */
  setClient(client) {
    this.client = client;
  }

  get list() {
    return [...this.vehicles.values()];
  }

  /** The VIN behind a Gladys device external id, null when it is not one of ours. */
  vinOf(deviceExternalId) {
    for (const vin of this.vehicles.keys()) {
      if (carIds(this.gladys, vin).device === deviceExternalId) {
        return vin;
      }
    }
    return null;
  }

  deviceIdOf(vin) {
    return carIds(this.gladys, vin).device;
  }

  /** Ask the cloud for the cars of the account. */
  async loadVehicles() {
    const list = await this.client.listVehicles();
    this.vehicles = new Map(list.map((vehicle) => [vehicle.vin, vehicle]));
    for (const vin of [...this.states.keys()]) {
      if (!this.vehicles.has(vin)) {
        this.states.delete(vin);
      }
    }
    logger.info(`${list.length} car(s) on the myAudi account`);
    return list;
  }

  /** The discovery payload: every car, with the features it reported so far. */
  discoveredDevices() {
    return this.list.map((vehicle) =>
      buildCarDevice(this.gladys, vehicle, this.states.get(vehicle.vin) ?? null),
    );
  }

  async publishDevices() {
    for (const vehicle of this.list) {
      this.featureSets.set(vehicle.vin, featureSignature(this.states.get(vehicle.vin)));
    }
    await this.gladys.publishDiscoveredDevices(this.discoveredDevices());
  }

  async publishTransports() {
    const entries = this.list.map((vehicle) => ({
      external_id: this.deviceIdOf(vehicle.vin),
      transport: this.errors.has(vehicle.vin)
        ? DEVICE_TRANSPORTS.UNREACHABLE
        : DEVICE_TRANSPORTS.CLOUD,
    }));
    if (entries.length > 0) {
      await this.gladys.publishTransports(entries);
    }
  }

  /**
   * Read one car and publish what changed.
   *
   * @param {string} vin
   * @param {{ wake?: boolean }} [options] wake: ask the car itself first
   */
  async read(vin, { wake = false } = {}) {
    const vehicle = this.vehicles.get(vin);
    if (!vehicle) {
      throw new Error('Unknown car');
    }
    const previous = this.states.get(vin) ?? null;
    let next;
    try {
      if (wake) {
        await this.client.wakeUp(vin);
      }
      const status = await this.client.getStatus(vin);
      const position = await this.client.getPosition(vin).catch((err) => {
        logger.warn(`Parking position of ${vehicle.name} not read: ${err.message}`);
        return null;
      });
      next = mergeVehicleState(previous, parseVehicleState(status, position));
    } catch (err) {
      const wasReachable = !this.errors.has(vin);
      this.errors.set(vin, err.message);
      if (wasReachable) {
        await this.publishTransports().catch(() => {});
      }
      throw err;
    }

    this.states.set(vin, next);
    this.readAt.set(vin, Date.now());
    if (this.errors.delete(vin)) {
      await this.publishTransports().catch(() => {});
    }

    // A feature seen for the first time (first successful read after a failed
    // discovery, a plug-in hybrid reporting its battery…): Gladys only stores
    // states of features it knows, so the device is published again first.
    if (this.featureSets.get(vin) !== featureSignature(next)) {
      await this.publishDevices();
    }
    await this.gladys.publishChangedStates(carStates(this.gladys, vehicle, next), {
      heartbeat: STATE_HEARTBEAT_MS,
    });
    await this.fireTransitions(vehicle, previous, next);
    this.onRead(vin);
    return next;
  }

  /** Send every known state of a car again (a device the user just created). */
  async republish(vin) {
    const vehicle = this.vehicles.get(vin);
    const state = this.states.get(vin);
    if (!vehicle || !state) {
      return;
    }
    this.gladys.forgetPublishedStates(this.deviceIdOf(vin));
    await this.gladys.publishChangedStates(carStates(this.gladys, vehicle, state), {
      heartbeat: STATE_HEARTBEAT_MS,
    });
  }

  /** Read every car; one failing car does not stop the others. */
  async readAll() {
    const results = [];
    for (const vehicle of this.list) {
      try {
        results.push(await this.read(vehicle.vin));
      } catch (err) {
        logger.error(`Reading ${vehicle.name} failed: ${err.message}`);
      }
    }
    return results;
  }

  async fireTransitions(vehicle, previous, next) {
    if (!previous) {
      // First read: a state, not a change. Firing here would start every
      // "charging finished" scene at each restart of the integration.
      return;
    }
    const device = this.deviceIdOf(vehicle.vin);
    if (next.chargingPhase && next.chargingPhase !== previous.chargingPhase) {
      await this.fire(TRIGGERS.CHARGING_STATE_CHANGED, {
        device,
        device_name: vehicle.name,
        state: next.chargingPhase,
        battery_level: next.batteryLevel,
        range: next.electricRange ?? next.totalRange,
      });
    }
    if (
      next.locked !== undefined &&
      previous.locked !== undefined &&
      next.locked !== previous.locked
    ) {
      await this.fire(TRIGGERS.LOCK_STATE_CHANGED, {
        device,
        device_name: vehicle.name,
        state: next.locked ? 'locked' : 'unlocked',
      });
    }
  }

  async fire(key, data) {
    // Flat primitives only: drop what the car did not report.
    const clean = Object.fromEntries(Object.entries(data).filter(([, v]) => v !== undefined));
    try {
      await this.gladys.publishSceneEvent(key, clean);
    } catch (err) {
      logger.warn(`Scene trigger ${key} not accepted: ${err.message}`);
    }
  }

  /**
   * A Gladys command on a feature. Resolves once the order is QUEUED, so the
   * ack reaches Gladys within its 5 s; the order runs in the background.
   */
  async setValue(device, feature, value) {
    const vin = this.vinOf(device.external_id);
    if (!vin) {
      throw new Error(`Not a car of this account: ${device.external_id}`);
    }
    const definition = featureByExternalId(this.gladys, vin, feature.external_id);
    if (!definition?.command) {
      throw new Error(`This feature cannot be controlled: ${feature.external_id}`);
    }
    const numeric = Number(value);

    if (definition.command === 'target_temperature') {
      // Applied at the next climate start: changing the stored settings alone
      // would need the whole object written back, for a value the start sends
      // anyway.
      const temperature = Math.min(30, Math.max(16, Math.round(numeric * 2) / 2));
      this.pendingTemperature.set(vin, temperature);
      await this.gladys.publishState(feature.external_id, temperature);
      return;
    }

    const command = commandFor(definition.command, numeric);
    const argument = command === 'target_soc' ? numeric : undefined;
    this.enqueue(vin, () => this.runCommand(vin, command, argument)).catch(() => {
      // Already logged and reported through the command_failed trigger.
    });
  }

  /**
   * Run one command now (queued behind the others of the same car) and wait
   * for the car's verdict. Used by the scene actions, which can wait.
   *
   * @returns {Promise<'successful' | 'unconfirmed'>}
   */
  execute(vin, command, value) {
    return this.enqueue(vin, () => this.runCommand(vin, command, value));
  }

  enqueue(vin, task) {
    const previous = this.queues.get(vin) ?? Promise.resolve();
    const run = previous.catch(() => {}).then(task);
    this.queues.set(vin, run);
    run
      .finally(() => {
        if (this.queues.get(vin) === run) {
          this.queues.delete(vin);
        }
      })
      .catch(() => {});
    return run;
  }

  async runCommand(vin, command, value) {
    const vehicle = this.vehicles.get(vin);
    const ids = carIds(this.gladys, vin);
    logger.info(`${vehicle?.name ?? 'Car'}: ${command}`);
    try {
      let verdict;
      let published;
      switch (command) {
        case 'lock':
        case 'unlock':
          verdict = await this.client.setLock(vin, command === 'lock', this.getConfig().spin);
          published = ['lock', command === 'lock' ? 1 : 0];
          break;
        case 'start_charging':
        case 'stop_charging':
          verdict = await this.client.setCharging(vin, command === 'start_charging');
          published = ['charging', command === 'start_charging' ? 1 : 0];
          break;
        case 'target_soc': {
          const target = Math.min(100, Math.max(20, Math.round(value)));
          verdict = await this.client.setTargetSoc(vin, target);
          published = ['target_soc', target];
          break;
        }
        case 'start_climate': {
          const temperature =
            value !== undefined && value !== null && Number.isFinite(Number(value))
              ? Number(value)
              : (this.pendingTemperature.get(vin) ?? null);
          verdict = await this.client.startClimatisation(vin, temperature);
          published = ['climate', 1];
          break;
        }
        case 'stop_climate':
          verdict = await this.client.stopClimatisation(vin);
          published = ['climate', 0];
          break;
        default:
          throw new Error(`Unknown command ${command}`);
      }
      // Only a feature the device declares can take a state.
      const [featureKey, featureValue] = published;
      const declared = featuresOf(this.states.get(vin) ?? null).some((f) => f.key === featureKey);
      if (declared) {
        await this.gladys.publishState(ids.feature(featureKey), featureValue).catch((err) => {
          logger.warn(`State after ${command} not accepted by Gladys: ${err.message}`);
        });
      }
      this.readLater(vin);
      return verdict;
    } catch (err) {
      logger.error(`${vehicle?.name ?? 'Car'}: ${command} failed: ${err.message}`);
      await this.fire(TRIGGERS.COMMAND_FAILED, {
        device: ids.device,
        device_name: vehicle?.name,
        command,
        reason: err instanceof CommandRefusedError ? err.reason : 'error',
        message: err.message.slice(0, 200),
      });
      // Put Gladys back on what the car really is.
      const state = this.states.get(vin);
      if (state && vehicle) {
        this.gladys.forgetPublishedStates(ids.device);
        await this.gladys
          .publishChangedStates(carStates(this.gladys, vehicle, state))
          .catch(() => {});
      }
      throw err;
    }
  }

  readLater(vin) {
    const timer = setTimeout(() => {
      this.timers.delete(timer);
      this.read(vin).catch((err) => logger.warn(`Read after command failed: ${err.message}`));
    }, READ_AFTER_COMMAND_MS);
    timer.unref?.();
    this.timers.add(timer);
  }

  /** Cancel the reads scheduled after commands (disconnection, shutdown). */
  stop() {
    for (const timer of this.timers) {
      clearTimeout(timer);
    }
    this.timers.clear();
  }
}

function commandFor(kind, value) {
  switch (kind) {
    case 'lock':
      return value === 1 ? 'lock' : 'unlock';
    case 'charging':
      return value === 1 ? 'start_charging' : 'stop_charging';
    case 'climate':
      return value === 1 ? 'start_climate' : 'stop_climate';
    case 'target_soc':
      return 'target_soc';
    default:
      throw new Error(`Unknown command ${kind}`);
  }
}

function featureSignature(state) {
  return featuresOf(state ?? null)
    .map((feature) => feature.key)
    .join(',');
}
