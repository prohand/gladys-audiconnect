// -----------------------------------------------------------------------------
// Entry point of the Audi Connect integration for Gladys Assistant.
//
// Role of this file: create the SDK client and connect. All the wiring lives in
// src/integration.js (testable against the SDK's fake Gladys), the Audi cloud
// in src/audi/, the Gladys devices in src/devices/.
//
// Environment variables provided by the Gladys supervisor to the container:
//   - GLADYS_HOST_API_URL         (host API URL)
//   - GLADYS_INTEGRATION_TOKEN    (integration-scoped JWT)
//   - GLADYS_INTEGRATION_SELECTOR (integration identifier)
// The SDK reads them automatically: `new GladysIntegration()` is enough.
// -----------------------------------------------------------------------------

import { GladysIntegration, logger } from '@gladysassistant/integration-sdk';
import { createIntegration } from './src/integration.js';

const gladys = new GladysIntegration();
createIntegration(gladys);

// An unexpected rejection is logged, never fatal: one failed background order
// must not take the whole integration down.
process.on('unhandledRejection', (reason) => {
  logger.error('Unhandled promise rejection', reason);
});

logger.info('Starting the Audi Connect integration...');
gladys.connect().catch((err) => {
  logger.error('Initial connection failed', err);
  process.exit(1);
});
