# 会话字段重构方案归档

> 最后更新：2026-06-08
> 状态：历史方案文档，已归档

本文档原本用于推进 `type / source / imChannel / IM DB 字段` 的重构。当前重构已落地，因此本文不再代表现状。

## 一、当前应以什么为准

当前真实模型请改看：

- [im-session-fields-and-binding.md](./im-session-fields-and-binding.md)
- [im-bridge-refactoring.md](./im-bridge-refactoring.md)

## 二、当前已落地结论

1. IM 会话统一使用 `type: 'chat'`
2. IM 入站创建统一使用 `source: 'im-inbound'`
3. 渠道识别统一使用 `imChannel`
4. 数据库存储统一使用 `im_channel / im_user_id / im_chat_id / im_chat_type`
5. `staff_id` / `conversation_id` 不再属于当前设计说明

## 三、为什么归档

本文中的大量描述属于当时的迁移中间态，例如：

- 旧字段兼容保留
- 旧列逐步替换
- 旧 `type/source` 判定向新模型迁移

这些已经不适合作为当前代码事实引用，因此保留为归档说明。
