/**
 * Show what the plugin-market's "installed" endpoint reports, so we can tell
 * whether a locally installed bundle shows up in that list (and whether it has
 * a toggle).
 *
 * Run: node tools/market-installed.mjs [base-url]
 */

const base = process.argv[2] ?? 'http://127.0.0.1:3080'

const res = await fetch(`${base}/dsh-market/installed`, { cache: 'no-store' })
console.log('status', res.status)
const body = await res.json()

console.log('\ntop-level keys:', Object.keys(body).join(', '))

const show = (label, value) => {
  if (value === undefined) return
  const arr = Array.isArray(value) ? value : [value]
  console.log(`\n${label} (${arr.length}):`)
  for (const item of arr) console.log('  -', typeof item === 'string' ? item : JSON.stringify(item))
}

show('bundles', body.bundles)
show('disabled', body.disabled)
show('order', body.order)
if (body.dependencies !== undefined) {
  const deps = body.dependencies
  console.log(`\ndependencies (${Array.isArray(deps) ? deps.length : Object.keys(deps).length}):`)
  const entries = Array.isArray(deps) ? deps : Object.entries(deps).map(([k, v]) => `${k}@${v}`)
  for (const e of entries) console.log('  -', typeof e === 'string' ? e : JSON.stringify(e))
}

const mentionsOurs = JSON.stringify(body).includes('dsh-plugin-balance-float')
console.log(`\nmentions dsh-plugin-balance-float anywhere: ${mentionsOurs}`)
