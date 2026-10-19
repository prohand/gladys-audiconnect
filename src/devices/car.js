// -----------------------------------------------------------------------------
// Device type: CAR — one Gladys device per car of the myAudi account.
//
// Features are declared from what the car actually reports (see
// src/audi/vehicleState.js): an e-tron gets battery and charging, a petrol car
// gets its fuel level, a car without the climatisation service gets no climate
// switch. The feature keys below are FOREVER: Gladys keys the history, scenes
// and dashboards on them.
//
// The device external id is built from the VIN, the one identifier of a car
// that never changes (a nickname does).
// -----------------------------------------------------------------------------

import {
  DEVICE_FEATURE_CATEGORIES as C,
  DEVICE_FEATURE_TYPES as T,
  DEVICE_FEATURE_UNITS as U,
  DEVICE_POLL_FREQUENCIES,
} from '@gladysassistant/integration-sdk';

export const DEVICE_TYPE = 'car';

/**
 * Every feature a car can have. `from` reads its value in the flat state,
 * `when` says whether this car has it. Controllable features name the
 * command they map to (handled in src/fleet.js).
 */
export const FEATURES = [
  {
    key: 'odometer',
    name: 'Mileage',
    category: C.ELECTRICAL_VEHICLE_STATE,
    type: T.ELECTRICAL_VEHICLE_STATE.ODOMETER,
    unit: U.KM,
    min: 0,
    max: 2000000,
    from: (s) => s.odometer,
  },
  {
    key: 'battery_level',
    name: 'Battery level',
    category: C.ELECTRICAL_VEHICLE_BATTERY,
    type: T.ELECTRICAL_VEHICLE_BATTERY.BATTERY_LEVEL,
    unit: U.PERCENT,
    min: 0,
    max: 100,
    from: (s) => s.batteryLevel,
  },
  {
    key: 'electric_range',
    name: 'Electric range',
    category: C.ELECTRICAL_VEHICLE_BATTERY,
    type: T.ELECTRICAL_VEHICLE_BATTERY.BATTERY_RANGE_ESTIMATE,
    unit: U.KM,
    min: 0,
    max: 2000,
    from: (s) => s.electricRange,
  },
  {
    key: 'total_range',
    name: 'Range',
    category: C.DISTANCE_SENSOR,
    type: T.SENSOR.INTEGER,
    unit: U.KM,
    min: 0,
    max: 3000,
    from: (s) => s.totalRange,
    // On a full electric car it repeats the electric range.
    when: (s) => s.totalRange !== undefined && s.carType !== 'electric',
  },
  {
    key: 'fuel_level',
    name: 'Fuel level',
    category: C.LEVEL_SENSOR,
    type: T.LEVEL_SENSOR.LIQUID_LEVEL_PERCENT,
    unit: U.PERCENT,
    min: 0,
    max: 100,
    from: (s) => s.fuelLevel,
  },
  {
    key: 'charging',
    name: 'Charging',
    category: C.ELECTRICAL_VEHICLE_CHARGE,
    type: T.ELECTRICAL_VEHICLE_CHARGE.CHARGE_ON,
    min: 0,
    max: 1,
    command: 'charging',
    from: (s) => bool(s.charging),
  },
  {
    key: 'plugged',
    name: 'Plugged in',
    category: C.ELECTRICAL_VEHICLE_CHARGE,
    type: T.ELECTRICAL_VEHICLE_CHARGE.PLUGGED,
    min: 0,
    max: 1,
    from: (s) => bool(s.plugged),
  },
  {
    key: 'charge_power',
    name: 'Charging power',
    category: C.ELECTRICAL_VEHICLE_CHARGE,
    type: T.ELECTRICAL_VEHICLE_CHARGE.CHARGE_POWER,
    unit: U.KILOWATT,
    min: 0,
    max: 400,
    from: (s) => s.chargePower,
  },
  {
    key: 'charge_remaining',
    name: 'Charging time left',
    category: C.DURATION,
    type: T.DURATION.INTEGER,
    unit: U.MINUTES,
    min: 0,
    max: 2880,
    from: (s) => s.chargeRemaining,
  },
  {
    key: 'target_soc',
    name: 'Target charge level',
    category: C.ELECTRICAL_VEHICLE_CHARGE,
    type: T.ELECTRICAL_VEHICLE_CHARGE.TARGET_CHARGE_LIMIT,
    unit: U.PERCENT,
    min: 20,
    max: 100,
    command: 'target_soc',
    from: (s) => s.targetSoc,
  },
  {
    key: 'climate',
    name: 'Climate',
    category: C.ELECTRICAL_VEHICLE_CLIMATE,
    type: T.ELECTRICAL_VEHICLE_CLIMATE.CLIMATE_ON,
    min: 0,
    max: 1,
    command: 'climate',
    from: (s) => bool(s.climateOn),
  },
  {
    key: 'target_temperature',
    name: 'Climate temperature',
    category: C.ELECTRICAL_VEHICLE_CLIMATE,
    type: T.ELECTRICAL_VEHICLE_CLIMATE.TARGET_TEMPERATURE,
    unit: U.CELSIUS,
    min: 16,
    max: 30,
    command: 'target_temperature',
    from: (s) => s.targetTemperature,
  },
  {
    key: 'lock',
    name: 'Locked',
    category: C.ELECTRICAL_VEHICLE_COMMAND,
    type: T.ELECTRICAL_VEHICLE_COMMAND.LOCK,
    min: 0,
    max: 1,
    command: 'lock',
    from: (s) => bool(s.locked),
  },
  {
    key: 'doors_open',
    name: 'Door open',
    category: C.ELECTRICAL_VEHICLE_STATE,
    type: T.ELECTRICAL_VEHICLE_STATE.DOOR_OPENED,
    min: 0,
    max: 1,
    from: (s) => bool(s.doorsOpen),
  },
  {
    key: 'windows_open',
    name: 'Window open',
    category: C.ELECTRICAL_VEHICLE_STATE,
    type: T.ELECTRICAL_VEHICLE_STATE.WINDOW_OPENED,
    min: 0,
    max: 1,
    from: (s) => bool(s.windowsOpen),
  },
  {
    key: 'inspection_days',
    name: 'Service due in',
    category: C.DURATION,
    type: T.DURATION.INTEGER,
    unit: U.DAYS,
    // Negative once the service is overdue.
    min: -3650,
    max: 3650,
    from: (s) => s.inspectionDays,
  },
  {
    key: 'inspection_km',
    name: 'Service due in (distance)',
    category: C.DISTANCE_SENSOR,
    type: T.SENSOR.INTEGER,
    unit: U.KM,
    min: -100000,
    max: 100000,
    from: (s) => s.inspectionKm,
  },
  {
    key: 'position',
    name: 'Parking position',
    category: C.TEXT,
    type: T.TEXT.TEXT,
    min: 0,
    max: 0,
    text: true,
    from: (s) =>
      s.latitude !== undefined && s.longitude !== undefined
        ? `${s.latitude.toFixed(5)}, ${s.longitude.toFixed(5)}`
        : undefined,
    // The position exists for every connected car, even before it is read.
    when: (s) => s.latitude !== undefined || s.moving !== undefined,
  },
];

/** Features published for a car never read yet (the cloud failed at discovery). */
const FALLBACK_FEATURES = ['odometer', 'lock', 'doors_open', 'windows_open'];

function bool(value) {
  if (value === undefined || value === null) {
    return undefined;
  }
  return value ? 1 : 0;
}

export function carIds(gladys, vin) {
  return gladys.externalIds(DEVICE_TYPE, vin.toLowerCase());
}

/** The features this car has, from its state (null: not read yet). */
export function featuresOf(state) {
  if (!state) {
    return FEATURES.filter((feature) => FALLBACK_FEATURES.includes(feature.key));
  }
  return FEATURES.filter((feature) =>
    feature.when ? feature.when(state) : feature.from(state) !== undefined,
  );
}

/**
 * Discovery payload of one car.
 *
 * @param {object} gladys
 * @param {{ vin: string, name: string, model?: string | null }} vehicle
 * @param {object | null} state flat state (src/audi/vehicleState.js)
 */
export function buildCarDevice(gladys, vehicle, state) {
  const ids = carIds(gladys, vehicle.vin);
  return {
    name: vehicle.name,
    external_id: ids.device,
    // Gladys calls onPoll every minute; src/devices/index.js reads the car at
    // the slower interval of the configuration by skipping the polls between.
    should_poll: true,
    poll_frequency: DEVICE_POLL_FREQUENCIES.EVERY_MINUTES,
    features: featuresOf(state).map((feature) => ({
      name: feature.name,
      external_id: ids.feature(feature.key),
      category: feature.category,
      type: feature.type,
      ...(feature.unit ? { unit: feature.unit } : {}),
      min: feature.min,
      max: feature.max,
      read_only: !feature.command,
      // Commands publish the state the car confirmed, or the next read does.
      has_feedback: Boolean(feature.command),
      keep_history: true,
    })),
  };
}

/** The states of one car, ready for publishStates / publishChangedStates. */
export function carStates(gladys, vehicle, state) {
  const ids = carIds(gladys, vehicle.vin);
  const states = [];
  for (const feature of featuresOf(state)) {
    const value = state ? feature.from(state) : undefined;
    if (value === undefined) {
      continue;
    }
    states.push(
      feature.text
        ? { device_feature_external_id: ids.feature(feature.key), text: value }
        : { device_feature_external_id: ids.feature(feature.key), state: value },
    );
  }
  return states;
}

/** The feature definition behind a feature external id, null if none. */
export function featureByExternalId(gladys, vin, externalId) {
  const ids = carIds(gladys, vin);
  return FEATURES.find((feature) => ids.feature(feature.key) === externalId) ?? null;
}
