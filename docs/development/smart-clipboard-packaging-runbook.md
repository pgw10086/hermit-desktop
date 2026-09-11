# Smart Clipboard 打包与更新流程

状态：`current`

本文是 Smart Clipboard 后续版本更新时的专属执行清单。共同的插件 package、runtime、
双宿主、Product Surface 和制品证据规则以[DSH Product Plugin 开发与打包标准](dsh-plugin-development-and-packaging.md)
为准；本文只补充 Smart Clipboard 的桌面 native、快捷键中心和 DMG 步骤。

## 先理解三类制品

Smart Clipboard 不是把一个页面复制进桌面包。一次完整交付包含三层：

| 制品 | 用途 | 当前产出方式 |
| --- | --- | --- |
| `@tianbuyv/smart-clipboard` npm package | Desktop 通过 exact version 消费 | package release workflow |
| `Hermit.app` 目录包 | 本机开发和隔离启动验收 | `package:desktop:dir` |
| `Hermit-<version>-arm64.dmg` | macOS smoke 或发布制品 | `dist:desktop:mac:smoke` / `dist:desktop:mac` |

插件 package 已发布到 public npm。桌面包内仍有两处有明确职责的物理投影，但它们必须来自
同一次 frozen install 的同一 package 版本：

- `Resources/runtime/.../dsh/node_modules/@tianbuyv/smart-clipboard`：给 DSH profile 安装和
  Client/Host 运行的插件制品；
- `app.asar/node_modules/@tianbuyv/smart-clipboard`：从上述 runtime 闭包复制给 Electron
  主进程的 SQLite、动作和 IPC 代码按 Node 模块规则解析的 host 运行依赖。

两处必须来自同一版本、同一构建闭包，不能再次从 `plugins/` workspace 源目录取文件。只把插件放进 DSH runtime，桌面主进程仍可能在
安装后的 DMG 中报 `ERR_MODULE_NOT_FOUND`。

`package:desktop:dir` 只用于本机测试。它会在包内写入 `hermitBuildVariant=test`，启动前将
userData 切到 `~/Library/Application Support/Hermit Test`，因此不会被已安装的
`/Applications/Hermit.app` 单实例锁接管，也不会混用正式包的 DSH profile、数据库或会话。
`mac-smoke` 和 `mac-release` 保持正式 `Hermit` 身份。

## 前置条件

1. 在仓库根目录工作，先确认版本和平台：

   ```sh
   node --version
   corepack pnpm --version
   uname -m
   ```

   普通脚本支持仓库声明的 Node 范围；资格、macOS 打包和发布强制使用仓库准备的
   bundled Node 24.x 和 pnpm 11.x。macOS DMG 当前只接受原生 Apple Silicon（`arm64`）。

2. 需要跨网准备依赖时使用 Clash：

   ```sh
   export HTTP_PROXY=http://127.0.0.1:7897
   export HTTPS_PROXY=http://127.0.0.1:7897
   ```

3. 关闭本次验收前启动的旧 Hermit 实例，避免单实例锁干扰；不要杀掉不属于本次验收的
   DSH、浏览器或其他会话进程。测试使用临时 `DSH_HOME` 和临时 user data，不接触真实
   DSH 历史、真实文件或 General Pasteboard。

## 每次改动后的标准顺序

### 1. 构建并验证插件

```sh
corepack pnpm --filter @tianbuyv/smart-clipboard test
```

如果要检查可安装包内容，在临时目录从已安装 package 生成一次测试 tarball：

```sh
artifact_dir=$(mktemp -d /tmp/hermit-smart-clipboard-artifact-XXXXXX)
(cd apps/desktop-vnext/node_modules/@tianbuyv/smart-clipboard && corepack pnpm pack --pack-destination "$artifact_dir")
tar -tzf "$artifact_dir"/*.tgz
```

归档时保留 tarball 的 SHA-256 和版本；不要把临时目录或真实 profile 写回仓库。

### 2. 验证 DSH 双宿主 Product Surface

```sh
corepack pnpm run test:smart-clipboard:product-surface
```

该测试会从当前已安装 package 生成同一个临时 `.tgz`，在 stock DSH 中确认 settings fallback 和
unavailable，在 Hermit bundled DSH 中确认侧栏和 History 入口。stock 与 Hermit 不生成
两份插件实现；stock 缺少 Hermit 专属 capability 时显示明确不可用是预期行为。

### 3. 验证桌面主进程和打包 UI

```sh
corepack pnpm run test:desktop
corepack pnpm run package:desktop:dir
corepack pnpm run test:smart-clipboard:packaged-ui
corepack pnpm run test:smart-clipboard:focus-restore
corepack pnpm run verify:desktop:packaged-runtime
```

`package:desktop:dir` 会自动准备 bundled Node、DSH runtime、native bridge、renderer 和
app-dir。`test:smart-clipboard:packaged-ui` 覆盖快捷键中心、History、暂停/继续、设置、停用/重新启用
生命周期；`test:smart-clipboard:focus-restore` 覆盖 macOS 临时 Surface 关闭后外部应用焦点恢复和
主窗口保持隐藏/不抢焦点；`verify:desktop:packaged-runtime` 覆盖 runtime closure、Product Surface patch
和 DSH clean boot。

### 4. 做隔离的桌面启动验收

仓库内的 `dist/mac-arm64/Hermit.app` 启动时可能沿父目录找到开发态 `node_modules`，不能
单独作为安装包证据。应把 app 复制到仓库外的临时目录再运行：

```sh
isolated=$(mktemp -d /tmp/hermit-packaged-isolated-XXXXXX)
ditto apps/desktop-vnext/dist/mac-arm64/Hermit.app "$isolated/Hermit.app"
HERMIT_PACKAGED_EXECUTABLE="$isolated/Hermit.app/Contents/MacOS/Hermit" \
  .hermit/runtime/node/bin/node apps/desktop-vnext/tests/m1-desktop-packaged.e2e.mjs
```

成功信号应包含 `M1 Desktop packaged passed`，并且托盘、登录项读写和退出顺序均通过。

### 5. 生成并验证 macOS smoke DMG

```sh
export HTTP_PROXY=http://127.0.0.1:7897
export HTTPS_PROXY=http://127.0.0.1:7897
corepack pnpm run dist:desktop:mac:smoke
```

该命令会重新生成 `apps/desktop-vnext/dist/mac-smoke/`，只接受原生 arm64，验证 DMG 内容、
bundled Node、DSH closure、native bridge、app 启动、托盘、登录项和正常退出。成功信号：

```text
M1 Desktop packaged passed: ...
macOS smoke DMG passed: .../Hermit-<version>-arm64.dmg
```

首次从 DMG 启动若出现系统授权提示，先把 Hermit 切到前台完成提示，再继续人工检查；若
出现 JavaScript error 或 `ERR_MODULE_NOT_FOUND`，这是打包缺依赖或解析边界问题，不是授权
提示，应停止发布并修复。

smoke 只用于日常打包检查。需要发布 GitHub Release 时，继续执行统一的
[macOS 发布流程](macos-release.md)；不要在本文另建一套签名、tag 或 Release 规则。

## 真实 macOS 人工清单

自动化不会读取或改写用户 General Pasteboard。用虚构内容在另一个应用中逐项确认：

- 复制 TEXT、IMAGE、FILE_LIST 后，等待历史记录出现，关闭再启动仍可恢复；
- 全局快捷键呼出紧凑面板，输入即过滤，方向键选择；
- 在 DSH“设置 -> 快捷键”中确认当前组合和注册状态；用另一个已被占用的组合验证只提示
  冲突，History 仍能打开、后台捕获仍继续；修改为可用组合后快速取回恢复；
- `Enter` 默认只复制，`Mod+Enter` 默认执行明确粘贴，`Shift+Enter` 只对 TEXT 做纯文本复制；
- 从旧版本升级时，缺少动作映射版本标记且仍是旧版默认组合的设置会一次性迁移为上述默认值；带当前版本标记的用户自定义组合保持不变；
- 用户按住 Option/Alt 点击时执行 Mod+Enter 映射；右键只打开已有类型预览，不执行复制或粘贴；
- 显式粘贴被系统拒绝时，界面保留“已复制，请手工粘贴”的降级反馈；
- History 列表、三类详情预览、置顶、删除、Trash、恢复/永久删除、暂停、导出和清空；
- 文件引用失效、存储上限、插件停用和重新启用时，界面显示对应明确状态；
- 从快捷面板、侧栏、命令和插件详情都能回到完整 History；
- 退出后重新打开，快捷键、捕获状态和数据目录均符合预期。

不要在这一步测试真实密码、token、客户文件或真实会话内容，也不要把截图、profile、
临时数据库和导出 ZIP 提交到仓库。

## 失败判断

| 现象 | 判断 | 处理 |
| --- | --- | --- |
| TypeScript、插件单测失败 | 代码或契约回归 | 修复后从第 1 步重跑 |
| stock Surface 无 History、Hermit 有 | capability 差异 | 预期；保持 stock unavailable，不复制第二套 UI |
| packaged UI 失败 | 桌面集成或生命周期回归 | 不进入 DMG |
| DMG 中 `ERR_MODULE_NOT_FOUND` | app.asar 依赖漏打包 | 检查 `electron-builder.yml` 的 app 内 host 依赖和隔离启动 |
| DMG 首次启动卡在系统对话框 | macOS 人工授权尚未完成 | 把应用切到前台完成授权后重跑；不要改成静默绕过 |
| native bridge 无法加载 | 平台、Electron/N-API 或依赖闭包不匹配 | 按 manifest、架构和动态依赖检查修复 |
| 未签名安全提示 | 当前阶段未购买签名和公证 | 在 Release 说明中标记 unsigned/not notarized；这不是构建失败 |

## 版本更新清单

1. 先更新外层工作区的 `../plugin-smart-clipboard/DESIGN.md`（若产品行为变化），再改实现和测试。
2. 更新插件版本并发布 public npm package；Desktop 使用 exact version 更新依赖和 `pnpm-lock.yaml`。
3. 清理并重新构建插件和 bundled runtime，不能复用上一次 `dist` 或 profile。
4. 按本文第 1 至第 5 步重跑；任何 package、runtime 或 native manifest 变化都要重新做资格检查。
5. 记录 npm package、app-dir 和 DMG 的版本、平台架构和测试结果；证据放在 `.hermit/artifacts/`，
   不提交本地缓存。
6. 需要形成 GitHub 版本时，直接运行未签名的 macOS 打包入口：

   ```sh
   corepack pnpm run dist:desktop:mac
   ```

## 明确不要做

- 不要手工把 workspace 的 `lib` 目录复制到用户 profile 或安装目录；
- 不要把 workspace symlink 当成发布制品；
- package 发布前必须移除 `private: true` 并设置 public npm access；
- 不要用真实用户 profile、真实剪贴板或真实文件做自动化测试；
- 不要为了通过启动而把 `NODE_PATH`、私有 DOM/Router 或第二套插件实现塞进桌面包；
- 不要把未签名制品描述成已经签名或公证。

## 当前仍未闭合的资格

当前代码和 smoke DMG 已证明插件、桌面、DSH runtime、Product Surface、app.asar 依赖和
DMG 冷启动闭环。真实 General Pasteboard 的复制/显式粘贴、辅助功能授权、物理快捷键、
Gatekeeper 和真实重启仍是独立证据，不因 smoke DMG 通过而自动视为完成。
