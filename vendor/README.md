# 固定平台制品

`vendor/platform/<module>/<sha256>.tgz` 保存 Hermit Product Desktop 当前锁定的第一方
Core、Runtime Adapter 和 Product Plugin 制品。

这里的目录和文件名按制品内容寻址：同一路径不得替换成不同字节。package name、版本、来源
repository、完整 commit、生产仓 lockfile 摘要和 tarball SHA-256 的唯一事实源是仓库根目录的
[`platform-lock.json`](../platform-lock.json)，本文不复制容易漂移的制品清单。

更新第一方组合时执行：

```sh
node scripts/platform-lock.mjs sync
corepack pnpm install --lockfile-only --ignore-scripts
node scripts/platform-lock.mjs install --mode release
```

`sync` 根据产品锁生成桌面 `package.json` 的 `file:` 投影和根 `overrides`。正式安装、测试和
打包只使用产品锁声明且摘要匹配的 `.tgz`；不得使用 sibling 源码目录、`link:` 或
`workspace:` 代替制品。开发态缺包恢复只有在重新构建的 tarball 与锁定 SHA 完全一致时才会
接纳，否则必须走一次显式的产品锁升级。

正式 registry 建立后，可以把制品获取位置迁移到 registry，但缓存、下载文件和最终消费的
字节仍必须与 `platform-lock.json` 的 SHA-256 一致。
