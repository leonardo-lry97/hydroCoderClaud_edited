# IM 重构计划归档

> 最后更新：2026-06-08
> 状态：历史计划文档，已归档

本文档原本用于描述本轮 IM 全面重构的目标与中间方案。当前代码已经完成主链路落地，因此本文不再作为“现状说明”使用。

## 一、当前归档结论

本轮重构已完成的核心结果：

1. 三端主链路已统一到同一套业务判断模型
2. IM 会话统一使用 `type: 'chat'`
3. IM 入站创建统一使用 `source: 'im-inbound'`
4. 数据库存储统一使用 `im_channel / im_user_id / im_chat_id / im_chat_type`
5. 飞书已移除交互卡片主方案，命令改为文本 / Markdown 风格回复
6. 会话层旧字段与旧渠道 type 语义已退出当前设计

## 二、哪些内容已经过时

以下内容如果出现在旧方案描述中，应视为历史信息，而不是当前现状：

1. “继续保留旧字段兼容迁移”
2. “删除 `_targetSessionMap`”
3. “飞书继续以卡片为主”
4. “微信已纳入与三端同级统一闭环”
5. “`type` 仍可表示 IM 渠道”

## 三、请改看哪里

若要查看当前真实架构，请改看：

- [im-bridge-refactoring.md](./im-bridge-refactoring.md)
- [im-session-fields-and-binding.md](./im-session-fields-and-binding.md)

若要查看当前使用方式，请改看：

- [../user-guide/FEISHU-GUIDE.zh.md](../user-guide/FEISHU-GUIDE.zh.md)
- [../user-guide/DINGTALK-GUIDE.zh.md](../user-guide/DINGTALK-GUIDE.zh.md)
- [../user-guide/ENTERPRISE-WEIXIN-GUIDE.zh.md](../user-guide/ENTERPRISE-WEIXIN-GUIDE.zh.md)
- [../user-guide/IM-REGRESSION-CHECKLIST.zh.md](../user-guide/IM-REGRESSION-CHECKLIST.zh.md)
