# IM 命令卡片设计归档

> 最后更新：2026-06-08
> 状态：历史设计文档，已归档

本文档记录的是一条曾经考虑过的“IM 命令卡片统一”路线。当前实际实现已经改为：

1. 三端主链路共享命令语义
2. 命令结果以文本 / Markdown 风格为主
3. 不再以飞书交互卡片作为主链路基座

## 一、当前结论

当前若要了解 IM 命令系统，应以以下文件为准：

- [im-bridge-refactoring.md](./im-bridge-refactoring.md)
- [../user-guide/FEISHU-GUIDE.zh.md](../user-guide/FEISHU-GUIDE.zh.md)
- [../user-guide/DINGTALK-GUIDE.zh.md](../user-guide/DINGTALK-GUIDE.zh.md)
- [../user-guide/ENTERPRISE-WEIXIN-GUIDE.zh.md](../user-guide/ENTERPRISE-WEIXIN-GUIDE.zh.md)

## 二、为什么归档

本文中涉及的大量内容，如：

- card renderer
- card action adapter
- 三端模板卡片统一

都没有成为当前主链路的最终形态，因此保留为历史背景，不再作为现状文档使用。
