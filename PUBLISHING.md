# 发布到插件市场（收录到 awesome-dsh-plugin）

目标：让 `dsh-plugin-balance-float` 出现在 **dshmarket 的目录页**（可搜索、可一键装），
而不只是在「插件列表 → 全局插件」里。

## 事实（都是从市场自身接口实测得到的，不是猜的）

| 项 | 值 |
| --- | --- |
| 目录来源 | `https://awesome-dsh-plugin.com` |
| **收录源仓库** | `https://github.com/awesome-dsh-plugin/awesome-dsh-plugin` |
| 目录规模 | 4012 条，23 个分类 |
| 分类中与我们相关的 | **`usage` = "用量与计费"（Usage & Billing）** |
| 条目里 `url`（GitHub 仓库） | **4012/4012 全都有 → 必需** |
| 条目里 `npm` | 2053/4012 有 → 强烈建议（决定能否一键装） |

条目真实样例（从 `/dsh-market/registry` 取的第一条）：

```json
{
  "name": "dsh-answer-reviewer",
  "owner": "bycall",
  "url": "https://github.com/bycall/dsh-answer-reviewer",
  "page": "https://awesome-dsh-plugin.com/p/bycall/dsh-answer-reviewer/",
  "category": ["agi"],
  "description": { "en": "...", "zh": "..." },
  "npm": "dsh-answer-reviewer",
  "version": "0.7.2",
  "stars": 3,
  "downloads": 706,
  "install": "dsh plugin --profile web add dsh-answer-reviewer",
  "added": "2026-09-09"
}
```

`stars` / `downloads` / `page` / `install` / `added` 是市场侧生成的，**提交时只需提供**
`name` / `owner` / `url` / `category` / `description{en,zh}`（有 npm 包再加 `npm`）。

## 一、包已准备好的部分（本仓库已完成）

- `package.json`：去掉 `private`、加 `license` / `keywords` / `engines` / `publishConfig`，
  保留 **`dsh.bundle.patch`**（这是能被 `dsh plugin add` 认成插件层的根）
- `LICENSE`（MIT）
- `README.md`（英文，npm 主文档）+ `README.zh.md`（中文）
- `cordis.patch.yml`：裸包名 insert
- `tools/verify-package.mjs`：发布前自检（清单 / patch / 路由 / 注入 / 交互）

发布前先跑：

```powershell
node tools\verify-package.mjs     # 期望 VERIFY_PACKAGE: ALL_PASS
```

## 二、填两个只有你能填的字段

`repository` 之类要你的账号，我不替你编。用 npm 直接写进 `package.json`：

```powershell
cd D:\DeepSeek_Workspace\dsh-plugin-balance-float
npm pkg set repository.type=git
npm pkg set repository.url=git+https://github.com/<你的GitHub名>/dsh-plugin-balance-float.git
npm pkg set homepage=https://github.com/<你的GitHub名>/dsh-plugin-balance-float
npm pkg set bugs.url=https://github.com/<你的GitHub名>/dsh-plugin-balance-float/issues
npm pkg set author=<你的名字或昵称>
```

## 三、发到 npm（这一步是"可一键装"的前提）

```powershell
cd D:\DeepSeek_Workspace\dsh-plugin-balance-float
npm login                      # 用你自己的 npm 账号
npm publish --access public    # package.json 里 publishConfig 已设好 public
```

发布后确认包名没被占（如果 `dsh-plugin-balance-float` 已被别人占用，需要改名，例如加前缀
`@你的scope/dsh-plugin-balance-float`，同时改 `cordis.patch.yml` 里的 `name`）：

```powershell
npm view dsh-plugin-balance-float version
```

**如果你想保留"私有"，就不要走这一步**，直接用第五节的私有目录方案。

## 四、建 GitHub 仓库并提交收录

```powershell
cd D:\DeepSeek_Workspace\dsh-plugin-balance-float
git init
git add -A
git commit -m "Add balance-float: floating DeepSeek API balance widget for the DSH Web GUI"
git branch -M main
git remote add origin https://github.com/<你的GitHub名>/dsh-plugin-balance-float.git
git push -u origin main
```

然后到收录源仓库提 PR：**<https://github.com/awesome-dsh-plugin/awesome-dsh-plugin>**
（该仓库的 CONTRIBUTING 可能更新，请以仓库里的实际说明为准）。按上面的 schema
把这条加进去：

```json
{
  "name": "dsh-plugin-balance-float",
  "owner": "<你的GitHub名>",
  "url": "https://github.com/<你的GitHub名>/dsh-plugin-balance-float",
  "category": ["usage"],
  "description": {
    "en": "Floating DeepSeek API balance capsule for the DSH Web GUI: shows the remaining balance in the corner, click to expand the breakdown, double-click to refresh, auto-refreshes every 5s. The host half proxies /user/balance so the API key never reaches the browser.",
    "zh": "DSH Web GUI 的 DeepSeek API 余额浮窗：角落常驻显示余额，点击展开明细，双击立即刷新，每 5 秒自动刷新。宿主侧代理 /user/balance，密钥不下发到浏览器。"
  },
  "npm": "dsh-plugin-balance-float"
}
```

## 五、私有旁路：不发布也能进目录

市场支持 **`DSHM_REGISTRY_URL`** 环境变量覆盖目录地址。其源码注释原文：

> `DSHM_REGISTRY_URL` … overridable through the process environment ONLY — the layer-3
> e2e points it at a local fixture catalog so the install route can be driven end to
> end **without publishing anything**.

也就是说：写一份只含本插件的小目录 JSON（结构与第一节的 `registry` 一致），用本地 HTTP
服务发出来，再把 `DSHM_REGISTRY_URL` 指过去，市场就会把它当目录来源——**插件会出现在
市场页里、并被标成"已安装"**，而完全不用发 npm、不用建公开仓库。

代价与注意：

- 只有设了这个环境变量的 dsh 进程能看到它（启动 `dsh web` 时带上该变量）；
- 目录页会**只**剩下你这份目录的内容，公开的 4012 条会被替换掉；
- 覆盖的是"哪份清单是精选"，安装时的来源校验照旧执行（源码注释明确说明）。

需要的话我可以把这份目录 JSON 和一个本地静态服务脚本一起做出来并实测。

## 六、发布后怎么验证

```powershell
# 市场目录里能搜到它
node tools\market-registry.mjs http://127.0.0.1:3080 balance-float

# 目录条目里能认出"已安装"
node tools\market-installed.mjs http://127.0.0.1:3080
```

两个脚本都在 `tools\` 下，分别读 `/dsh-market/registry` 和 `/dsh-market/installed`。
