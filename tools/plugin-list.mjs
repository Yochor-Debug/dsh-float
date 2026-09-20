/**
 * Expand Settings -> 插件 -> 插件列表 -> 全局插件 and look for our bundle there.
 *
 * Run: node tools/plugin-list.mjs <gui-url-with-token>
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

const url = process.argv[2]
if (url === undefined) throw new Error('usage: plugin-list.mjs <gui-url>')

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9345
const profile = join(tmpdir(), `edge-global-${Date.now()}`)
mkdirSync(profile, { recursive: true })
const outDir = 'D:\\DeepSeek_Workspace\\dsh-plugin-balance-float'

const child = spawn(EDGE, [
  '--headless=new', '--disable-gpu', '--no-first-run', '--no-default-browser-check',
  `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--window-size=1600,1100', 'about:blank'
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
  throw new Error('DevTools never came up')
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

const evaluate = async (cdp, expression) =>
  (await cdp.send('Runtime.evaluate', { expression, returnByValue: true })).result.value

const clickLabel = async (cdp, label) => evaluate(cdp, `(() => {
  const scope = document.querySelector('[role="dialog"]') || document.body
  const hit = [...scope.querySelectorAll('button,a,[role="tab"],[role="menuitem"],li,div')]
    .filter((el) => (el.textContent || '').trim() === ${JSON.stringify(label)}).pop()
  if (!hit) return 'not-found'
  hit.click(); return 'clicked'
})()`)

try {
  const cdp = await connect(await target())
  await cdp.send('Page.enable')
  await cdp.send('Page.navigate', { url })
  await delay(12000)
  await evaluate(cdp, `(() => {
    const hit = [...document.querySelectorAll('button,a,[role="button"]')]
      .find((el) => /^设置$|^Settings$/.test((el.textContent || '').trim()))
    if (hit) hit.click()
  })()`)
  await delay(6000)
  await clickLabel(cdp, '插件')
  await delay(2500)
  await clickLabel(cdp, '插件列表')
  await delay(7000)

  // Use the search box: type our package name. This is the most reliable way to
  // find a row among 182 global entries.
  const searched = await evaluate(cdp, `(() => {
    const scope = document.querySelector('[role="dialog"]') || document.body
    const input = [...scope.querySelectorAll('input')].find((el) => /搜索|search/i.test(el.placeholder || ''))
    if (!input) return 'no-search-box'
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set
    setter.call(input, 'balance')
    input.dispatchEvent(new Event('input', { bubbles: true }))
    return 'typed'
  })()`)
  console.log('search box:', searched)
  await delay(6000)

  const afterSearch = await evaluate(cdp, `(() => {
    const scope = document.querySelector('[role="dialog"]') || document.body
    const text = scope.innerText || ''
    const idx = text.indexOf('balance')
    const switches = [...scope.querySelectorAll('[role="switch"],button[aria-checked],input[type=checkbox]')]
    return JSON.stringify({
      mentionsBalance: idx >= 0,
      context: idx >= 0 ? text.slice(Math.max(0, idx - 260), idx + 300) : null,
      switches: switches.length,
      lines: text.split('\\n').map((l) => l.trim()).filter(Boolean).slice(0, 30)
    })
  })()`)
  console.log('after search:', afterSearch)

  writeFileSync(join(outDir, 'plugin-search.png'),
    Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
  console.log('screenshot -> plugin-search.png')
  cdp.close()
} finally {
  child.kill('SIGKILL')
  await delay(400)
  rmSync(profile, { recursive: true, force: true })
}
