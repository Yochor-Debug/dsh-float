/**
 * Open the live GUI in headless Edge, find the plugin-market settings section,
 * and screenshot it - to confirm whether a locally installed bundle appears in
 * the market's "installed" list with a toggle.
 *
 * Run: node tools/market-shot.mjs <gui-url-with-token> [out.png]
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

const url = process.argv[2]
const out = process.argv[3] ?? 'D:\\DeepSeek_Workspace\\dsh-plugin-balance-float\\market-installed.png'
if (url === undefined) throw new Error('usage: market-shot.mjs <gui-url> [out.png]')

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9339
const profile = join(tmpdir(), `edge-market-${Date.now()}`)
mkdirSync(profile, { recursive: true })

const child = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--window-size=1500,1000', 'about:blank'
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
  throw new Error('market-shot: DevTools never came up')
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

try {
  const cdp = await connect(await target())
  await cdp.send('Page.enable')
  await cdp.send('Runtime.enable')
  await cdp.send('Page.navigate', { url })
  await delay(12000)

  // What settings sections does the UI expose?
  const probe = await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const texts = [...document.querySelectorAll('button,a,[role="tab"],[role="menuitem"]')]
        .map((el) => (el.textContent || '').trim())
        .filter((t) => t.length > 0 && t.length < 30)
      const market = texts.filter((t) => /市场|market|插件|plugin/i.test(t))
      return JSON.stringify({ marketish: [...new Set(market)].slice(0, 25), total: texts.length })
    })()`,
    returnByValue: true
  })
  console.log('clickable labels mentioning market/plugin:', probe.result.value)

  const shot1 = await cdp.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(out.replace(/\.png$/, '-page.png'), Buffer.from(shot1.data, 'base64'))
  console.log('page screenshot ->', out.replace(/\.png$/, '-page.png'))

  // Click the first market/plugin entry we found, then screenshot again.
  const clicked = await cdp.send('Runtime.evaluate', {
    expression: `(() => {
      const els = [...document.querySelectorAll('button,a,[role="tab"],[role="menuitem"]')]
      const hit = els.find((el) => /市场|market/i.test((el.textContent || '').trim()))
      if (!hit) return 'not-found'
      hit.click()
      return 'clicked:' + (hit.textContent || '').trim()
    })()`,
    returnByValue: true
  })
  console.log('click result:', clicked.result.value)
  await delay(9000)

  const shot2 = await cdp.send('Page.captureScreenshot', { format: 'png' })
  writeFileSync(out, Buffer.from(shot2.data, 'base64'))
  console.log('screenshot ->', out)

  const after = await cdp.send('Runtime.evaluate', {
    expression: `JSON.stringify({ mentionsBalance: document.body.innerText.includes('balance-float'), hasToggle: !!document.querySelector('input[type=checkbox],[role=switch]') })`,
    returnByValue: true
  })
  console.log('after click:', after.result.value)
  cdp.close()
} finally {
  child.kill('SIGKILL')
  await delay(400)
  rmSync(profile, { recursive: true, force: true })
}
