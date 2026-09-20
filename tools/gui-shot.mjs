/**
 * Boots a headless Edge against the real DSH Web GUI and grabs a screenshot
 * over Chrome DevTools Protocol. Used once to confirm the injected floating
 * widget renders above the shipped shell. Never part of the shipped plugin.
 *
 * Run: node tools/gui-shot.mjs <url> <out.png> [width] [height]
 */

import { spawn } from 'node:child_process'
import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'

const [url, out, width = '1280', height = '720'] = process.argv.slice(2)
if (url === undefined || out === undefined) throw new Error('usage: gui-shot.mjs <url> <out.png> [w] [h]')

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9333
const profile = join(tmpdir(), `edge-dsh-shot-${Date.now()}`)
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
    `--window-size=${width},${height}`,
    'about:blank'
  ],
  { stdio: 'ignore', detached: false }
)

/** Poll the DevTools endpoint until the browser is up. */
async function target() {
  for (let attempt = 0; attempt < 60; attempt++) {
    try {
      const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json()
      const page = list.find((entry) => entry.type === 'page')
      if (page?.webSocketDebuggerUrl !== undefined) return page.webSocketDebuggerUrl
    } catch {
      /* the browser is still starting */
    }
    await delay(250)
  }
  throw new Error('gui-shot: DevTools endpoint never came up')
}

/** Minimal CDP client over the built-in WebSocket. */
async function connect(wsUrl) {
  const socket = new WebSocket(wsUrl)
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', () => reject(new Error('gui-shot: WebSocket failed')), { once: true })
  })
  let nextId = 0
  const pending = new Map()
  socket.addEventListener('message', (event) => {
    const message = JSON.parse(event.data)
    const entry = pending.get(message.id)
    if (entry === undefined) return
    pending.delete(message.id)
    if (message.error !== undefined) entry.reject(new Error(JSON.stringify(message.error)))
    else entry.resolve(message.result)
  })
  return {
    send(method, params = {}) {
      const id = ++nextId
      socket.send(JSON.stringify({ id, method, params }))
      return new Promise((resolve, reject) => pending.set(id, { resolve, reject }))
    },
    close: () => socket.close()
  }
}

try {
  const cdp = await connect(await target())
  await cdp.send('Page.enable')
  await cdp.send('Page.navigate', { url })
  await delay(9000)
  const shot = await cdp.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(out, Buffer.from(shot.data, 'base64'))
  const probe = await cdp.send('Runtime.evaluate', {
    expression: `JSON.stringify({ widget: !!document.querySelector('dsh-balance-float'), title: document.title, body: document.body.children.length })`,
    returnByValue: true
  })
  console.log('probe ->', probe.result.value)
  console.log('screenshot ->', out)
  cdp.close()
} finally {
  child.kill('SIGKILL')
  await delay(500)
  rmSync(profile, { recursive: true, force: true })
}
