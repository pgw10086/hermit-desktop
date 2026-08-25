# 第一方产品插件

本 monorepo 初期拥有三个可独立打包的插件：

- `organizer/`；
- `file-workspace/`；
- `smart-clipboard/`。

可安装 artifact boundary 不要求独立 Git 仓库。Shared manifest、capability 和
runtime contract 经过 review 后，插件目录才进入产品实现。
