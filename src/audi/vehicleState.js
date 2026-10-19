// -----------------------------------------------------------------------------
// From the raw answers of the Audi cloud to one flat state per car.
//
// The selectivestatus answer is a tree of "jobs" (access, charging,
// climatisation…), each `{ <status>: { value: {...} } }`. A job the car does
// not support comes back as an error object, or not at all, and a car never
// sends what it does not have (no fuel level on an e-tron, no battery on a
// petrol car). So every value here may be `undefined`, and `undefined` means
// "this car does not report it": the device gets no feature for it.
//
// Units are those of the cloud: km, %, kW, minutes, °C.
// -----------------------------------------------------------------------------

/** Read a nested value, undefined as soon as one step is missing. */
export function pick(source, path) {
  let node = source;
  for (const key of path.split('.')) {
    if (node === null || typeof node !== 'object') {
      return undefined;
    }
    node = node[key];
  }
  return node;
}

function num(value) {
  if (value === null || value === undefined || value === '') {
    return undefined;
  }
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * What a charging state means for Gladys and for the `charging_state_changed`
 * trigger: charging / finished / stopped / error.
 */
export function chargingPhase(chargingState) {
  switch (chargingState) {
    case undefined:
    case null:
      return undefined;
    case 'charging':
      return 'charging';
    case 'chargePurposeReachedAndConservation':
    case 'chargePurposeReachedAndNotConservationCharging':
    case 'conservation':
      return 'finished';
    case 'error':
      return 'error';
    default:
      // readyForCharging, notReadyForCharging, discharging, off, invalid…
      return 'stopped';
  }
}

/**
 * @param {object} status selectivestatus answer
 * @param {{ moving: boolean, latitude?: number, longitude?: number, at?: string } | null} [position]
 */
export function parseVehicleState(status, position = null) {
  const access = pick(status, 'access.accessStatus.value');
  const charging = pick(status, 'charging');
  const climate = pick(status, 'climatisation');
  const range = pick(status, 'fuelStatus.rangeStatus.value');

  const engines = [range?.primaryEngine, range?.secondaryEngine].filter(Boolean);
  const electric = engines.find((engine) => engine.type === 'electric');
  const combustion = engines.find((engine) => engine.type && engine.type !== 'electric');
  const carType = range?.carType ?? pick(status, 'measurements.fuelLevelStatus.value.carType');

  const batteryLevel = num(pick(charging, 'batteryStatus.value.currentSOC_pct'));
  const electricRange =
    num(pick(charging, 'batteryStatus.value.cruisingRangeElectric_km')) ??
    num(electric?.remainingRange_km);
  const chargingState = pick(charging, 'chargingStatus.value.chargingState');
  const plug = pick(charging, 'plugStatus.value.plugConnectionState');
  const climateState = pick(climate, 'climatisationStatus.value.climatisationState');
  const lockStatus = access?.doorLockStatus;

  const doors = Array.isArray(access?.doors) ? access.doors : [];
  const windows = Array.isArray(access?.windows) ? access.windows : [];
  const supported = (item) => Array.isArray(item?.status) && !item.status.includes('unsupported');
  const supportedDoors = doors.filter(supported);
  const supportedWindows = windows.filter(supported);

  const remainingCharge = num(
    pick(charging, 'chargingStatus.value.remainingChargingTimeToComplete_min'),
  );
  const climateRemaining = num(
    pick(climate, 'climatisationStatus.value.remainingClimatisationTime_min'),
  );

  return {
    capturedAt:
      pick(status, 'measurements.odometerStatus.value.carCapturedTimestamp') ??
      access?.carCapturedTimestamp ??
      pick(charging, 'batteryStatus.value.carCapturedTimestamp'),
    carType,
    odometer: num(pick(status, 'measurements.odometerStatus.value.odometer')),
    totalRange:
      num(range?.totalRange_km) ??
      num(pick(status, 'measurements.rangeStatus.value.totalRange_km')),
    electricRange: batteryLevel !== undefined || electric ? electricRange : undefined,
    combustionRange: num(combustion?.remainingRange_km),
    batteryLevel: batteryLevel ?? num(electric?.currentSOC_pct),
    fuelLevel: num(pick(status, 'measurements.fuelLevelStatus.value.currentFuelLevel_pct')),

    chargingState,
    chargingPhase: chargingPhase(chargingState),
    charging: chargingState === undefined ? undefined : chargingState === 'charging',
    plugged: plug === undefined ? undefined : plug === 'connected',
    chargePower: num(pick(charging, 'chargingStatus.value.chargePower_kW')),
    // The cloud says 0 when not charging: keep 0, it is a true value then.
    chargeRemaining: remainingCharge === undefined ? undefined : Math.max(0, remainingCharge),
    targetSoc: num(pick(charging, 'chargingSettings.value.targetSOC_pct')),

    climateState,
    climateOn:
      climateState === undefined || climateState === 'invalid' ? undefined : climateState !== 'off',
    // The car reports a negative remaining time when off.
    climateRemaining: climateRemaining === undefined ? undefined : Math.max(0, climateRemaining),
    targetTemperature: num(pick(climate, 'climatisationSettings.value.targetTemperature_C')),

    locked: lockStatus === 'locked' ? true : lockStatus === 'unlocked' ? false : undefined,
    doorsOpen:
      supportedDoors.length > 0
        ? supportedDoors.some((door) => door.status.includes('open'))
        : undefined,
    windowsOpen:
      supportedWindows.length > 0
        ? supportedWindows.some((window) => !window.status.includes('closed'))
        : undefined,

    inspectionDays: num(
      pick(status, 'vehicleHealthInspection.maintenanceStatus.value.inspectionDue_days'),
    ),
    inspectionKm: num(
      pick(status, 'vehicleHealthInspection.maintenanceStatus.value.inspectionDue_km'),
    ),
    oilServiceDays: num(
      pick(status, 'vehicleHealthInspection.maintenanceStatus.value.oilServiceDue_days'),
    ),

    moving: position?.moving ?? undefined,
    latitude: position && !position.moving ? position.latitude : undefined,
    longitude: position && !position.moving ? position.longitude : undefined,
  };
}

/**
 * Keep the last known value of every field the new read lacks. A job that
 * failed this time (the cloud answers 207 with an error object for it) must
 * not make the feature look gone, nor its value reset.
 */
export function mergeVehicleState(previous, next) {
  if (!previous) {
    return next;
  }
  const merged = { ...previous };
  for (const [key, value] of Object.entries(next)) {
    if (value !== undefined) {
      merged[key] = value;
    }
  }
  // A car that drives has no parking position: forget the old one.
  if (next.moving === true) {
    merged.latitude = undefined;
    merged.longitude = undefined;
  }
  return merged;
}
