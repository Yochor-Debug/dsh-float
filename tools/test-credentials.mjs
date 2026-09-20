/**
 * Regression test for the credential lookup. A fresh `dsh` boot rewrites
 * `~/.dsh/.credentials.yaml` from a block mapping into flow style, which broke
 * the original line-based reader and left the widget showing 「余额异常」. This
 * covers both spellings plus the credential-seam branch. Never part of the
 * shipped plugin.
 *
 * Run: node tools/test-credentials.mjs
 */

import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readApiKey } from '../lib/index.js'

const KEY = 'sk-test-0123456789abcdef'
const BLOCK = `version: 1
records:
  client-connection/browser-session:
    kind: grant
    payload:
      version: 1
      secret: abc
refs:
  DEEPSEEK_API_KEY: ${KEY}
`
const FLOW = `version: 1
records:
  client-connection/browser-session:
    kind: grant
    payload:
      version: 1
      secret: abc
refs: { DEEPSEEK_API_KEY: ${KEY} }
`
const QUOTED = `version: 1
refs: { DEEPSEEK_API_KEY: "${KEY}" }
`
const ABSENT = `version: 1
refs: {}
`

/** Point DSH_HOME at a throwaway directory holding one credentials file. */
function withHome(contents) {
  const home = mkdtempSync(join(tmpdir(), 'dsh-cred-'))
  if (contents !== undefined) writeFileSync(join(home, '.credentials.yaml'), contents)
  return home
}

const cases = [
  { label: 'block mapping', file: BLOCK, expected: KEY },
  { label: 'flow mapping (the style a reboot writes)', file: FLOW, expected: KEY },
  { label: 'flow mapping, quoted value', file: QUOTED, expected: KEY },
  { label: 'no key configured', file: ABSENT, expected: undefined },
  { label: 'no credentials file at all', file: undefined, expected: undefined }
]

const originalHome = process.env.DSH_HOME
const originalKey = process.env.DEEPSEEK_API_KEY
delete process.env.DEEPSEEK_API_KEY

let failed = 0
try {
  for (const testCase of cases) {
    const home = withHome(testCase.file)
    process.env.DSH_HOME = home
    const actual = await readApiKey({ logger: { warn: () => {} } })
    const pass = actual === testCase.expected
    if (!pass) failed++
    console.log(`${pass ? 'PASS' : 'FAIL'}  ${testCase.label}  ->  ${actual === undefined ? 'undefined' : `${actual.slice(0, 8)}…`}`)
    rmSync(home, { recursive: true, force: true })
  }

  /* The credential seam wins over the file, and is asked per call. */
  process.env.DSH_HOME = withHome(ABSENT)
  let calls = 0
  const seamValue = 'sk-from-seam'
  const fromSeam = await readApiKey({
    logger: { warn: () => {} },
    credentials: {
      resolve: async (ref) => {
        calls++
        if (ref !== 'DEEPSEEK_API_KEY') throw new Error(`unexpected ref ${ref}`)
        return { value: seamValue, source: 'env' }
      }
    }
  })
  const seamPass = fromSeam === seamValue && calls === 1
  if (!seamPass) failed++
  console.log(`${seamPass ? 'PASS' : 'FAIL'}  credential seam wins  ->  ${fromSeam} (calls ${calls})`)

  /* A throwing seam falls back to the file rather than failing the reading. */
  process.env.DSH_HOME = withHome(FLOW)
  const fromFallback = await readApiKey({
    logger: { warn: () => {} },
    credentials: {
      resolve: async () => {
        throw new Error('seam down')
      }
    }
  })
  const fallbackPass = fromFallback === KEY
  if (!fallbackPass) failed++
  console.log(`${fallbackPass ? 'PASS' : 'FAIL'}  seam failure falls back to file  ->  ${fromFallback?.slice(0, 8)}…`)

  /* The environment outranks both. */
  process.env.DEEPSEEK_API_KEY = 'sk-from-env'
  const fromEnv = await readApiKey({ logger: { warn: () => {} }, credentials: { resolve: async () => ({ value: seamValue, source: 'env' }) } })
  const envPass = fromEnv === 'sk-from-env'
  if (!envPass) failed++
  console.log(`${envPass ? 'PASS' : 'FAIL'}  environment outranks seam  ->  ${fromEnv}`)
} finally {
  if (originalHome === undefined) delete process.env.DSH_HOME
  else process.env.DSH_HOME = originalHome
  if (originalKey === undefined) delete process.env.DEEPSEEK_API_KEY
  else process.env.DEEPSEEK_API_KEY = originalKey
}

console.log(failed === 0 ? '\nall credential cases passed' : `\n${failed} case(s) failed`)
process.exitCode = failed === 0 ? 0 : 1
