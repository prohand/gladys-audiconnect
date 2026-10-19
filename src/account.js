// -----------------------------------------------------------------------------
// Linking the myAudi account: the `account_link` field of the configuration.
//
// The user clicks "Connect": Gladys calls `onOAuthAuthorizeUrl`, and opens the
// URL resolved here — the Audi page where the user signs in and approves the
// code. Nothing redirects back to Gladys (no callback): this module polls the
// Audi token endpoint at the pace Audi asks for, until the approval, a refusal
// or the expiry of the code, and reports through the connection status.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';
import { LINK_FAILED, waitingForApproval } from './messages.js';

const logger = createLogger({ name: 'account' });

/** RFC 8628: on `slow_down`, wait this much longer between two polls. */
const SLOW_DOWN_STEP_MS = 5_000;

/** Network failures tolerated in a row while waiting for the approval. */
const MAX_POLL_ERRORS = 5;

export class AccountLink {
  /**
   * @param {object} options
   * @param {object} options.gladys
   * @param {() => import('./audi/auth.js').AudiSession} options.getSession
   * @param {() => Promise<void>} options.onLinked called once the account is linked
   * @param {(ms: number) => Promise<void>} [options.sleep] (tests)
   * @param {() => number} [options.now] (tests)
   */
  constructor({ gladys, getSession, onLinked, sleep, now }) {
    this.gladys = gladys;
    this.getSession = getSession;
    this.onLinked = onLinked;
    this.sleep = sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
    this.now = now ?? (() => Date.now());
    this.current = null;
    this.waiting = Promise.resolve();
  }

  /**
   * Start a link: resolves the URL of the Audi approval page, and keeps
   * waiting for the approval in the background.
   */
  async start() {
    this.cancel();
    const session = this.getSession();
    const login = await session.startDeviceLogin();
    const run = { ...login, cancelled: false };
    this.current = run;
    logger.info(`Waiting for the approval of code ${login.userCode} on the Audi page`);
    await this.gladys
      .setConnectionStatus(false, waitingForApproval(login.userCode))
      .catch(() => {});
    this.waiting = this.wait(session, run).catch((err) => {
      logger.error(`Account link failed: ${err.message}`);
    });
    return login.url;
  }

  /** Stop waiting (a new link, a disconnection, a shutdown). */
  cancel() {
    if (this.current) {
      this.current.cancelled = true;
      this.current = null;
    }
  }

  async wait(session, run) {
    let interval = run.intervalMs;
    let errors = 0;
    while (!run.cancelled && this.now() < run.expiresAt) {
      await this.sleep(interval);
      if (run.cancelled) {
        return;
      }
      let result;
      try {
        result = await session.pollDeviceLogin(run.deviceCode);
        errors = 0;
      } catch (err) {
        errors += 1;
        logger.warn(`Waiting for the approval: ${err.message}`);
        if (errors >= MAX_POLL_ERRORS) {
          await this.fail(run, LINK_FAILED.error);
          return;
        }
        continue;
      }
      switch (result) {
        case 'ok':
          logger.info('myAudi account linked');
          this.current = null;
          await this.onLinked();
          return;
        case 'slow_down':
          interval += SLOW_DOWN_STEP_MS;
          break;
        case 'expired':
          await this.fail(run, LINK_FAILED.expired);
          return;
        case 'denied':
          await this.fail(run, LINK_FAILED.denied);
          return;
        default:
          // pending: the user has not approved yet.
          break;
      }
    }
    if (!run.cancelled) {
      await this.fail(run, LINK_FAILED.expired);
    }
  }

  async fail(run, message) {
    if (this.current === run) {
      this.current = null;
    }
    logger.warn(`Account link ended: ${message.en}`);
    await this.gladys.setConnectionStatus(false, message).catch(() => {});
  }
}
