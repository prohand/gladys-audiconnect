// -----------------------------------------------------------------------------
// Scene actions (SDK v0.14+, Gladys 5.1+).
//
// Each one is declared in the manifest `scene_actions` field and handled here,
// keyed by the same `key`; index.js registers them with
// `gladys.onSceneAction(key, ...)`.
//
//   - `fields` arrive RESOLVED (scene variables substituted); a
//     `"source": "devices"` field is the chosen device external_id;
//   - the resolved object holds the declared `outputs` (scalars only);
//   - a car that refuses the order is an OUTPUT (`started: false`), not a
//     failure: a scene action is never a condition, the scene author gates on
//     the output. Throwing is kept for what the scene author can do nothing
//     about in the scene (the cloud unreachable, a device that is not a car).
//
// Scene TRIGGERS are fired by src/fleet.js (charging and lock state changes,
// a failed command).
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { CommandRefusedError } from '../audi/api.js';

const logger = createLogger({ name: 'scenes' });

function vinOrThrow(fleet, deviceExternalId) {
  const vin = fleet.vinOf(deviceExternalId);
  if (!vin) {
    throw new Error('This device is not a car of the linked myAudi account');
  }
  return vin;
}

/** Run a command; a refusal by the car becomes `{ done: false }`. */
async function attempt(fleet, vin, command, value) {
  try {
    const verdict = await fleet.execute(vin, command, value);
    return { done: true, confirmed: verdict === 'successful' };
  } catch (err) {
    if (err instanceof CommandRefusedError) {
      return { done: false, confirmed: false };
    }
    throw err;
  }
}

export const SCENE_ACTIONS = {
  async start_climatisation(gladys, { fields, fleet }) {
    logger.info(`Scene action start_climatisation <- ${fields.device}`);
    const vin = vinOrThrow(fleet, fields.device);
    const temperature = Number(fields.temperature);
    const { done, confirmed } = await attempt(
      fleet,
      vin,
      'start_climate',
      fields.temperature === undefined || fields.temperature === null || fields.temperature === ''
        ? null
        : Math.min(30, Math.max(16, temperature)),
    );
    return { started: done, confirmed };
  },

  async stop_climatisation(gladys, { fields, fleet }) {
    logger.info(`Scene action stop_climatisation <- ${fields.device}`);
    const vin = vinOrThrow(fleet, fields.device);
    const { done, confirmed } = await attempt(fleet, vin, 'stop_climate');
    return { stopped: done, confirmed };
  },

  async refresh_vehicle(gladys, { fields, fleet }) {
    logger.info(`Scene action refresh_vehicle <- ${fields.device}`);
    const vin = vinOrThrow(fleet, fields.device);
    const state = await fleet.read(vin, { wake: fields.wake === true });
    const bool = (value) => (value === undefined ? undefined : Boolean(value));
    return {
      battery_level: state.batteryLevel,
      range: state.electricRange ?? state.totalRange,
      fuel_level: state.fuelLevel,
      mileage: state.odometer,
      locked: bool(state.locked),
      charging: bool(state.charging),
      plugged: bool(state.plugged),
      climate_on: bool(state.climateOn),
    };
  },
};
