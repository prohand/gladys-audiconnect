// -----------------------------------------------------------------------------
// The small pieces: configuration, devices, messages, logs, documentation.
// -----------------------------------------------------------------------------

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { access } from 'node:fs/promises';
import { createFakeGladys } from '@gladysassistant/integration-sdk/testing';
import { parseVehicleState } from '../src/audi/vehicleState.js';
import { formatReportTime } from '../src/capabilities/widget.js';
import { DEFAULT_CONFIG, normalizeConfig } from '../src/config.js';
import { FEATURES, buildCarDevice, carStates, featuresOf } from '../src/devices/car.js';
import { LANGUAGES } from '../src/i18n.js';
import { applyLogLevel } from '../src/logging.js';
import * as messages from '../src/messages.js';
import { ETRON_VIN, PETROL_VIN, loadFixture } from './helpers/fakeAudi.js';

test('the configuration is normalized and bounded', () => {
  assert.deepEqual(normalizeConfig(), DEFAULT_CONFIG);
  const config = normalizeConfig({ market: 'ca', poll_frequency: '60', spin: ' 1234 ' });
  assert.equal(config.market, 'CA');
  assert.equal(config.poll_frequency, 300, 'never faster than 5 minutes');
  assert.equal(config.spin, '1234');
  assert.equal(normalizeConfig({ market: 'US' }).market, 'DE', 'unsupported market');
  assert.equal(normalizeConfig({ poll_frequency: 'abc' }).poll_frequency, 900);
});

test('every car device is accepted by Gladys (categories, types, units, poll frequency)', async () => {
  const gladys = createFakeGladys();
  await gladys.connect();
  const etron = parseVehicleState(loadFixture('status-etron'), {
    moving: false,
    latitude: 1,
    longitude: 2,
  });
  const petrol = parseVehicleState(loadFixture('status-petrol'), { moving: true });
  const devices = [
    buildCarDevice(gladys, { vin: ETRON_VIN, name: 'e-tron' }, etron),
    buildCarDevice(gladys, { vin: PETROL_VIN, name: 'A3' }, petrol),
    buildCarDevice(gladys, { vin: 'WAUZZZ0000X000003', name: 'Never read' }, null),
  ];
  await gladys.publishDiscoveredDevices(devices);
  for (const device of devices) {
    for (const feature of device.features) {
      assert.equal(typeof feature.min, 'number', `${feature.external_id}: min`);
      assert.equal(typeof feature.max, 'number', `${feature.external_id}: max`);
    }
  }
  await gladys.publishStates([
    ...carStates(gladys, { vin: ETRON_VIN }, etron),
    ...carStates(gladys, { vin: PETROL_VIN }, petrol),
  ]);
});

test('features follow what the car reports', () => {
  const etron = parseVehicleState(loadFixture('status-etron'));
  const keys = featuresOf(etron).map((feature) => feature.key);
  assert.ok(
    keys.includes('battery_level') && keys.includes('climate') && keys.includes('charging'),
  );
  assert.ok(!keys.includes('fuel_level') && !keys.includes('total_range'));
  const petrol = featuresOf(parseVehicleState(loadFixture('status-petrol'))).map((f) => f.key);
  assert.ok(petrol.includes('fuel_level') && petrol.includes('total_range'));
  assert.ok(!petrol.includes('charging') && !petrol.includes('climate'));
});

test('feature keys are unique (they are forever)', () => {
  const keys = FEATURES.map((feature) => feature.key);
  assert.equal(new Set(keys).size, keys.length);
});

test('every message exists in the four languages', () => {
  const objects = [
    ...Object.values(messages.MESSAGES),
    ...Object.values(messages.LINK_FAILED),
    ...Object.values(messages.ACTION_MESSAGES),
    messages.waitingForApproval('X'),
    messages.failed('x'),
    messages.connectionReport({ linked: true, cars: ['A'], remaining: 3 }),
    messages.connectionReport({ linked: true, cars: [], remaining: null }),
    messages.connectionReport({ linked: true, error: 'boom' }),
  ];
  for (const object of objects) {
    assert.deepEqual(Object.keys(object).sort(), [...LANGUAGES].sort());
    for (const language of LANGUAGES) {
      assert.ok(object[language].length > 0 && object[language].length <= 200);
    }
  }
});

test('the user documentation exists in the four languages', async () => {
  for (const language of LANGUAGES) {
    await access(new URL(`../docs/${language}.md`, import.meta.url));
  }
});

test('the debug switch raises the log level and puts the baseline back', () => {
  const before = process.env.LOG_LEVEL;
  try {
    assert.equal(applyLogLevel({ debug_logs: true }), 'debug');
    assert.equal(applyLogLevel({ debug_logs: false }), before ?? 'info');
  } finally {
    if (before === undefined) {
      delete process.env.LOG_LEVEL;
    } else {
      process.env.LOG_LEVEL = before;
    }
  }
});

test('the last report time is short and local', () => {
  const text = formatReportTime('2026-10-18T17:42:05Z', 'fr');
  assert.ok(text.length <= 40, text);
  assert.equal(formatReportTime(undefined, 'en'), '—');
});
