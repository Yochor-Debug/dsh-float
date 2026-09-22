/**
 * Regression test for the credential-seam notice.
 *
 * The desktop shell does not inject the `credentials` service, and Cordis throws
 * on reading an uninjected service. The plugin must fall back to the credentials
 * file and say so ONCE per process — not once per poll, which is what it used to
 * do (~25s apart in the shell's log).
 *
 * The stub context below throws on `.credentials` exactly like Cordis does, so
 * the fallback path is the one under test.
 *
 * Run: node tools/verify-credential-fallback.mjs
 */

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const pkgUrl = new URL('../package.json', import.meta.url)
const pkg = JSON.parse(readFileSync(fileURLToPath(pkgUrl), 'utf8'))
const { readApiKey } = await import(new URL(pkg.exports['.'], pkgUrl).href)

let failures = 0
const check = (label, ok, detail = '') => {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label.padEnd(38)} ${detail}`)
}

// The seam path is only reached when the environment does not already carry a key.
const savedKey = process.env.DEEPSEEK_API_KEY
delete process.env.DEEPSEEK_API_KEY

const warnings = []
const logger = { warn: (message) => warnings.push(String(message)), info: () => {}, error: () => {} }
const credentials = { resolve: async () => { throw new Error('should not be reached') } }

/** Cordis throws on an uninjected service; a plain object would not. */
const throwingCtx = new Proxy({ logger }, {
  get(target, key) {
    if (key === 'credentials') throw new Error('cannot get property "credentials" without inject')
    return target[key]
  }
})

console.log('--- 1) seam unavailable: falls back and notes it once ---')
const first = await readApiKey(throwingCtx)
check('fallback returns a key', typeof first === 'string' && first.length > 0, first === undefined ? 'undefined' : `length ${first.length}`)
check('exactly one notice after 1 call', warnings.length === 1, `${warnings.length} warning(s)`)
check('notice explains the fallback', /credentials file instead/.test(warnings[0] ?? ''), (warnings[0] ?? '').slice(0, 80))

console.log('\n--- 2) ten more calls add no log lines (this is the fix) ---')
for (let i = 0; i < 10; i++) await readApiKey(throwingCtx)
check('still exactly one notice', warnings.length === 1, `${warnings.length} warning(s) after 11 calls`)

console.log('\n--- 3) a working seam is still preferred and stays silent ---')
const working = { ...throwingCtx }
const value = await readApiKey(new Proxy({ logger, credentials: { resolve: async () => ({ value: 'from-seam' }) } }, {
  get(target, key) { return target[key] }
}))
check('seam value wins when available', value === 'from-seam', String(value))
check('no extra notice for a working seam', warnings.length === 1, `${warnings.length} warning(s)`)

console.log('\n--- 4) the environment variable still short-circuits everything ---')
process.env.DEEPSEEK_API_KEY = 'from-env'
const fromEnv = await readApiKey(throwingCtx)
check('env value wins', fromEnv === 'from-env', String(fromEnv))
check('still exactly one notice', warnings.length === 1, `${warnings.length} warning(s)`)

if (savedKey === undefined) delete process.env.DEEPSEEK_API_KEY
else process.env.DEEPSEEK_API_KEY = savedKey

console.log(`\n${failures === 0 ? 'VERIFY_CREDENTIAL_FALLBACK: ALL_PASS' : `VERIFY_CREDENTIAL_FALLBACK: ${failures}_FAILED`}`)
process.exitCode = failures === 0 ? 0 : 1
void working
