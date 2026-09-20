/**
 * Offline harness for the balance-float host half: mounts the real plugin on a
 * stub Cordis context, calls the registered route against the real DeepSeek
 * balance endpoint, and writes the emitted index row to widget.html for a
 * browser check. Never part of the shipped plugin.
 *
 * Run: node tools/harness.mjs
 */

import { writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { apply, inject, name } from '../lib/index.js'

const routes = new Map()
const taps = []

const ctx = {
  logger: { warn: (...args) => console.log('[warn]', ...args) },
  effect: (factory) => {
    factory()
  },
  on: (event, listener) => {
    taps.push({ event, listener })
  },
  webServer: {
    register: (route) => {
      routes.set(route.path, route)
      return () => routes.delete(route.path)
    }
  }
}

apply(ctx)

const route = routes.get('/x-balance-float')
if (route === undefined) throw new Error('harness: the plugin registered no route')
const row = taps.find((tap) => tap.event === 'webserver/index-inject')
if (row === undefined) throw new Error('harness: the plugin registered no index injection')

const injections = []
row.listener(injections)
const scriptRow = injections.find((entry) => entry.kind === 'script')
const nonce = 'n0nce'
const html = `<!doctype html><html><head><meta charset="utf-8"><title>balance float</title></head><body>
<div id="app" style="font:14px system-ui;padding:24px">DSH shell placeholder — the widget must render above this.</div>
<script nonce="${nonce}">${scriptRow.text}</script>
</body></html>`
writeFileSync(new URL('../widget.html', import.meta.url), html)

const server = createServer((req, res) => {
  route.handler(req, res).catch((error) => {
    res.writeHead(500)
    res.end(String(error))
  })
})

await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
const base = `http://127.0.0.1:${server.address().port}/x-balance-float`

console.log('plugin name:', name, '| inject:', JSON.stringify(inject), '| rows:', injections.length)

const first = await fetch(base)
const body = await first.json()
console.log('GET  ->', first.status, first.headers.get('content-type'))
console.log('body ->', JSON.stringify(body))

const second = await fetch(base)
const cached = await second.json()
console.log('cache hit identical:', JSON.stringify(cached) === JSON.stringify(body))

const head = await fetch(base, { method: 'HEAD' })
console.log('HEAD ->', head.status, 'bytes:', (await head.text()).length)

const post = await fetch(base, { method: 'POST' })
console.log('POST ->', post.status, 'allow:', post.headers.get('allow'))

server.close()
console.log('wrote widget.html —', html.length, 'bytes')
