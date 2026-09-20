/**
 * Read the live market registry through the GUI's own endpoint, to learn the
 * entry schema a plugin must satisfy to appear in the market catalog.
 *
 * Run: node tools/market-registry.mjs [base-url] [nameFilter]
 */

const base = process.argv[2] ?? 'http://127.0.0.1:3080'
const filter = process.argv[3] ?? ''

const res = await fetch(`${base}/dsh-market/registry`, { cache: 'no-store' })
console.log('status', res.status, 'content-type', res.headers.get('content-type'))
const body = await res.json()

const top = Object.keys(body)
console.log('top-level keys:', top.join(', '))
const registry = body.registry ?? body
console.log('registry keys:', Object.keys(registry).join(', '))
const plugins = registry.plugins ?? registry.items ?? []
console.log('plugin count:', Array.isArray(plugins) ? plugins.length : 'n/a')

if (Array.isArray(plugins) && plugins.length > 0) {
  console.log('\n--- entry shape (first entry) ---')
  console.log(JSON.stringify(plugins[0], null, 2).slice(0, 1200))

  const withNpm = plugins.filter((p) => p.npm).length
  const withUrl = plugins.filter((p) => p.url).length
  console.log(`\nentries with npm: ${withNpm}, with url: ${withUrl}`)
  console.log('categories seen:', [...new Set(plugins.map((p) => p.category).filter(Boolean))].slice(0, 20).join(', '))

  if (filter !== '') {
    const hit = plugins.filter((p) => JSON.stringify(p).toLowerCase().includes(filter.toLowerCase()))
    console.log(`\nentries matching "${filter}": ${hit.length}`)
    for (const h of hit.slice(0, 3)) console.log(JSON.stringify(h, null, 2).slice(0, 900))
  }
}
