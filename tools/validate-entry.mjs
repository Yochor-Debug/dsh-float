/**
 * Validate a registry entry file the same way the catalog does:
 *   - it must parse as YAML
 *   - a description containing ": " must be quoted (the documented trap)
 *   - only the allowed keys may appear (a hand-written `npm:` is rejected)
 *   - the filename must be <owner>__<repo>.yml matching the entry's url
 *
 * Run: node tools/validate-entry.mjs <entry.yml> [expectedOwner__repo]
 */

import { readFileSync } from 'node:fs'
import { basename, join } from 'node:path'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { pathToFileURL } from 'node:url'

/**
 * Load js-yaml from wherever it is installed. This repository declares no
 * dependencies of its own, so there is nothing local to import: the harness profile
 * keeps a copy, and so does any scratch directory where js-yaml was installed.
 * DSH_YAML_ROOT overrides the search when neither is the case.
 */
function loadYaml() {
  const roots = [
    join(process.cwd(), 'node_modules'),
    join(homedir(), '.dsh', 'profiles', 'web', 'node_modules'),
    ...(process.env.DSH_YAML_ROOT ? [process.env.DSH_YAML_ROOT] : [])
  ]
  for (const root of roots) {
    try {
      const require = createRequire(pathToFileURL(join(root, 'noop.js')))
      return require('js-yaml')
    } catch {
      /* not here; try the next root */
    }
  }
  throw new Error('js-yaml not found: install it, or point DSH_YAML_ROOT at a node_modules directory that has it')
}

const yaml = loadYaml()

const file = process.argv[2]
if (file === undefined) throw new Error('usage: validate-entry.mjs <entry.yml> [expectedStem]')

const ALLOWED = new Set(['url', 'name', 'category', 'description', 'note', 'screenshots'])
const CATEGORIES = new Set([
  'agi', 'ui', 'usage', 'theme', 'model', 'identity', 'session', 'memory', 'tools', 'wsl',
  'browser', 'vision', 'voice', 'docs', 'skill', 'workflow', 'git', 'notify', 'dev',
  'security', 'remote', 'market', 'fun',
])

let failures = 0
const check = (label, ok, detail = '') => {
  if (!ok) failures += 1
  console.log(`${ok ? 'PASS' : 'FAIL'} ${label.padEnd(30)} ${detail}`)
}

const raw = readFileSync(file, 'utf8')

// 1. parse
let entry
try {
  entry = yaml.load(raw)
  check('YAML parses', true)
} catch (error) {
  check('YAML parses', false, error.message)
  process.exit(1)
}

// 2. the ": " trap. It applies only to a description VALUE: an unquoted
//    "Vision toolkit: OCR" there makes YAML read a nested key. Top-level keys
//    like `url: https://…` are of course fine, so only indented en/zh lines are
//    inspected - an earlier version flagged every key and reported the already
//    published entries as broken.
const unquoted = []
for (const line of raw.split('\n')) {
  const value = /^\s+(en|zh):\s+(.*)$/.exec(line)
  if (value === null) continue
  const text = value[2]
  const quoted = /^(['"]).*\1$/.test(text.trim())
  if (text.includes(': ') && !quoted) unquoted.push(line.trim().slice(0, 70))
}
check('description ": " quoted', unquoted.length === 0, unquoted.join(' | '))

// 3. keys
const keys = Object.keys(entry)
const extra = keys.filter((k) => !ALLOWED.has(k))
check('keys allowed', extra.length === 0, extra.length ? `unexpected: ${extra.join(', ')} (a hand-written npm: is rejected)` : keys.join(', '))

// 4. required fields + shape
check('url is a github repo', /^https:\/\/github\.com\/[^/]+\/[^/]+$/.test(entry.url), entry.url)
check('category valid', CATEGORIES.has(entry.category), entry.category)
check('description.en present', typeof entry.description?.en === 'string' && entry.description.en.length > 0)
check('description.en ends with .', typeof entry.description?.en === 'string' && entry.description.en.trim().endsWith('.'))
check('description.zh present', typeof entry.description?.zh === 'string', entry.description?.zh ? 'yes' : 'missing (optional; a maintainer adds it)')

// 5. filename convention <owner>__<repo>.yml
const stem = basename(file, '.yml')
const fromUrl = entry.url.replace('https://github.com/', '').replace(/\//g, '__')
check('filename matches url', stem === fromUrl, `${stem} vs ${fromUrl}`)

console.log('\n--- parsed entry ---')
console.log(JSON.stringify(entry, null, 2))
console.log(`\n${failures === 0 ? 'VALIDATE_ENTRY: ALL_PASS' : `VALIDATE_ENTRY: ${failures}_FAILED`}`)
process.exitCode = failures === 0 ? 0 : 1
