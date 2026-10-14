/** Select only the two published JSONL Cordis plugin shapes, without losing Config or lifecycle ownership. */
export function selectPersistencePlugin(module) {
  if (module === null || typeof module !== 'object' || Array.isArray(module)) {
    throw new Error('UNSUPPORTED_PERSISTENCE_PLUGIN_EXPORT')
  }
  const legacy = module.default
  const validLegacy = typeof legacy === 'function'
    || (legacy !== null && typeof legacy === 'object' && typeof legacy.apply === 'function')
  // alpha.3 exports the plugin namespace itself; passing only apply loses Config.
  // Source runners may proxy missing namespace properties to the default class;
  // Function.prototype.apply is not a named module export.
  const validNamespace = Object.hasOwn(module, 'apply') && typeof module.apply === 'function'
  if (validNamespace && !Object.hasOwn(module, 'default')) return module
  if (validLegacy && Object.hasOwn(module, 'default') && !Object.hasOwn(module, 'apply')) return legacy
  throw new Error('UNSUPPORTED_PERSISTENCE_PLUGIN_EXPORT')
}
