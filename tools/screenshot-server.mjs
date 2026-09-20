/**
 * Screenshot rig for the balance-float widget: serves the widget document and
 * the real balance route on one origin, so a headless browser can render the
 * expanded and collapsed states for visual inspection. Never part of the
 * shipped plugin.
 *
 * Run: node tools/screenshot-server.mjs <port>
 */

import { readFileSync, writeFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { apply } from '../lib/index.js'

const port = Number(process.argv[2] ?? 3931)

const routes = new Map()
const taps = []
const ctx = {
  logger: { warn: (...args) => console.log('[warn]', ...args) },
  effect: (factory) => {
    factory()
  },
  on: (event, listener) => taps.push({ event, listener }),
  webServer: {
    register: (route) => {
      routes.set(route.path, route)
      return () => routes.delete(route.path)
    }
  }
}

apply(ctx)
const balanceRoute = routes.get('/x-balance-float')
const row = taps.find((tap) => tap.event === 'webserver/index-inject')
const injections = []
row.listener(injections)
const script = injections.find((entry) => entry.kind === 'script').text

/** Build the stand-in shell document, with an optional forced widget state. */
function document_(mode) {
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8"><title>DSH balance float</title>
<style>body{margin:0;font:14px -apple-system,"Segoe UI","Microsoft YaHei",system-ui;background:#f6f7f9;color:#222}
.shell{padding:26px}.card{max-width:560px;background:#fff;border:1px solid #e6e8eb;border-radius:12px;padding:20px;box-shadow:0 1px 3px rgba(15,23,42,.06)}
h1{font-size:16px;margin:0 0 12px}p{color:#5b6472;line-height:1.7;margin:6px 0}</style></head>
<body><div class="shell"><div class="card"><h1>DSH 会话占位页面</h1>
<p>这个页面模拟 DSH Web GUI，用来检查右下角余额浮窗的渲染与交互。</p>
<p>模式：${mode}。</p></div></div>
<script>${script}</script></body></html>`
}

writeFileSync(new URL('../widget.html', import.meta.url), document_('collapsed/expanded'))

const server = createServer((req, res) => {
  const url = new URL(req.url ?? '/', 'http://x')
  if (url.pathname === '/x-balance-float') {
    console.log(`[${new Date().toISOString().slice(11, 23)}] balance request`)
    /* `?mode=http-error` renders the widget's failure branch. */
    if (url.searchParams.get('mode') === 'http-error') {
      res.writeHead(502, { 'content-type': 'application/json' })
      res.end('{"ok":false,"detail":"rig: simulated upstream failure"}')
      return
    }
    balanceRoute.handler(req, res).catch((error) => {
      res.writeHead(500)
      res.end(String(error))
    })
    return
  }
  const mode = url.searchParams.get('balance-float')
  const body = document_(mode === 'open' ? 'expanded' : mode === 'http-error' ? 'failure branch' : 'collapsed')
    .replace('<script>', `<script>window.__RIG_MODE__=${JSON.stringify(url.searchParams.get('mode'))};</script><script>`)
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' })
  res.end(body)
})

server.listen(port, '127.0.0.1', () => {
  console.log(`screenshot rig on http://127.0.0.1:${port}/`)
})
