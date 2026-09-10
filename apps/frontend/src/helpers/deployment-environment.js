// deployment-environment.js
// PURGE_TEST_TOOL — Test tool — remove at handover. Grep PURGE_TEST_TOOL.
//
// Reads the deployed environment from the API rather than inferring it from
// window.location.hostname: a staging build served on an unexpected domain must
// still behave as staging, and a production build must never be talked into
// showing a destructive test control by the URL it happens to be served from.
//
// The environment comes from the SERVER the client is actually talking to, which
// is the only authority on whether the purge endpoint will accept a request.

import apiClient from '../api-client/api-client.js';

const PURGE_ENABLED_ENVIRONMENTS = ['development', 'staging', 'test'];

export async function fetchDeploymentEnvironment() {
  try {
    const result = await apiClient.get('/health/environment');
    return typeof result?.environment === 'string' ? result.environment : null;
  } catch {
    // Unknown environment is treated as production: fail CLOSED, so a failed
    // probe hides the destructive control rather than revealing it.
    return null;
  }
}

export function isPurgeToolEnabled(environment) {
  return PURGE_ENABLED_ENVIRONMENTS.includes(environment);
}
