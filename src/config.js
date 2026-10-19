// -----------------------------------------------------------------------------
// Integration configuration.
//
// Filled in by the user from the `config_schema` of
// gladys-assistant-integration.json; the SDK fetches it (`gladys.getConfig()`)
// and announces every change (`gladys.onConfigUpdated()`). This module gives
// the defaults and normalizes the received object, so the rest of the code
// never deals with `undefined` or with numbers typed as strings.
// -----------------------------------------------------------------------------

import { MARKETS } from './audi/auth.js';

/**
 * Key of the stored Audi refresh token. OUTSIDE the config_schema on purpose:
 * written by the integration through `gladys.setConfig`, never shown in the
 * Configuration screen, never sent to the browser.
 */
export const REFRESH_TOKEN_KEY = 'audi_refresh_token';

/** Key of the `account_link` field (the "Connect" button). */
export const ACCOUNT_FIELD_KEY = 'account';

// Defaults: they MUST match the `default` values of the manifest config_schema
// (test/manifest.test.js checks it).
export const DEFAULT_CONFIG = {
  market: 'DE',
  spin: '',
  // Seconds between two reads of a car. Every read costs calls of the daily
  // allowance of the account: a quarter of an hour is what the myAudi app
  // users never notice.
  poll_frequency: 900,
  debug_logs: false,
  [REFRESH_TOKEN_KEY]: '',
};

export const POLL_FREQUENCY_BOUNDS = { min: 300, max: 3600 };

const clamp = (value, { min, max }, fallback) => {
  const n = Number(value);
  if (!Number.isFinite(n)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, n));
};

/**
 * Merge the user config with the defaults.
 * @param {Record<string, unknown>} raw config returned by the SDK
 */
export function normalizeConfig(raw = {}) {
  const config = raw ?? {};
  const market = String(config.market ?? DEFAULT_CONFIG.market).toUpperCase();
  return {
    ...DEFAULT_CONFIG,
    ...config,
    market: MARKETS[market] ? market : DEFAULT_CONFIG.market,
    // An S-PIN is 4 digits; spaces typed around it are not part of it.
    spin: String(config.spin ?? '').trim(),
    poll_frequency: clamp(
      config.poll_frequency ?? DEFAULT_CONFIG.poll_frequency,
      POLL_FREQUENCY_BOUNDS,
      DEFAULT_CONFIG.poll_frequency,
    ),
    debug_logs: config.debug_logs === true || config.debug_logs === 'true',
    [REFRESH_TOKEN_KEY]: String(config[REFRESH_TOKEN_KEY] ?? ''),
  };
}
