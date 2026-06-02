# IM 命令卡片统一设计

> Hydro Desktop v1.7.74+ | 设计时间：2026-05-28 | 最后更新：2026-06-01

## 实施状态

| 阶段 | 内容 | 状态 |
|------|------|:----:|
| 阶段一 | 飞书内部抽象 → presenter + plain text renderer + card renderer | ✅ 已完成 |
| 阶段二 | 钉钉接入统一命令卡片 | ❌ 未开始 |
| 阶段三 | 企业微信接入统一命令卡片 | ❌ 未开始 |
| 阶段四 | 普通微信接入统一文本 presenter | ❌ 未开始 |

**已完成部分**：
- ✅ `im-command-presenter.js` — 统一命令文本 presenter（被钉钉、飞书和企业微信共享）
- ✅ `im-command-policy.js` — 命令策略文本（help/status/close/rename 消息，被三渠道共享）
- ✅ `im-command-executor.js` — 命令分发框架（被钉钉、飞书和企业微信共享）
- ✅ `im-card-renderers/plain-text-renderer.js` — 纯文本 fallback renderer
- ✅ `im-card-renderers/feishu-card-renderer.js` — 飞书卡片 renderer（完整迁移：`buildHistoryChoiceCard`/`buildHelpCard`/`buildStatusCard`/`buildResultCard`/`buildCommandButton`/`chunkCardActions`/`attachCardContext`/`buildCardContextValue`，232 行）
- ✅ 飞书共享命令层接入 — `dispatchImCommand` + 全量共享模块（`im-command-policy`/`im-session-command-flow`/`im-session-decision`/`im-resume-post-action`），与卡片系统并行

**未完成部分**：
- ❌ 钉钉卡片 renderer 未创建
- ❌ 企业微信模板卡片 renderer 未创建
- ❌ `im-card-action-adapter.js` 未创建

---

本文定义外部 IM 命令菜单在飞书、钉钉、企业微信之间的统一卡片架构，并明确普通微信在该架构中的 fallback 位置。本文只定义设计与实施边界，不直接替代实现任务清单。

---

## 一、背景

当前外部 IM 桥接已经进入第二阶段问题：

1. 会话、绑定、图片、命令基础能力已经逐步打通
2. 飞书已经具备完整的卡片式命令菜单
3. 钉钉与企业微信仍主要停留在 Markdown / 文本菜单层
4. 普通微信采用 iLink 的文本/图片消息模型，不具备与飞书同等级的交互式卡片闭环

继续沿用当前结构，会出现三个问题：

- 同一类命令菜单在不同 IM 通道上持续分叉
- 飞书卡片逻辑会继续堆积在 `feishu-bridge.js` 内部，难以复用
- 钉钉和企业微信即使补齐卡片能力，也容易形成第二份、第三份平行实现

因此需要先定义一套统一的命令卡片架构，再分批实施。

---

## 二、目标

本设计的目标只有三个：

1. 统一外部 IM 命令菜单的语义层
2. 让飞书、钉钉、企业微信共享同一套卡片模型与动作语义
3. 为普通微信提供同语义的文本 fallback，而不是强行进入卡片闭环

统一对象限定为“命令类界面”，包括：

- 帮助菜单
- 系统状态
- 当前会话列表
- 历史会话选择
- 关闭会话后的结果菜单

---

## 三、非目标

以下内容不在本次统一范围内：

1. 普通 AI 回复全面卡片化
2. 飞书、钉钉、企业微信流式文本与卡片联动更新
3. 普通微信交互卡片化
4. 跨平台统一图片卡片格式
5. 一次性重写全部 IM bridge

本次统一只覆盖命令型菜单，不覆盖日常问答正文的展示形态。

---

## 四、平台能力结论

### 4.1 飞书

飞书已具备完整卡片实现：

- `FeishuEventClient` 已处理 `card.action.trigger`
- `FeishuBridge` 已具备卡片发送、按钮意图、命令回落
- `FeishuMessageAPI` 已具备 `sendCardMessage(...)`

因此飞书在本次设计中作为参考实现，不再扩展新能力，只抽象其通用结构。

### 4.2 钉钉

钉钉平台支持互动卡片，但当前实现仅使用：

- webhook markdown 回复
- `sampleText`
- `sampleImageMsg`

当前缺失的是：

- 卡片发送渲染层
- 卡片动作回调处理层
- 卡片动作到命令语义的适配层

结论：钉钉应接入统一卡片架构。

### 4.3 企业微信

企业微信当前实现主要使用 Markdown 和媒体消息，但本地 SDK `@wecom/aibot-node-sdk` 已明确提供：

- `replyTemplateCard`
- `replyStreamWithCard`
- `updateTemplateCard`
- `sendMessage(... template_card ...)`
- `event.template_card_event`

结论：企业微信应纳入统一卡片架构，但实施顺序放在钉钉之后。

### 4.4 普通微信

普通微信当前通道通过 `WeixinNotifyService` 的 `item_list` 发送文本和图片，消息项类型目前只有：

- 文本
- 图片

未形成交互卡片、按钮回调、卡片更新能力。

结论：普通微信不进入卡片闭环，只接入统一命令语义的文本 fallback。

---

## 五、统一架构

本设计不建议抽象出一个巨大的 `IMBridgeBase`。更合理的结构是将“命令菜单能力”拆成四层。

### 5.1 命令语义层

统一定义命令型界面需要表达的业务语义，而不是直接使用平台消息 JSON。

统一的命令菜单类型：

- `help`
- `status`
- `sessions`
- `history-choice`
- `close-result`
- `generic-result`

统一的动作语义：

- `help`
- `status`
- `sessions`
- `new`
- `resume`
- `close`

这一层的输出是与平台无关的中立模型。

### 5.2 Presenter 层

Presenter 负责把 bridge 当前上下文、活跃会话、历史会话、关闭结果等数据组织成统一模型。

建议新增模块：

- `src/main/managers/im-command-presenter.js`

建议输出结构：

```js
{
  kind: 'status',
  title: '系统状态',
  summary: '...',
  items: [],
  actions: [
    {
      label: '活跃会话',
      intent: 'sessions',
      variant: 'primary',
      payload: {}
    }
  ],
  context: {
    source: 'feishu',
    senderId: '...',
    senderName: '...',
    chatId: '...',
    chatType: 'p2p',
    chatName: '...'
  }
}
```

### 5.3 Renderer 层

Renderer 负责把统一模型渲染成平台消息体。

建议新增：

- `src/main/managers/im-card-renderers/feishu-card-renderer.js`
- `src/main/managers/im-card-renderers/dingtalk-card-renderer.js`
- `src/main/managers/im-card-renderers/enterprise-weixin-card-renderer.js`
- `src/main/managers/im-card-renderers/plain-text-renderer.js`

职责边界：

- 飞书 renderer 输出 interactive card JSON
- 钉钉 renderer 输出钉钉卡片消息体
- 企业微信 renderer 输出 `template_card`
- plain text renderer 输出文本菜单，供普通微信和所有平台 fallback

### 5.4 Action Adapter 层

按钮动作不能散落在各个 bridge 中解析。应统一适配成“命令语义”。

建议新增：

- `src/main/managers/im-card-action-adapter.js`

职责：

- 构建标准化 action value
- 将各平台回调动作统一还原为命令文本和上下文

目标输出：

```js
{
  commandText: '/resume 2',
  context: {
    senderId: '...',
    senderName: '...',
    chatId: '...',
    chatType: 'p2p',
    chatName: '...'
  },
  source: 'history-choice'
}
```

### 5.5 Bridge 接线层

各 bridge 保持各自的传输、鉴权、身份管理和会话绑定逻辑，不参与通用 JSON 构建。

Bridge 只负责：

1. 采集上下文与会话状态
2. 调用 presenter 生成统一模型
3. 调用 renderer 发送平台卡片
4. 在失败时回退到 plain text renderer
5. 接收平台动作回调并交给 action adapter
6. 将动作最终回落到现有 `_handleCommand(...)`

---

## 六、现有代码映射

### 6.1 飞书

飞书已具备完整闭环，且已完成阶段一迁移：

- `FeishuEventClient` 负责卡片动作入口
- `FeishuBridge._handleCardAction(...)` 负责动作转命令
- `FeishuBridge._handleCommand(...)` 是命令中心（现已接入 `dispatchImCommand`）
- `FeishuMessageAPI.sendCardMessage(...)` 负责卡片发送

**已迁移到 `im-card-renderers/feishu-card-renderer.js`**：
- `buildHistoryChoiceCard` / `buildHelpCard` / `buildStatusCard` / `buildResultCard`
- `buildCommandButton` / `chunkCardActions` / `attachCardContext` / `buildCardContextValue`

仍留在 `feishu-bridge.js` 内部（文本 fallback，尚未迁移到 presenter）：
- `_getHelpText()` / `_buildActiveSessionsText(...)` / `_buildStatusText(...)`

### 6.2 钉钉

钉钉当前命令语义已较完整，主要缺失卡片链路。

保留：

- `dingtalk-commands.js` 的命令中心和会话管理逻辑
- `dingtalk-bridge.js` 的 transport、消息解析、图片通路

新增：

- 钉钉卡片 renderer
- 钉钉卡片动作回调处理
- 钉钉动作到命令语义的统一适配

### 6.3 企业微信

企业微信能力足够，但当前实现还没有形成完整命令层和卡片事件层。

后续需要补：

- 命令型卡片发送入口
- `template_card_event` 处理
- 统一命令回落

### 6.4 普通微信

普通微信不接入卡片 renderer，只接入 presenter 和 plain text renderer。

---

## 七、分阶段实施计划

### 阶段一：飞书内部抽象，行为不变

目标：

- 落地 presenter
- 落地 plain text renderer
- 落地 feishu card renderer
- 将飞书现有卡片构建逻辑迁移到新模块

约束：

- 飞书现有行为不得变化
- 飞书命令卡片测试必须先补齐

### 阶段二：钉钉接入统一命令卡片

目标：

- 帮助菜单卡片
- 状态卡片
- 当前会话列表卡片
- 历史会话选择卡片
- 关闭会话结果卡片

约束：

- 普通聊天回复仍保持当前文本/图片模式
- 卡片发送失败必须 fallback 到文本

### 阶段三：企业微信接入统一命令卡片

目标：

- 使用 `template_card` 接入与飞书/钉钉同级的命令卡片

约束：

- 第一批不接 `replyStreamWithCard`
- 先做静态命令卡片，再考虑流式与卡片组合

### 阶段四：普通微信接入统一文本 presenter

目标：

- 让普通微信也复用统一的命令语义和文本菜单

约束：

- 不引入交互卡片机制

---

## 八、测试与回退策略

### 8.1 飞书回归

必须覆盖：

1. `/help` 卡片发送
2. `/status` 卡片发送
3. `/sessions` 卡片发送
4. 历史会话卡片动作恢复正确
5. close result 卡片动作正确
6. 卡片发送失败时文本 fallback 正常

### 8.2 钉钉新增

必须覆盖：

1. help/status/sessions/history-choice/close-result 五类卡片发送
2. 卡片动作回调正确落回现有命令语义
3. 单聊/群聊上下文不串
4. 发送失败 fallback 文本正常

### 8.3 企业微信新增

必须覆盖：

1. 模板卡片发送
2. `template_card_event` 回调
3. 卡片动作回落命令处理
4. 不影响现有 Markdown / 图片通路

### 8.4 回退策略

所有平台在卡片发送失败时必须退回到 plain text renderer 结果。

plain text renderer 是统一命令菜单的最低保底层，不允许绕过。

---

## 九、实施原则

1. 不做一次性大重写
2. 先抽飞书，再接钉钉，再接企业微信
3. transport、鉴权、session identity 继续留在各 bridge 内部
4. 只统一命令菜单，不统一所有 IM 正文展示
5. 普通微信只做文本 fallback，不纳入交互卡片闭环

以上原则在后续实现中优先级高于“形式上的完全统一”。
