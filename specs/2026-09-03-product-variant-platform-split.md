# 新产品变体与 Desktop Core/DSH 平台拆分

状态：`superseded by ADR-0007`

更新时间：2026-09-03

本文记录一个已取消的新产品方案。它曾讨论新产品复用 Hermit Desktop Core 和 DSH 能力、但需要大幅调整
Conversation、Session、Settings、Approval 或导航交互时的候选架构。本文是方案和
迁移门槛，不覆盖现有 Hermit 产品需求。用户已确认本方案；本轮将先同步权威文档，再
创建同一父文件夹下的 sibling Git 仓库。旧 `hermit-vnext` 保留为迁移源和回滚参考，直到
所有独立仓库完成构建和集成验收。该方案已由
[ADR-0007](../docs/adr/0007-agent-desktop-core-runtime-adapters.md) 取代，当前只保留作历史追溯。

## 1. 背景和问题

现有 Hermit vNext 已经把 Electron Desktop、DSH 和 Product Plugin 的逻辑职责分开，但
当前代码仍由一个 Git 仓库、一个 pnpm workspace 和一个 Desktop 应用统一装配。新产品
希望继续使用已经验证的桌面能力和 DSH 运行时，同时拥有不同的产品界面、导航和交互。

如果新产品只作为现有 Hermit 的一个插件，Hermit 的主窗口、导航、Settings 和 DSH
交互会逐渐被新产品的条件分支污染；如果直接复制整个 Desktop 或 DSH，又会产生两套
生命周期、安全边界、Session 状态和运行时修复，后续很难保持一致。

本方案要解决的是“共享平台能力、隔离产品体验”，不是为了仓库数量而拆仓。

## 2. 目标

- 让新产品可以复用 Desktop Core 的窗口、系统能力、安全和生命周期接口；
- 让新产品可以复用固定兼容的 DSH 基础能力；
- 让新产品独立拥有自己的产品壳、导航、Conversation/Session 组合、Settings 和
  Approval 交互；
- 新产品的 UI 改动不改变 Hermit 当前产品行为；
- Hermit 和新产品可以独立构建、测试、版本、打包和发布；
- 跨产品共享通过版本化 typed contract 和真实制品完成，不通过源码互引完成。

## 3. 非目标

- 不为了新产品提前建设通用 `desktopAPI`、任意 IPC 或万能插件平台；
- 不把 DSH 私有 Router、Store、DOM、CSS 或 React root 暴露给产品插件；
- 不在两个产品之间复制 Session、Approval、模型凭据或业务数据库；
- 不在没有真实使用者前创建 `ui-patterns`、`ui-desktop` 等空的公共仓库；
- 初始物理拆仓不包含远端写入；用户在本地验证通过后另行授权创建并 push 当前 Hermit、
  Desktop Core 和三个插件的私有 GitHub 仓库。仍不在本方案中发布 package、tag、Release
  或签名制品。

## 当前进度

- 已创建独立 sibling `desktop-core` 仓库，提供中性的 `@platform/agent-desktop-core` package；
  通用 Surface、快捷键、deadline、notification、evidence、生命周期和受信 IPC 能力已移入
  其中，Electron 原生通知工厂通过显式子路径加载。
- 已从桌面主进程抽出 `HermitProductComposition`，集中装配 Hermit 的 Conversation Quick、
  Organizer、File Workspace 和 Smart Clipboard；主进程保留平台生命周期编排。
- 已用本地资格工具链 Node 24.13.1 完成 Core 构建和 20 项 Core 测试，并完成桌面构建、
  83 项 Desktop 测试、Organizer/Conversation packaged 流程和仓库级测试。
- 现有 Hermit 的 Conversation、Session、Settings、Approval 和导航交互继续由已验证的
  DSH layout 提供；新产品的具体交互稿、状态语义和验收场景尚未确定，因此没有把 Hermit
  页面复制成第二套实现。当前 runtime manifest 和 after-pack 门禁要求一套运行时内所有
  consumer 使用同一份 `@deepseek-ai/dsh-client-ui-layout` 制品，所以新产品若替换核心
  页面，必须拥有自己的 layout 制品和 DSH generation，不能在 Hermit generation 里共存两套。
- 已在普通父文件夹 `hermit-platform/` 下创建 `desktop-core`、`hermit-desktop`、
  `new-product-desktop`、`plugin-organizer`、`plugin-file-workspace` 和
  `plugin-smart-clipboard` 六个本地独立 Git 仓库；父文件夹不是 Git 或 pnpm workspace。
- 独立 Desktop Core 已通过 20 项测试并生成 `agent-desktop-core-0.1.0.tgz`（包名
  `@platform/agent-desktop-core@0.1.0`）；
  Hermit Desktop 已改为从固定 Core/插件 tarball 构建，不再包含三个插件源码目录，并通过
  全仓门禁、83 项 Desktop 测试、三个 Product Surface 资格和 macOS arm64 目录包 after-pack。
- 新产品仓库当前是可运行的 stock DSH 开发底座，已验证独立 profile 以及通过同一 Desktop
  Core 启动、HTTP ready 和停止真实 DSH；正式产品名称、Layout 和打包仍待产品设计。
- 三个插件仓库分别完成独立 lockfile、构建、测试和 pack；它们通过固定 Hermit Layout
  tarball 获取公开扩展类型，不再使用 `../../packages/...` 源码路径。
- Smart Clipboard 的 SQLite、捕获编排、业务 IPC 和 native bridge 先留在 Hermit Desktop
  的产品专属适配层，不进入共享 Desktop Core；完成公开 desktop-adapter contract 后再迁移。
- 当前项目的 `desktop-core`、`hermit-desktop` 和三个插件仓库已创建为
  `github.com/pgw10086/*` 私有仓库并 push `main`；`new-product-desktop` 按用户要求只保留在
  本地，不属于本次上传范围。

## 4. 产品形态判断

新产品的边界由 UI 改动的范围决定：

| 变化范围 | 推荐形态 | DSH 处理方式 |
| --- | --- | --- |
| 只增加业务页面和业务动作 | 独立 Product Plugin | 复用当前 DSH 和 Desktop Core |
| 改主工作区、产品入口、品牌、菜单或设置组合，但保留 DSH Session/Tool/Approval 语义 | 独立 Product Desktop App | 复用 DSH 基础包，使用新产品自己的 layout/composition |
| 改 Conversation、Session、Settings、Approval 或导航的核心流程，但不改变 DSH 数据模型 | 独立 DSH layout/source patch generation | 固定上游 DSH commit，补公开 typed contract |
| 改 DSH 私有状态模型、协议或运行时语义 | 独立 DSH Web fork 和独立 Desktop App | 建立自己的上游同步、patch queue、资格和发布链路 |

本项目当前采用的候选判断是“第二种起步、第三种落地”：先创建独立的 Product Desktop，
但只要新产品确实替换 Conversation、Session、Settings、Approval 或导航的核心页面，就
同步创建自己的 layout 制品和 DSH generation。这个 generation 可以复用同一个上游 DSH
commit 和数据语义；只有要改变 DSH 私有状态、协议或运行时语义时，才升级为 fork。

主题只能解决颜色、图标、字号和品牌资源。结构性改变不能伪装成主题覆盖。

## 5. 目标分层

```text
共享平台层
  Desktop Core runtime + Desktop Core typed contracts
  DSH 基础 runtime + 每个产品各自经过验证的兼容 generation
  安全、生命周期、打包和资格测试

产品层
  Hermit Desktop + Hermit layout/composition + Hermit plugins
  New Product Desktop + New Product layout/composition + New Product plugins
```

## 新产品交互基线（待确认）

下面是新产品在不复制 DSH 状态的前提下，建议先采用的交互基线。它们是实现前的验收
假设，不代表当前 Hermit 已经切换到这些表现。

| 交互 | DSH 继续拥有的事实 | 新产品可以改变的表现 |
| --- | --- | --- |
| Conversation | 消息、流式响应、输入草稿、Tool 结果和当前 Session | 页面结构、消息分区、输入区布局、空状态和品牌视觉 |
| Session | Session id、历史、当前选择、创建/打开/恢复和持久化 | 列表入口、筛选/分组方式、从业务页面回到 Conversation 的路径 |
| Settings | DSH 运行时设置、Provider/模型、插件生命周期和权限相关设置 | 新产品自己的偏好页、入口位置和设置分组；不复制 DSH 配置存储 |
| Approval | PendingWait、审批 key、工具调用和响应结果 | 审批卡片、独立审批窗口、文案和确认按钮；不在产品层伪造第二套审批状态 |
| 导航 | Session 的真实切换和 DSH 页面生命周期 | 产品入口、工作区顺序、返回 Conversation 的表现和品牌导航 |

建议的第一版验收场景：

1. 新产品从自己的入口打开 Conversation，发送消息后仍能在同一个 DSH Session 中看到流式
   响应和历史；刷新或重启不会产生第二份 Session 记录。
2. 从 Session 列表、搜索结果或业务页面打开会话时，产品工作面先关闭，再回到该 Session；
   重复点击同一 Session 也不能制造第二份导航状态。
3. DSH Settings 仍可正常打开；新产品偏好单独存放并有自己的入口，不能把产品设置写进
   DSH 私有配置格式。
4. Tool 需要确认时，Approval 可以显示在独立 Surface；允许、拒绝、关闭和 DSH 重启后都
   只有一个真实 PendingWait，不能出现“界面显示已允许但工具仍在等待”的假状态。
5. 产品导航在 Conversation、Settings 和 Product Surface 之间切换时只有一个 active 事实，
   不通过 URL、DOM 或私有 Router 复制一份选择状态。

若新产品需要改变上表左侧的事实，而不仅是右侧表现，就不再是普通 layout 变体，必须先
升级为新的 DSH generation 或 fork 方案，并新增 Session/Approval 兼容性资格。

### 5.1 Desktop Core 平台层

Desktop Core 只拥有 Electron 和操作系统能力：窗口、Surface、Tray、快捷键、通知、
系统剪贴板、生命周期、受控 IPC、DSH 进程监管和打包。对外只提供小而稳定的 typed
facade，不暴露 BrowserWindow、Node、native handle 或通用 IPC。

当前 `apps/desktop-vnext` 还包含 Hermit 的产品装配和 Smart Clipboard 专属运行代码。
后续拆分时，应先把通用能力与 Hermit 产品装配分开，再让两个产品分别组合平台能力。

### 5.2 DSH 平台层

DSH 继续拥有 Conversation、Session、Tool、Skill、Approval、Settings 和插件运行时。
每个产品的 DSH generation 必须由上游 commit、lockfile、source patch 摘要和 runtime
manifest 共同确定；两个产品可以复用同一个上游 DSH commit 和数据语义，但不能在同一套
runtime 里混用两份 layout 制品。

Hermit 和新产品如果只需要不同页面，可以分别拥有 layout/composition package，并分别生成
自己的 DSH layout 制品。不能让新产品直接修改 Hermit 当前的 layout patch；当前 manifest
只登记一份 layout package，after-pack 也会拒绝不同 consumer 解析到不同字节。

### 5.3 产品层

每个产品拥有自己的 App、产品导航、页面组合、插件清单、品牌和发布版本。业务插件
拥有自己的业务数据、规则、Host、Client、Tool 和页面；它们只依赖公开 DSH/Hermit
contract，不依赖任一产品 App 的内部文件。

## 6. 候选仓库结构

仓库可以在同一个父目录中并排存在，但每个仓库拥有自己的 Git、lockfile、构建和发布
流程：

```text
hermit-platform/
├── desktop-core/              # 共享平台能力和公共 contract
├── hermit-desktop/            # Hermit 产品 App 和产品装配
├── new-product-desktop/       # 新产品 App 和产品装配
├── new-product-dsh-layout/    # 新产品自己的 DSH layout/source patch（必要时）
├── plugin-organizer/          # 现有业务插件
├── plugin-file-workspace/     # 现有业务插件
├── plugin-smart-clipboard/    # 现有业务插件及其产品专属桌面适配
├── new-product-plugin-*/      # 新产品业务插件
└── integration/               # 可选：跨仓库版本清单、E2E 和发布编排
```

`dsh-client-ui-layout` 和 `dsh-plugin-reference` 初期跟随平台或集成发布，不单独创建仓库。
只有它们出现独立负责人、独立更新节奏和多个外部宿主后，才评估继续拆分。

Smart Clipboard 的 SQLite、捕获编排、业务 IPC 和 macOS bridge 属于产品专属部分，迁移
时应重新确认是否放入 Smart Clipboard 的 desktop-adapter；Desktop Core 只保留通用系统
能力。这个归属在代码迁移前必须明确，不能靠仓库移动后再猜。

## 7. 依赖和制品规则

- 正式依赖使用发布后的 package 版本或固定 `.tgz`，不使用 `workspace:*`、`link:`、
  `file:../` 或兄弟源码相对路径；
- 每个仓库维护自己的 lockfile；集成仓库另有一份锁定全部产品候选的 lockfile；
- 插件先独立执行 build/test/pack，再由产品 App 消费同一份带 SHA-256 的制品；
- DSH stock 和 bundled 宿主必须使用同一个插件制品进行资格测试；
- Desktop 发布清单记录 Desktop Core、DSH generation、layout package、插件版本、
  commit 和制品摘要；
- 本地快速开发可以使用本地制品目录，但正式 CI 和发布不能依赖开发机目录结构；
- React、ReactDOM、DSH runtime 由宿主统一提供，避免重复实例和客户端图不一致。

## 8. 防止两个产品互相污染

1. 新产品的产品壳、导航、Settings 和 layout 只能在新产品仓库修改；
2. 共享平台只接受与两个产品都有关的能力，不接受单一产品的业务 UI；
3. 公共 contract 单独版本化，破坏性变化必须升级版本并运行消费者兼容测试；
4. DSH source patch 必须绑定明确的上游 commit 和 generation，Hermit 与新产品可以拥有
   不同 generation，但不能无记录地各自修改同一份运行时；
5. 每个产品用自己的 DSH profile/home 和数据根，不共享业务数据库或 Session 数据；
6. 目录、架构和安全文档只保留一个事实负责人，产品仓库只链接公共规则，不复制一套。

## 9. 迁移顺序

### 阶段 0：先做边界整理

- 把新产品的 UI 改动按“业务页面、产品壳、DSH 核心交互”分类；
- 从 `apps/desktop-vnext` 识别通用 Desktop Core 和 Hermit 专属装配；
- 为 Desktop Core 建立独立 contract 和 clean-install 验证；
- 让当前插件可以生成真实 `.tgz`，并用制品而不是源码路径做一次集成构建。

### 阶段 1：建立平台消费方式

- 发布 Desktop Core contract/package 的候选版本；
- 将 runtime manifest 从源码路径改为 package/version/hash 输入；
- 建立 Hermit 产品 App 对平台 package 和插件 artifact 的集成构建；
- 不改变 Hermit 当前用户界面和业务行为。

### 阶段 2：创建新产品 App

- 新产品从独立 App 仓库开始，不复制 Hermit 产品页面；
- 先复用同一上游 DSH commit 和同一 Desktop Core contract；如果替换核心页面，就使用新产品
  自己的 DSH layout generation；
- 新产品 UI 通过自己的 layout/composition 和 Product Plugin 实现；
- 新产品单独运行 packaged smoke、DSH session、approval 和导航流程。

### 阶段 3：必要时建立新的 layout generation 或 DSH fork

- 新产品替换核心页面时建立自己的 layout/source patch generation；只有公开 layout/slot/typed
  service 仍无法表达需求时，才继续扩大 source patch；
- patch 必须通过 license/notice、依赖、双宿主、React singleton 和生命周期资格；
- 如果必须修改 DSH 私有语义，则升级为独立 fork，不把 fork 伪装成普通插件能力。

## 10. 正式拆仓门槛

以下清单是“可正式发布的完整多产品体系”门槛，不等同于本轮已经完成的物理拆仓：

- Desktop Core 的干净 checkout 不需要 Hermit 或新产品源码即可构建；
- 两个产品都能消费同一个已发布的 Desktop Core package；
- 插件可单独构建、测试、打包和回读制品；
- stock/bundled DSH 使用同一制品完成资格测试；
- 源码中没有跨仓库相对引用、`workspace:*` 或开发机路径依赖；
- UI 变化可以在产品仓库完成，不需要修改另一个产品的页面；
- 每个产品的 lockfile、runtime manifest、版本和 SHA-256 都可追溯；
- 关键 Conversation、Session、Settings、Approval 和导航流程在目标产品的 packaged
  App 中通过；
- 至少连续两次完整集成候选可以从干净环境重建。

## 11. 已确认决定和仍待产品设计的内容

已经确认：新产品沿用 DSH 底层 Session/Tool/Approval 等语义，但拥有自己的页面组合和
Layout generation；两个产品共用版本化 Desktop Core；仓库使用 `desktop-core`、
`hermit-desktop` 和 `new-product-desktop` 名称；暂不创建 integration 仓库；Smart Clipboard
桌面专属能力先留在 Hermit 产品边界，插件拆仓时再随插件迁移。

尚未确认的是新产品本身的名称、品牌、具体交互稿、业务插件清单和额外系统权限。这些信息
影响产品实现和正式包名，但不阻塞先建立可运行的独立仓库基础。新产品具体页面仍需按交互
基线逐项验收，不能把本架构确认当成页面已经完成。
