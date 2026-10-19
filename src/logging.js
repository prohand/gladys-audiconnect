// -----------------------------------------------------------------------------
// The log level, switchable from the Configuration screen.
//
// The Audi cloud is the part of this integration nobody can watch: a sign-in
// refused, a car that answers with half its fields, a command the car never
// confirmed. The debug channel tells those apart, and until now reaching it
// meant setting `LOG_LEVEL=debug` on the container — a redeploy, exactly what a
// user diagnosing their installation cannot do from the Gladys UI.
//
// The SDK logger re-reads `process.env.LOG_LEVEL` on every line, so writing
// that variable is enough: it takes effect at once, for every logger already
// created. The value the operator set on the container is the baseline: the
// switch raises the level to debug while it is on, and puts their value back —
// not `info` — when it goes off.
// -----------------------------------------------------------------------------

import { createLogger } from '@gladysassistant/integration-sdk';

const logger = createLogger({ name: 'logging' });

/** `LOG_LEVEL` as the container was started with, read once. */
const BASELINE = process.env.LOG_LEVEL;

/**
 * Apply the log level a configuration asks for.
 *
 * @param {{ debug_logs?: boolean }} config normalized configuration
 * @returns {string} the level in force afterwards
 */
export function applyLogLevel(config) {
  const wanted = config?.debug_logs ? 'debug' : BASELINE;
  const current = process.env.LOG_LEVEL;

  if (wanted === undefined) {
    delete process.env.LOG_LEVEL;
  } else {
    process.env.LOG_LEVEL = wanted;
  }

  // Said at info, so it is readable in both directions: the line announcing
  // debug survives the level it announces, the line ending it is printed
  // after the level dropped back.
  if (current !== process.env.LOG_LEVEL) {
    logger.info(
      config?.debug_logs
        ? 'Detailed logs turned on'
        : `Detailed logs turned off (level: ${process.env.LOG_LEVEL ?? 'info'})`,
    );
  }
  return process.env.LOG_LEVEL ?? 'info';
}
