// -----------------------------------------------------------------------------
// Polling of the cars.
//
// Gladys calls `onPoll` for every car once a minute (the slowest pace it
// offers, read once when the device is created). The integration reads a car
// at the interval of the configuration instead (a quarter of an hour by
// default): every read costs calls of the account's daily allowance. The polls
// in between are skipped, so the user can change the interval at any time
// without re-creating the devices.
// -----------------------------------------------------------------------------

import { DEVICE_POLL_FREQUENCIES } from '@gladysassistant/integration-sdk';

// Gladys' poll ticks drift by a few milliseconds: a read due within the next
// half-minute runs now, so a 900 s interval does not slip to 960 s.
const POLL_TOLERANCE_MS = DEVICE_POLL_FREQUENCIES.EVERY_MINUTES / 2;

/**
 * Create the `onPoll` dispatcher.
 *
 * Resolves `true` when the car was read, `false` when the poll was skipped
 * (not due, or not one of our cars). A read that throws is retried at the
 * next poll; reads made elsewhere (a command, a scene) count as reads.
 *
 * @param {import('../fleet.js').Fleet} fleet
 */
export function createPoller(fleet) {
  return async function pollDevice(device, config) {
    const vin = fleet.vinOf(device.external_id);
    if (!vin) {
      return false;
    }
    const lastRead = fleet.readAt.get(vin);
    if (
      lastRead !== undefined &&
      Date.now() - lastRead < config.poll_frequency * 1000 - POLL_TOLERANCE_MS
    ) {
      return false;
    }
    await fleet.read(vin);
    return true;
  };
}
