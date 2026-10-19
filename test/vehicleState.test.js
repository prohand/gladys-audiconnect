import { test } from 'node:test';
import assert from 'node:assert/strict';
import { chargingPhase, mergeVehicleState, parseVehicleState } from '../src/audi/vehicleState.js';
import { loadFixture } from './helpers/fakeAudi.js';

const PARKED = { moving: false, latitude: 48.85661, longitude: 2.35222 };

test('an e-tron reports battery, charging, climate, locks and position', () => {
  const state = parseVehicleState(loadFixture('status-etron'), PARKED);
  assert.equal(state.carType, 'electric');
  assert.equal(state.odometer, 43740);
  assert.equal(state.batteryLevel, 69);
  assert.equal(state.electricRange, 300);
  assert.equal(state.fuelLevel, undefined, 'no fuel on an e-tron');
  assert.equal(state.chargingState, 'readyForCharging');
  assert.equal(state.chargingPhase, 'stopped');
  assert.equal(state.charging, false);
  assert.equal(state.plugged, true);
  assert.equal(state.chargePower, 0);
  assert.equal(state.targetSoc, 70);
  assert.equal(state.climateOn, false);
  assert.equal(state.climateRemaining, 0, 'the negative remaining time of an idle climate is 0');
  assert.equal(state.targetTemperature, 15.5);
  assert.equal(state.locked, true);
  assert.equal(state.doorsOpen, false);
  assert.equal(state.windowsOpen, false, 'unsupported sunroofs are ignored');
  assert.equal(state.inspectionDays, 381);
  assert.equal(state.latitude, 48.85661);
});

test('a petrol car reports its fuel, no battery, and a failed job is not a value', () => {
  const state = parseVehicleState(loadFixture('status-petrol'), { moving: true });
  assert.equal(state.fuelLevel, 55);
  assert.equal(state.totalRange, 610);
  assert.equal(state.batteryLevel, undefined);
  assert.equal(state.electricRange, undefined);
  assert.equal(state.charging, undefined, 'the charging job came back as an error');
  assert.equal(state.climateOn, undefined);
  assert.equal(state.locked, false);
  assert.equal(state.doorsOpen, true);
  assert.equal(state.inspectionDays, -12, 'an overdue service stays negative');
  assert.equal(state.moving, true);
  assert.equal(state.latitude, undefined);
});

test('charging states map to the four phases of the trigger', () => {
  assert.equal(chargingPhase('charging'), 'charging');
  assert.equal(chargingPhase('chargePurposeReachedAndConservation'), 'finished');
  assert.equal(chargingPhase('chargePurposeReachedAndNotConservationCharging'), 'finished');
  assert.equal(chargingPhase('notReadyForCharging'), 'stopped');
  assert.equal(chargingPhase('error'), 'error');
  assert.equal(chargingPhase(undefined), undefined);
});

test('a read missing a job keeps the last known values', () => {
  const first = parseVehicleState(loadFixture('status-etron'), PARKED);
  const partial = parseVehicleState({
    measurements: { odometerStatus: { value: { odometer: 43800 } } },
  });
  const merged = mergeVehicleState(first, partial);
  assert.equal(merged.odometer, 43800);
  assert.equal(merged.batteryLevel, 69, 'the battery level survives a failed charging job');
  assert.equal(merged.latitude, 48.85661, 'no position read keeps the position');
});

test('a car that drives off forgets its parking position', () => {
  const first = parseVehicleState(loadFixture('status-etron'), PARKED);
  const merged = mergeVehicleState(first, parseVehicleState({}, { moving: true }));
  assert.equal(merged.latitude, undefined);
  assert.equal(merged.moving, true);
});
