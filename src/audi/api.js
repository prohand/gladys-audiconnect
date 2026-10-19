// -----------------------------------------------------------------------------
// The Audi cloud calls the integration makes, one method each.
//
// Reading costs: the account has a metered daily allowance of calls (see
// `rateLimit` in http.js), so nothing here wakes the car or polls on its own.
// `getStatus` reads what the car last sent to the cloud; only `wakeUp` asks the
// car itself for fresh values, and it is only called on a user's request.
//
// Commands are asynchronous on the car side: the cloud answers 200/202 with a
// request id as soon as it QUEUED the order, and the car carries it out (or
// not) later. `confirm` follows that request id, and tells "the car did it"
// from "the car refused" from "no verdict in time" — the last one is NOT a
// failure: the order may still be carried out, the next read will say.
// -----------------------------------------------------------------------------

import { createHash } from 'node:crypto';
import { createLogger } from '@gladysassistant/integration-sdk';
import { AudiHttpError, request } from './http.js';

const logger = createLogger({ name: 'audi-api' });

/** The selectivestatus jobs read on every refresh: what the devices show. */
export const STATUS_JOBS = [
  'access',
  'charging',
  'climatisation',
  'fuelStatus',
  'measurements',
  'vehicleHealthInspection',
];

const GRAPHQL_URL = 'https://app-api.live-my.audi.com/vgql/v1/graphql';
const VEHICLE_LIST_QUERY =
  'query vehicleList {\n userVehicles {\n vin\n mappingVin\n vehicle { core { modelYear\n }\n media { shortName\n longName }\n }\n csid\n commissionNumber\n type\n devicePlatform\n mbbConnect\n userRole {\n role\n }\n vehicle {\n classification {\n driveTrain\n }\n }\n nickname\n }\n}';

/** MBB hosts serving lock / unlock, tried in this order (the first that answers is kept). */
const MBB_LOCK_HOSTS = [
  'https://mal-3a.prd.eu.dp.vwg-connect.com',
  'https://mal-1a.prd.ece.vwg-connect.com',
];

/** How long a command is followed. Every check costs one call of the allowance. */
export const CONFIRM = {
  charging: { attempts: 3, sleepMs: 5_000 },
  climatisation: { attempts: 8, sleepMs: 10_000 },
  wakeUp: { attempts: 10, sleepMs: 10_000 },
  lock: { attempts: 10, sleepMs: 5_000 },
};

/** Settings the car reports and expects back when climatisation starts with new settings. */
const CLIMATE_PASSTHROUGH = [
  'climatisationWithoutExternalPower',
  'climatizationAtUnlock',
  'windowHeatingEnabled',
  'zoneFrontLeftEnabled',
  'zoneFrontRightEnabled',
  'zoneRearLeftEnabled',
  'zoneRearRightEnabled',
  'heaterSource',
];
const CLIMATE_DEFAULTS = {
  climatisationWithoutExternalPower: true,
  climatizationAtUnlock: false,
  windowHeatingEnabled: false,
  zoneFrontLeftEnabled: false,
  zoneFrontRightEnabled: false,
  zoneRearLeftEnabled: false,
  zoneRearRightEnabled: false,
};

/** A command the car (or the cloud) explicitly refused. */
export class CommandRefusedError extends Error {
  constructor(message, reason) {
    super(message);
    this.name = 'CommandRefusedError';
    this.reason = reason;
  }
}

export class AudiClient {
  /**
   * @param {import('./auth.js').AudiSession} session
   * @param {object} [options]
   * @param {(ms: number) => Promise<void>} [options.sleep] (tests)
   */
  constructor(session, { sleep } = {}) {
    this.session = session;
    this.sleep = sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.lockHosts = new Map();
  }

  vehicleUrl(vin, path) {
    return `${this.session.bff}/vehicle/v1/vehicles/${vin.toUpperCase()}/${path}`;
  }

  /**
   * The cars of the account.
   *
   * @returns {Promise<Array<{ vin: string, name: string, model: string | null, modelYear: number | null }>>}
   */
  async listVehicles() {
    const token = await this.session.azsToken();
    const { language } = await this.session.discover();
    const { data } = await request(GRAPHQL_URL, {
      method: 'POST',
      token,
      headers: {
        'Accept-Language': `${language}-${this.session.market}`,
        'X-User-Country': this.session.market,
      },
      json: { query: VEHICLE_LIST_QUERY },
    });
    if (data?.errors) {
      throw new Error(
        `The myAudi server refused the car list: ${JSON.stringify(data.errors).slice(0, 200)}`,
      );
    }
    const vehicles = data?.data?.userVehicles;
    if (!Array.isArray(vehicles)) {
      throw new Error('The myAudi server sent no car list');
    }
    return vehicles
      .filter((item) => typeof item?.vin === 'string' && item.vin.length > 0)
      .map((item) => ({
        vin: item.vin.toUpperCase(),
        name: item.nickname || item.vehicle?.media?.shortName || `Audi ${item.vin.slice(-4)}`,
        model: item.vehicle?.media?.longName ?? null,
        modelYear: Number(item.vehicle?.core?.modelYear) || null,
      }));
  }

  /** What the car last reported to the cloud (selectivestatus, raw). */
  async getStatus(vin) {
    const token = await this.session.bffToken();
    const { data } = await request(
      this.vehicleUrl(vin, `selectivestatus?jobs=${STATUS_JOBS.join(',')}`),
      {
        token,
      },
    );
    return data ?? {};
  }

  /**
   * Where the car is parked. `{ moving: true }` when the cloud answers 204 (the
   * car is driving: no parking position), null when the car does not share it.
   */
  async getPosition(vin) {
    const token = await this.session.bffToken();
    try {
      const { status, data } = await request(this.vehicleUrl(vin, 'parkingposition'), { token });
      if (status === 204 || !data?.data) {
        return { moving: true };
      }
      const latitude = Number(data.data.lat);
      const longitude = Number(data.data.lon);
      if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
        return null;
      }
      return { moving: false, latitude, longitude, at: data.data.carCapturedTimestamp ?? null };
    } catch (err) {
      // 403/404: position sharing is off in myAudi, or the car has none.
      if (err instanceof AudiHttpError && (err.status === 403 || err.status === 404)) {
        return null;
      }
      throw err;
    }
  }

  /** Ask the car itself to send fresh values (costs the car's battery, use sparingly). */
  async wakeUp(vin) {
    const token = await this.session.bffToken();
    const { data } = await request(this.vehicleUrl(vin, 'vehiclewakeup'), {
      method: 'POST',
      token,
    });
    return this.confirm(vin, data?.data?.requestID, 'wake-up', CONFIRM.wakeUp);
  }

  /** Start (true) or stop (false) charging now. */
  async setCharging(vin, start) {
    const action = start ? 'start' : 'stop';
    let response;
    try {
      response = await this.command(vin, 'POST', `charging/${action}`, {});
    } catch (err) {
      // Older cars only know the combined route.
      if (!(err instanceof AudiHttpError && err.status === 404)) {
        throw err;
      }
      response = await this.command(vin, 'POST', 'charging/start-stop', { action });
    }
    return this.confirm(vin, response?.data?.requestID, `charging ${action}`, CONFIRM.charging);
  }

  /** The level charging stops at, 20 to 100 %. */
  async setTargetSoc(vin, percent) {
    const target = Math.round(Number(percent));
    if (!(target >= 20 && target <= 100)) {
      throw new RangeError('The target charge level must be between 20 and 100 %');
    }
    const response = await this.command(vin, 'PUT', 'charging/settings', { targetSOC_pct: target });
    return this.confirm(vin, response?.data?.requestID, 'target charge level', CONFIRM.charging);
  }

  /**
   * Start climatisation. Without a temperature the car uses the settings it
   * stores (what the myAudi app does). With one, the start replaces the WHOLE
   * settings object: the car's own settings are read and sent back with only
   * the temperature changed, so seat zones and window heating are kept.
   */
  async startClimatisation(vin, temperatureC = null) {
    let body;
    if (temperatureC !== null && temperatureC !== undefined) {
      const stored = await this.getClimatisationSettings(vin);
      body = buildClimatisationStartBody(stored, temperatureC);
    }
    const response = await this.command(vin, 'POST', 'climatisation/start', body);
    return this.confirm(
      vin,
      response?.data?.requestID,
      'climatisation start',
      CONFIRM.climatisation,
    );
  }

  async stopClimatisation(vin) {
    const response = await this.command(vin, 'POST', 'climatisation/stop');
    return this.confirm(
      vin,
      response?.data?.requestID,
      'climatisation stop',
      CONFIRM.climatisation,
    );
  }

  async getClimatisationSettings(vin) {
    const token = await this.session.bffToken();
    const { data } = await request(this.vehicleUrl(vin, 'selectivestatus?jobs=climatisation'), {
      token,
    });
    const value = data?.climatisation?.climatisationSettings?.value;
    return value && typeof value === 'object' ? value : {};
  }

  /**
   * Flash the lights for 10 s (never the horn: a dashboard button must not be
   * able to wake the street). The cloud requires the user's position: the
   * car's own parking position is given.
   */
  async flashLights(vin, latitude, longitude) {
    await this.command(vin, 'POST', 'honkandflash', {
      duration_s: 10,
      mode: 'flash',
      userPosition: { latitude, longitude },
    });
  }

  /**
   * Lock (true) or unlock (false), through the MBB platform, with the S-PIN.
   *
   * @returns {Promise<'successful' | 'unconfirmed'>}
   */
  async setLock(vin, lock, spin) {
    if (!/^[0-9]{4}$/.test(String(spin ?? ''))) {
      throw new CommandRefusedError(
        'The S-PIN (4 digits) is required to lock or unlock',
        'spin_missing',
      );
    }
    const VIN = vin.toUpperCase();
    const operation = lock ? 'LOCK' : 'UNLOCK';
    const token = await this.session.mbbToken();
    const { host, challenge } = await this.requestPinChallenge(VIN, operation, token);

    const pinHeaders = {
      'User-Agent': 'okhttp/3.7.0',
      'X-App-Version': '3.14.0',
      'X-App-Name': 'myAudi',
    };
    const { data: completed } = await request(
      `${host}/api/rolesrights/authorization/v2/security-pin-auth-completed`,
      {
        method: 'POST',
        token,
        headers: pinHeaders,
        json: {
          securityPinAuthentication: {
            securityPin: {
              challenge: challenge.challenge,
              securityPinHash: securityPinHash(spin, challenge.challenge),
            },
            securityToken: challenge.securityToken,
          },
        },
        throwOnError: false,
      },
    );
    if (!completed?.securityToken) {
      throw new CommandRefusedError('The S-PIN was refused', 'spin_refused');
    }

    const { data } = await request(
      `${host}/api/bs/rlu/v1/vehicles/${VIN}/${lock ? 'lock' : 'unlock'}`,
      {
        method: 'POST',
        token,
        headers: {
          'Content-Type': 'application/vnd.vwg.mbb.RemoteLockUnlock_v1_0_0+xml',
          Accept:
            'application/json, application/vnd.vwg.mbb.RemoteLockUnlock_v1_0_0+xml, application/vnd.vwg.mbb.genericError_v1_0_2+xml, */*',
          'x-securityToken': completed.securityToken,
        },
      },
    );
    const requestId = data?.rluActionResponse?.requestId;
    if (!requestId) {
      return 'unconfirmed';
    }
    for (let attempt = 0; attempt < CONFIRM.lock.attempts; attempt += 1) {
      await this.sleep(CONFIRM.lock.sleepMs);
      const { data: status } = await request(
        `${host}/api/bs/rlu/v1/vehicles/${VIN}/requests/${requestId}/status`,
        { token, headers: { 'X-Client-ID': this.session.mbbClientId } },
      );
      const verdict = status?.requestStatusResponse?.status;
      if (verdict === 'request_successful') {
        return 'successful';
      }
      if (verdict === 'request_failed') {
        throw new CommandRefusedError(`The car refused to ${lock ? 'lock' : 'unlock'}`, 'refused');
      }
    }
    return 'unconfirmed';
  }

  async requestPinChallenge(VIN, operation, token) {
    const hosts = this.lockHosts.has(VIN) ? [this.lockHosts.get(VIN)] : MBB_LOCK_HOSTS;
    let lastError;
    for (const host of hosts) {
      try {
        const { data } = await request(
          `${host}/api/rolesrights/authorization/v2/vehicles/${VIN}/services/rlu_v1/operations/${operation}/security-pin-auth-requested`,
          {
            token,
            headers: {
              'User-Agent': 'okhttp/3.7.0',
              'X-App-Version': '3.14.0',
            },
          },
        );
        const info = data?.securityPinAuthInfo;
        if (info?.securityToken && info?.securityPinTransmission?.challenge) {
          this.lockHosts.set(VIN, host);
          return {
            host,
            challenge: {
              securityToken: info.securityToken,
              challenge: info.securityPinTransmission.challenge,
            },
          };
        }
        lastError = new Error('No S-PIN challenge in the answer');
      } catch (err) {
        lastError = err;
        logger.debug(`S-PIN challenge refused by ${new URL(host).host}: ${err.message}`);
      }
    }
    throw lastError;
  }

  async command(vin, method, path, json) {
    const token = await this.session.bffToken();
    const { data } = await request(this.vehicleUrl(vin, path), {
      method,
      token,
      // The BFF commands answer to the bare app client, without X-App-*.
      headers: { 'X-App-Version': undefined, 'X-App-Name': undefined },
      json,
    });
    return data;
  }

  /**
   * Follow a queued command until the car carries it out.
   *
   * @returns {Promise<'successful' | 'unconfirmed'>}
   */
  async confirm(vin, requestId, label, { attempts, sleepMs }) {
    if (!requestId) {
      logger.debug(`${label}: accepted, no request id to follow`);
      return 'unconfirmed';
    }
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      await this.sleep(sleepMs);
      const token = await this.session.bffToken();
      const { data } = await request(this.vehicleUrl(vin, 'pendingrequests'), { token });
      const pending = (data?.data ?? []).find((item) => item?.id === requestId);
      if (!pending || pending.status === 'in_progress') {
        continue;
      }
      if (pending.status === 'successful') {
        return 'successful';
      }
      throw new CommandRefusedError(
        `The car did not carry out the ${label} (${pending.status})`,
        pending.status,
      );
    }
    logger.info(
      `${label}: queued, not confirmed by the car within ${(attempts * sleepMs) / 1000} s`,
    );
    return 'unconfirmed';
  }
}

/**
 * Body of climatisation/start with a new target temperature: the car's own
 * settings, the temperature changed. Exported for the tests.
 */
export function buildClimatisationStartBody(stored, temperatureC) {
  const settings = stored && Object.keys(stored).length > 0 ? stored : CLIMATE_DEFAULTS;
  const body = Object.fromEntries(
    CLIMATE_PASSTHROUGH.filter((key) => key in settings).map((key) => [key, settings[key]]),
  );
  // The car stores half degrees.
  body.targetTemperature = Math.round(Number(temperatureC) * 2) / 2;
  body.targetTemperatureUnit = 'celsius';
  body.climatisationMode = settings.climatisationMode || 'comfort';
  return body;
}

/** SHA-512 of the S-PIN bytes followed by the challenge bytes, hex upper-case. */
export function securityPinHash(spin, challenge) {
  const bytes = Buffer.concat([hexBytes(String(spin)), hexBytes(String(challenge))]);
  return createHash('sha512').update(bytes).digest('hex').toUpperCase();
}

function hexBytes(hex) {
  const pairs = hex.match(/.{1,2}/g) ?? [];
  return Buffer.from(pairs.map((pair) => Number.parseInt(pair, 16)));
}
