const plugin = await import('../lib/index.js')

if (plugin.name !== 'whalemaid' || typeof plugin.apply !== 'function' || plugin.Config == null) {
  throw new Error('built plugin exports are incomplete')
}
