/**
 * dsh-plugin-balance-float — host half.
 *
 * Two responsibilities, both host-side because the DeepSeek API key must never
 * reach the browser and `api.deepseek.com` sends no CORS headers:
 *
 * 1. `GET /x-balance-float` — same-origin JSON proxy reading the DeepSeek
 *    balance with the local credential, with a short success/failure cache.
 * 2. One `webserver/index-inject` script row that lands the floating widget in
 *    every rendered index.html, so the widget exists exactly as long as the GUI
 *    page does.
 *
 * @module dsh-plugin-balance-float
 */

import { readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join } from 'node:path'

/** Stable Cordis plugin name. */
export const name = 'balance-float'

/** The webserver must exist before the route and the index row can be registered. */
export const inject = ['webServer']

/** Exact route pathname owned by this plugin. */
const ROUTE_PATH = '/x-balance-float'

/** Upstream DeepSeek balance endpoint. */
const BALANCE_URL = 'https://api.deepseek.com/user/balance'

/** Bounds one upstream call. */
const UPSTREAM_TIMEOUT_MS = 15000

/** How long a successful reading stays fresh. */
const OK_TTL_MS = 20000

/** How long a failure stays cached, so a broken key is not hammered. */
const ERROR_TTL_MS = 10000

const CLIENT_SCRIPT_URL = new URL('./client.js', import.meta.url)

/** The absolute path of the Harness home (`~/.dsh`). */
function dshHome() {
  return process.env.DSH_HOME ?? join(homedir(), '.dsh')
}

/**
 * Read `DEEPSEEK_API_KEY` out of the credentials file. Both YAML spellings the
 * harness writes must work: `refs: { DEEPSEEK_API_KEY: sk-x }` (the form a
 * fresh boot rewrites) and a block mapping `refs:\n  DEEPSEEK_API_KEY: sk-x`.
 * This is only the fallback for when the credentials service is unavailable.
 * @returns the key, or undefined.
 */
function readApiKeyFile() {
  let text
  try {
    text = readFileSync(join(dshHome(), '.credentials.yaml'), 'utf8')
  } catch {
    return undefined
  }
  const match = /DEEPSEEK_API_KEY\s*:\s*("([^"]*)"|'([^']*)'|([^\s,}]+))/.exec(text)
  if (match === null) return undefined
  const value = (match[2] ?? match[3] ?? match[4] ?? '').trim()
  return value === '' ? undefined : value
}

/**
 * Resolve the DeepSeek API key through the harness' own credential seam (which
 * layers the process environment, `.env` files, and the credential store), then
 * fall back to the environment and finally to the credentials file. The key is
 * resolved per request and never cached in this process beyond that.
 * @param ctx - plugin context, optionally carrying `credentials`.
 * @returns the key, or undefined when the machine has none configured.
 */
export async function readApiKey(ctx) {
  const fromEnv = process.env.DEEPSEEK_API_KEY
  if (fromEnv !== undefined && fromEnv.trim() !== '') return fromEnv.trim()
  try {
    /* Reading an unavailable service off a Cordis context throws, so the
     * property access belongs inside the guard along with the resolve. */
    const credentials = ctx.credentials
    if (credentials !== undefined) {
      const resolved = await credentials.resolve('DEEPSEEK_API_KEY')
      if (resolved?.value !== undefined && resolved.value.trim() !== '') return resolved.value.trim()
    }
  } catch (error) {
    ctx.logger.warn(`balance-float: credential seam could not resolve DEEPSEEK_API_KEY, falling back to the credentials file: ${error instanceof Error ? error.message : String(error)}`)
  }
  return readApiKeyFile()
}

/** Flatten a failed fetch's cause chain into one readable sentence. */
function describeError(error) {
  const parts = []
  let current = error
  let depth = 0
  while (current !== undefined && current !== null && depth < 4) {
    if (current instanceof AggregateError) {
      current = current.errors?.[0]
      depth++
      continue
    }
    const code = current instanceof Error && typeof current.code === 'string' ? `${current.code}: ` : ''
    const message = typeof current.message === 'string' ? current.message : String(current)
    const text = `${code}${message}`.trim()
    if (text !== '' && !parts.includes(text)) parts.push(text)
    current = current.cause
    depth++
  }
  return parts.length === 0 ? String(error) : parts.join(' ← ')
}

/**
 * One fresh reading from DeepSeek, normalized for the widget.
 * @param ctx - plugin context used to resolve the credential.
 */
async function readBalance(ctx) {
  const key = await readApiKey(ctx)
  if (key === undefined) {
    return {
      ok: false,
      payload: {
        ok: false,
        error: 'no-api-key',
        detail: '未找到 DEEPSEEK_API_KEY（环境变量 / DSH 凭证存储 / ~/.dsh/.credentials.yaml）',
        at: Date.now()
      }
    }
  }
  let response
  try {
    response = await fetch(BALANCE_URL, {
      headers: { authorization: `Bearer ${key}`, accept: 'application/json' },
      signal: AbortSignal.timeout(UPSTREAM_TIMEOUT_MS)
    })
  } catch (error) {
    return {
      ok: false,
      payload: {
        ok: false,
        error: 'unreachable',
        detail: `无法连接 api.deepseek.com：${describeError(error)}`,
        at: Date.now()
      }
    }
  }
  if (!response.ok) {
    let detail = `HTTP ${response.status}`
    try {
      const text = await response.text()
      if (text !== '') detail = text.slice(0, 400)
    } catch {
      /* the status line is detail enough */
    }
    return {
      ok: false,
      payload: { ok: false, error: response.status === 401 || response.status === 403 ? 'bad-key' : 'upstream', detail, at: Date.now() }
    }
  }
  let body
  try {
    body = await response.json()
  } catch (error) {
    return {
      ok: false,
      payload: {
        ok: false,
        error: 'bad-response',
        detail: `上游返回了非 JSON 响应：${error instanceof Error ? error.message : String(error)}`,
        at: Date.now()
      }
    }
  }
  return {
    ok: true,
    payload: {
      ok: true,
      available: body?.is_available === true,
      infos: Array.isArray(body?.balance_infos) ? body.balance_infos : [],
      at: Date.now()
    }
  }
}

/**
 * Mount the balance route and the floating-widget index injection.
 * @param ctx - plugin context carrying the `webServer` service.
 */
export function apply(ctx) {
  /** Read the widget script fresh, so editing it only needs a page reload. */
  function clientScript() {
    try {
      return readFileSync(CLIENT_SCRIPT_URL, 'utf8')
    } catch (error) {
      ctx.logger.warn(`balance-float: client widget script is unreadable, no floating window will be injected: ${error instanceof Error ? error.message : String(error)}`)
      return undefined
    }
  }

  /** Last reading this mount owns, kept only for the TTL window. */
  let cached

  ctx.effect(
    () => {
      const handler = async (req, res) => {
        const method = req.method ?? 'GET'
        if (method !== 'GET' && method !== 'HEAD') {
          res.writeHead(405, { allow: 'GET, HEAD' })
          res.end()
          return
        }
        const now = Date.now()
        const ttl = cached?.ok === true ? OK_TTL_MS : ERROR_TTL_MS
        if (cached === undefined || now - cached.at > ttl) {
          const reading = await readBalance(ctx)
          cached = { ok: reading.ok, at: Date.now(), payload: reading.payload }
        }
        const body = JSON.stringify(cached.payload)
        res.writeHead(200, {
          'content-type': 'application/json; charset=utf-8',
          'cache-control': 'no-store',
          'content-length': Buffer.byteLength(body)
        })
        if (method === 'HEAD') {
          res.end()
          return
        }
        res.end(body)
      }
      try {
        return ctx.webServer.register({ kind: 'exact', path: ROUTE_PATH, handler })
      } catch (error) {
        /* A stale mount from an earlier plugin load can still own the route on a
         * live-reloaded host; the widget must not lose its index injection over
         * that, so keep the existing route and carry on. */
        ctx.logger.warn(`balance-float: ${ROUTE_PATH} is already registered by an earlier mount, reusing it: ${error instanceof Error ? error.message : String(error)}`)
        return undefined
      }
    },
    'balance-float: balance route'
  )

  ctx.effect(
    () =>
      ctx.on('webserver/index-inject', (rows) => {
        const script = clientScript()
        if (script === undefined) return
        rows.push({ kind: 'script', placement: 'body', text: script })
        rows.push({
          kind: 'style',
          text: '.dsh-balance-float-host{all:initial;position:fixed;inset:auto 0 0 auto;z-index:2147483000;pointer-events:none}'
        })
      }),
    'balance-float: index injection'
  )
}
