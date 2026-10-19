// -----------------------------------------------------------------------------
// The integration, wired to the SDK.
//
// Kept apart from index.js so the tests can run the whole wiring against the
// SDK's fake Gladys (`createFakeGladys`) and a fake Audi cloud. index.js only
// creates the real client and connects.
//
// Every handler is registered BEFORE connect(), as the SDK requires.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { AccountLink } from './account.js';
import { MANIFEST_ACTIONS } from './actions.js';
import { AudiClient } from './audi/api.js';
import { AudiAuthError, AudiSession } from './audi/auth.js';
import { SCENE_ACTIONS } from './capabilities/scenes.js';
import { WIDGETS, refreshWidgets } from './capabilities/widget.js';
import { ACCOUNT_FIELD_KEY, REFRESH_TOKEN_KEY, normalizeConfig } from './config.js';
import { createPoller } from './devices/index.js';
import { Fleet } from './fleet.js';
import { applyLogLevel } from './logging.js';
import { MESSAGES } from './messages.js';

const logger = createLogger({ name: 'integration' });

/** After a failed start, the next poll tries again at most this often. */
const RETRY_START_MS = 5 * 60 * 1000;

/**
 * @param {object} gladys GladysIntegration (or the SDK's fake)
 * @param {object} [deps] replaced by the tests
 */
export function createIntegration(gladys, deps = {}) {
  const {
    createSession = (options) => new AudiSession(options),
    createClient = (session) => new AudiClient(session),
    sleep,
  } = deps;

  let config = normalizeConfig();
  let session = null;
  let lastStartAttempt = 0;

  const fleet = new Fleet({
    gladys,
    client: null,
    getConfig: () => config,
    // The widget's computed rows (locks, charging…) follow every read.
    onRead: () => refreshWidgets(gladys),
  });
  const pollDevice = createPoller(fleet);
  const account = new AccountLink({
    gladys,
    getSession: () => session,
    onLinked: () => start(),
    sleep,
  });

  function newSession() {
    session = createSession({ market: config.market, onRefreshToken: storeRefreshToken });
    fleet.setClient(createClient(session));
  }

  // The refresh token rotates at every refresh: the newest one is stored at
  // once, or the next restart would present a dead one.
  async function storeRefreshToken(token) {
    config = { ...config, [REFRESH_TOKEN_KEY]: token };
    try {
      await gladys.setConfig({ [REFRESH_TOKEN_KEY]: token });
    } catch (err) {
      logger.error(`The Audi sign-in could not be stored in Gladys: ${err.message}`);
    }
  }

  const isLinked = () => Boolean(session?.linked || config[REFRESH_TOKEN_KEY]);

  async function ensureLogin() {
    if (!session.linked) {
      await session.loginWithRefreshToken(config[REFRESH_TOKEN_KEY]);
    }
  }

  /** Sign in, list the cars, read them, publish everything. */
  async function start() {
    lastStartAttempt = Date.now();
    if (!isLinked()) {
      await gladys.setConnectionStatus(false, MESSAGES.notLinked);
      return;
    }
    try {
      await ensureLogin();
      await fleet.loadVehicles();
      await fleet.readAll();
      await fleet.publishDevices();
      await fleet.publishTransports();
      refreshWidgets(gladys);
      if (fleet.list.length === 0) {
        await gladys.setConnectionStatus(true, MESSAGES.noCars);
      } else {
        await gladys.setConnectionStatus(true);
      }
    } catch (err) {
      if (err instanceof AudiAuthError) {
        logger.warn(err.message);
        await gladys.setConnectionStatus(false, MESSAGES.relink).catch(() => {});
        return;
      }
      logger.error(`Start failed: ${err.message}`);
      await gladys.setConnectionStatus(false, MESSAGES.initFailed).catch(() => {});
    }
  }

  // --- Account link: the "Connect" button of the `account_link` field -------
  // No redirect URI (undefined) and no callback: account.js waits for the
  // approval itself.
  gladys.onOAuthAuthorizeUrl(async (key) => {
    if (key !== ACCOUNT_FIELD_KEY) {
      throw new Error(`Unknown account field: ${key}`);
    }
    logger.info('Connect clicked: starting the myAudi sign-in');
    newSession();
    return account.start();
  });

  // --- Discovery -------------------------------------------------------------
  gladys.onScanRequest(async () => {
    if (!session?.linked) {
      return;
    }
    await fleet.loadVehicles();
    await fleet.publishDevices();
  });

  // --- Polling: Gladys asks once a minute per car ----------------------------
  gladys.onPoll(async (device) => {
    if (!fleet.vinOf(device.external_id)) {
      // The cars are unknown: the start failed (cloud down at boot). Try
      // again, not more than every few minutes.
      if (isLinked() && Date.now() - lastStartAttempt > RETRY_START_MS) {
        await start();
      }
      return;
    }
    await pollDevice(device, config);
  });

  // --- Commands --------------------------------------------------------------
  gladys.onSetValue(async (device, feature, value) => {
    logger.info(`onSetValue <- ${feature.external_id} = ${value}`);
    await fleet.setValue(device, feature, value);
  });

  // A device the user just created gets the known values at once, instead of
  // at the next change.
  gladys.onDeviceCreated(async (device) => {
    const vin = fleet.vinOf(device.external_id);
    if (vin) {
      await fleet.republish(vin);
    }
  });

  // --- Manifest actions ------------------------------------------------------
  for (const [key, handler] of Object.entries(MANIFEST_ACTIONS)) {
    gladys.onAction(key, (fields = {}) =>
      handler({
        fleet,
        fields,
        isLinked,
        connect: async () => {
          await ensureLogin();
          await fleet.loadVehicles();
          await fleet.publishDevices();
        },
      }),
    );
  }

  // --- Scene actions (Gladys 5.1+) -------------------------------------------
  for (const [key, handler] of Object.entries(SCENE_ACTIONS)) {
    gladys.onSceneAction(key, (fields = {}) => handler(gladys, { fields, fleet }));
  }

  // --- Dashboard widgets (Gladys 5.1+) ---------------------------------------
  for (const [key, widget] of Object.entries(WIDGETS)) {
    gladys.onWidgetGet(key, (request) => widget.get(gladys, { ...request, fleet }));
    gladys.onWidgetAction(key, (actionKey, params, { settings } = {}) =>
      widget.action(gladys, { actionKey, params, settings, fleet }),
    );
  }

  // --- Configuration saved by the user ---------------------------------------
  gladys.onConfigUpdated(async (raw) => {
    logger.info('onConfigUpdated -> new configuration received');
    const previousMarket = config.market;
    // The stored sign-in is ours: a form save that does not carry it keeps it.
    config = normalizeConfig({
      ...raw,
      [REFRESH_TOKEN_KEY]: raw?.[REFRESH_TOKEN_KEY] || config[REFRESH_TOKEN_KEY],
    });
    applyLogLevel(config);
    if (config.market !== previousMarket) {
      newSession();
      await start();
    }
    refreshWidgets(gladys);
  });

  // --- Connection lifecycle --------------------------------------------------
  gladys.on('connected', async () => {
    try {
      config = normalizeConfig(await gladys.getConfig());
    } catch (err) {
      logger.error(`Configuration not read: ${err.message}`);
    }
    applyLogLevel(config);
    if (!session || session.market !== config.market) {
      newSession();
    }
    await start();
  });

  gladys.on('disconnected', () => {
    fleet.stop();
  });

  gladys.handleShutdown((signal) => {
    logger.info(`Received ${signal} -> graceful shutdown`);
    account.cancel();
    fleet.stop();
  });

  return {
    fleet,
    account,
    get config() {
      return config;
    },
    get session() {
      return session;
    },
    start,
  };
}
