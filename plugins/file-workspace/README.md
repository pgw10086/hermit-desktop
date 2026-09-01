# File Workspace

File Workspace 是 Hermit 的单一 Product Surface：统一文件树、根层文件夹、managed 文件
生命周期、空正文快速记事和 Markdown 编辑。首版接受任意普通文件作为 managed copy；Markdown
可直接编辑，其他格式只显示可靠元数据，不伪造预览。

开发入口：先读[Product Plugin 开发规范](../development-guidelines.md)，再读[本插件设计](DESIGN.md)。
本插件不需要 Desktop Core；普通文件能力优先使用 DSH 公开 `storage`/`fs` 和浏览器文件选择。

Host 通过 DSH 公开的 `ctx.storage.domain` 持久化 FileRecord、ManagedBlob 和 revisions，
通过 `ctx.connection.rpc` 提供最小业务传输。Client 只使用 Product Surface、公开 UI
primitives、浏览器文件选择/拖放和 Connection RPC，不访问 Node、Electron、私有 DSH API
或宿主文件路径。

当前包完成 Slice 1/2，包括多选/拖放添加、冲突替换或跳过、进度取消、失败重试、文件夹
组织、Trash/恢复/永久删除和 managed Markdown revision 保存。`@文件` 的安全 projection
暂未启用，因为锁定的 DSH 制品没有公开 FileRecord projection 读取契约。代码不会用 path-only
或私有 API 伪造这一条链路。

```sh
corepack pnpm --filter @hermit/file-workspace test
corepack pnpm run test:file-workspace:product-surface
```
