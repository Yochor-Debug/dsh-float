/**
 * Screenshot the rig after a real click on the capsule, to confirm the panel
 * renders correctly in the click-only design.
 *
 * Run: node tools/shot-open.mjs [rig-url] [out.png]
 */

import { spawn } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const url = process.argv[2] ?? 'http://127.0.0.1:3931/'
const out = process.argv[3] ?? 'D:\\DeepSeek_Workspace\\dsh-plugin-balance-float\\widget-click-open.png'
const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9338
const profile = join(tmpdir(), `edge-shot-open-${Date.now()}`)
mkdirSync(profile, { recursive: true })

const child = spawn(
  EDGE,
  ['--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
   `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--window-size=1000,700', 'about:blank'],
  { stdio: 'ignore' }
)

async function target() {
  for (let i = 0; i < 60; i++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const page = list.find((e) => e.type === 'page')
      if (page?.webSocketDebuggerUrl !== undefined) return page.webSocketDebuggerUrl
    } catch { /* starting */ }
    await delay(250)
  }
  throw new Error('shot: DevTools endpoint never came up')
}

async function connect(wsUrl) {
  const socket = new WebSocket(wsUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', () => reject(new Error('shot: ws failed')), { once: true })
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

try {
  const cdp = await connect(await target())
  await cdp.send('Page.enable')
  await cdp.send('Page.navigate', { url })
  await delay(9000)

  const vp = JSON.parse((await cdp.send('Runtime.evaluate', {
    expression: 'JSON.stringify({ w: innerWidth, h: innerHeight })', returnByValue: true
  })).result.value)
  const x = vp.w - 18 - 40
  const y = vp.h - 18 - 17
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x, y })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mousePressed', x, y, button: 'left', clickCount: 1 })
  await cdp.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x, y, button: 'left', clickCount: 1 })
  await delay(1200)

  const state = (await cdp.send('Runtime.evaluate', {
    expression: `document.querySelector('dsh-balance-float').hasAttribute('data-open') ? 'open' : 'closed'`,
    returnByValue: true
  })).result.value
  console.log('state after click:', state)

  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(out, Buffer.from(shot.data, 'base64'))
  console.log('screenshot ->', out)
  cdp.close()
} finally {
  child.kill('SIGKILL')
  await delay(400)
  rmSync(profile, { recursive: true, force: true })
}
