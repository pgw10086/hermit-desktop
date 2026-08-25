# Package 规则

- 每个 package 必须在 `docs/repository-layout.md` 中声明 owner、layer、public face
  和允许的依赖方向；
- 公共 contract definition 与特权 provider implementation 必须分离；
- Capability 按 Definition、Provider、Consumer 建模，使用显式 service injection，
  不依赖隐藏的激活顺序；
- registration、timer、watcher、connection 和其他资源必须由 effect 管理并可确定性
  dispose；
- 只有 DSH adapter package 可以 import 批准的 DSH host/client contract；
- 新增 package 必须形成真实所有权边界，不能只为拆文件而创建。
