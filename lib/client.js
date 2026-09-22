/**
 * DeepSeek API balance floating widget — the browser half of
 * dsh-plugin-balance-float, injected inline into every rendered index.html.
 *
 * A Sogou-input-method-style capsule pinned to the page corner: collapsed it
 * shows the total balance, expanded it shows the balance breakdown, the last
 * refresh time, and a manual refresh. It lives in a closed shadow root outside
 * the SPA's React tree, so no app re-render can remove it; it disappears when
 * the page does.
 */
;(() => {
  'use strict'

  var ENDPOINT = '/x-balance-float'
  var POSITION_KEY = 'dsh-balance-float:position'
  var REFRESH_MS = 5000
  var FLASH_MS = 500

  if (document.querySelector('dsh-balance-float')) return

  var host = document.createElement('dsh-balance-float')
  host.className = 'dsh-balance-float-host'
  var shadow = host.attachShadow({ mode: 'closed' })

  var style = document.createElement('style')
  style.textContent = [
    ':host{all:initial}',
    '*,*::before,*::after{box-sizing:border-box}',
    '.root{position:fixed;right:18px;bottom:18px;z-index:1;pointer-events:none;',
    'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","Microsoft YaHei",system-ui,sans-serif;',
    'font-size:12px;line-height:1.45;color:var(--fg);--fg:#1f2329;--muted:#8a9099;--bg:rgba(255,255,255,.94);--line:rgba(15,23,42,.12);--shadow:0 6px 22px rgba(15,23,42,.18)}',
    '@media (prefers-color-scheme:dark){.root{--fg:#e8eaed;--muted:#9aa0a6;--bg:rgba(32,35,40,.94);--line:rgba(255,255,255,.14);--shadow:0 6px 22px rgba(0,0,0,.5)}}',
    '.pill{pointer-events:auto;display:flex;align-items:center;gap:7px;padding:6px 13px 6px 10px;border-radius:999px;',
    'background:var(--bg);border:1px solid var(--line);box-shadow:var(--shadow);cursor:grab;user-select:none;',
    '-webkit-user-select:none;touch-action:none;transition:transform .12s ease,box-shadow .12s ease}',
    '.pill:hover{transform:translateY(-1px)}',
    '.pill.dragging{cursor:grabbing}',
    '.dot{width:8px;height:8px;border-radius:50%;background:#9aa0a6;flex:0 0 auto}',
    '.dot.ok{background:#22c55e}.dot.low{background:#f59e0b}.dot.empty{background:#ef4444}.dot.err{background:#9aa0a6}',
    '.amt{font-weight:600;font-variant-numeric:tabular-nums;letter-spacing:.2px;white-space:nowrap}',
    '.amt.err{color:var(--muted)}',
    '.rate{flex:0 0 auto;font-size:10px;font-weight:600;line-height:1;padding:2px 4px;border-radius:5px;',
    'border:1px solid transparent;letter-spacing:.5px;cursor:default}',
    '.rate.off{color:#15803d;background:rgba(34,197,94,.15);border-color:rgba(34,197,94,.32)}',
    '.rate.peak{color:#b45309;background:rgba(245,158,11,.16);border-color:rgba(245,158,11,.34)}',
    '@media (prefers-color-scheme:dark){.rate.off{color:#4ade80;background:rgba(34,197,94,.18);border-color:rgba(34,197,94,.34)}',
    '.rate.peak{color:#fbbf24;background:rgba(245,158,11,.2);border-color:rgba(245,158,11,.36)}}',
    '.panel{pointer-events:none;position:absolute;right:0;bottom:calc(100% + 8px);width:236px;opacity:0;transform:translateY(6px);',
    'transition:opacity .14s ease,transform .14s ease;background:var(--bg);border:1px solid var(--line);border-radius:12px;',
    'box-shadow:var(--shadow);padding:11px 12px;color:var(--fg)}',
    '.w.open .panel{opacity:1;transform:none;pointer-events:auto}',
    '.head{display:flex;align-items:center;justify-content:space-between;gap:8px}',
    '.title{font-weight:600;font-size:12px}',
    '.refresh{pointer-events:auto;cursor:pointer;border:0;background:transparent;color:var(--muted);font-size:14px;',
    'line-height:1;padding:2px 5px;border-radius:6px;opacity:.55;transition:opacity .12s ease,color .12s ease,background .12s ease}',
    '.panel:hover .refresh{opacity:1}',
    '.refresh:hover{color:var(--fg);background:rgba(127,127,127,.14)}',
    '.muted{color:var(--muted)}',
    '.expand{position:absolute;left:50%;bottom:calc(100% + 3px);transform:translateX(-50%) rotate(180deg);font-size:8px;',
    'line-height:1;color:var(--muted);opacity:.4;transition:opacity .12s ease}',
    '.w:hover .expand{opacity:0}',
    '.refresh.flash svg{animation:dsh-balance-spin .5s ease}',
    '@keyframes dsh-balance-spin{from{transform:rotate(0)}to{transform:rotate(360deg)}}',
    '.total{font-size:21px;font-weight:650;font-variant-numeric:tabular-nums;margin:6px 0 2px;letter-spacing:.3px}',
    '.total.err{font-size:13px;font-weight:500;color:var(--fg);word-break:break-word}',
    '.row{display:flex;justify-content:space-between;gap:10px;padding:2px 0;font-variant-numeric:tabular-nums}',
    '.row + .row{border-top:1px solid var(--line)}',
    '.hint{margin-top:7px;padding-top:6px;border-top:1px solid var(--line);font-size:11px;color:var(--muted);line-height:1.5;white-space:pre-line}',
    '.w{position:relative;pointer-events:none;display:flex;flex-direction:column;align-items:flex-end}'
  ].join('')
  shadow.appendChild(style)

  var root = document.createElement('div')
  root.className = 'root'
  root.innerHTML = [
    '<div class="w">',
    '<div class="panel">',
    '<div class="head"><span class="title">DeepSeek 余额</span>',
    '<button class="refresh" type="button" title="立即刷新（或双击浮窗）" aria-label="立即刷新">',
    '<svg viewBox="0 0 16 16" width="13" height="13" aria-hidden="true">',
    '<path d="M13 8a5 5 0 1 1-1.6-3.7" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/>',
    '<path d="M13.4 1.8v3.1h-3.1" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>',
    '</svg></button></div>',
    '<div class="total muted">读取中…</div>',
    '<div class="rows"></div>',
    '<div class="hint">—</div>',
    '</div>',
    '<div class="pill" title="点击查看明细，双击立即刷新，拖动可移动">',
    '<span class="expand">▼</span>',
    '<span class="dot"></span><span class="amt">读取中…</span><span class="rate"></span>',
    '</div>',
    '</div>'
  ].join('')
  shadow.appendChild(root)

  var wrap = root.querySelector('.w')
  var pill = root.querySelector('.pill')
  var dot = root.querySelector('.dot')
  var amt = root.querySelector('.amt')
  var rate = root.querySelector('.rate')
  var panel = root.querySelector('.panel')
  var total = root.querySelector('.total')
  var rows = root.querySelector('.rows')
  var hint = root.querySelector('.hint')
  var refreshButton = root.querySelector('.refresh')

  /** Keep the capsule inside the viewport after a resize or a stale save. */
  function clamp() {
    var rect = wrap.getBoundingClientRect()
    var right = Math.min(Math.max(6, Math.round(window.innerWidth - rect.right)), Math.max(6, window.innerWidth - wrap.offsetWidth - 6))
    var bottom = Math.min(Math.max(6, Math.round(window.innerHeight - rect.bottom)), Math.max(6, window.innerHeight - wrap.offsetHeight - 6))
    root.style.right = right + 'px'
    root.style.bottom = bottom + 'px'
    return { right: right, bottom: bottom }
  }

  try {
    var saved = JSON.parse(localStorage.getItem(POSITION_KEY) || 'null')
    if (saved && isFinite(saved.right) && isFinite(saved.bottom)) {
      root.style.right = Math.max(6, saved.right) + 'px'
      root.style.bottom = Math.max(6, saved.bottom) + 'px'
    }
  } catch (error) {
    /* an unreadable position is not worth reporting */
  }

  var dragging = false
  var moved = false
  var origin = null

  pill.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return
    if (event.target.closest && event.target.closest('.refresh')) return
    var rect = wrap.getBoundingClientRect()
    origin = {
      x: event.clientX,
      y: event.clientY,
      right: window.innerWidth - rect.right,
      bottom: window.innerHeight - rect.bottom
    }
    moved = false
    dragging = true
    pill.classList.add('dragging')
    try {
      pill.setPointerCapture(event.pointerId)
    } catch (error) {
      /* capture is a nicety; window listeners below still track the drag */
    }
    event.preventDefault()
  })

  window.addEventListener('pointermove', (event) => {
    if (!dragging || origin === null) return
    var dx = event.clientX - origin.x
    var dy = event.clientY - origin.y
    if (!moved && Math.abs(dx) + Math.abs(dy) < 4) return
    moved = true
    root.style.right = Math.max(6, origin.right - dx) + 'px'
    root.style.bottom = Math.max(6, origin.bottom - dy) + 'px'
  })

  function endDrag() {
    if (!dragging) return
    dragging = false
    pill.classList.remove('dragging')
    if (moved) {
      var pos = clamp()
      try {
        localStorage.setItem(POSITION_KEY, JSON.stringify(pos))
      } catch (error) {
        /* private mode or a full quota: the position simply does not persist */
      }
    }
  }

  window.addEventListener('pointerup', endDrag)
  window.addEventListener('pointercancel', endDrag)

  /** Show the detail panel. Driven by an explicit click, never by hover: the
   * pointer merely passing over the capsule must not pop anything up. */
  function expand() {
    wrap.classList.add('open')
    /* Observability only: the shadow root is closed, so nothing outside can see
     * the panel's state. This attribute mirrors it (for tests/diagnostics) without
     * changing any behaviour. */
    host.toggleAttribute('data-open', true)
  }

  /** Hide the detail panel. */
  function collapse() {
    wrap.classList.remove('open')
    host.toggleAttribute('data-open', false)
  }

  /* Deliberately NO pointerenter/pointerleave handlers here. Hovering used to
   * expand the panel, which meant the widget reacted to the mouse just travelling
   * across the screen. Expansion is click-only now. */
  pill.addEventListener('click', () => {
    /* A click that ended a drag must not toggle the panel. */
    if (moved) {
      moved = false
      return
    }
    if (wrap.classList.contains('open')) {
      collapse()
    } else {
      expand()
    }
  })

  /* Clicking elsewhere on the page closes an open panel. */
  document.addEventListener('pointerdown', (event) => {
    if (event.target !== host && !host.contains(event.target)) collapse()
  })
  window.addEventListener('blur', collapse)

  /** Manual refresh with visible feedback on the ↻ icon. */
  function manualRefresh() {
    refreshButton.classList.add('flash')
    setTimeout(() => refreshButton.classList.remove('flash'), FLASH_MS)
    void refresh()
  }

  pill.addEventListener('dblclick', (event) => {
    event.preventDefault()
    manualRefresh()
  })
  panel.addEventListener('dblclick', (event) => {
    event.preventDefault()
    manualRefresh()
  })
  refreshButton.addEventListener('click', (event) => {
    event.stopPropagation()
    manualRefresh()
  })

  panel.addEventListener('click', (event) => event.stopPropagation())

  window.addEventListener('resize', () => {
    clamp()
  })

  /** Render one reading (or one failure) into both the capsule and the panel. */
  function paint(result) {
    paintRate()
    var infos = result && result.ok && Array.isArray(result.infos) ? result.infos : []
    var primary = infos[0]
    wrap.classList.remove('err')
    if (result && result.ok && primary) {
      var amount = Number(primary.total_balance)
      var symbol = primary.currency === 'CNY' ? '¥' : primary.currency === 'USD' ? '$' : (primary.currency || '') + ' '
      var text = symbol + (isFinite(amount) ? amount.toFixed(2) : String(primary.total_balance))
      dot.className = 'dot ' + (result.available === false ? 'empty' : amount <= 0 ? 'empty' : amount < 5 ? 'low' : 'ok')
      amt.className = 'amt'
      amt.textContent = text
      total.className = 'total'
      total.textContent = text
      rows.innerHTML = ''
      for (var i = 0; i < infos.length; i++) {
        var info = infos[i]
        var currency = info.currency || ''
        var unit = currency === 'CNY' ? '¥' : currency === 'USD' ? '$' : currency + ' '
        rows.appendChild(row('总额', unit + info.total_balance))
        rows.appendChild(row('赠金', unit + info.granted_balance))
        rows.appendChild(row('充值', unit + info.topped_up_balance))
      }
      hint.textContent = (result.available === false ? '账户不可用 · ' : '') + '更新于 ' + time(result.at) + ' · 5 秒自动刷新\n双击浮窗立即刷新'
      return
    }
    var detail = (result && result.detail) || '余额读取失败'
    dot.className = 'dot err'
    amt.className = 'amt err'
    amt.textContent = '余额异常'
    total.className = 'total err'
    total.textContent = detail
    rows.innerHTML = ''
    hint.textContent = '更新于 ' + time(result && result.at) + ' · 双击浮窗重试'
  }

  /** One label/value row element. */
  function row(label, value) {
    var line = document.createElement('div')
    line.className = 'row'
    var left = document.createElement('span')
    left.className = 'muted'
    left.textContent = label
    var right = document.createElement('span')
    right.textContent = value
    line.appendChild(left)
    line.appendChild(right)
    return line
  }

  /** `HH:MM:SS` for one epoch timestamp. */
  function time(at) {
    var date = new Date(typeof at === 'number' ? at : Date.now())
    var pad = (value) => String(value).padStart(2, '0')
    return pad(date.getHours()) + ':' + pad(date.getMinutes()) + ':' + pad(date.getSeconds())
  }

  /* DeepSeek's peak/off-peak pricing, from the official pricing page: peak hours are
   * 01:00-04:00 and 06:00-10:00 UTC, Monday to Friday, excluding Chinese public
   * holidays; every other hour is off-peak, weekends and holidays in full.
   *
   * Read in UTC on purpose: the window is defined in UTC and both peak blocks sit
   * inside a single UTC day, so there is nothing to convert. In Beijing time the
   * peak blocks are 09:00-12:00 and 14:00-18:00.
   *
   * Chinese public holidays are NOT modelled — that would mean shipping a calendar
   * that rots every year. A weekday holiday therefore shows as 峰 while the provider
   * bills it as 谷; the tooltip says so. */
  var PEAK_UTC_MINUTES = [[60, 240], [360, 600]]

  /** Whether this instant bills at the off-peak rate. */
  function offPeak(now) {
    var day = now.getUTCDay()
    if (day === 0 || day === 6) return true
    var minutes = now.getUTCHours() * 60 + now.getUTCMinutes()
    for (var i = 0; i < PEAK_UTC_MINUTES.length; i++) {
      if (minutes >= PEAK_UTC_MINUTES[i][0] && minutes < PEAK_UTC_MINUTES[i][1]) return false
    }
    return true
  }

  /** Label the capsule with 峰 or 谷 for the current hour. */
  function paintRate() {
    var off = offPeak(new Date())
    rate.textContent = off ? '谷' : '峰'
    rate.className = 'rate ' + (off ? 'off' : 'peak')
    rate.title = (off ? '谷时段：按峰时价格的 50% 计费' : '峰时段：按标准价格计费') +
      '\n峰时段为周一至周五 09:00-12:00、14:00-18:00（北京时间）。\n法定节假日未计入判断（节假日全天按谷计费）。'
  }

  var inFlight = false

  /** Read the host proxy and repaint. */
  async function refresh() {
    if (inFlight) return
    inFlight = true
    try {
      var response = await fetch(ENDPOINT + (typeof window.__RIG_MODE__ === 'string' ? '?mode=' + window.__RIG_MODE__ : ''), { headers: { accept: 'application/json' }, cache: 'no-store' })
      if (!response.ok) throw new Error('HTTP ' + response.status)
      paint(await response.json())
    } catch (error) {
      paint({ ok: false, detail: '余额请求失败：' + (error && error.message ? error.message : String(error)), at: Date.now() })
    } finally {
      inFlight = false
    }
  }

  document.documentElement.appendChild(host)
  clamp()
  paintRate()
  void refresh()
  /* Every 5 seconds while the page is visible; a hidden tab costs nothing and
   * catches up on its first visible frame. */
  setInterval(() => {
    if (document.visibilityState === 'visible') void refresh()
  }, REFRESH_MS)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') void refresh()
  })
  /* Debug affordance: `?balance-float=open` starts expanded (screenshot checks). */
  if (/[?&]balance-float=open\b/.test(location.search)) expand()
})()
