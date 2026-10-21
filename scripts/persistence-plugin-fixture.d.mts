/** Preserve the legacy SDK's plugin type while also supporting the published namespace plugin. */
export function selectPersistencePlugin<T>(module: T): T extends { default: infer P } ? P : T
