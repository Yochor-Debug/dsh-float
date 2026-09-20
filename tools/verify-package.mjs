/**
 * Standalone verifier for the balance-float plugin package.
 *
 * Loads the packaged host half exactly as the loader would (ESM import of the
 * package entry), mounts it on a stub context, and checks the two things the
 * plugin owns: the /x-balance-float route and the index-injection rows. Also
 * asserts the bundle manifest points at a readable patch file, because that is
 * what makes `dsh plugin add` treat this package as a profile layer.
 *
 * Run: node tools/verify-package.mjs
 */

import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'

const pkgUrl = new URL('../package.json', import.meta.url)
const pkg = JSON.parse(readFileSync(fileURLToPath(pkgUrl), 'utf8'))

let failures = 0
const check = (label, ok, detail) => {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label.padEnd(34)} ${detail}`)
}

// --- manifest checks (this is what makes it an installable bundle) -----------
console.log('--- package manifest ---')
check('dsh.bundle.patch declared', pkg.dsh?.bundle?.patch !== undefined, pkg.dsh?.bundle?.patch ?? 'missing')
const patchPath = new URL(pkg.dsh.bundle.patch, pkgUrl)
let patchText = ''
try {
  patchText = readFileSync(fileURLToPath(patchPath), 'utf8')
  check('patch file readable', true, fileURLToPath(patchPath))
} catch (error) {
  check('patch file readable', false, error.message)
}
check('patch inserts our module', /name:\s*dsh-plugin-balance-float/m.test(patchText), 'bare package name in patch')
check('entry point exists in exports', typeof pkg.exports?.['.'] === 'string', pkg.exports?.['.'] ?? 'missing')
check('client script is shipped', (pkg.files ?? []).includes('lib/client.js'), JSON.stringify(pkg.files))

// --- behaviour checks: import the packaged entry and mount it ---------------
console.log('\n--- host half ---')
const entryUrl = new URL(pkg.exports['.'], pkgUrl)
const { apply, inject, name } = await import(entryUrl.href)
check('module exports apply', typeof apply === 'function', `entry=${pkg.exports['.']} name=${name} inject=${JSON.stringify(inject)}`)

const routes = new Map()
const injections = []
const ctx = {
  logger: { warn: (...args) => console.log('   [warn]', ...args) },
  effect: (factory) => { factory() },
  on: (event, listener) => { if (event === 'webserver/index-inject') injections.push(listener) },
  webServer: {
    register: (route) => { routes.set(route.path, route); return () => routes.delete(route.path) }
  }
}
apply(ctx)

check('registered the balance route', routes.has('/x-balance-float'), [...routes.keys()].join(', ') || 'none')

const rows = []
for (const listener of injections) listener(rows)
const scriptRow = rows.find((row) => row.kind === 'script')
const styleRow = rows.find((row) => row.kind === 'style')
check('injects the widget script', scriptRow !== undefined && scriptRow.text.includes('dsh-balance-float'), `script row: ${scriptRow?.placement ?? 'none'}`)
check('injects the host style row', styleRow !== undefined, styleRow?.text?.slice(0, 60) ?? 'none')
check('widget uses click-only toggle', scriptRow !== undefined && !/addEventListener\('pointer(enter|leave)'/.test(scriptRow.text), 'no hover listeners in injected script')

// --- exercise the route over real HTTP -------------------------------------
const route = routes.get('/x-balance-float')
const server = createServer((req, res) => {
  route.handler(req, res).catch((error) => { res.writeHead(500); res.end(String(error)) })
})
await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}/x-balance-float`

const get = await fetch(base)
const body = await get.json()
check('route answers JSON', get.status === 200 && typeof body.ok === 'boolean', JSON.stringify(body).slice(0, 110))
const head = await fetch(base, { method: 'HEAD' })
check('route handles HEAD', head.status === 200 && (await head.text()) === '', `status=${head.status}`)
const post = await fetch(base, { method: 'POST' })
check('route rejects other methods', post.status === 405, `status=${post.status} allow=${post.headers.get('allow')}`)

server.close()

console.log(`\n${failures === 0 ? 'VERIFY_PACKAGE: ALL_PASS' : `VERIFY_PACKAGE: ${failures}_FAILED`}`)
process.exitCode = failures === 0 ? 0 : 1
