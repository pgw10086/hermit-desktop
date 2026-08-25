# Native Platform

负责人：Native Platform。

计划中的根 Cargo workspace member 包括 Node runtime supervision、Tier 0 Rescue、
OS credential、clipboard bridge、parser isolation 和 desktop integration。Crate 必须
与第一份 reviewed protocol implementation 一起创建。

这里不提前建立空 crate，也不把平台特权能力暴露给产品插件；每个 crate 都必须
有明确的 contract、capability 边界和拒绝路径测试。
