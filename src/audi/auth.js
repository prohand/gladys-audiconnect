// -----------------------------------------------------------------------------
// Signing in to the Audi cloud (myAudi / VW Group identity).
//
// Since 2026 Audi refuses the password sign-in of third-party clients in
// Europe and Canada (the token exchange requires an Android Play Integrity
// attestation). What still works, and what this module does, is the standard
// OAuth "device authorization grant" (RFC 8628) — the same path the Home
// Assistant integration moved to:
//
//   1. ask the identity server for a device code; it answers with a short
//      user code and a page to open (`verification_uri_complete`);
//   2. the user opens that page, signs in to myAudi and approves;
//   3. meanwhile we poll the token endpoint, every `interval` seconds, until
//      it hands out the IDK tokens (access, id and refresh token).
//
// Gladys renders this as an `account_link` field: a "Connect" button that
// opens the page, no redirect back to Gladys (see src/account.js).
//
// From the IDK tokens come the other two the cloud needs:
//   - the AZS token (myAudi authorization server), only for the GraphQL list
//     of the account's cars;
//   - the MBB token (VW Group "mbboauth"), only for lock / unlock, the one
//     command still served by the older MBB platform. Fetched lazily.
// Everything else (status, position, charging, climate, wake-up) goes to the
// CARIAD "BFF" with the IDK access token.
//
// Only the IDK refresh token outlives a restart. It ROTATES: every refresh can
// return a new one, and the old one stops working — `onRefreshToken` is called
// each time so the caller stores the newest (src/account.js keeps it in the
// integration config through `gladys.setConfig`).
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { APP_VERSION, USER_AGENT, request } from './http.js';

const logger = createLogger({ name: 'audi-auth' });

/** Markets whose accounts sign in with the device code (the BFF region they use). */
export const MARKETS = { DE: 'emea', CA: 'emea' };

const MARKETS_URL = 'https://content.app.my.audi.com/service/mobileapp/configurations/markets';
const DEFAULT_CLIENT_ID = '09b6cbec-cd19-4589-82fd-363dfa8c24da@apps_vw-dilab_com';
const DEFAULT_DEVICE_AUTHORIZATION_URL = 'https://identity.vwgroup.io/oidc/v1/device_authorization';
const DEFAULT_MBB_OAUTH_URL = 'https://mbboauth-1d.prd.ece.vwg-connect.com/mbbcoauth';
const DEVICE_CODE_SCOPE = 'openid mbb profile badge cars dealers vin';
const DEVICE_CODE_GRANT = 'urn:ietf:params:oauth:grant-type:device_code';

/** Refresh this long before the access token expires. */
const REFRESH_MARGIN_MS = 5 * 60 * 1000;

/** Headers of the token calls (no X-App-* on those, as the app does). */
const TOKEN_HEADERS = {
  Accept: 'application/json',
  'Accept-Charset': 'utf-8',
  'User-Agent': USER_AGENT,
  'X-App-Version': undefined,
  'X-App-Name': undefined,
};

/**
 * The account needs the user again: no link yet, or a link Audi revoked
 * (refresh token refused). Retrying will not help — only "Connect" will.
 */
export class AudiAuthError extends Error {
  constructor(message) {
    super(message);
    this.name = 'AudiAuthError';
  }
}

export class AudiSession {
  /**
   * @param {object} options
   * @param {string} [options.market] key of MARKETS
   * @param {(refreshToken: string) => void | Promise<void>} [options.onRefreshToken]
   * @param {() => number} [options.now] clock (tests)
   */
  constructor({ market = 'DE', onRefreshToken = () => {}, now = () => Date.now() } = {}) {
    this.market = MARKETS[market] ? market : 'DE';
    this.bff = `https://${MARKETS[this.market]}.bff.cariad.digital`;
    this.onRefreshToken = onRefreshToken;
    this.now = now;
    this.endpoints = null;
    this.idk = null;
    this.idkExpiresAt = 0;
    this.azs = null;
    this.mbb = null;
    this.mbbExpiresAt = 0;
    this.refreshing = null;
  }

  /** True once tokens are held (a link was made, or restored from the config). */
  get linked() {
    return this.idk !== null;
  }

  /** The current IDK refresh token, to store. */
  get refreshToken() {
    return this.idk?.refresh_token ?? null;
  }

  /**
   * Resolve the client id and the endpoints from the public configuration of
   * the market, like the app does at startup. Falls back on the known values
   * for anything the configuration does not say.
   */
  async discover() {
    if (this.endpoints) {
      return this.endpoints;
    }
    const { data: markets } = await request(MARKETS_URL);
    const specification = markets?.countries?.countrySpecifications?.[this.market];
    if (!specification) {
      throw new Error(`The Audi cloud does not know the market ${this.market}`);
    }
    const language = specification.defaultLanguage ?? 'en';
    const { data: market } = await request(
      `https://content.app.my.audi.com/service/mobileapp/configurations/market/${this.market}/${language}?v=4.23.1`,
    );
    const openIdUrl =
      market?.idkLoginServiceConfigurationURLProduction ??
      `${this.bff}/auth/v1/idk/oidc/openid-configuration`;
    const { data: openId } = await request(openIdUrl);

    this.endpoints = {
      language,
      clientId: market?.idkClientIDAndroidLive ?? DEFAULT_CLIENT_ID,
      azs:
        market?.myAudiAuthorizationServerProxyServiceURLProduction ?? `${this.bff}/login/v1/audi`,
      mbb: market?.mbbOAuthBaseURLLive ?? DEFAULT_MBB_OAUTH_URL,
      token: openId?.token_endpoint ?? `${this.bff}/auth/v1/idk/oidc/token`,
      deviceAuthorization:
        openId?.device_authorization_endpoint ?? DEFAULT_DEVICE_AUTHORIZATION_URL,
    };
    return this.endpoints;
  }

  /**
   * Step 1 of the link: get a device code and the page the user approves it on.
   *
   * @returns {Promise<{ deviceCode: string, userCode: string, url: string, intervalMs: number, expiresAt: number }>}
   */
  async startDeviceLogin() {
    const { clientId, deviceAuthorization } = await this.discover();
    const { data, text } = await request(deviceAuthorization, {
      method: 'POST',
      form: { client_id: clientId, scope: DEVICE_CODE_SCOPE },
      throwOnError: false,
    });
    if (!data?.device_code) {
      throw new Error(
        `Audi refused to start the sign-in: ${data?.error_description ?? data?.error ?? text.slice(0, 120)}`,
      );
    }
    const url =
      data.verification_uri_complete ??
      `${data.verification_uri}${data.verification_uri.includes('?') ? '&' : '?'}user_code=${encodeURIComponent(data.user_code)}`;
    return {
      deviceCode: data.device_code,
      userCode: data.user_code,
      url,
      intervalMs: Math.max(1, Number(data.interval) || 5) * 1000,
      expiresAt: this.now() + (Number(data.expires_in) || 600) * 1000,
    };
  }

  /**
   * Step 3 of the link, one poll: did the user approve?
   *
   * @returns {Promise<'ok' | 'pending' | 'slow_down' | 'expired' | 'denied'>}
   */
  async pollDeviceLogin(deviceCode) {
    const { clientId, token } = await this.discover();
    const { data, text } = await request(token, {
      method: 'POST',
      headers: TOKEN_HEADERS,
      form: { grant_type: DEVICE_CODE_GRANT, client_id: clientId, device_code: deviceCode },
      throwOnError: false,
    });
    if (data?.access_token) {
      await this.acceptIdkTokens(data);
      return 'ok';
    }
    switch (data?.error) {
      case 'authorization_pending':
        return 'pending';
      case 'slow_down':
        return 'slow_down';
      case 'expired_token':
        return 'expired';
      case 'access_denied':
        return 'denied';
      default:
        throw new Error(
          `Unexpected answer while waiting for the approval: ${data?.error ?? text.slice(0, 120)}`,
        );
    }
  }

  /** Rebuild a session from a stored refresh token (a restart). */
  async loginWithRefreshToken(refreshToken) {
    if (!refreshToken) {
      throw new AudiAuthError('No Audi account linked yet');
    }
    await this.refreshWith(refreshToken);
  }

  /** Make sure the IDK and AZS tokens are valid for at least a few minutes. */
  async ensureFresh() {
    if (!this.idk) {
      throw new AudiAuthError('No Audi account linked yet');
    }
    if (this.now() < this.idkExpiresAt - REFRESH_MARGIN_MS) {
      return;
    }
    // Concurrent calls (several cars polled at once) share one refresh: two
    // refreshes with the same rotating token would leave one of them dead.
    this.refreshing ??= this.refreshWith(this.idk.refresh_token).finally(() => {
      this.refreshing = null;
    });
    await this.refreshing;
  }

  /** IDK access token: every CARIAD BFF call. */
  async bffToken() {
    await this.ensureFresh();
    return this.idk.access_token;
  }

  /** AZS access token: the GraphQL list of cars. */
  async azsToken() {
    await this.ensureFresh();
    return this.azs.access_token;
  }

  /** MBB access token: lock / unlock. Fetched on first use, then cached. */
  async mbbToken() {
    await this.ensureFresh();
    if (this.mbb && this.now() < this.mbbExpiresAt - REFRESH_MARGIN_MS) {
      return this.mbb.access_token;
    }
    const { mbb } = await this.discover();
    const { data: client } = await request(`${mbb}/mobile/register/v1`, {
      method: 'POST',
      headers: TOKEN_HEADERS,
      json: {
        client_name: 'SM-A405FN',
        platform: 'google',
        client_brand: 'Audi',
        appName: 'myAudi',
        appVersion: APP_VERSION,
        appId: 'de.myaudi.mobile.assistant',
      },
    });
    if (!client?.client_id) {
      throw new Error('The VW Group cloud refused to register the client used for locking');
    }
    const { data } = await request(`${mbb}/mobile/oauth2/v1/token`, {
      method: 'POST',
      headers: { ...TOKEN_HEADERS, 'X-Client-ID': client.client_id },
      form: { grant_type: 'id_token', token: this.idk.id_token, scope: 'sc2:fal' },
      throwOnError: false,
    });
    if (!data?.access_token) {
      throw new Error(
        `The VW Group cloud refused the token used for locking: ${data?.error_description ?? data?.error ?? 'no token'}`,
      );
    }
    this.mbb = data;
    this.mbbClientId = client.client_id;
    this.mbbExpiresAt = this.now() + (Number(data.expires_in) || 3600) * 1000;
    return this.mbb.access_token;
  }

  /** Forget everything (unlink, or a market change). */
  reset() {
    this.idk = null;
    this.idkExpiresAt = 0;
    this.azs = null;
    this.mbb = null;
    this.mbbExpiresAt = 0;
  }

  async refreshWith(refreshToken) {
    const { clientId, token } = await this.discover();
    const { data, text } = await request(token, {
      method: 'POST',
      headers: TOKEN_HEADERS,
      form: {
        client_id: clientId,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        response_type: 'token id_token',
      },
      throwOnError: false,
    });
    if (!data?.access_token) {
      const detail = data?.error_description ?? data?.error ?? text.slice(0, 120);
      // invalid_grant: the refresh token itself is dead (revoked, expired,
      // already rotated). Anything else may be a blip, worth a retry.
      if (data?.error === 'invalid_grant') {
        this.reset();
        throw new AudiAuthError(`Audi refused the stored sign-in: ${detail}`);
      }
      throw new Error(`Audi token refresh failed: ${detail}`);
    }
    // A refresh answer may omit the refresh token: the old one stays valid.
    await this.acceptIdkTokens({ refresh_token: refreshToken, ...data });
  }

  async acceptIdkTokens(tokens) {
    const previous = this.idk?.refresh_token;
    this.idk = tokens;
    this.idkExpiresAt = this.now() + (Number(tokens.expires_in) || 3600) * 1000;
    // The MBB token derives from the id token: get a new one next time.
    this.mbb = null;
    await this.fetchAzs();
    logger.debug('Audi session tokens renewed');
    if (tokens.refresh_token && tokens.refresh_token !== previous) {
      await this.onRefreshToken(tokens.refresh_token);
    }
  }

  async fetchAzs() {
    const { azs } = await this.discover();
    const { data } = await request(`${azs}/token`, {
      method: 'POST',
      json: {
        token: this.idk.access_token,
        grant_type: 'id_token',
        stage: 'live',
        config: 'myaudi',
      },
      throwOnError: false,
    });
    if (!data?.access_token) {
      throw new Error(
        `The myAudi server refused the session: ${data?.error_description ?? data?.error ?? 'no token'}`,
      );
    }
    this.azs = data;
  }
}
