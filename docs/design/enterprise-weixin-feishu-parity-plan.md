# 企业微信对齐飞书计划归档

> 最后更新：2026-06-08
> 状态：历史计划文档，已归档

本文档原本用于推进“企业微信能力对齐飞书”。当前相关能力已经落地，因此本文不再代表现状。

## 一、当前归档结论

企业微信目前已经达到本轮目标范围内与飞书一致的用户可见现象：

1. 入站建会话
2. 历史选择与 `/resume`
3. `/status`
4. `/new`
5. `/close`
6. 主动绑定后入站复用
7. 解绑防复活
8. 桌面介入回传

## 二、仍保留的平台差异

以下差异属于平台实现差异，不是当前功能缺口：

1. 企业微信保留原生 `replyStream` 流式回复
2. 企业微信联系人主动发送依赖 `wecom-cli`
3. 企业微信群显示名可能来自本地 alias / known chat 名称

## 三、请改看哪里

当前现状请改看：

- [im-bridge-refactoring.md](./im-bridge-refactoring.md)
- [../user-guide/ENTERPRISE-WEIXIN-GUIDE.zh.md](../user-guide/ENTERPRISE-WEIXIN-GUIDE.zh.md)
