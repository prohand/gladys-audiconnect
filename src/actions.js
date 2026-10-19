// -----------------------------------------------------------------------------
// Buttons of the Configuration screen (manifest `actions`).
//
// Each handler resolves the multi-language message shown under the button. The
// ack is awaited under the action's `timeout_seconds` (manifest), not the usual
// 5 s: waking a car up takes up to a minute and a half.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { rateLimit } from './audi/http.js';
import { ACTION_MESSAGES, connectionReport, failed } from './messages.js';

const logger = createLogger({ name: 'actions' });

export const MANIFEST_ACTIONS = {
  /** Sign in again with the stored link, list the cars, say what came back. */
  async test_connection({ fleet, connect, isLinked }) {
    if (!isLinked()) {
      return connectionReport({ linked: false });
    }
    try {
      await connect();
      return connectionReport({
        linked: true,
        cars: fleet.list.map((vehicle) => vehicle.name),
        remaining: rateLimit.remaining,
      });
    } catch (err) {
      logger.warn(`Test the connection: ${err.message}`);
      return connectionReport({ linked: true, error: err.message.slice(0, 150) });
    }
  },

  /** Read one car now; with `wake`, ask the car itself for fresh values first. */
  async refresh_now({ fleet, fields }) {
    const vin = fleet.vinOf(fields.device);
    if (!vin) {
      return ACTION_MESSAGES.unknownCar;
    }
    const wake = fields.wake === true || fields.wake === 'true';
    try {
      await fleet.read(vin, { wake });
      return wake ? ACTION_MESSAGES.woken : ACTION_MESSAGES.refreshed;
    } catch (err) {
      return failed(err.message.slice(0, 150));
    }
  },

  /** Flash the lights of the chosen car, to find it in a car park. */
  async identify({ fleet, fields }) {
    const vin = fleet.vinOf(fields.device);
    if (!vin) {
      return ACTION_MESSAGES.unknownCar;
    }
    const state = fleet.states.get(vin);
    if (state?.latitude === undefined || state?.longitude === undefined) {
      return ACTION_MESSAGES.noPosition;
    }
    try {
      await fleet.client.flashLights(vin, state.latitude, state.longitude);
      return ACTION_MESSAGES.flashing;
    } catch (err) {
      return failed(err.message.slice(0, 150));
    }
  },
};
