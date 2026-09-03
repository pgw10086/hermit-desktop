# File Workspace 与 Better Sidebar managed 保存契约资格记录

日期：2026-08-28

状态：`SUPERSEDED`

> 2026-09-01 说明：本文记录当时对外部制品的真实资格结果，但当前 File Workspace 已改用
> Hermit Product Surface v1 作为唯一宿主，不再依赖 Better Sidebar。本文不是当前实现
> 要求；当前产品行为只以 File Workspace DESIGN 和核心需求为准。

本文是一次实现前资格记录，只保存外部制品、公开契约、实践结果和限制。File Workspace
当前产品行为仍以
`plugin-file-workspace` sibling 仓库中的 `DESIGN.md` 为唯一权威来源，跨域数据与安全边界以
[核心需求](../../specs/2026-08-24-hermit-dsh-vnext/core-requirements.md#63-file-workspace)为准。

## 1. 要回答的问题

需要确认 Better Sidebar 是否存在公开的 managed source + revision-aware save 契约，可直接
完成以下闭环：

```text
打开 managed Markdown
-> 编辑
-> File Workspace 接收保存
-> 保持 FileRecord 身份
-> 写入新 revision
-> 关闭并重开后看到新内容
```

如果内置契约不存在，还要验证是否能只使用 Better Sidebar 的公开扩展面承载 File Workspace
自己的 logical FileRecord tree、编辑状态和 revision-aware save，而不导入私有实现、不伪造
filesystem path，也不让 Better Sidebar 取得 Canonical 数据所有权。

## 2. 固定制品

| 项目 | 资格基线 |
|---|---|
| 上游 | [omdsh-dev/DSH-better-sidebar](https://github.com/omdsh-dev/DSH-better-sidebar) |
| npm 制品 | `dsh-better-sidebar@0.16.1` |
| 上游 tag / commit | `v0.16.1` / `f9153dfc1ce47cf43445c1b351ee3ae47b4ad9f1` |
| npm shasum | `612a6f3c33d7b722df1cd6f7fa74dedfa1202907` |
| tarball SHA-256 | `350486c712e17287c316ddb6ba15bc05741796ab0f4de6c5c0daae729913f2b3` |
| npm integrity | `sha512-fjFNzfrgdIbzlcC4Sd4aS1I2ZRbuA+/m3XQnOxY13jE6IKJzwz0+GjATcKTyFoLnXoDRp2QJz/U0GxhaOD70Dw==` |
| 许可证 | MIT |
| DSH | stock 和 Hermit bundled 均为 `0.1.1-rc.2` |
| Node | Hermit bundled Node `24.19.0` |

上游 `main` 当时为 `0.17.0`、commit
`0314fd9b93c5f55eb68f98480d84500d67a75b03`，但没有对应已发布 tag；本次没有用 `main` 或
`latest` 代替发布制品。

## 3. 发布制品审计

发布包公开 `./client/service` 和 `./client/api`，也把 `./src/*` 写进 export map。后者即使
技术上可导入，仍属于上游实现路径，Hermit 生产插件禁止使用，只用于审计公开制品行为。

审计结论：

- `FileViewerDescriptor.load` 的输入是 `path`、Session scope 和 abort signal；没有 FileRecord
  identity、managed source handle、base revision、save callback 或 conflict result。
- 内置 TextEditor 保存直接调用 filesystem `fsWrite(scope, path, content)`；成功只清除自身
  dirty 状态，失败只进入 failed 状态，没有新 revision 或 stale-base 语义。
- 内置 Explorer、EditorHost 和 Viewer matching 都围绕 Session `cwd + path`；不能把 managed
  FileRecord 映射成假路径来复用，否则会绕过 File Workspace/Core 的归属和 revision 契约。
- 公开 `registerTab` 可注册自定义 React 工作面并返回 disposer；公开 `openTab`、`closeTab`
  和 single/dedupe 语义足以承载一个由 File Workspace 自己管理内容的 Tab。

对应上游证据：

- [发布包与 exports](https://github.com/omdsh-dev/DSH-better-sidebar/blob/f9153dfc1ce47cf43445c1b351ee3ae47b4ad9f1/package.json)
- [公开 service 和 descriptor](https://github.com/omdsh-dev/DSH-better-sidebar/blob/f9153dfc1ce47cf43445c1b351ee3ae47b4ad9f1/src/client/service.ts)
- [内置 TextEditor filesystem 保存](https://github.com/omdsh-dev/DSH-better-sidebar/blob/f9153dfc1ce47cf43445c1b351ee3ae47b4ad9f1/src/client/TextEditor.tsx)
- [EditorHost 的 path 资源边界](https://github.com/omdsh-dev/DSH-better-sidebar/blob/f9153dfc1ce47cf43445c1b351ee3ae47b4ad9f1/src/client/EditorHost.tsx)
- [内置 Viewer 注册](https://github.com/omdsh-dev/DSH-better-sidebar/blob/f9153dfc1ce47cf43445c1b351ee3ae47b4ad9f1/src/client/builtins/viewers.tsx)

## 4. 最小资格实践

资格 spike 是 `.hermit/tmp/file-workspace-contract-spike` 下的可丢弃实验，不是正式 Product
Plugin，也不选择正式 Markdown 编辑器。它只使用公开 `registerTab/openTab/closeTab`，在一个
custom Tab 中放置一条假的 FileRecord、受控文本输入和内存 revision store。内存 store 只
模拟 File Workspace/Core 对 UI 可观察的 read/save 语义，用来隔离 Better Sidebar host
契约；它不证明真实 Core transport、数据库事务或持久化耐久性。

同一 spike tarball 的 SHA-256 为
`ff89763b16b224842df4ded4c01af59daf33f4d02dec845f7768840d6bda0707`。stock DSH 和
Hermit bundled DSH 使用独立干净的 `DSH_HOME`/profile，安装相同 Better Sidebar tarball
和相同 spike tarball，并通过真实 Electron + Playwright 浏览器执行相同流程。

验证流程和结果：

1. 打开 `file-1` 的 `r1`，编辑后以 `r1` 为基线保存为 `r2`；FileRecord 身份不变，`r1`
   保留，dirty 清除。
2. 通过公开 `closeTab` 再 `openTab`，组件真实 unmount/remount，重新 read 后看到 `r2` 新内容，
   证明内容不依赖 Tab 内存保留。
3. 模拟持久化失败，确认不增加 revision、draft 保留、dirty 为 true；重试成功后得到 `r3`。
4. 编辑器仍基于 `r3` 时模拟外部推进到 `r4`，保存返回显式 conflict；不产生 `r5`、不覆盖
   `r4`、draft 保留、dirty 为 true。
5. 删除 spike 的 client bundle entry 并重启时，Better Sidebar 仍可独立启动；重新启用后
   相同流程再次通过，没有重复注册。
6. 通过官方插件命令分别卸载 spike 和 Better Sidebar 后，依赖和 bundle 均按预期清理，Core
   可继续启动。

| 运行环境 | 首次闭环 | 停用后重启 | 重新启用后复验 | 卸载 |
|---|---|---|---|---|
| stock DSH `0.1.1-rc.2` | PASS | PASS | PASS | PASS |
| Hermit bundled DSH `0.1.1-rc.2` | PASS | PASS | PASS | PASS |

最终浏览器结果保存在以下本地资格目录，均为 `status: PASS` 且 `pageErrors: []`：

- `.hermit/artifacts/file-workspace-better-sidebar/stock/`
- `.hermit/artifacts/file-workspace-better-sidebar/hermit-bundled/`
- `.hermit/artifacts/file-workspace-better-sidebar/stock-reenabled/`
- `.hermit/artifacts/file-workspace-better-sidebar/hermit-bundled-reenabled/`

最终状态故意停在冲突现场：编辑基线 `r3`、当前 revision `r4`、revision 总数 4、draft
`# Local conflict`、dirty 为 true、save status 为 conflict。这证明旧基线保存没有被伪装成
成功；它不是残留测试失败。

## 5. 安装与 Package Gate 观察

两套隔离 profile 首次执行官方插件安装都被 pnpm 11 的 build-script 审批门停止：
`node-pty@1.1.0` 是 Better Sidebar `0.16.1` 的直接依赖，未审核时出现
`ERR_PNPM_IGNORED_BUILDS`。资格过程只把自动生成的 `node-pty` 决策改为允许，然后使用
frozen lockfile 完成安装；没有使用全量批准、force、peer override 或 artifact patch。

因此 Package Gate 必须记录 `node-pty` 的精确解析版本、lock integrity、平台和 native build
结果。制品或 lock 更新后重新审核；出现额外未审 build script、native build 失败、必须全量
放行、force 或 patch 时直接失败。

隔离 profile 使用 `autoInstallPeers: false`，所以 profile-local peer 检查会报告 DSH/React peer
缺失。不能为了清除 warning 在 profile 安装第二份 React 或 DSH；也不能直接忽略。每个 warning
必须证明是 Host-provided 或 optional：runtime 版本满足声明范围、profile 没有第二份副本、
Client bundle externalize React/ReactDOM/DSH，并且 stock DSH 与 Hermit 真实运行均通过。

## 6. 最终裁决

| Gate | 结果 | 含义 |
|---|---|---|
| `BetterSidebar.ManagedDocumentSourceSave` | `NOT PROVIDED` | 内置 Viewer/Editor 不能保存 managed FileRecord |
| `BetterSidebar.PublicCustomTabHost` | `PASS` | 固定 0.16.1 制品可公开承载自定义工作面和生命周期 |
| `FileWorkspace.ManagedMarkdownHostingStrategy` | `RESOLVED` | Better Sidebar 承载 Tab，File Workspace/Core 拥有 tree、editor 和 revision save |

当前 Better Sidebar 阻塞项可以关闭，File Workspace DESIGN 可以进入
`READY_FOR_IMPLEMENTATION`。这不是“Better Sidebar managed save 通过”，而是确认它不提供
该能力，同时资格验证了一条不绕过公开边界的替代路径。

不继续扩大当前 spike。第一条正式 managed Markdown vertical slice 需要把内存 store 换成
真实 File Workspace/Core transport 和持久化，并复验成功保存、旧 revision 冲突、保存失败、
关闭重开和 disable/remove。正式 Markdown 编辑器、logical tree 实现、Better Sidebar 分栏
拖拽、导入、搜索和 projection 均未由本资格宣称完成。

## 7. 网页 GPT 独立复核

网页 GPT 只提供独立判断，最终结论以上游发布制品审计和本地实践证据为准：

- 初步架构判断：`e2eef3fb-8195-43c5-94e9-31b56eae787f`
- 最小资格方案复核：`db03c897-7ddf-4aaf-a149-a966a9f1ba98`
- 实践结果与最终裁决复核：`bce338f2-de57-4ced-be58-cfdfcbacd377`
