/**
 * Boundary test for the peak/off-peak (峰/谷) badge.
 *
 * The spec, from DeepSeek's official pricing page: peak hours are 01:00-04:00 and
 * 06:00-10:00 UTC, Monday to Friday, excluding Chinese public holidays; every other
 * hour is off-peak, weekends and holidays in full. The expectations below are
 * written out from that sentence rather than recomputed from the widget's own
 * logic, so a wrong window in client.js fails here instead of agreeing with itself.
 *
 * How it works: load the rig once, then for each case override `window.Date` with a
 * fixed instant, force a repaint (double-click the capsule), and read the badge out
 * of the CLOSED shadow root through CDP's pierced DOM.
 *
 * Run: node tools/verify-tariff.mjs [rig-url]
 */

import { spawn } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const url = process.argv[2] ?? 'http://127.0.0.1:3931/'
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9346
const profile = join(tmpdir(), `edge-tariff-${Date.now()}`)
mkdirSync(profile, { recursive: true })

/** [label, UTC instant, expected badge] - boundaries included on purpose. */
const CASES = [
  ['Mon 00:59 before the window', '2026-09-21T00:59:00Z', '谷'],
  ['Mon 01:00 window opens', '2026-09-21T01:00:00Z', '峰'],
  ['Mon 02:00 inside', '2026-09-21T02:00:00Z', '峰'],
  ['Mon 03:59 last minute', '2026-09-21T03:59:00Z', '峰'],
  ['Mon 04:00 window closes', '2026-09-21T04:00:00Z', '谷'],
  ['Mon 05:30 between windows', '2026-09-21T05:30:00Z', '谷'],
  ['Mon 06:00 second window opens', '2026-09-21T06:00:00Z', '峰'],
  ['Mon 09:59 last minute', '2026-09-21T09:59:00Z', '峰'],
  ['Mon 10:00 second window closes', '2026-09-21T10:00:00Z', '谷'],
  ['Mon 23:30 late evening', '2026-09-21T23:30:00Z', '谷'],
  ['Sat 02:00 weekend', '2026-09-26T02:00:00Z', '谷'],
  ['Sun 08:00 weekend', '2026-09-20T08:00:00Z', '谷']
]

const child = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--window-size=1000,800', 'about:blank'
], { stdio: 'ignore' })

async function target() {
  for (let i = 0; i < 80; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const page = list.find((e) => e.type === 'page')
      if (page?.webSocketDebuggerUrl !== undefined) return page.webSocketDebuggerUrl
    } catch { /* starting */ }
    await delay(250)
  }
  throw new Error('verify-tariff: DevTools never came up')
}

async function connect(wsUrl) {
  const socket = new WebSocket(wsUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', () => reject(new Error('ws failed')), { once: true })
  })
  let id = 0
  const pending = new Map()
  socket.addEventListener('message', (event) => {
    const m = JSON.parse(event.data)
    const entry = pending.get(m.id)
    if (entry === undefined) return
    pending.delete(m.id)
    if (m.error !== undefined) entry.reject(new Error(JSON.stringify(m.error)))
    else entry.resolve(m.result)
  })
  return {
    send(method, params = {}) {
      const n = ++id
      socket.send(JSON.stringify({ id: n, method, params }))
      return new Promise((resolve, reject) => pending.set(n, { resolve, reject }))
    },
    close: () => socket.close()
  }
}

/** Force the widget's clock, keeping the real Date reachable for other callers. */
function freezeClock(cdp, iso) {
  const ms = Date.parse(iso)
  return cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const Real = window.__realDate || Date
      window.__realDate = Real
      function FakeDate(...args) { return args.length === 0 ? new Real(${ms}) : new Real(...args) }
      FakeDate.now = () => ${ms}
      FakeDate.UTC = Real.UTC
      FakeDate.parse = Real.parse
      window.Date = FakeDate
      return new Real(${ms}).toISOString()
    })()`,
    returnByValue: true
  })
}

/** Read the badge out of the closed shadow root via the pierced DOM. */
async function readBadge(cdp) {
  const doc = await cdp.send('DOM.getDocument', { depth: -1, pierce: true })
  let found = null
  const walk = (node) => {
    if (node === undefined || node === null || found !== null) return
    const attributes = node.attributes ?? []
    for (let i = 0; i < attributes.length; i += 2) {
      if (attributes[i] === 'class' && /(?:^|\s)rate(?:\s|$)/.test(attributes[i + 1])) { found = node; return }
    }
    for (const key of ['children', 'shadowRoots', 'contentDocument']) {
      const list = node[key]
      if (Array.isArray(list)) for (const child of list) { walk(child); if (found !== null) return }
    }
  }
  walk(doc.root)
  if (found === null) return null
  const { object } = await cdp.send('DOM.resolveNode', { nodeId: found.nodeId })
  const res = await cdp.send('Runtime.callFunctionOn', {
    objectId: object.objectId,
    functionDeclaration: 'function(){ return { text: this.textContent, cls: this.className, title: this.title } }',
    returnByValue: true
  })
  return res.result.value
}

try {
  const cdp = await connect(await target())
  await cdp.send('Page.enable')
  await cdp.send('DOM.enable')
  await cdp.send('Page.navigate', { url })
  await delay(9000)

  const vp = JSON.parse((await cdp.send('Runtime.evaluate', {
    expression: 'JSON.stringify({ w: innerWidth, h: innerHeight })', returnByValue: true
  })).result.value)
  const x = vp.w - 18 - 40
  const y = vp.h - 18 - 17

  let failures = 0
  for (const [label, iso, want] of CASES) {
    const actualIso = (await freezeClock(cdp, iso)).result.value
    // Double-click forces a repaint; the badge is recomputed inside paint().
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 2 })
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 2 })
    let badge = null
    for (let i = 0; i < 30 && badge === null; i++) { await delay(150); badge = await readBadge(cdp) }
    const got = badge === null ? '(no badge)' : badge.text
    const ok = got === want
    if (!ok) failures += 1
    console.log(`${ok ? 'PASS' : 'FAIL'} ${label.padEnd(30)} clock=${actualIso.slice(11, 16)}Z  want=${want}  got=${got}  class=${badge === null ? '-' : badge.cls}`)
    if (ok && label.startsWith('Mon 01:00')) console.log(`     tooltip: ${badge.title.replace(/\n/g, ' / ')}`)
    // Close the panel again so the next double-click targets the capsule.
    await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
    await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
    await delay(200)
  }

  console.log(`\nVERIFY_TARIFF: ${failures === 0 ? 'ALL_PASS' : failures + '_FAILED'}`)
  cdp.close()
  process.exitCode = failures === 0 ? 0 : 1
} finally {
  child.kill('SIGKILL')
  await delay(400)
  rmSync(profile, { recursive: true, force: true })
}
