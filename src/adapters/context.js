export function adapterContext({ sources = {}, previousSessions = new Map(), now = new Date(), localRead = true, permissions = {}, legacy = {}, discovery = null, projects = [] } = {}) {
  return Object.freeze({
    sources: Object.freeze({ ...sources }),
    projects: Object.freeze([...projects]),
    previousSessions,
    now,
    permissions: Object.freeze({
      localRead: Boolean(localRead),
      networkConnected: false,
      updateCheckNetwork: false,
      localIntegrationWrite: false,
      externalModification: false,
      ...permissions
    }),
    legacy: Object.freeze({ ...legacy }),
    discovery,
    // Deliberately no shell, browser, credential, or mutable global context.
    readOnly: true
  });
}
