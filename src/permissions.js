export const DEFAULT_PERMISSIONS = Object.freeze({
  localRead: true,
  networkConnected: false,
  updateCheckNetwork: false,
  localIntegrationWrite: false,
  externalModification: false
});

export function normalizePermissions(value = {}) {
  return Object.freeze({
    localRead: value.localRead !== false,
    networkConnected: value.networkConnected === true,
    updateCheckNetwork: value.updateCheckNetwork === true,
    localIntegrationWrite: value.localIntegrationWrite === true,
    externalModification: value.externalModification === true
  });
}

export function permissionsFromSettings(settings = {}) {
  return normalizePermissions(settings.permissions || DEFAULT_PERMISSIONS);
}
