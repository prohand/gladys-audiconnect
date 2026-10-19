// -----------------------------------------------------------------------------
// Dashboard widget "Audi car" (SDK v0.14+, Gladys 5.1+).
//
// One instance shows one car (the `device` setting, the first car when left
// empty). The content is declarative — the core renders it with its own theme
// and translations:
//   - live tiles bound to the car's features (battery, range, mileage): they
//     follow the published states, nothing to refresh;
//   - a status list computed here (locks, openings, charging, climate, last
//     report of the car), nudged after every read (see refreshWidgets);
//   - buttons: read again, climate on/off, lock (never unlock: a dashboard can
//     hang on a wall anybody walks past), and a map link to the parking spot.
// -----------------------------------------------------------------------------

import { createLogger, WIDGET_COLORS } from '@gladysassistant/integration-sdk';
import { carIds, featuresOf } from '../devices/car.js';
import { ACTION_MESSAGES, failed } from '../messages.js';

const logger = createLogger({ name: 'widget' });

export const CAR_WIDGET = 'car_status';

const WIDGET_ACTIONS = {
  REFRESH: 'refresh',
  CLIMATE_START: 'climate_start',
  CLIMATE_STOP: 'climate_stop',
};

const T = {
  noCar: {
    en: 'No car yet: link your myAudi account in the integration configuration.',
    fr: "Pas encore de voiture : reliez votre compte myAudi dans la configuration de l'intégration.",
    de: 'Noch kein Fahrzeug: Verbinde dein myAudi-Konto in der Konfiguration der Integration.',
    es: 'Aún no hay coche: vincule su cuenta myAudi en la configuración de la integración.',
  },
  battery: { en: 'Battery', fr: 'Batterie', de: 'Akku', es: 'Batería' },
  fuel: { en: 'Fuel', fr: 'Carburant', de: 'Kraftstoff', es: 'Combustible' },
  range: { en: 'Range', fr: 'Autonomie', de: 'Reichweite', es: 'Autonomía' },
  mileage: { en: 'Mileage', fr: 'Kilométrage', de: 'Kilometerstand', es: 'Kilometraje' },
  locks: { en: 'Locks', fr: 'Verrouillage', de: 'Verriegelung', es: 'Cierre' },
  locked: { en: 'Locked', fr: 'Verrouillée', de: 'Verriegelt', es: 'Cerrado' },
  unlocked: { en: 'Unlocked', fr: 'Déverrouillée', de: 'Entriegelt', es: 'Abierto' },
  openings: {
    en: 'Doors and windows',
    fr: 'Portes et fenêtres',
    de: 'Türen und Fenster',
    es: 'Puertas y ventanas',
  },
  closed: { en: 'Closed', fr: 'Fermées', de: 'Geschlossen', es: 'Cerradas' },
  open: { en: 'Open', fr: 'Ouvertes', de: 'Offen', es: 'Abiertas' },
  charging: { en: 'Charging', fr: 'Charge', de: 'Laden', es: 'Carga' },
  phase: {
    charging: { en: 'Charging', fr: 'En charge', de: 'Lädt', es: 'Cargando' },
    finished: { en: 'Finished', fr: 'Terminée', de: 'Beendet', es: 'Terminada' },
    stopped: { en: 'Not charging', fr: 'Pas en charge', de: 'Lädt nicht', es: 'Sin cargar' },
    error: { en: 'Error', fr: 'Erreur', de: 'Fehler', es: 'Error' },
  },
  climate: { en: 'Climate', fr: 'Climatisation', de: 'Klimatisierung', es: 'Climatización' },
  on: { en: 'On', fr: 'En marche', de: 'An', es: 'Encendida' },
  off: { en: 'Off', fr: 'Arrêtée', de: 'Aus', es: 'Apagada' },
  lastReport: { en: 'Last report', fr: 'Dernier relevé', de: 'Letzte Meldung', es: 'Último dato' },
  unreachable: {
    en: 'Cloud unreachable',
    fr: 'Cloud injoignable',
    de: 'Cloud nicht erreichbar',
    es: 'Nube inaccesible',
  },
  refresh: { en: 'Refresh', fr: 'Actualiser', de: 'Aktualisieren', es: 'Actualizar' },
  climateStart: {
    en: 'Start climate',
    fr: 'Lancer la clim',
    de: 'Klima starten',
    es: 'Iniciar clima',
  },
  climateStop: {
    en: 'Stop climate',
    fr: 'Arrêter la clim',
    de: 'Klima stoppen',
    es: 'Parar clima',
  },
  lock: { en: 'Lock', fr: 'Verrouiller', de: 'Verriegeln', es: 'Cerrar' },
  map: { en: 'Map', fr: 'Carte', de: 'Karte', es: 'Mapa' },
};

/** The car of a widget instance: its `device` setting, or the first car. */
function carOf(fleet, settings) {
  const vin = settings?.device ? fleet.vinOf(settings.device) : fleet.list[0]?.vin;
  return vin ? fleet.vehicles.get(vin) : null;
}

/** A short local date for the status row (≤ 40 characters). */
export function formatReportTime(iso, language) {
  const date = new Date(iso);
  if (!iso || Number.isNaN(date.getTime())) {
    return '—';
  }
  try {
    return new Intl.DateTimeFormat(language || 'en', {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: process.env.TZ || 'Europe/Paris',
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 16).replace('T', ' ');
  }
}

export const WIDGETS = {
  [CAR_WIDGET]: {
    async get(gladys, { settings, language, fleet }) {
      logger.debug(`onWidgetGet <- ${CAR_WIDGET}`);
      const vehicle = carOf(fleet, settings);
      if (!vehicle) {
        return { ttl_seconds: 300, components: [{ type: 'text', text: T.noCar }] };
      }
      const state = fleet.states.get(vehicle.vin) ?? null;
      const ids = carIds(gladys, vehicle.vin);
      const has = new Set(featuresOf(state).map((feature) => feature.key));
      const components = [];

      // Live tiles.
      if (has.has('battery_level')) {
        components.push({
          type: 'gauge',
          label: T.battery,
          device_feature: ids.feature('battery_level'),
          color: WIDGET_COLORS.SUCCESS,
        });
      } else if (has.has('fuel_level')) {
        components.push({
          type: 'gauge',
          label: T.fuel,
          device_feature: ids.feature('fuel_level'),
          color: WIDGET_COLORS.INFO,
        });
      }
      const rangeKey = has.has('electric_range') ? 'electric_range' : 'total_range';
      if (has.has(rangeKey)) {
        components.push({
          type: 'value',
          label: T.range,
          icon: 'navigation',
          device_feature: ids.feature(rangeKey),
        });
      }
      if (has.has('odometer')) {
        components.push({
          type: 'value',
          label: T.mileage,
          icon: 'activity',
          device_feature: ids.feature('odometer'),
        });
      }

      // Computed rows.
      const items = [];
      if (state?.locked !== undefined) {
        items.push({
          label: T.locks,
          icon: state.locked ? 'lock' : 'unlock',
          value: state.locked ? T.locked : T.unlocked,
          color: state.locked ? WIDGET_COLORS.SUCCESS : WIDGET_COLORS.WARNING,
        });
      }
      if (state?.doorsOpen !== undefined || state?.windowsOpen !== undefined) {
        const open = Boolean(state.doorsOpen || state.windowsOpen);
        items.push({
          label: T.openings,
          icon: 'square',
          value: open ? T.open : T.closed,
          color: open ? WIDGET_COLORS.WARNING : WIDGET_COLORS.SUCCESS,
        });
      }
      if (state?.chargingPhase) {
        items.push({
          label: T.charging,
          icon: 'battery-charging',
          value: T.phase[state.chargingPhase],
          color:
            state.chargingPhase === 'error'
              ? WIDGET_COLORS.DANGER
              : state.chargingPhase === 'charging'
                ? WIDGET_COLORS.PRIMARY
                : WIDGET_COLORS.NEUTRAL,
        });
      }
      if (state?.climateOn !== undefined) {
        items.push({
          label: T.climate,
          icon: 'wind',
          value: state.climateOn ? T.on : T.off,
          color: state.climateOn ? WIDGET_COLORS.PRIMARY : WIDGET_COLORS.NEUTRAL,
        });
      }
      items.push(
        fleet.errors.has(vehicle.vin)
          ? {
              label: T.lastReport,
              icon: 'cloud-off',
              value: T.unreachable,
              color: WIDGET_COLORS.DANGER,
            }
          : {
              label: T.lastReport,
              icon: 'clock',
              value: formatReportTime(state?.capturedAt, language),
              color: WIDGET_COLORS.NEUTRAL,
            },
      );
      components.push({ type: 'status', items });

      // Buttons. `params` are declared here and sent back as-is: the handler
      // never receives user input.
      components.push({
        type: 'button',
        label: T.refresh,
        icon: 'refresh-cw',
        style: 'secondary',
        action: { key: WIDGET_ACTIONS.REFRESH, params: { device: ids.device } },
      });
      if (has.has('climate')) {
        components.push({
          type: 'button',
          label: state.climateOn ? T.climateStop : T.climateStart,
          icon: 'wind',
          style: 'primary',
          action: {
            key: state.climateOn ? WIDGET_ACTIONS.CLIMATE_STOP : WIDGET_ACTIONS.CLIMATE_START,
            params: { device: ids.device },
            confirm: true,
          },
        });
      }
      if (has.has('lock') && state?.locked === false) {
        components.push({
          type: 'button',
          label: T.lock,
          icon: 'lock',
          style: 'secondary',
          device_feature: ids.feature('lock'),
          value: 1,
        });
      }
      if (state?.latitude !== undefined && state?.longitude !== undefined) {
        const lat = state.latitude.toFixed(5);
        const lon = state.longitude.toFixed(5);
        components.push({
          type: 'button',
          label: T.map,
          icon: 'map-pin',
          style: 'secondary',
          link: {
            url: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lon}#map=17/${lat}/${lon}`,
          },
        });
      }

      // The computed rows change with each read, and index.js nudges the
      // widget after every read: the TTL is only a safety net.
      return { ttl_seconds: 900, components };
    },

    async action(gladys, { actionKey, params, fleet }) {
      logger.info(`onWidgetAction <- ${CAR_WIDGET}.${actionKey}`);
      const vin = fleet.vinOf(params?.device);
      if (!vin) {
        return ACTION_MESSAGES.unknownCar;
      }
      switch (actionKey) {
        case WIDGET_ACTIONS.REFRESH:
          try {
            await fleet.read(vin);
            return ACTION_MESSAGES.refreshed;
          } catch (err) {
            return failed(err.message.slice(0, 150));
          }
        case WIDGET_ACTIONS.CLIMATE_START:
        case WIDGET_ACTIONS.CLIMATE_STOP:
          // Sent and followed in the background (a car takes up to a minute):
          // a refusal fires the command_failed trigger and the next read
          // shows the truth.
          fleet
            .execute(
              vin,
              actionKey === WIDGET_ACTIONS.CLIMATE_START ? 'start_climate' : 'stop_climate',
            )
            .catch(() => {});
          return actionKey === WIDGET_ACTIONS.CLIMATE_START
            ? ACTION_MESSAGES.climateStarted
            : ACTION_MESSAGES.climateStopped;
        default:
          // Throwing acks the action as failed: the message reaches the user.
          throw new Error(`Unknown widget action: ${actionKey}`);
      }
    },
  },
};

/**
 * Freshness nudge: ask the core to re-pull every widget now instead of waiting
 * for the TTL. Fire-and-forget, rate-limited core-side (1 per 10 s per
 * widget), dropped while disconnected — so also called after each
 * (re)connection.
 */
export function refreshWidgets(gladys) {
  for (const key of Object.keys(WIDGETS)) {
    gladys.requestWidgetRefresh(key);
  }
}
