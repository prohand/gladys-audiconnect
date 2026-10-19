import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  AudiClient,
  CommandRefusedError,
  STATUS_JOBS,
  buildClimatisationStartBody,
  securityPinHash,
} from '../src/audi/api.js';
import { AudiSession } from '../src/audi/auth.js';
import { rateLimit } from '../src/audi/http.js';
import { ETRON_VIN, PETROL_VIN, noSleep, useFakeAudi } from './helpers/fakeAudi.js';

async function linkedClient(t) {
  const fake = useFakeAudi(t);
  const session = new AudiSession();
  await session.loginWithRefreshToken('idk-refresh-0');
  return { fake, client: new AudiClient(session, { sleep: noSleep }) };
}

test('the car list comes from GraphQL, nickname first', async (t) => {
  const { client } = await linkedClient(t);
  const cars = await client.listVehicles();
  assert.deepEqual(cars, [
    { vin: ETRON_VIN, name: 'My e-tron', model: 'Audi Q8 e-tron', modelYear: 2024 },
    { vin: PETROL_VIN, name: 'A3 Sportback', model: 'Audi A3 Sportback', modelYear: 2024 },
  ]);
  assert.equal(rateLimit.remaining, 150, 'the daily allowance is read from every answer');
});

test('the status reads the jobs the devices need, with the IDK token', async (t) => {
  const { fake, client } = await linkedClient(t);
  const status = await client.getStatus(ETRON_VIN);
  assert.equal(status.charging.batteryStatus.value.currentSOC_pct, 69);
  const [call] = fake.callsTo('/selectivestatus');
  assert.equal(new URLSearchParams(call.query).get('jobs'), STATUS_JOBS.join(','));
  assert.equal(call.headers.Authorization, 'Bearer idk-access-1');
});

test('a parked car has a position, a driving one (204) has none', async (t) => {
  const { client } = await linkedClient(t);
  assert.deepEqual(await client.getPosition(ETRON_VIN), {
    moving: false,
    latitude: 48.85661,
    longitude: 2.35222,
    at: '2026-10-18T17:40:00Z',
  });
  assert.deepEqual(await client.getPosition(PETROL_VIN), { moving: true });
});

test('charging falls back on the combined route of older cars', async (t) => {
  const { fake, client } = await linkedClient(t);
  fake.failNext = { path: '/charging/start', status: 404 };
  assert.equal(await client.setCharging(ETRON_VIN, true), 'successful');
  const [combined] = fake.callsTo('/charging/start-stop');
  assert.deepEqual(combined.body, { action: 'start' });
});

test('a command the car refuses is a CommandRefusedError', async (t) => {
  const { fake, client } = await linkedClient(t);
  fake.pendingStatus = 'failed';
  await assert.rejects(client.stopClimatisation(ETRON_VIN), CommandRefusedError);
});

test('a command without a verdict in time is unconfirmed, not failed', async (t) => {
  const { fake, client } = await linkedClient(t);
  fake.pendingStatus = 'in_progress';
  assert.equal(await client.setTargetSoc(ETRON_VIN, 80), 'unconfirmed');
  const [settings] = fake.callsTo('/charging/settings');
  assert.deepEqual(settings.body, { targetSOC_pct: 80 });
  await assert.rejects(client.setTargetSoc(ETRON_VIN, 10), RangeError);
});

test('climate starts with the car settings, or with them and a new temperature', async (t) => {
  const { fake, client } = await linkedClient(t);
  await client.startClimatisation(ETRON_VIN);
  assert.equal(fake.callsTo('/climatisation/start')[0].body, undefined);

  await client.startClimatisation(ETRON_VIN, 21.3);
  const body = fake.callsTo('/climatisation/start')[1].body;
  assert.equal(body.targetTemperature, 21.5, 'half degrees, as the car stores them');
  assert.equal(body.windowHeatingEnabled, false, 'the stored settings are sent back');
  assert.equal(body.climatisationMode, 'comfort');
});

test('the start body of a car without stored settings uses the defaults', () => {
  const body = buildClimatisationStartBody({}, 22);
  assert.equal(body.climatisationWithoutExternalPower, true);
  assert.equal(body.targetTemperatureUnit, 'celsius');
});

test('the S-PIN hash is SHA-512 of the PIN and challenge bytes', () => {
  const expected = createHash('sha512')
    .update(Buffer.from([0x12, 0x34, 0xaa, 0xbb]))
    .digest('hex')
    .toUpperCase();
  assert.equal(securityPinHash('1234', 'AABB'), expected);
});

test('locking goes through the S-PIN challenge and follows the request', async (t) => {
  const { fake, client } = await linkedClient(t);
  assert.equal(await client.setLock(ETRON_VIN, true, '1234'), 'successful');
  const [completed] = fake.callsTo('/security-pin-auth-completed');
  assert.equal(
    completed.body.securityPinAuthentication.securityPin.securityPinHash,
    securityPinHash('1234', 'AABBCCDD'),
  );
  const [lock] = fake.callsTo('/rlu/v1/vehicles/');
  assert.equal(lock.headers['x-securityToken'], 'sec-token-2');
  assert.equal(lock.headers.Authorization, 'Bearer mbb-idk-id-1');
});

test('no S-PIN, no lock command sent', async (t) => {
  const { fake, client } = await linkedClient(t);
  await assert.rejects(
    client.setLock(ETRON_VIN, false, ''),
    (err) => err.reason === 'spin_missing',
  );
  assert.equal(fake.callsTo('/security-pin').length, 0);
});

test('an HTTP error names the status and hides the VIN', async (t) => {
  const { fake, client } = await linkedClient(t);
  fake.failNext = { path: '/selectivestatus', status: 429 };
  await assert.rejects(client.getStatus(ETRON_VIN), (err) => {
    assert.equal(err.status, 429);
    assert.ok(!err.message.includes(ETRON_VIN), err.message);
    return true;
  });
});
