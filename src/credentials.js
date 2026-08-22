// Phase 2A's supported credential source is deliberately narrow: an
// environment value supplied to the local dashboard process. Disk settings
// retain only this opaque reference, never the secret itself.
export const OPENROUTER_MANAGEMENT_CREDENTIAL_REF = 'env:OPENROUTER_MANAGEMENT_KEY';

export function openRouterCredential(env = process.env, reference = OPENROUTER_MANAGEMENT_CREDENTIAL_REF) {
  if (reference !== OPENROUTER_MANAGEMENT_CREDENTIAL_REF) return null;
  const value = typeof env.OPENROUTER_MANAGEMENT_KEY === 'string' ? env.OPENROUTER_MANAGEMENT_KEY.trim() : '';
  return value ? { reference, value } : null;
}

export function credentialStatus(env = process.env, reference = null) {
  return {
    reference: reference === OPENROUTER_MANAGEMENT_CREDENTIAL_REF ? reference : null,
    available: Boolean(openRouterCredential(env, reference))
  };
}
