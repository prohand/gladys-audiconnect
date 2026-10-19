// -----------------------------------------------------------------------------
// The HTTP layer every Audi call goes through.
//
// Node 22 ships `fetch`: no dependency. This module only adds what the Audi
// cloud needs on top of it:
//   - the headers of the myAudi Android app (some gateways answer differently,
//     or not at all, to an unknown client);
//   - a 30 s timeout on the whole request, body included;
//   - the `Vcf-Remaining-Calls` header, the metered daily allowance of the
//     account, remembered so the widget and the logs can show it;
//   - one error type, `AudiHttpError`, carrying the status and the body
//     (shortened), so callers can tell a 401 from a 429 from a timeout.
//
// `setFetch` exists for the tests: they never touch the network.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'audi-http' });

export const APP_VERSION = '4.31.0';
export const USER_AGENT = `Android/${APP_VERSION} (Build 800341641.root project 'myaudi_android'.ext.buildTime) Android/13`;
export const TIMEOUT_MS = 30_000;

/** Headers of the myAudi app, sent on every call unless replaced. */
export const APP_HEADERS = {
  Accept: 'application/json',
  'Accept-Charset': 'utf-8',
  'X-App-Version': APP_VERSION,
  'X-App-Name': 'myAudi',
  'User-Agent': USER_AGENT,
};

let fetchImpl = (...args) => globalThis.fetch(...args);

/** Replace `fetch` (tests). Returns the previous one. */
export function setFetch(impl) {
  const previous = fetchImpl;
  fetchImpl = impl;
  return previous;
}

/** What the account has left of its daily allowance, as the cloud last said. */
export const rateLimit = { remaining: null, at: null };

export class AudiHttpError extends Error {
  constructor(status, url, body) {
    // The path only: query strings can carry identifiers.
    const path = safePath(url);
    super(`Audi cloud answered HTTP ${status} on ${path}`);
    this.name = 'AudiHttpError';
    this.status = status;
    this.path = path;
    this.body = body;
  }
}

/**
 * Send one request.
 *
 * @param {string} url
 * @param {object} [options]
 * @param {string} [options.method] GET by default
 * @param {Record<string, string>} [options.headers] merged over APP_HEADERS
 * @param {object} [options.json] JSON body
 * @param {Record<string, string>} [options.form] form-encoded body
 * @param {string} [options.token] bearer token
 * @param {boolean} [options.throwOnError] false: resolve whatever the status
 * @returns {Promise<{ status: number, data: any, text: string }>}
 */
export async function request(url, options = {}) {
  const { method = 'GET', json, form, token, throwOnError = true } = options;
  // A header set to `undefined` in options.headers removes the app default.
  const headers = Object.fromEntries(
    Object.entries({ ...APP_HEADERS, ...options.headers }).filter(([, v]) => v !== undefined),
  );
  let body;
  if (json !== undefined) {
    body = JSON.stringify(json);
    headers['Content-Type'] = 'application/json; charset=utf-8';
  } else if (form !== undefined) {
    body = new URLSearchParams(form).toString();
    headers['Content-Type'] = 'application/x-www-form-urlencoded';
  }
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }

  let response;
  try {
    response = await fetchImpl(url, {
      method,
      headers,
      body,
      redirect: 'manual',
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
  } catch (err) {
    if (err?.name === 'TimeoutError' || err?.name === 'AbortError') {
      throw new Error(
        `Audi cloud did not answer within ${TIMEOUT_MS / 1000} s (${safePath(url)})`,
        {
          cause: err,
        },
      );
    }
    throw new Error(`Audi cloud unreachable (${safePath(url)}): ${err?.message ?? err}`, {
      cause: err,
    });
  }

  readRateLimit(response.headers);
  const text = await response.text();
  let data = null;
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
  }
  logger.debug(`${method} ${safePath(url)} -> ${response.status}`);
  if (throwOnError && (response.status < 200 || response.status >= 300)) {
    throw new AudiHttpError(response.status, url, text.slice(0, 300));
  }
  return { status: response.status, data, text };
}

function readRateLimit(headers) {
  const raw = headers?.get?.('vcf-remaining-calls');
  const remaining = Number.parseInt(raw ?? '', 10);
  if (Number.isFinite(remaining)) {
    rateLimit.remaining = remaining;
    rateLimit.at = new Date().toISOString();
    if (remaining < 10) {
      logger.warn(`Only ${remaining} Audi cloud calls left for today on this account`);
    }
  }
}

function safePath(url) {
  try {
    const { host, pathname } = new URL(url);
    // A VIN in the path is an identifier of the owner: keep its last 4 only.
    return `${host}${pathname.replace(/\/([A-HJ-NPR-Z0-9]{13})([A-HJ-NPR-Z0-9]{4})(?=\/|$)/gi, '/*************$2')}`;
  } catch {
    return '(invalid url)';
  }
}
