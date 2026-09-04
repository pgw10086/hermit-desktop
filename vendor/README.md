# 固定平台制品

`platform-desktop-core-0.1.0.tgz` 是 Hermit Desktop 当前消费的 Desktop Core 候选制品。

- package：`@platform/desktop-core@0.1.0`
- SHA-256：`cf88a01fcd3009a883ddbe6fac48d6d418ccea24b5f50963e363dd7844781663`
- 构建来源：[`desktop-core@8dcfc8d`](https://github.com/pgw10086/desktop-core/commit/8dcfc8d4c6964338ed4f7b3680b2b0ad8e783850)

该 tarball 让干净安装不依赖 sibling 源码路径。正式发布前应替换为私有 registry 版本或由
发布清单锁定的正式制品，并重新记录摘要。

Hermit 当前还固定消费三个独立插件仓库的候选制品：

- `hermit-organizer-0.2.2.tgz`：`17bf9d1bcbeaed23fca6a7450856f95681942f01400d5770c07c7f17e8dd033c`，来源 [`1e4b0c6`](https://github.com/pgw10086/plugin-organizer/commit/1e4b0c69ec4b6b7afae37f0c614bb19309b053f2)
- `hermit-file-workspace-0.2.2.tgz`：`ecb1ef3f9477200f9437ab9c3cbf3f4a415d25958b5884c00b99803a22f5e347`，来源 [`fc1c83e`](https://github.com/pgw10086/plugin-file-workspace/commit/fc1c83e4b6337488d2b610feef4b6d377b3ae8a4)
- `hermit-smart-clipboard-0.2.2.tgz`：`0d33bebb4f7906714c201d4bce00f71bcea1cf2e8f24f5eab62b33d191a3d8a1`，来源 [`6068946`](https://github.com/pgw10086/plugin-smart-clipboard/commit/606894603ede431850d8d4c5d0c40bd5c398247f)

`apps/desktop-vnext/runtime-bundle-manifest.json` 是 runtime 使用这些制品和摘要的机器事实。
