// -----------------------------------------------------------------------------
// A fake Audi cloud, plugged in place of `fetch` (src/audi/http.js setFetch).
//
// It answers every endpoint the integration calls with what the real one
// returns, and records each call. The tests change its state (`cars`,
// `statuses`, `pendingStatus`, `deviceCodeSteps`…) to play the scenarios.
// -----------------------------------------------------------------------------

import { readFileSync } from 'node:fs';
import { setFetch } from '../../src/audi/http.js';

export const ETRON_VIN = 'WAUZZZGE1PB000001';
export const PETROL_VIN = 'WAUZZZ8V0LA000002';

export const loadFixture = (name) =>
  JSON.parse(readFileSync(new URL(`../fixtures/${name}.json`, import.meta.url), 'utf8'));

const json = (status, body, headers = {}) =>
  new Response(body === undefined ? null : JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json', 'Vcf-Remaining-Calls': '150', ...headers },
  });

export function createFakeAudi() {
  const fake = {
    calls: [],
    cars: [
      { vin: ETRON_VIN, nickname: 'My e-tron', model: 'Audi Q8 e-tron', status: 'status-etron' },
      { vin: PETROL_VIN, nickname: '', model: 'Audi A3 Sportback', status: 'status-petrol' },
    ],
    statuses: {},
    positions: {
      [ETRON_VIN]: { lat: 48.85661, lon: 2.35222, carCapturedTimestamp: '2026-10-18T17:40:00Z' },
      [PETROL_VIN]: null, // 204: driving
    },
    /** What the token endpoint answers to the device-code polls, in order. */
    deviceCodeSteps: ['authorization_pending', 'ok'],
    /** What pendingrequests says of a command. */
    pendingStatus: 'successful',
    refreshCount: 0,
    refreshError: null,
    failNext: null,
    pinChallenge: 'AABBCCDD',
    lastRequestId: 0,
  };
  fake.statuses[ETRON_VIN] = loadFixture('status-etron');
  fake.statuses[PETROL_VIN] = loadFixture('status-petrol');

  const tokens = () => {
    fake.refreshCount += 1;
    return {
      access_token: `idk-access-${fake.refreshCount}`,
      id_token: `idk-id-${fake.refreshCount}`,
      refresh_token: `idk-refresh-${fake.refreshCount}`,
      expires_in: 3600,
      token_type: 'bearer',
    };
  };

  async function handle(url, init = {}) {
    const method = init.method ?? 'GET';
    const { host, pathname, searchParams } = new URL(url);
    const body =
      typeof init.body === 'string'
        ? init.body.startsWith('{')
          ? JSON.parse(init.body)
          : Object.fromEntries(new URLSearchParams(init.body))
        : undefined;
    const headers = init.headers ?? {};
    fake.calls.push({
      method,
      host,
      path: pathname,
      query: searchParams.toString(),
      body,
      headers,
    });

    if (fake.failNext && pathname.includes(fake.failNext.path)) {
      const { status, body: errorBody } = fake.failNext;
      fake.failNext = null;
      return json(status, errorBody ?? { error: 'failure' });
    }

    // --- Discovery
    if (pathname.endsWith('/configurations/markets')) {
      return json(200, {
        countries: {
          countrySpecifications: { DE: { defaultLanguage: 'de' }, CA: { defaultLanguage: 'en' } },
        },
      });
    }
    if (pathname.includes('/configurations/market/')) {
      return json(200, {
        idkLoginServiceConfigurationURLProduction:
          'https://emea.bff.cariad.digital/auth/v1/idk/oidc/openid-configuration',
        myAudiAuthorizationServerProxyServiceURLProduction:
          'https://emea.bff.cariad.digital/login/v1/audi',
      });
    }
    if (pathname.endsWith('/openid-configuration')) {
      return json(200, {
        token_endpoint: 'https://emea.bff.cariad.digital/auth/v1/idk/oidc/token',
      });
    }

    // --- Identity
    if (pathname === '/oidc/v1/device_authorization') {
      return json(200, {
        device_code: 'dev-code-1',
        user_code: 'ABCD-EFGH',
        verification_uri: 'https://identity.vwgroup.io/device',
        verification_uri_complete: 'https://identity.vwgroup.io/device?user_code=ABCD-EFGH',
        expires_in: 600,
        interval: 5,
      });
    }
    if (pathname === '/auth/v1/idk/oidc/token') {
      if (body.grant_type === 'urn:ietf:params:oauth:grant-type:device_code') {
        const step = fake.deviceCodeSteps.shift() ?? 'expired_token';
        return step === 'ok' ? json(200, tokens()) : json(400, { error: step });
      }
      if (body.grant_type === 'refresh_token') {
        if (fake.refreshError) {
          return json(400, { error: fake.refreshError });
        }
        if (!String(body.refresh_token).startsWith('idk-refresh-')) {
          return json(400, { error: 'invalid_grant' });
        }
        return json(200, tokens());
      }
    }
    if (pathname === '/login/v1/audi/token') {
      return json(200, { access_token: `azs-${body.token}`, expires_in: 3600 });
    }

    // --- Car list
    if (pathname === '/vgql/v1/graphql') {
      return json(200, {
        data: {
          userVehicles: fake.cars.map((car) => ({
            vin: car.vin,
            nickname: car.nickname,
            vehicle: {
              core: { modelYear: 2024 },
              media: { shortName: car.model.split(' ').slice(1).join(' '), longName: car.model },
            },
          })),
        },
      });
    }

    // --- CARIAD BFF
    const vehicle = pathname.match(/^\/vehicle\/v1\/vehicles\/([A-Z0-9]+)\/(.+)$/);
    if (host === 'emea.bff.cariad.digital' && vehicle) {
      const [, vin, rest] = vehicle;
      if (rest === 'selectivestatus') {
        const status = fake.statuses[vin];
        if (searchParams.get('jobs') === 'climatisation') {
          return json(200, { climatisation: status?.climatisation });
        }
        return json(207, status ?? {});
      }
      if (rest === 'parkingposition') {
        const position = fake.positions[vin];
        return position ? json(200, { data: position }) : new Response(null, { status: 204 });
      }
      if (rest === 'pendingrequests') {
        return json(200, {
          data: [{ id: `req-${fake.lastRequestId}`, status: fake.pendingStatus }],
        });
      }
      if (
        [
          'vehiclewakeup',
          'charging/start',
          'charging/stop',
          'charging/start-stop',
          'charging/settings',
          'climatisation/start',
          'climatisation/stop',
        ].includes(rest)
      ) {
        fake.lastRequestId += 1;
        return json(rest === 'vehiclewakeup' ? 202 : 200, {
          data: { requestID: `req-${fake.lastRequestId}` },
        });
      }
      if (rest === 'honkandflash') {
        return new Response(null, { status: 204 });
      }
    }

    // --- MBB (lock / unlock)
    if (pathname === '/mbbcoauth/mobile/register/v1') {
      return json(200, { client_id: 'mbb-client-1' });
    }
    if (pathname === '/mbbcoauth/mobile/oauth2/v1/token') {
      return json(200, { access_token: `mbb-${body.token}`, expires_in: 3600 });
    }
    if (pathname.endsWith('/security-pin-auth-requested')) {
      return json(200, {
        securityPinAuthInfo: {
          securityToken: 'sec-token-1',
          securityPinTransmission: { challenge: fake.pinChallenge },
        },
      });
    }
    if (pathname.endsWith('/security-pin-auth-completed')) {
      return json(200, { securityToken: 'sec-token-2' });
    }
    const rlu = pathname.match(/^\/api\/bs\/rlu\/v1\/vehicles\/[A-Z0-9]+\/(lock|unlock)$/);
    if (rlu) {
      return json(200, { rluActionResponse: { requestId: 'rlu-1' } });
    }
    if (pathname.endsWith('/requests/rlu-1/status')) {
      return json(200, {
        requestStatusResponse: {
          status: fake.pendingStatus === 'successful' ? 'request_successful' : 'request_failed',
        },
      });
    }

    return json(404, { error: `fake Audi: no route for ${method} ${host}${pathname}` });
  }

  fake.fetch = handle;
  /** Calls to one path (substring match). */
  fake.callsTo = (fragment) => fake.calls.filter((call) => call.path.includes(fragment));
  return fake;
}

/** Install a fake Audi cloud as `fetch` for the current test; restored after it. */
export function useFakeAudi(t) {
  const fake = createFakeAudi();
  const previous = setFetch(fake.fetch);
  t.after(() => setFetch(previous));
  return fake;
}

/** A sleep that does not wait (the cloud commands poll every few seconds). */
export const noSleep = () => Promise.resolve();
