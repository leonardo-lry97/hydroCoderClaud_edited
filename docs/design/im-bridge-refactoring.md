# IM Bridge 架构文档

> v1.7.74 → HEAD | 最后更新：2026-06-01

## 一、架构概览

IM Bridge 系统负责将外部 IM 平台（钉钉、飞书、企业微信、个人微信）接入 Hydro Desktop，使 Agent 会话能通过 IM 渠道进行双向交互。

### 1.1 分层架构

```
┌──────────────────────────────────────────────────────┐
│                    UI 层 (Renderer)                    │
│  ChatInputToolbar  │  Settings Pages  │  AgentLeftContent │
│  (IM 快速发送按钮)  │  (各渠道配置页)   │  (IM 会话筛选)     │
└────────────────────────┬─────────────────────────────┘
                         │ IPC (contextBridge)
┌────────────────────────┴─────────────────────────────┐
│                  IPC Handler 层                       │
│  im-bridge-handlers (共享工厂)  │  渠道专属 handlers      │
│  getStatus/start/stop/restart/  │  listTargets/bind/    │
│  setEnabled/updateConfig/sendText│  unbind/getBinding    │
└────────────────────────┬─────────────────────────────┘
                         │
┌────────────────────────┴─────────────────────────────┐
│                Bridge 实现层 (主进程)                   │
│                                                       │
│  ┌──────────────┐  ┌──────────┐  ┌─────────────────┐  │
│  │ DingTalk     │  │  Feishu  │  │ EnterpriseWeixin│  │
│  │ Bridge       │  │  Bridge  │  │    Bridge       │  │
│  │ (Stream SDK) │  │ (SDK WS) │  │  (aibot SDK WS) │  │
│  └──────┬───────┘  └────┬─────┘  └───────┬─────────┘  │
│         │               │                │             │
│  ┌──────┴───────────────┴────────────────┴─────────┐  │
│  │            共享命令层 (Shared Command Layer)      │  │
│  │  im-command-executor │ im-command-policy         │  │
│  │  im-command-presenter│ im-session-command-flow   │  │
│  │  im-session-decision │ im-session-selectors      │  │
│  │  im-resume-post-action                           │  │
│  └──────────────────────────────────────────────────┘  │
│                                                       │
│  ┌──────────────────────────────────────────────────┐  │
│  │            共享基础层 (Shared Foundation)          │  │
│  │  ImSessionMapper │ ImReplyCollector              │  │
│  │  ImFrontendNotifier │ im-utils                   │  │
│  └──────────────────────────────────────────────────┘  │
└────────────────────────┬─────────────────────────────┘
                         │
┌────────────────────────┴─────────────────────────────┐
│                 数据层 (DB / Config)                   │
│  agent-db.js (im_channel, im_user_id)                │
│  session-database.js (Schema 迁移)                    │
│  config-manager.js (dingtalk/feishu/enterpriseWeixin) │
└──────────────────────────────────────────────────────┘
```

### 1.2 渠道能力矩阵（当前实际状态）

| 能力 | 钉钉 | 飞书 | 企业微信 | 个人微信 |
|------|:----:|:----:|:-------:|:-------:|
| 入站消息 | Stream | 长连接 | 长连接 | 轮询 |
| 回复消息 | webhook POST | REST API | WS 流式 replyStream | ilink API |
| 流式回复 | markdown 分段 | 逐条 sendMessage | 原生 replyStream | ❌ |
| 主动推送 | batchSend API | createMessage API | sendMessage WS | ilink API |
| 图片收发 | ✅ | ✅ | ✅ (含解密) | ✅ |
| 命令系统 (/help, /status, /sessions 等) | ✅ 共享层 | ✅ 飞书原生 | ✅ 共享层 | ❌ |
| 历史会话选择 | ✅ | ✅ | ✅ | ❌ |
| 桌面介入回传 | ✅ | ✅ | ✅ | ✅ |
| IM 快速发送 | ✅ | ✅ | ✅ | ✅ |
| 会话绑定/解绑 | ✅ | ✅ | ✅ | ✅ |
| DB 持久化 | ✅ | ✅ | ✅ | ✅ |
| 交互卡片 | ❌ (文本) | ✅ (飞书卡片) | ❌ (文本) | ❌ |
| 联系人列表 | 组织 API | 组织 API | wecom-cli | ilink 好友 |
| SDK 合规 | 部分 (REST 手写) | ✅ | ✅ | N/A |
| 共享命令层接入 | ✅ | ❌ (自有卡片) | ✅ | ❌ |

---

## 二、共享命令层（核心架构）

共享命令层是本轮重构的核心成果，将钉钉和企业微信的命令处理逻辑统一为 7 个共享模块。

### 2.1 模块职责

```
src/main/managers/
├── im-command-executor.js    ← 命令分发 + status/sessions/close/rename 解析
├── im-command-policy.js      ← 帮助文本、提示消息、cwd 解析、历史合并
├── im-command-presenter.js   ← 菜单文本构建（历史选择、活跃会话、状态、帮助）
├── im-session-command-flow.js← 激活新会话 + resume 选择解析
├── im-session-decision.js    ← 会话路由决策（当前/绑定/历史/新建）
├── im-session-selectors.js   ← 会话筛选、映射管理、清理
├── im-resume-post-action.js  ← resume 后的激活后处理
```

### 2.2 命令分发流程 (dispatchImCommand)

```
IM 消息以 / 开头
  → bridge._handleCommand(text, context)
    → dispatchImCommand({ text, normalizeText, beforeExecute, handlers, onUnknown })
      → beforeExecute: 清理 pendingChoice（命令是独立操作）
      → handlers[command]({ command, args }):
          help    → buildImCommandHelpText()
          status  → buildHistoryChoiceMenuText() 或 buildNoHistoryText()
          sessions→ buildSharedSessionsText()
          close   → resolveCloseCommand() + agentSessionManager.close()
          new     → resolveCommandCwd() + createSession() + activateNewSession()
          resume  → resolveResumeSelection() + reopen/handleChoice()
          rename  → resolveRenameCommand() + agentSessionManager.rename()
      → onUnknown: buildUnknownCommandText()
    → bridge._sendTextReply() 或 bridge._replyToDingTalk()
```

### 2.3 会话路由决策 (ensureHistoryChoiceOrCurrent)

```
收到非命令消息
  → resolveStrictCurrentSessionId(mapper, mapKey)
    → 内存 sessionMap 中有 → use_current
    → 内存中无
      → resolveBoundSessionId() 有绑定 → use_bound
      → _queryHistorySessions() 有历史 → show_choice（发送选择菜单）
      → 无历史 → create_new
```

### 2.4 各 Bridge 共享层接入状态

| 共享模块 | 钉钉 | 飞书 | 企业微信 | 个人微信 |
|---------|:----:|:----:|:-------:|:-------:|
| im-command-executor | ✅ | ❌ 自有 | ✅ | ❌ |
| im-command-policy | ✅ | ❌ | ✅ | ❌ |
| im-command-presenter | ✅ | ✅ 部分 | ✅ | ❌ |
| im-session-command-flow | ✅ | ❌ | ✅ | ❌ |
| im-session-decision | ❌ 内联 | ❌ 内联 | ✅ | ❌ |
| im-session-selectors | ✅ | ❌ | ✅ | ❌ |
| im-resume-post-action | ❌ | ❌ | ✅ | ❌ |
| ImSessionMapper | ❌ 自有 | ✅ | ✅ | ❌ |
| ImReplyCollector | ❌ 内联 | ✅ | ✅ | ❌ |
| ImFrontendNotifier | ✅ | ✅ | ✅ | ❌ |
| im-utils | ✅ | ✅ | ✅ | ✅ |

---

## 三、各 Bridge 实现详情

### 3.1 钉钉 (DingTalk Bridge)

**文件**：`src/main/managers/dingtalk-bridge.js` (1568行) + `dingtalk-commands.js` (422行) + `dingtalk-image.js`

**连接方式**：`dingtalk-stream-sdk-nodejs` WebSocket Stream

**命令层**：已接入共享命令层（`dingtalk-commands.js` 从 bridge 提取为 mixin）
- 使用 `dispatchImCommand` 进行命令分发
- 使用共享 `resolveCloseCommand` / `resolveRenameCommand` / `activateNewSession` / `resolveResumeSelection`
- 自有实现：`_getActiveSessionsByConversation()` (使用 `createActivatedSessionMatcher` + `listChatSessions`)
- 自有实现：`_cmdStatus` / `_cmdSessions` / `_cmdClose` / `_cmdNew` / `_cmdResume`

**回复通道**：sessionWebhook URL（一次性 HTTP POST）
- `_replyToDingTalk(webhook, text)` → markdown POST
- `_sendCollectedImages()` → 上传图片 → API 发送

**未接入共享层**：
- `ImSessionMapper`：使用自有 `sessionMap` + `_pendingChoices`
- `ImReplyCollector`：使用内联 collector（因为 webhook 管道差异）
- `im-session-decision`：内联实现确保逻辑

### 3.2 飞书 (Feishu Bridge)

**文件**：`src/main/managers/feishu-bridge.js` (1288行) + `feishu-event-client.js` + `feishu-message-api.js`

**连接方式**：`@larksuiteoapi/node-sdk` WebSocket 长连接 (protobuf)

**SDK 规范化**：`feishu-message-api.js` 已完成 SDK 重写（-209行），所有 REST API 调用改为使用 SDK `Client` 方法。

**命令层**：使用飞书自有交互卡片系统（未接入共享命令层）
- 飞书卡片：`_buildHelpCard` / `_buildStatusCard` / `_buildSessionsCard` / `_buildHistoryChoiceCard`
- 卡片动作：`FeishuEventClient` 处理 `card.action.trigger` → `_handleCardAction`
- 命令文本 fallback：`_getHelpText()` 等

**共享层使用**：
- ✅ `ImSessionMapper`
- ✅ `ImReplyCollector`
- ✅ `ImFrontendNotifier`
- ✅ `im-utils`
- ✅ `buildHistoryChoiceMenuText`（部分场景）

### 3.3 企业微信 (Enterprise Weixin Bridge)

**文件**：`src/main/managers/enterprise-weixin-bridge.js` (1759行)

**连接方式**：`@wecom/aibot-node-sdk` WSClient WebSocket 长连接

**命令层**：完整接入共享命令层
- 使用 `dispatchImCommand` 进行命令分发
- 使用 `resolveCloseCommand` / `resolveRenameCommand` / `activateNewSession` / `resolveResumeSelection`
- 使用 `ensureHistoryChoiceOrCurrent` 进行会话路由
- 使用 `resolveStrictCurrentSessionId` 获取当前会话
- 使用 `runResumePostAction` 处理 resume 后激活
- 使用 `buildImCommandHelpText` / `buildSharedSessionsText` / `buildHistoryChoiceMenuText` 等共享 presenter

**回复通道**：同一条 WebSocket，原生 `replyStream`
- 被动回复：`wsClient.replyStreamNonBlocking(frame, streamId, chunk, finish)`
- 主动推送：`wsClient.sendMessage(chatId, { msgtype: 'markdown', ... })`

**图片链路**：
- 入站：`wsClient.downloadFile(url, aeskey)` → 解密 → base64
- 出站被动：`wsClient.uploadMedia(buffer)` + `replyMedia(frame, 'image', mediaId)`
- 出站主动：`wsClient.uploadMedia(buffer)` + `sendMediaMessage(chatId, 'image', mediaId)`

**联系人管理**：通过 `wecom-cli-manager.js` 获取联系人列表

### 3.4 个人微信 (Weixin Bridge)

**文件**：`src/main/managers/weixin-bridge.js` (591行) + `weixin-notify-service.js`

**连接方式**：HTTP 长轮询（无官方 SDK）

**状态**：未接入共享命令层，保持原有实现。使用 `im-utils` 进行图片路径提取。

---

## 四、数据模型

### 4.1 会话字段

| 字段 | 类型 | 说明 |
|------|------|------|
| `type` | `chat \| notebook` | UI 展示形态（仅两种） |
| `source` | `manual \| im-inbound` | 创建来源（仅两种） |
| `imChannel` | `dingtalk \| feishu \| weixin \| enterprise-weixin \| null` | IM 渠道标识 |
| `taskId` | `string \| null` | 定时任务标识 |
| `clientType` | `string \| null` | 内嵌 App 类型 |

### 4.2 DB 列

```sql
-- agent_conversations 表
type            TEXT    -- 'chat' | 'notebook'
source          TEXT    -- 'manual' | 'im-inbound'
im_channel      TEXT    -- IM 渠道 (新增)
im_user_id      TEXT    -- IM 用户 ID (新增)
im_chat_id      TEXT    -- IM 聊天 ID (计划)
staff_id        TEXT    -- [兼容] 旧 IM 用户 ID 列
conversation_id TEXT    -- [兼容] 旧 IM 聊天 ID 列
task_id         TEXT    -- 定时任务 ID
status          TEXT    -- 'idle' | 'streaming' | 'closed'
```

### 4.3 关键 DB 方法

```javascript
// 统一写入（同时写新旧列）
updateImIdentity(sessionId, userId, channelId)
// → staff_id = userId, im_user_id = userId
// → conversation_id = channelId

// 统一查询（新列优先，过滤 closed）
getImSessionsByType(imType, staffId, conversationId, limit)
// → WHERE im_channel = ?

// 会话绑定
bindSessionExternalImSource(sessionId, channel)
// → session.imChannel = channel
// → DB: im_channel = channel (同时写旧 source 兼容)

// 解绑
unbindSessionExternalImSource(sessionId)
// → session.imChannel = null
```

---

## 五、IPC 通道

### 5.1 共享处理器工厂

`im-bridge-handlers.js` 的 `setupImBridgeHandlers(ipcMain, bridge, configManager, prefix)` 为任何 IM Bridge 注册 7 个标准通道：

| IPC Channel | 说明 |
|------------|------|
| `{prefix}:getStatus` | 获取连接状态 |
| `{prefix}:start` | 启动连接 |
| `{prefix}:stop` | 停止连接 |
| `{prefix}:restart` | 重启连接 |
| `{prefix}:setEnabled` | 切换启用状态（持久化 + 驱动运行态） |
| `{prefix}:updateConfig` | 更新配置（仅保存，不驱动开关） |
| `{prefix}:sendText` | 主动发送文本 |

### 5.2 渠道专属 IPC

| 渠道 | 额外通道 |
|------|---------|
| 钉钉 | `listTargets`, `bindSessionToTarget`, `unbindSessionTarget`, `getSessionBinding` |
| 飞书 | `listTargets`, `bindSessionToTarget`, `unbindSessionTarget`, `getSessionBinding`, `getContacts` |
| 企业微信 | `listTargets`, `bindSessionToTarget`, `unbindSessionTarget`, `getSessionBinding`, `getBootstrapStatus`, `listContacts` |
| 个人微信 | `listContacts`, `sendText` |

### 5.3 前端事件

| 事件 | 说明 |
|------|------|
| `{prefix}:statusChange` | 连接状态变更 |
| `{prefix}:messageReceived` | 收到 IM 消息 |
| `{prefix}:sessionCreated` | IM 创建了新会话 |
| `{prefix}:sessionClosed` | IM 关闭了会话 |
| `{prefix}:error` | 桥接错误 |

---

## 六、渠道元数据

`src/shared/external-im-meta.js` 是所有 IM 渠道的单一数据源：

```javascript
EXTERNAL_IM_CHANNELS = {
  dingtalk:           { id, label, icon: 'dingtalk',           hasCommands: true,  routeName: 'dingtalk-settings' },
  weixin:             { id, label, icon: 'weixin',             hasCommands: false, routeName: null },
  feishu:             { id, label, icon: 'feishu',             hasCommands: true,  routeName: 'feishu-settings' },
  'enterprise-weixin':{ id, label, icon: 'wecom',              hasCommands: true,  routeName: 'enterprise-weixin-settings' },
}
```

核心 API：
- `getAllExternalImChannelIds()` → 获取所有渠道 ID
- `isExternalImChannel(channel)` → 验证渠道有效性
- `getExternalImMeta(channel)` → 获取渠道元数据
- `getConversationIcon(conv)` → 根据 `imChannel` 返回图标
- `getSessionImChannel(conv)` → 获取会话的 IM 渠道

---

## 七、UI 层

### 7.1 设置页面

| 渠道 | 页面路由 | 组件 |
|------|---------|------|
| 钉钉 | `dingtalk-settings` | `DingTalkSettingsContent.vue` |
| 飞书 | `feishu-settings` | `FeishuSettingsContent.vue` |
| 企业微信 | `enterprise-weixin-settings` | `EnterpriseWeixinSettingsContent.vue` |

每个设置页支持：
- 启用/禁用开关（与配置保存分离）
- 连接/断开/重连控制
- 状态显示（已连接/连接中/重连中/未连接/错误）
- 高级设置（历史会话数等）
- 嵌入式模式（embedded prop）

### 7.2 IM 快速发送

`ChatInputToolbar.vue` 中的 IM 快速发送按钮：
- 根据会话 `imChannel` 显示对应图标
- 点击弹出 `ImQuickSendPanel`（渠道通用组件）
- 支持选择目标联系人/群聊
- 发送后自动绑定会话与目标

### 7.3 侧栏筛选

`AgentLeftContent.vue` 使用 `getSessionImChannel(conv)` 进行 IM 渠道筛选，不再依赖 `type` / `source`。

---

## 八、平台协议对比

| | 钉钉 | 飞书 | 企业微信 | 个人微信 |
|---|---|---|---|---|
| **SDK** | `dingtalk-stream-sdk-nodejs` | `@larksuiteoapi/node-sdk` | `@wecom/aibot-node-sdk` | 无官方 SDK |
| **连接** | WebSocket Stream | WebSocket (protobuf) | WebSocket | HTTP 长轮询 |
| **认证** | appKey + appSecret | appId + appSecret | botId + secret | QR 码登录 |
| **回复通道** | sessionWebhook URL (一次性) | REST API | 同一条 WS (replyStream) | ilink 自定义 API |
| **流式** | markdown 分段 POST | 逐条 sendMessage | 原生 replyStreamNonBlocking | ❌ |
| **图片入站** | API 下载 (downloadCode) | SDK messageResource | downloadFile (含 AES 解密) | ilink URL 下载 |
| **图片出站** | upload + batchSend | SDK image.create | uploadMedia + replyMedia | ilink 上传 |

---

## 九、延后项与待办

| 项目 | 状态 | 原因 |
|------|------|------|
| BaseImBridge 抽象类 | ⏸️ 延后 | 依赖 ImReplyCollector/ImSessionMapper 在钉钉完成迁移 |
| ImReplyCollector 钉钉回迁 | ⏸️ 延后 | webhook 管道差异大，需真实 IM 测试环境 |
| ImSessionMapper 钉钉回迁 | ⏸️ 延后 | 同上 |
| 飞书命令层接入共享层 | ⏸️ 延后 | 飞书已有完整卡片闭环，迁移成本高收益低 |
| 钉钉交互卡片 | ⏸️ 延后 | 见 `im-command-card-unification.md` 阶段二 |
| 企业微信交互卡片 | ⏸️ 延后 | 见 `im-command-card-unification.md` 阶段三 |
| ImQuickSendPanel UI 抽取 | ⏸️ 延后 | 依赖 BaseImBridge |
| 个人微信共享层接入 | ⏸️ 延后 | 商榷中 |
| DB 旧列清理 (staff_id/conversation_id) | ⏸️ 延后 | 需确保所有渠道迁移完成 |

---

## 十、测试覆盖

| 测试文件 | 覆盖范围 |
|---------|---------|
| `tests/main/dingtalk-bridge.test.js` | 钉钉消息处理、命令、会话管理 |
| `tests/main/feishu-bridge.test.js` | 飞书消息处理、卡片、命令 |
| `tests/main/enterprise-weixin-bridge.test.js` | 企业微信消息、命令、绑定 |
| `tests/main/enterprise-weixin-session-created-wiring.test.js` | 企业微信会话创建链路 |
| `tests/main/im-restored-session-host-routing.test.js` | IM 恢复会话路由测试 |

---

## 十一、相关文档

- [IM 命令卡片统一设计](./im-command-card-unification.md) — 卡片架构设计（阶段一已完成，阶段二/三待实施）
- [企业微信集成完善设计](./enterprise-weixin-feishu-parity-plan.md) — 企业微信对齐飞书的详细计划（✅ 已完成）
- [会话字段重构方案](./session-fields-refactoring-plan.md) — type/source/imChannel 字段重构（✅ 已完成）
- [钉钉桥接使用指南](../user-guide/DINGTALK-GUIDE.zh.md) — 用户配置指南
