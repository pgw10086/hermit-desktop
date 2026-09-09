# Git 与 Hermit 打包入门

状态：current

这份文档写给刚开始使用 Git 和 Hermit 打包流程的同学。你不需要先学会所有 Git 命令，
先按本文的固定流程做，就能安全地开发、测试、提交和推送。

## 先记住五件事

1. 仓库：一个项目自己的 Git 目录。Hermit 的 Git 仓库是 hermit-desktop。
2. 工作区：你当前正在修改的文件。工作区有改动，不代表已经保存到 Git。
3. commit：给当前代码拍一张有名字的快照，只保存在本机 Git 历史里。
4. push：把本机的 commit 上传到 GitHub 远程仓库。
5. tag：给某个 commit 起一个版本名字，例如 v0.2.2，正式版本通常用它定位。

最容易混淆的一点是：

~~~text
修改文件  ->  git add  ->  git commit  ->  git push
工作区        暂存区       本地仓库         远程仓库
~~~

git add 不是提交，git commit 不是推送，git push 也不会替你检查代码是否正确。

## 当前项目目录怎么理解

~~~text
/Users/pgw/Developer/codes/hermit-platform/       普通父目录，不是 Git 仓库
├── hermit-desktop/                                Hermit Product Desktop，真正的 Git 仓库
├── plugin-organizer/                              独立插件仓库
├── plugin-file-workspace/                         独立插件仓库
├── plugin-smart-clipboard/                        独立插件仓库
└── ../platform-core/agent-desktop-core/           独立 Core 仓库
~~~

外层父目录只是为了把多个项目放在一起，不能在外层执行提交。需要提交 Hermit 时必须进入：

~~~sh
cd /Users/pgw/Developer/codes/hermit-platform/hermit-desktop
~~~

每个 sibling 仓库都有自己的 Git、版本、lockfile、测试和发布边界。Hermit 正式依赖的是
已经打好的 package/tarball，不是兄弟仓库的 src/ 目录。

## 每次开始工作先做三步

~~~sh
pwd
git status --short --branch
git branch --show-current
~~~

你要看懂的状态符号：

| 符号 | 意思 |
| --- | --- |
| M | 文件已经修改，但还没有提交 |
| ?? | 新文件，还没有加入 Git |
| A | 新文件，已经加入暂存区 |
| D | 文件被删除 |
| R | 文件被重命名 |
| 没有输出 | 工作区干净 |

查看具体改了什么：

~~~sh
git diff
git diff --cached
git diff --stat
git diff --name-status
~~~

不要一上来使用 git add .。如果工作区里有别人留下的修改，它会把所有内容一起放进提交。
优先使用明确的文件路径。

## 分支是什么

分支可以理解为“从某个版本分出来的一条独立道路”：

~~~text
main                         稳定主线
└── feature/product-build-automation   当前自动化打包工作
~~~

查看分支：

~~~sh
git branch -vv
~~~

创建新功能分支：

~~~sh
git switch main
git switch -c feature/my-task
~~~

分支名只是名字，不会自动发布，也不会自动合并到 main。

## commit、push 和远程仓库

### commit 是本地保存点

~~~sh
git add <明确的文件路径>
git diff --cached
git commit -m "feat: describe the change"
~~~

常用提交前缀：feat 新功能、fix 修复、docs 文档、test 测试、chore 配置工具、
refactor 重构。

### push 是上传到 GitHub

~~~sh
git remote -v
git push -u origin feature/my-task
~~~

origin 是远程仓库简称，-u 会记住当前分支的远程对应关系。以后在同一分支可以直接：

~~~sh
git push
~~~

本次自动化打包分支是 feature/product-build-automation，推送后不会自动合并到 main。

## 本项目的版本锁定方式

### platform-lock.json

platform-lock.json 就像 Maven 的 BOM，记录：

- Core、Runtime Adapter 和插件的名称、角色、版本；
- 来源仓库和完整 Git commit；
- 生产仓 lockfile 的 SHA-256；
- .tgz 制品路径和 SHA-256；
- Node、pnpm、Electron 和 DSH 版本批次。

版本号方便人阅读，Git commit 表示源码身份，SHA-256 表示实际文件字节。三者不是一回事。

### pnpm 文件是安装投影

pnpm 仍然需要 package.json、pnpm-workspace.yaml 和 pnpm-lock.yaml 才能安装。它们是
从 platform-lock.json 生成和校验出来的消费投影，不是另一份第一方版本事实。

如果要更换第一方制品，先修改产品锁，再执行：

~~~sh
node scripts/platform-lock.mjs sync
corepack pnpm install --lockfile-only --ignore-scripts
node scripts/platform-lock.mjs install --mode release
~~~

不要手动在多个 package.json 里分别改版本，然后让 pnpm 自己猜。

### runtime-bundle-manifest.json

这个文件只描述运行时怎么摆放和加载插件。插件版本、仓库、commit 和制品 SHA 统一看
platform-lock.json，不要在两个文件里各写一份。

## 三种产品打包命令

统一入口是 scripts/package-product.mjs。以下命令在 hermit-desktop/ 根目录执行。

### dev：日常开发

~~~sh
node scripts/package-product.mjs dev
~~~

允许缺少制品时按固定 commit 临时构建，随后执行 Desktop 测试、目录包和 packaged runtime
验证。适合本机快速验证，但不代表可以发布。

### candidate：测试候选

~~~sh
node scripts/package-product.mjs candidate
~~~

只使用已经锁定并校验过的制品，执行完整项目检查、native、runtime、三个 Product Surface、
目录包、packaged UI 和 DMG 挂载启动验证，生成未签名测试 DMG。

输出通常在：

~~~text
apps/desktop-vnext/dist/mac-smoke/Hermit-<version>-arm64.dmg
~~~

### release：正式候选

~~~sh
node scripts/package-product.mjs release --signing skip
node scripts/package-product.mjs release --signing required
~~~

它要求工作区干净，并要求版本 tag 指向当前 commit。skip 只跳过 Developer ID 签名、公证和
staple；required 要求完整签名和公证凭据。任一步失败都会停止，不会自动修改代码、移动 tag
或上传 GitHub Release。

--signing skip 不是“强行发布”，也不是“忽略错误”。它只决定签名策略。

## 打包报告在哪里

每次统一打包都会生成：

~~~text
.hermit/artifacts/builds/<version>/<profile>/<time>/build-manifest.json
~~~

报告记录产品版本、当前 commit、工作区是否干净、Node/pnpm/Electron、platform lock 摘要、
五个模块的版本和制品摘要、每一步 PASS/FAIL/SKIPPED、耗时，以及最终目录包或 DMG 的路径、
大小和 SHA-256。终端摘要是速览，build-manifest.json 是完整证据。

## 为什么正式发布要求干净工作区

如果本机有未提交修改：

~~~text
platform-lock 记录的是 A
Git 工作区实际是 A + 未提交修改
~~~

别人无法仅凭 Git commit 复现这个包，所以脚本会先检查：

~~~sh
git status --porcelain
~~~

只要有输出，release 就停止。--signing skip 不能绕过这个保护。

处理方式：

- 属于本次功能：测试后 git add、git commit；
- 暂时不想提交：保留修改，使用 candidate；
- 是错误修改：人工确认后再使用 git restore <file>；
- 不确定是谁的修改：不要删除，先查看 git diff。

## 为什么正式发布要求 tag

tag 是版本名字，例如 v0.2.2 指向某个确定 commit。如果你在 v0.2.2 发布后又改了代码，
不要把旧 tag 移到新 commit。正确做法是提升版本号，例如 0.2.3，提交新 commit，再使用
新的 v0.2.3 tag。

检查当前版本和 tag：

~~~sh
git rev-parse HEAD
git rev-list -n 1 v0.2.2
~~~

## 一套可以照抄的日常流程

~~~sh
cd /Users/pgw/Developer/codes/hermit-platform/hermit-desktop

# 看状态
git status --short --branch

# 新任务从 main 创建分支
git switch main
git switch -c feature/my-task

# 修改后检查
git diff --check
node scripts/platform-lock.mjs prepare --mode release
corepack pnpm test

# 日常打包
node scripts/package-product.mjs dev

# 精确暂存和检查
git add <file1> <file2>
git diff --cached

# 本地保存
git commit -m "feat: describe the change"

# 上传分支
git push -u origin feature/my-task
~~~

如果只是测试当前候选，不需要先 commit，可以直接运行：

~~~sh
node scripts/package-product.mjs candidate
~~~

## 哪些命令要小心

通常安全的只读命令：

~~~sh
git status
git log --oneline --decorate -10
git diff
git diff --cached
git branch -vv
git remote -v
~~~

需要特别小心的命令：

~~~sh
git restore <file>       # 丢弃某个文件未提交的修改
git reset                 # 可能改变暂存区或提交关系
git clean -fd             # 删除未跟踪文件和目录
git push --force          # 可能覆盖远程历史
git tag -d <tag>          # 删除本地 tag
git push origin :refs/tags/<tag>  # 删除远程 tag
~~~

不要用 git reset --hard 或 git clean -fd 来“解决 release 报错”。release 报错是在保护
你的修改。

## 常见问题对照表

| 现象 | 通常原因 | 先做什么 |
| --- | --- | --- |
| working tree is not clean | 有未提交修改 | git status --short |
| tag must point to current commit | 版本 tag 指向旧 commit | 检查版本号和 git rev-list -n 1 <tag> |
| Platform lock is stale | package 投影没有同步 | node scripts/platform-lock.mjs sync |
| Artifact missing | 锁定的 .tgz 不存在 | 开发用 dev，正式构建补齐制品 |
| SHA-256 mismatch | 文件内容被替换或清单过期 | 不要覆盖，先查来源 |
| Cannot find package | 最终 App 没有带入该 package | 检查 staging 和 app.asar |
| SKIPPED | 后续步骤没有执行 | 先找前面第一个 FAIL |
| DMG 已生成但启动失败 | 只证明打包器生成文件 | 重新检查挂载后的 App |

## 最后用一句话理解整个流程

~~~text
platform-lock 决定要哪些第一方字节
pnpm-lock 决定这些字节怎样和第三方依赖组成安装图
runtime manifest 决定运行时怎样摆放和加载
Product Desktop 负责组装 Hermit.app/DMG
Git commit 和 tag 决定这次构建能不能被别人复现
~~~

只要记住：**先看状态，再测试；先 commit，再 push；正式发布必须干净；不要删除看不懂的修改。**
