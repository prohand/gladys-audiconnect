// -----------------------------------------------------------------------------
// The whole integration, wired to the SDK's fake Gladys and to a fake Audi
// cloud: what a user sees, from "Connect" to the scene triggers.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validateWidgetContent } from '@gladysassistant/integration-sdk';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { AudiClient } from '../src/audi/api.js';
import { REFRESH_TOKEN_KEY } from '../src/config.js';
import { createIntegration } from '../src/integration.js';
import { MESSAGES } from '../src/messages.js';
import { ETRON_VIN, PETROL_VIN, noSleep, useFakeAudi } from './helpers/fakeAudi.js';

const deps = {
  sleep: noSleep,
  createClient: (session) => new AudiClient(session, { sleep: noSleep }),
};

/** A connected integration whose account is linked through a stored refresh token. */
async function linked(t, config = {}) {
  const audi = useFakeAudi(t);
  const gladys = createFakeGladys({
    config: { market: 'DE', [REFRESH_TOKEN_KEY]: 'idk-refresh-0', ...config },
  });
  const integration = createIntegration(gladys, deps);
  t.after(() => integration.fleet.stop());
  await gladys.connect();
  const deviceOf = (vin) =>
    gladys.fake.discoveredDevices.find(
      (device) => device.external_id === integration.fleet.deviceIdOf(vin),
    );
  const featureOf = (vin, key) =>
    deviceOf(vin).features.find((feature) => feature.external_id.endsWith(`:${key}`));
  const settle = () =>
    Promise.all([...integration.fleet.queues.values()].map((p) => p.catch(() => {})));
  return { audi, gladys, integration, deviceOf, featureOf, settle };
}

test('without a link, the configuration screen asks to click Connect', async (t) => {
  useFakeAudi(t);
  const gladys = createFakeGladys({ config: {} });
  createIntegration(gladys, deps);
  await gladys.connect();
  assert.deepEqual(gladys.fake.connectionStatus, { connected: false, message: MESSAGES.notLinked });
  assert.deepEqual(gladys.fake.discoveredDevices ?? [], []);
});

test('Connect opens the Audi page, and the approval links the account', async (t) => {
  const audi = useFakeAudi(t);
  const gladys = createFakeGladys({ config: {} });
  const integration = createIntegration(gladys, deps);
  t.after(() => integration.fleet.stop());
  await gladys.connect();

  const ack = await gladys.fake.oauthAuthorizeUrl('account');
  assert.equal(ack.success, true);
  assert.equal(ack.data.authorize_url, 'https://identity.vwgroup.io/device?user_code=ABCD-EFGH');
  assert.match(gladys.fake.connectionStatus.message.en, /ABCD-EFGH/);

  await integration.account.waiting;
  assert.equal(audi.callsTo('/auth/v1/idk/oidc/token').length, 2, 'pending, then approved');
  assert.equal(gladys.fake.config[REFRESH_TOKEN_KEY], 'idk-refresh-1', 'the sign-in is stored');
  assert.equal(gladys.fake.connectionStatus.connected, true);
  assert.equal(gladys.fake.discoveredDevices.length, 2);
});

test('a restart reads the cars and publishes devices, states and badges', async (t) => {
  const { gladys, integration, deviceOf, featureOf } = await linked(t);
  assert.deepEqual(gladys.fake.connectionStatus, { connected: true });
  assert.equal(deviceOf(ETRON_VIN).name, 'My e-tron');
  assert.equal(gladys.fake.lastState(featureOf(ETRON_VIN, 'battery_level').external_id), 69);
  assert.equal(gladys.fake.lastState(featureOf(ETRON_VIN, 'lock').external_id), 1);
  assert.equal(
    gladys.fake.lastState(featureOf(ETRON_VIN, 'position').external_id),
    '48.85661, 2.35222',
  );
  assert.equal(gladys.fake.lastState(featureOf(PETROL_VIN, 'fuel_level').external_id), 55);
  assert.equal(featureOf(PETROL_VIN, 'battery_level'), undefined, 'no battery on a petrol car');
  assert.deepEqual(
    gladys.fake.transports.map((entry) => entry.transport),
    ['cloud', 'cloud'],
  );
  assert.equal(gladys.fake.config[REFRESH_TOKEN_KEY], 'idk-refresh-1', 'the rotated token');
  assert.equal(integration.fleet.list.length, 2);
});

test('a revoked sign-in asks for a new link', async (t) => {
  useFakeAudi(t);
  const gladys = createFakeGladys({ config: { [REFRESH_TOKEN_KEY]: 'revoked' } });
  createIntegration(gladys, deps);
  await gladys.connect();
  assert.deepEqual(gladys.fake.connectionStatus, { connected: false, message: MESSAGES.relink });
});

test('polls read a car at the configured interval only', async (t) => {
  const { audi, gladys, deviceOf } = await linked(t);
  const before = audi.callsTo('/selectivestatus').length;
  const ack = await gladys.fake.poll(deviceOf(ETRON_VIN));
  assert.equal(ack.success, true);
  assert.equal(audi.callsTo('/selectivestatus').length, before, 'read at startup, not due yet');
});

test('a climate command is acked at once and its state follows the car verdict', async (t) => {
  const { audi, gladys, deviceOf, featureOf, settle } = await linked(t);
  const climate = featureOf(ETRON_VIN, 'climate');
  const ack = await gladys.fake.setValue(deviceOf(ETRON_VIN), climate, 1);
  assert.equal(ack.success, true);
  await settle();
  assert.equal(audi.callsTo('/climatisation/start').length, 1);
  assert.equal(gladys.fake.lastState(climate.external_id), 1);
});

test('the temperature set in Gladys is used at the next climate start', async (t) => {
  const { audi, gladys, deviceOf, featureOf, settle } = await linked(t);
  await gladys.fake.setValue(deviceOf(ETRON_VIN), featureOf(ETRON_VIN, 'target_temperature'), 22);
  await gladys.fake.setValue(deviceOf(ETRON_VIN), featureOf(ETRON_VIN, 'climate'), 1);
  await settle();
  assert.equal(audi.callsTo('/climatisation/start')[0].body.targetTemperature, 22);
});

test('a lock without S-PIN fails: the command_failed trigger fires, the state stays', async (t) => {
  const { gladys, deviceOf, featureOf, settle, integration } = await linked(t);
  const lock = featureOf(ETRON_VIN, 'lock');
  await gladys.fake.setValue(deviceOf(ETRON_VIN), lock, 0);
  await settle();
  const event = gladys.fake.sceneEvents.find((e) => e.key === 'command_failed');
  assert.ok(event, 'command_failed fired');
  assert.equal(event.data.command, 'unlock');
  assert.equal(event.data.reason, 'spin_missing');
  assert.equal(event.data.device, integration.fleet.deviceIdOf(ETRON_VIN));
  assert.equal(gladys.fake.lastState(lock.external_id), 1, 'still locked');
});

test('with the S-PIN, unlocking goes through and publishes the new state', async (t) => {
  const { audi, gladys, deviceOf, featureOf, settle } = await linked(t, { spin: '1234' });
  const lock = featureOf(ETRON_VIN, 'lock');
  await gladys.fake.setValue(deviceOf(ETRON_VIN), lock, 0);
  await settle();
  assert.equal(audi.callsTo('/rlu/v1/vehicles/').length, 2, 'unlock, then its status');
  assert.equal(gladys.fake.lastState(lock.external_id), 0);
});

test('charging and lock changes between two reads fire their triggers', async (t) => {
  const { audi, gladys, integration } = await linked(t);
  assert.equal(gladys.fake.sceneEvents.length, 0, 'the first read is a state, not a change');

  const status = audi.statuses[ETRON_VIN];
  status.charging.chargingStatus.value.chargingState = 'charging';
  status.access.accessStatus.value.doorLockStatus = 'unlocked';
  await integration.fleet.read(ETRON_VIN);

  const charging = gladys.fake.sceneEvents.find((e) => e.key === 'charging_state_changed');
  assert.deepEqual(charging.data, {
    device: integration.fleet.deviceIdOf(ETRON_VIN),
    device_name: 'My e-tron',
    state: 'charging',
    battery_level: 69,
    range: 300,
  });
  const lock = gladys.fake.sceneEvents.find((e) => e.key === 'lock_state_changed');
  assert.equal(lock.data.state, 'unlocked');

  await integration.fleet.read(ETRON_VIN);
  assert.equal(gladys.fake.sceneEvents.length, 2, 'no change, no new event');
});

test('a failed read turns the badge to unreachable, the next one back to cloud', async (t) => {
  const { audi, gladys, integration } = await linked(t);
  const badge = () =>
    gladys.fake.transports
      .filter((entry) => entry.device_external_id === integration.fleet.deviceIdOf(ETRON_VIN))
      .at(-1).transport;
  audi.failNext = { path: '/selectivestatus', status: 503 };
  await assert.rejects(integration.fleet.read(ETRON_VIN));
  assert.equal(badge(), 'unreachable');
  await integration.fleet.read(ETRON_VIN);
  assert.equal(badge(), 'cloud');
});

test('scene actions: refresh gives the values, climate says what the car did', async (t) => {
  const { audi, gladys, integration } = await linked(t);
  const device = integration.fleet.deviceIdOf(ETRON_VIN);

  const refresh = await gladys.fake.sceneAction('refresh_vehicle', { device, wake: true });
  assert.equal(refresh.success, true);
  assert.deepEqual(refresh.data.outputs, {
    battery_level: 69,
    range: 300,
    mileage: 43740,
    locked: true,
    charging: false,
    plugged: true,
    climate_on: false,
  });
  assert.equal(audi.callsTo('/vehiclewakeup').length, 1);

  const start = await gladys.fake.sceneAction('start_climatisation', { device, temperature: 20 });
  assert.deepEqual(start.data.outputs, { started: true, confirmed: true });

  audi.pendingStatus = 'failed';
  const stop = await gladys.fake.sceneAction('stop_climatisation', { device });
  assert.equal(stop.success, true, 'a refusal is an output, not a failed action');
  assert.deepEqual(stop.data.outputs, { stopped: false, confirmed: false });
});

test('the widget renders a car exactly as sent, and its buttons answer', async (t) => {
  const { gladys, integration } = await linked(t);
  for (const vin of [ETRON_VIN, PETROL_VIN]) {
    const ack = await gladys.fake.widgetGet('car_status', {
      settings: { device: integration.fleet.deviceIdOf(vin) },
      language: 'fr',
    });
    assert.equal(ack.success, true);
    assert.deepEqual(validateWidgetContent(ack.data.content), []);
  }
  const content = (await gladys.fake.widgetGet('car_status')).data.content;
  const refresh = content.components.find((c) => c.action?.key === 'refresh');
  const answer = await gladys.fake.widgetAction('car_status', 'refresh', refresh.action.params);
  assert.equal(answer.success, true);
  assert.ok(gladys.fake.widgetRefreshes.includes('car_status'));
});

test('the widget without any car invites to link the account', async (t) => {
  useFakeAudi(t);
  const gladys = createFakeGladys({ config: {} });
  createIntegration(gladys, deps);
  await gladys.connect();
  const ack = await gladys.fake.widgetGet('car_status');
  assert.deepEqual(validateWidgetContent(ack.data.content), []);
  assert.equal(ack.data.content.components[0].type, 'text');
});

test('configuration actions: test, refresh now, flash the lights', async (t) => {
  const { audi, gladys, integration } = await linked(t);
  const device = integration.fleet.deviceIdOf(ETRON_VIN);

  const tested = await gladys.fake.action('test_connection');
  assert.match(tested.data.message.en, /My e-tron, A3 Sportback/);
  assert.match(tested.data.message.fr, /Appels restants aujourd'hui : 150/);

  const refreshed = await gladys.fake.action('refresh_now', { device });
  assert.match(refreshed.data.message.en, /read again/);

  const flashed = await gladys.fake.action('identify', { device });
  assert.match(flashed.data.message.en, /flashes/);
  assert.deepEqual(audi.callsTo('/honkandflash')[0].body, {
    duration_s: 10,
    mode: 'flash',
    userPosition: { latitude: 48.85661, longitude: 2.35222 },
  });

  const parked = await gladys.fake.action('identify', {
    device: integration.fleet.deviceIdOf(PETROL_VIN),
  });
  assert.match(parked.data.message.en, /no parking position/);
});

test('a form save keeps the stored sign-in it does not carry', async (t) => {
  const { gladys, integration } = await linked(t);
  await gladys.fake.configUpdated({ market: 'DE', poll_frequency: 600 });
  assert.equal(integration.config[REFRESH_TOKEN_KEY], 'idk-refresh-1');
  assert.equal(integration.config.poll_frequency, 600);
});
