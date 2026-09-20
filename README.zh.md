# dsh-plugin-balance-float

DSH Web GUI 的 DeepSeek API 余额小浮窗 —— 仿搜狗输入法状态条的胶囊式悬浮窗。

- **打开 DSH（页面加载）时自动出现，关闭页面时随之消失**：浮窗由宿主插件注入到每个
  `index.html`，不依赖会话、不占用对话上下文。
- 折叠态只显示余额（绿/黄/红圆点表示充足/偏低/不足），并带一个很小的 `▼` 提示可展开。
- **点击展开明细**：总额、赠金、充值、上次刷新时间。**悬停不会弹任何东西**——鼠标划过
  胶囊不产生反应；再点一次收起，点页面其它地方也会收起。
  （早期版本是"悬停即展开"，实测会让人觉得浮窗在跟着鼠标闪，已改为点击触发。）
- **双击浮窗立即刷新**（折叠态、展开态都支持），刷新时 ↻ 图标转一圈作为反馈；面板右上角的
  ↻ 按钮同样可以手动刷新。
- **每 5 秒自动刷新**一次；页面切到后台时不刷新，切回前台立刻补一次。
- 可拖动，位置自动吸附在视口内并记在 `localStorage`；深色/浅色跟随系统主题。
- 浮窗位于 closed shadow root 中，脱离 React 渲染树，不与界面样式互相污染。
  展开状态会镜像到宿主元素的 `data-open` 属性上，仅供测试/诊断读取（不改行为）。

## 结构

| 文件 | 作用 |
| --- | --- |
| `package.json` | 插件清单：声明 `dsh.bundle.patch`，这是被 `dsh plugin` 认成 bundle 层的关键 |
| `cordis.patch.yml` | 这个包自带的 profile 层：`insert` 一行 `id: balance-float` / `name: dsh-plugin-balance-float` |
| `lib/index.js` | 宿主侧：注册 `GET /x-balance-float` 代理路由 + 注入浮窗脚本 |
| `lib/client.js` | 浏览器侧：浮窗 DOM/CSS/拖拽/轮询逻辑（被注入为内联脚本） |
| `tools/verify-package.mjs` | **插件包独立验证**：清单、patch、路由、注入、点击式交互（不需要 DSH 在跑） |
| `tools/harness.mjs` | 离线验证：桩上下文 + 真实上游调用 + 生成 `widget.html` |
| `tools/test-credentials.mjs` | 密钥解析回归测试（两种 YAML 写法、凭证服务、环境变量优先级） |
| `tools/screenshot-server.mjs` | 截图台：同源提供页面与余额路由，便于无头截图 |
| `tools/verify-interactions.mjs` | 用 CDP 验证"点击才展开"、双击刷新、5 秒轮询 |
| `tools/shot-open.mjs` | 点击一次后截图（确认展开态渲染） |
| `tools/gui-shot.mjs` | 通过 CDP 对真实 GUI 截图 |

宿主在**每次渲染 index 时**重新读取 `lib/client.js`，所以改浮窗样式/参数只需刷新页面，
不用重装插件，也不用重启 `dsh web`。

## 为什么余额查询在宿主侧

DeepSeek 的 `/user/balance` 需要 `Authorization: Bearer <key>`，且不下发 CORS 头。
把密钥放进浏览器既暴露凭证又会被 CORS 拦住，因此由宿主读取本机凭证并代理，
浏览器只请求同源的 `/x-balance-float`。

密钥解析顺序（每次请求现取，不在插件里长期缓存）：

1. `DEEPSEEK_API_KEY` 环境变量；
2. DSH 凭证服务 `ctx.credentials.resolve('DEEPSEEK_API_KEY')`（环境 + `.env` + 凭证存储）；
   访问该服务必须在 `try` 里——服务不可用时读属性本身就会抛，抛出去会让整条路由返回 400；
3. 兜底：直接解析 `$DSH_HOME/.credentials.yaml`。

⚠️ 第 3 步必须同时认两种 YAML 写法：`refs: { DEEPSEEK_API_KEY: sk-x }`（**DSH 重启后会把
文件改写成这种流式写法**）和块写法（`refs:` 换行后缩进的 `DEEPSEEK_API_KEY: sk-x`）。
最初只认块写法，重启后浮窗就显示「余额异常 · 未找到 DEEPSEEK_API_KEY」。
`tools/test-credentials.mjs` 是这条的回归测试，改动密钥解析后必须跑。

密钥不会出现在任何响应里。

## 安装（正式插件包）

```powershell
dsh plugin --profile web add D:\DeepSeek_Workspace\dsh-plugin-balance-float
```

`dsh plugin` 是 pnpm 的转发器，会做三件事：

1. 在 profile 目录里执行 `pnpm add`，本包以 `link:` 形式进入 `dependencies`；
2. **因为本包 `package.json` 里声明了 `dsh.bundle.patch`**，`reconcilePlugins` 会自动
   把 `dsh-plugin-balance-float` 加进 profile 的 `dsh.profile.bundles` 列表；
3. 于是它成为 profile 的一个**层**，层里 `insert` 的 `balance-float` 就是宿主路由 + 注入。

卸载：

```powershell
dsh plugin --profile web remove dsh-plugin-balance-float
```

### 为什么不用写 `file://` 绝对路径

早期版本是在 profile 的 `cordis.patch.yml` 里手写一行 `file:///D:/.../lib/index.js?v=3`。
那样能用，但**不是插件包该有的形态**：换机器/换目录/DSH 升级都会失效，也没有依赖记录。
现在与 `open-sea-skin`、`dsh-builtin-browser` 等第三方插件一致——patch 里写**裸包名**，
由 profile 的 `node_modules` 解析。

### 改了代码怎么生效

| 改的是 | 怎么生效 |
| --- | --- |
| `lib/client.js`（浮窗外观/参数） | 宿主每次渲染 index 都重读该文件 —— **刷新页面即可** |
| `lib/index.js`（宿主逻辑） | Node 按 URL 缓存 ESM，且运行中的进程不会重读 bundles 列表 —— **重启 `dsh web`**（或重装插件后重启） |
| `package.json` / `cordis.patch.yml` | 同上：bundles 列表只在 boot 时读一次，需要重启 |

⚠️ **实测结论：改 profile 的 `package.json`（bundles 列表）不会热生效。** 运行中的 dsh
只在 boot 时组合一次 bundles 列表；`patchReload: live` 监视的是 `cordis.patch.yml` 这类
patch 文件，**不包括 `package.json`**。所以「装好插件但 GUI 没反应」时，重启进程即可。

## 验证

```powershell
node tools/verify-package.mjs                 # 插件包独立验证（不需要 DSH 在跑）
node tools/test-credentials.mjs              # 两种 YAML 写法 + 凭证服务分支（回归测试）
node tools/harness.mjs                       # 路由、缓存、HEAD/POST 语义、真实余额
node tools/screenshot-server.mjs 3931        # 然后浏览器打开 http://127.0.0.1:3931/?balance-float=open
node tools/verify-interactions.mjs http://127.0.0.1:3931/   # 需要 rig 在跑
```

`verify-package.mjs` 的实测输出（它模拟 loader 的方式 import 包入口并挂到桩上下文）：

```text
--- package manifest ---
PASS dsh.bundle.patch declared          ./cordis.patch.yml
PASS patch file readable                ...\cordis.patch.yml
PASS patch inserts our module           bare package name in patch
PASS entry point exists in exports      ./lib/index.js
PASS client script is shipped           ["lib/index.js","lib/client.js","cordis.patch.yml","README.md"]

--- host half ---
PASS module exports apply               entry=./lib/index.js name=balance-float inject=["webServer"]
PASS registered the balance route       /x-balance-float
PASS injects the widget script          script row: body
PASS injects the host style row         .dsh-balance-float-host{...}
PASS widget uses click-only toggle      no hover listeners in injected script
PASS route answers JSON                 {"ok":true,"available":true,...}
PASS route handles HEAD                 status=200
PASS route rejects other methods        status=405 allow=GET, HEAD

VERIFY_PACKAGE: ALL_PASS
```

`?balance-float=open` 让浮窗以展开态启动（截图用）；`__RIG_MODE__=http-error`
会把浮窗切到失败分支。渲染结果见 `widget-expanded.png`、`widget-collapsed.png`、
`widget-error.png`、`widget-error-open.png`、`real-gui.png`。

`verify-interactions.mjs` 的实测输出（真实 Edge + CDP，检测"点击才展开"这条规则）：

```text
baseline state (collapsed): closed
--- 1) hover only, no click ---
   state after hover: closed  -> PASS (hover does not open)
--- 2) single click ---
   state after click: open  -> PASS (panel opened)
--- 3) click again ---
   state after 2nd click: closed  -> PASS (panel closed)
--- 3b) click elsewhere closes it ---
   state after outside click: closed  -> PASS
--- 4) double click refreshes once ---
   extra refresh requests: 1
--- 5) auto refresh rhythm over 12s ---
   requests in 12s: 2  gaps(ms): 5010
```

检测方式说明：面板在 **closed shadow root** 里，页面脚本看不到它，所以浮窗把展开状态
镜像到宿主元素的 `data-open` 属性上供测试读取（只加属性，不改行为）。踩过的坑：最初想用
CDP 的 `DOM.getDocument {pierce:true}` 数影子树节点数，但那个数字在展开前后都是 40，
**判据不灵敏、会误报"点击没生效"**。

## 行为细节

- 路由只接受 `GET`/`HEAD`，其它方法返回 `405` 且带 `Allow` 头。
- 宿主对上游结果做缓存：成功 20 秒、失败 10 秒，所以浮窗 5 秒轮询不会等频打到
  DeepSeek（最多每 20 秒一次真实请求）。轮询频率在 `lib/client.js` 的 `REFRESH_MS`，
  缓存时长在 `lib/index.js` 的 `OK_TTL_MS` / `ERROR_TTL_MS`。
- 上游 401/403 归为 `bad-key`，连接失败归为 `unreachable`，非 JSON 归为 `bad-response`，
  凭证缺失归为 `no-api-key`；四种情况浮窗都显示可读的中文原因并保留双击重试。
- 双击判定由浏览器原生 `dblclick` 完成，拖动过的指针序列不会触发（`preventDefault` 在拖动时发生）。
- 页面里没有浮窗时脚本会直接返回，重复注入不会产生两个浮窗。

## 卸载

```powershell
dsh plugin --profile web remove dsh-plugin-balance-float
```

pnpm 会移除依赖，`reconcilePlugins` 会顺带把它从 profile 的 bundles 列表里摘掉。
删完**重启 `dsh web`**（bundles 列表只在 boot 时读）。

## 封装过程记录（踩过的坑）

| 现象 | 根因 | 处理 |
| --- | --- | --- |
| `dsh plugin add` 报 `'pnpm' is not recognized` | `%APPDATA%\npm` 里只有 `pnpm.ps1`，**没有 `pnpm.cmd`**；dsh 用 `spawnSync(shell:true)` 起的是 cmd，cmd 只认 `.cmd`/`.exe` | 补了一个 `pnpm.cmd` shim（指向 `node_modules\pnpm\pnpm.exe`） |
| 装好后 GUI 仍是 404 | 运行中的进程**只在 boot 时读一次 bundles 列表**，`package.json` 不在 live 监视范围内 | 重启 `dsh web`；重启后路由 200、余额正常 |
| patch 里写相对路径 `./…` 不靠谱 | loader 的解析基准不确定（profile 目录？patch 所在目录？） | 照抄第三方插件约定：**写裸包名** |
| 改宿主代码后旧的 `?v=` 讲究 | 那是 file:// 直挂时代的产物（Node 按 URL 缓存 ESM） | 插件包方式下不再需要；重启进程即可 |
