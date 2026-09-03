# 固定平台制品

`hermit-desktop-core-0.1.0.tgz` 是 Hermit Desktop 当前消费的 Desktop Core 候选制品。

- package：`@hermit/desktop-core@0.1.0`
- SHA-256：`c91fe161d9e64b7be9daa8941881cef457f3ed3ba657fe29c81b7fb1d5057e13`
- 构建来源：[`desktop-core@990d74d`](https://github.com/pgw10086/desktop-core/commit/990d74dea0f4b5ca06931355065d84382b7edef4)

该 tarball 让干净安装不依赖 sibling 源码路径。正式发布前应替换为私有 registry 版本或由
发布清单锁定的正式制品，并重新记录摘要。

Hermit 当前还固定消费三个独立插件仓库的候选制品：

- `hermit-organizer-0.2.2.tgz`：`17bf9d1bcbeaed23fca6a7450856f95681942f01400d5770c07c7f17e8dd033c`，来源 [`1e4b0c6`](https://github.com/pgw10086/plugin-organizer/commit/1e4b0c69ec4b6b7afae37f0c614bb19309b053f2)
- `hermit-file-workspace-0.2.2.tgz`：`ecb1ef3f9477200f9437ab9c3cbf3f4a415d25958b5884c00b99803a22f5e347`，来源 [`fc1c83e`](https://github.com/pgw10086/plugin-file-workspace/commit/fc1c83e4b6337488d2b610feef4b6d377b3ae8a4)
- `hermit-smart-clipboard-0.2.2.tgz`：`0d33bebb4f7906714c201d4bce00f71bcea1cf2e8f24f5eab62b33d191a3d8a1`，来源 [`6068946`](https://github.com/pgw10086/plugin-smart-clipboard/commit/606894603ede431850d8d4c5d0c40bd5c398247f)

`apps/desktop-vnext/runtime-bundle-manifest.json` 是 runtime 使用这些制品和摘要的机器事实。
