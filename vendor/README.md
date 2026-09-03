# 固定平台制品

`hermit-desktop-core-0.1.0.tgz` 是 Hermit Desktop 当前消费的 Desktop Core 候选制品。

- package：`@hermit/desktop-core@0.1.0`
- SHA-256：`c265e4ab712abef330e2240659da644342d562d15dec238630e75befae30a37d`
- 构建来源：同级 `desktop-core/` 本地候选仓库

该 tarball 让干净安装不依赖 sibling 源码路径。正式发布前应替换为私有 registry 版本或由
发布清单锁定的正式制品，并重新记录摘要。

Hermit 当前还固定消费三个独立插件仓库的候选制品：

- `hermit-organizer-0.2.2.tgz`：`9f75a4e9c5309bfdd454a2886e8a352d79e65ad3754a4ee34d5cd42f712c224c`
- `hermit-file-workspace-0.2.2.tgz`：`00fb7646f92586d6cb13cb02d5b6e9db2fd18f09d39f5ea844b4333f58f5f9e3`
- `hermit-smart-clipboard-0.2.2.tgz`：`9f0a10a3ea1ae749dbb45034f7c0e2ac87341775d5d25503d9c53cfbcb182ba3`

`apps/desktop-vnext/runtime-bundle-manifest.json` 是 runtime 使用这些制品和摘要的机器事实。
