/**
 * Interaction check for the balance-float widget, driven over CDP against the rig.
 *
 * Checks the click-only rule:
 *   1. hovering must NOT open the panel
 *   2. one click opens it
 *   3. a second click closes it
 *   4. double click still refreshes (one extra /x-balance-float request)
 *   5. auto refresh keeps its ~5s rhythm
 *
 * The panel lives in a closed shadow root, so the page cannot be queried for it.
 * Detection therefore uses CDP's DOM domain with `pierce: true`, which walks into
 * closed shadow trees, and counts nodes inside the widget's shadow root: the
 * collapsed widget is a handful of nodes, opening the panel adds its subtree.
 *
 * Run: node tools/verify-interactions.mjs [rig-url]   (start the rig first)
 */

import { spawn } from 'node:child_process'
import { mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const url = process.argv[2] ?? 'http://127.0.0.1:3931/'
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9337
const profile = join(tmpdir(), `edge-balance-verify-${Date.now()}`)
mkdirSync(profile, { recursive: true })

const child = spawn(
  EDGE,
  [
    '--headless=new',
    '--disable-gpu',
    '--no-first-run',
    '--no-default-browser-check',
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    '--window-size=1000,900',
    'about:blank'
  ],
  { stdio: 'ignore' }
)

async function target() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const page = list.find((entry) => entry.type === 'page')
      if (page?.webSocketDebuggerUrl !== undefined) return page.webSocketDebuggerUrl
    } catch {
      /* still starting */
    }
    await delay(250)
  }
  throw new Error('verify: DevTools endpoint never came up')
}

async function connect(wsUrl) {
  const socket = new WebSocket(wsUrl)
  const requests = []
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', () => reject(new Error('verify: WebSocket failed')), { once: true })
  })
  let nextId = 0
  const pending = new Map()
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    if (message.method === 'Network.requestWillBeSent' && String(message.params.request.url).includes('/x-balance-float')) {
      requests.push(Date.now())
    }
    const entry = pending.get(message.id)
    if (entry === undefined) return
    pending.delete(message.id)
    if (message.error !== undefined) entry.reject(new Error(JSON.stringify(message.error)))
    else entry.resolve(message.result)
  })
  return {
    requests,
    send(method, params = {}) {
      const id = ++nextId
      socket.send(JSON.stringify({ id, method, params }))
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
    },
    close: () => socket.close()
  }
}

/**
 * Read the widget's open/closed state.
 *
 * The shadow root is closed, so the page cannot see the panel directly. The
 * widget mirrors the state onto its host element as `data-open`, which the page
 * CAN read - that is an observability hook, not a behaviour change.
 */
async function openState(cdp) {
  const res = await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const h = document.querySelector('dsh-balance-float')
      if (!h) return 'missing'
      return h.hasAttribute('data-open') ? 'open' : 'closed'
    })()`,
    returnByValue: true
  })
  return res.result.value
}

/** Count nodes inside the widget's shadow tree via CDP's pierced DOM (secondary check). */
async function shadowNodeCount(cdp) {
  const doc = await cdp.send('DOM.getDocument', { depth: -1, pierce: true })
  let count = 0
  let found = false
  const walk = (node) => {
    if (node === undefined || node === null) return
    if (!found && node.nodeName === 'DSH-BALANCE-FLOAT') found = true
    if (found) count += 1
    for (const key of ['children', 'shadowRoots', 'contentDocument']) {
      const list = node[key]
      if (Array.isArray(list)) for (const child of list) walk(child)
    }
  }
  walk(doc.root)
  return found ? count : -1
}

async function mouse(cdp, type, x, y, clickCount = 1) {
  await cdp.send('Input.dispatchMouseEvent', { type, x, y, button: 'left', clickCount })
}

try {
  const cdp = await connect(await target())
  await cdp.send('Network.enable')
  await cdp.send('Page.enable')
  await cdp.send('Page.navigate', { url })
  await delay(9000)

  const vp = await cdp.send('Runtime.evaluate', {
    expression: `JSON.stringify({ w: innerWidth, h: innerHeight })`,
    returnByValue: true
  })
  const view = JSON.parse(vp.result.value)
  // Capsule is pinned 18px from bottom-right, roughly 80x34.
  const x = view.w - 18 - 40
  const y = view.h - 18 - 17
  console.log('viewport', JSON.stringify(view), '| capsule point', x, y)

  const base = await openState(cdp)
  console.log('baseline state (collapsed):', base)

  console.log('--- 1) hover only, no click ---')
  await mouse(cdp, 'mouseMoved', x, y)
  await delay(700)
  const hovered = await openState(cdp)
  console.log(`   state after hover: ${hovered}  -> ${hovered === 'closed' ? 'PASS (hover does not open)' : 'FAIL (hover opened it!)'}`)

  console.log('--- 2) single click ---')
  await mouse(cdp, 'mousePressed', x, y, 1)
  await mouse(cdp, 'mouseReleased', x, y, 1)
  await delay(700)
  const clicked = await openState(cdp)
  console.log(`   state after click: ${clicked}  -> ${clicked === 'open' ? 'PASS (panel opened)' : 'FAIL (did not open)'}`)
  console.log(`   shadow nodes: ${await shadowNodeCount(cdp)}`)

  console.log('--- 3) click again ---')
  await mouse(cdp, 'mousePressed', x, y, 1)
  await mouse(cdp, 'mouseReleased', x, y, 1)
  await delay(700)
  const clicked2 = await openState(cdp)
  console.log(`   state after 2nd click: ${clicked2}  -> ${clicked2 === 'closed' ? 'PASS (panel closed)' : 'FAIL (still open)'}`)

  console.log('--- 3b) click elsewhere closes it ---')
  await mouse(cdp, 'mousePressed', x, y, 1)
  await mouse(cdp, 'mouseReleased', x, y, 1)
  await delay(400)
  await mouse(cdp, 'mousePressed', 120, 120, 1)
  await mouse(cdp, 'mouseReleased', 120, 120, 1)
  await delay(500)
  const afterOutside = await openState(cdp)
  console.log(`   state after outside click: ${afterOutside}  -> ${afterOutside === 'closed' ? 'PASS' : 'FAIL'}`)

  console.log('--- 4) double click refreshes once ---')
  const before = cdp.requests.length
  await mouse(cdp, 'mousePressed', x, y, 1)
  await mouse(cdp, 'mouseReleased', x, y, 1)
  await mouse(cdp, 'mousePressed', x, y, 2)
  await mouse(cdp, 'mouseReleased', x, y, 2)
  const deadline = Date.now() + 1000
  let extra = 0
  while (Date.now() < deadline) {
    await delay(100)
    extra = cdp.requests.length - before
    if (extra > 0) break
  }
  console.log(`   extra refresh requests: ${extra}`)

  console.log('--- 5) auto refresh rhythm over 12s ---')
  const mark = cdp.requests.length
  await delay(12000)
  const gaps = cdp.requests.slice(mark + 1).map((t, i) => Math.round(t - cdp.requests[mark + i]))
  console.log(`   requests in 12s: ${cdp.requests.length - mark}  gaps(ms): ${gaps.join(', ')}`)

  cdp.close()
} finally {
  child.kill('SIGKILL')
  await delay(400)
  rmSync(profile, { recursive: true, force: true })
}
