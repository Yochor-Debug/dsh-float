/**
 * Scope the market/plugins check to the SETTINGS PANEL, not the whole page.
 *
 * Earlier attempt searched document.body.innerText and got a false positive: the
 * user's chat transcript mentions "dsh-plugin-balance-float", so the page text
 * matched even though the list did not show it. This version finds the settings
 * dialog, clicks the exact nav item, and reports the DIALOG's own text plus its
 * toggle controls.
 *
 * Run: node tools/market-check.mjs <gui-url-with-token> [navLabel]
 */

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'

const url = process.argv[2]
const navLabel = process.argv[3] ?? '插件'
if (url === undefined) throw new Error('usage: market-check.mjs <gui-url> [navLabel]')

const EDGE = 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe'
const PORT = 9342
const profile = join(tmpdir(), `edge-market4-${Date.now()}`)
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

  // Click the exact nav label inside the settings panel.
  const clicked = await evaluate(cdp, `(() => {
    const hit = [...document.querySelectorAll('button,a,[role="tab"],[role="menuitem"],[role="treeitem"],li,div')]
      .filter((el) => (el.textContent || '').trim() === ${JSON.stringify(navLabel)})
      .pop()
    if (!hit) return 'not-found'
    hit.click(); return 'clicked'
  })()`)
  console.log(`click nav "${navLabel}":`, clicked)
  await delay(9000)

  // Scope everything to the settings dialog / panel, not the whole page.
  const report = await evaluate(cdp, `(() => {
    const scope = document.querySelector('[role="dialog"]') ||
                  document.querySelector('[class*="settings"]') ||
                  document.body
    const text = scope.innerText || ''
    const idx = text.indexOf('dsh-plugin-balance-float')
    const rows = [...scope.querySelectorAll('[role="switch"],input[type=checkbox]')].length
    const switchish = [...scope.querySelectorAll('button')]
      .filter((b) => /停用|启用|Disable|Enable/.test(b.textContent || '')).length
    return JSON.stringify({
      scopeTag: scope.tagName + '/' + (scope.getAttribute('role') || scope.className || '').slice(0, 30),
      listMentionsOurPlugin: idx >= 0,
      context: idx >= 0 ? text.slice(Math.max(0, idx - 150), idx + 200) : null,
      switchControls: rows,
      enableDisableButtons: switchish,
      lineCount: text.split('\\n').length
    })
  })()`)
  console.log('scoped report:', report)

  const safe = navLabel === '插件' ? 'plugins' : 'market'
  writeFileSync(join(outDir, `settings-${safe}.png`),
    Buffer.from((await cdp.send('Page.captureScreenshot', { format: 'png' })).data, 'base64'))
  console.log(`screenshot -> settings-${safe}.png`)
  cdp.close()
} finally {
  child.kill('SIGKILL')
  await delay(400)
  rmSync(profile, { recursive: true, force: true })
}
