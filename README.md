# dsh-plugin-balance-float

A floating DeepSeek API balance capsule for the DeepSeek Harness Web GUI — the
Sogou-input-method kind of status pill: it sits in the corner, shows your
remaining balance, and gets out of the way.

> 中文文档见 [README.zh.md](./README.zh.md)。

## What it does

- **Appears with the page, disappears with it.** The host plugin injects the
  widget into every rendered `index.html`, so it is not tied to any session and
  costs no conversation context.
- **Collapsed** it shows just the balance plus a status dot: green = healthy,
  amber = low, red = depleted. Next to the balance a small badge shows whether the
  current hour bills at **峰 (peak)** or **谷 (off-peak)** rates. A small `▼` hints
  that it can be opened.
- **Click to open** the detail panel: total, granted and topped-up balance, and
  the last refresh time. **Hovering does nothing** — the pointer merely passing
  over the capsule must not pop anything up. Click again (or click elsewhere) to
  close.
- **Double-click to refresh immediately**, on both the collapsed and expanded
  states; the ↻ icon spins as feedback, and the panel's ↻ button does the same.
- **Auto-refreshes every 5 seconds.** Polling pauses while the tab is hidden and
  catches up on the first visible frame.
- **Draggable**, snaps inside the viewport, remembers its position in
  `localStorage`, and follows the system light/dark theme.
- Lives in a **closed shadow root**, outside the SPA's React tree, so it neither
  disturbs nor is disturbed by the app's styles.

## Install

```powershell
dsh plugin --profile web add dsh-plugin-balance-float
```

Then restart `dsh web` (see *Why a restart* below) and refresh the page.

Once installed it shows up in **Settings → 插件 → 插件列表 → 全局插件** with an
enable/disable control, alongside every other installed plugin.

Uninstall:

```powershell
dsh plugin --profile web remove dsh-plugin-balance-float
```

## Requirements

- A DeepSeek API key on the machine, as the `DEEPSEEK_API_KEY` environment
  variable, or as `refs.DEEPSEEK_API_KEY` in `$DSH_HOME/.credentials.yaml`.
- DeepSeek Harness `>= 0.1.5-rc.2` (the profile bundle mechanism this package
  uses).

## Why the balance is fetched on the host

DeepSeek's `/user/balance` requires `Authorization: Bearer <key>` and sends no
CORS headers. Putting the key in the browser would both expose the credential
and be blocked by CORS, so the host half reads the local credential and proxies
the call; the browser only ever talks to the same-origin `/x-balance-float`.

Credential resolution order, per request (nothing is cached long-term):

1. the `DEEPSEEK_API_KEY` environment variable;
2. the Harness credential service, `ctx.credentials.resolve('DEEPSEEK_API_KEY')`;
3. a direct read of `$DSH_HOME/.credentials.yaml` as a fallback.

The key never appears in any response.

## Files

| File | Role |
| --- | --- |
| `package.json` | Manifest: declares `dsh.bundle.patch`, which is what makes `dsh plugin` treat this package as a profile layer |
| `cordis.patch.yml` | The package's own profile layer: inserts `id: balance-float` / `name: dsh-plugin-balance-float` |
| `lib/index.js` | Host half: the `GET /x-balance-float` proxy route plus the index injection |
| `lib/client.js` | Browser half: the widget's DOM/CSS/drag/poll logic (injected inline) |
| `tools/verify-package.mjs` | Package-level verification (manifest, patch, route, injection, click-only interaction) |

The host re-reads `lib/client.js` on **every index render**, so changing the widget
only needs a page refresh — **provided the widget file the host reads is the one you
edited.** Installed from GitHub or npm, that is the copy in the profile's store, not
your working tree, so a change has to be pushed and reinstalled (see below). A
`link:` install reads your working tree directly, which is what makes local
iteration a refresh away.

## Verify

```powershell
node tools/verify-package.mjs                        # manifest, route, injection
node tools/verify-tariff.mjs http://127.0.0.1:3931/  # 峰/谷 badge at every boundary
```

`verify-tariff.mjs` freezes the page clock with a fake `Date`, forces a repaint, and
reads the badge out of the closed shadow root through CDP's pierced DOM. Its
expectations are written from the pricing rule rather than recomputed from the
widget, so a wrong window fails the test instead of agreeing with itself.

## Peak / off-peak badge

DeepSeek bills off-peak hours at half the peak rate. Per the official pricing page,
**peak hours are 01:00–04:00 and 06:00–10:00 UTC, Monday to Friday, excluding
Chinese public holidays**; every other hour is off-peak, weekends and holidays in
full. In Beijing time that is 09:00–12:00 and 14:00–18:00 on weekdays.

The badge is computed in the browser from UTC, so it is correct whatever the
machine's timezone is, and it re-evaluates on every 5-second refresh.

**Chinese public holidays are not modelled.** That would mean shipping a calendar
that goes stale every year, so on a weekday holiday the badge says 峰 while the
provider bills it as 谷. The badge's tooltip says so.

## Known limitations

- **A restart is required after install.** A running `dsh` composes its profile
  bundle list once, at boot; `patchReload: live` watches patch files, not
  `package.json`. So a host started before the install does not know about the
  new layer. Restarting `dsh web` is the fix.
- Balance figures come from DeepSeek's own endpoint and are subject to its
  caching and reporting delay.
- The widget shows the first currency DeepSeek reports; multi-currency accounts
  see one line for the primary entry.

## License

MIT
