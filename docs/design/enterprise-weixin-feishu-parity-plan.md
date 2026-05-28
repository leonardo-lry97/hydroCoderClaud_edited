# 企业微信集成完善设计（对齐飞书）

## 1. 目标

本轮企业微信集成的目标，不是只把 `enterprise-weixin-bridge.js` 补到“能连上”，而是把它补到与飞书渠道同等级可用。

目标标准：

1. 会话创建、绑定、切换、恢复逻辑与飞书一致
2. IM -> 桌面 -> IM 的文本、图片双向链路完整
3. `/help`、`/status`、`/sessions`、历史会话选择等命令体验完整
4. 桌面端主动发送、会话绑定、重启后恢复行为完整
5. 设置页、IPC、测试、日志、异常处理达到可回归状态

## 2. 范围

本轮范围内：

- 企业微信智能机器人 `Bot ID + Secret + 长连接`
- 单聊
- 企业微信内部群聊
- 文本消息
- 图片消息
- 图文混排中的文本和图片
- 会话命令与会话选择
- 桌面端主动发送与绑定
- 会话过滤、图标、观察模式、状态展示
- 单元测试与冒烟清单

本轮暂不做：

- 复杂模板卡片主方案
- 语音/文件/视频完整处理
- 用户反馈事件深度利用
- 企业微信专属增强功能先于飞书落地

原则：先实现“飞书等价能力”，再考虑企业微信特有增强。

## 3. 当前现状评估

当前 `src/main/managers/enterprise-weixin-bridge.js` 只属于桥接骨架，离飞书等价还有明显差距。

已具备：

- 长连接接入
- 基础消息接收
- 基于 `ImSessionMapper` 的会话映射
- 基础流式文本回复
- Agent 结果后补发图片的雏形
- 设置页与基础 IPC 通道

缺失或不完整：

1. 命令体系缺失
   - 没有 `/help` `/status` `/sessions`
   - 没有命令分发、帮助文案、状态文案

2. 历史会话选择未闭环
   - `needsChoice` 时只发文本菜单
   - 没有“用户回复数字 -> 绑定/恢复/新建”的后续处理

3. 入站图片未完成
   - 只提取文本
   - 未下载并解密企业微信图片
   - 未保存到临时目录并传给桌面

4. 主动发送能力未完成
   - 只有 `sendTextToTarget`
   - 没有 target 列表获取
   - 没有桌面工具栏发送入口
   - 没有 `getSessionBinding / bind / unbind` 配套 IPC

5. 会话状态与恢复不完整
   - `getStatus()` 仍固定返回 `activeSessions: 0`
   - 未完整维护 session <-> 企业微信身份映射
   - 重启后绑定恢复逻辑缺失

6. 事件能力未利用
   - `enter_chat`
   - `template_card_event`
   - `disconnected_event`
   当前均未纳入完整业务设计

7. 测试缺失
   - 当前没有企业微信桥接测试文件
   - 不满足本仓库 IM 渠道回归要求

## 4. 设计原则

### 4.1 总原则

企业微信以飞书为功能参考，以企业微信 SDK 能力为传输实现。

也就是说：

- 用户体验、会话语义、桌面侧行为，尽量与飞书一致
- 具体收发 API、流式方式、图片下载解密方式，按企业微信 SDK 实现

### 4.2 字段原则

会话字段继续遵循已完成的 IM 重构：

- `type`: 仅 `chat | notebook`
- `source`: 仅入口来源，例如 `manual | im-inbound`
- `imChannel`: IM 渠道标识，企业微信为 `enterprise-weixin`
- `taskId`: 定时任务标识，不混入 `source`

企业微信实现中禁止重新引入“把渠道类型写回 source”的旧模式。

### 4.3 交互原则

1. 能共用 presenter 的文本，必须共用
2. 不因为企业微信 SDK 不同，就改变桌面侧会话语义
3. 默认先做文本菜单；卡片能力作为后续增强，不阻塞主链路
4. 所有企业微信特有逻辑，尽量封装在 `enterprise-weixin-bridge.js` 内，不污染共享主流程

## 5. 企业微信与飞书的关键差异

### 5.1 通道差异

飞书：

- 接收：事件订阅
- 发送：REST API
- 图片发送：上传图片获取 key 后发送

企业微信智能机器人：

- 接收：WebSocket 长连接
- 回复：基于回调帧 `req_id` 被动回复
- 主动推送：同一条 WebSocket 通道主动发送
- 图片接收：消息内提供加密下载地址与 `aeskey`
- 图片发送：`uploadMedia` + `replyMedia / sendMediaMessage`

### 5.2 设计含义

这意味着：

1. 企业微信的“被动回复”必须保留收到的原始 frame/headers
2. 历史会话选择、命令回复、流式回复、被动图片回复，都应尽量基于原始回调帧
3. 主动桌面发送才走 `sendMessage(chatid, body)` 或 `sendMediaMessage`
4. 图片链路需要补上下载解密与临时落盘

## 6. 目标架构

### 6.1 文件分层

核心沿用当前 IM 重构结构：

- `src/main/managers/enterprise-weixin-bridge.js`
  - 企业微信主桥接
- `src/main/ipc-handlers/enterprise-weixin-handlers.js`
  - 企业微信专属 IPC 扩展
- `src/renderer/pages/enterprise-weixin-settings/*`
  - 设置页
- 复用共享模块：
  - `im-session-mapper.js`
  - `im-reply-collector.js`
  - `im-command-presenter.js`
  - `im-utils.js`
  - `external-im-meta.js`

### 6.2 主桥接内部结构

企业微信桥接建议拆成以下内部职责：

1. 连接与生命周期
2. 入站消息标准化
3. 会话选择 / 命令处理
4. Agent 事件监听与回传
5. 图片下载、解密、发送
6. 桌面端主动发送与绑定
7. 事件回调处理
8. 状态恢复与清理

## 7. 详细功能设计

### 7.1 入站消息标准化

目标：把企业微信原始消息整理成与飞书近似的内部结构，再进入共享会话流程。

标准化输出建议包含：

- `frame`
- `msgId`
- `chatId`
- `chatType`
- `senderId`
- `senderName`
- `text`
- `images`
- `files`
- `unsupported`
- `raw`

消息类型处理：

1. `text`
   - 直接取 `text.content`

2. `image`
   - 用 `wsClient.downloadFile(url, aeskey)` 下载并解密
   - 落到临时目录
   - 生成图片路径数组

3. `mixed`
   - 提取全部文本项拼接为文本
   - 对图片项逐个下载解密

4. `voice / file / video`
   - 当前阶段先记录日志并给出统一提示
   - 不阻塞文本命令与普通会话链路

### 7.2 会话身份模型

企业微信 identity 建议统一为：

```js
{
  userId,
  channelId,   // 单聊=userId，群聊=chatId
  chatId,
  chatType,    // single | group
  nickname,
  channelName,
}
```

映射键：

- 单聊：`${userId}:${userId}`
- 群聊：`${userId}:${chatId}`

这样可兼容：

- 单聊一人一会话历史
- 群聊同一用户在不同群分别管理

### 7.3 历史会话选择

行为必须对齐飞书：

1. 企业微信收到消息
2. `ImSessionMapper.ensureSession(...)`
3. 若需要选择历史会话：
   - 保存 pending choice 状态
   - 回复菜单文本
4. 用户下一条消息若为数字：
   - 绑定到选中的历史会话
5. 若输入 `/new`：
   - 新建会话
6. 若输入其他文本：
   - 给出提示，引导先选择或新建

需要新增的数据结构：

- `_pendingChoices: Map<choiceKey, pendingContext>`

`pendingContext` 建议包含：

- `frame`
- `identity`
- `sessions`
- `createdAt`
- `chatId`
- `chatType`

### 7.4 命令体系

命令体验参照飞书文本模式：

- `/help`
- `/status`
- `/sessions`
- `/new`
- 历史会话编号选择

实现要求：

1. 文案使用共享 presenter：
   - `buildCommandHelpText`
   - `buildStatusText`
   - `buildActiveSessionsText`
   - `buildHistoryChoiceMenuText`

2. `/status`
   - 展示连接状态
   - 当前会话
   - 模型
   - turn / message / cost / context token
   - 与飞书保持同级信息密度

3. `/sessions`
   - 仅列当前聊天上下文下的活跃会话
   - 支持后续数字选择

4. `/new`
   - 在当前聊天上下文下新建会话

5. 未知命令
   - 统一回复“未知命令 + /help 指引”

### 7.5 被动回复与流式输出

企业微信与飞书不同点在于：回复应尽量使用原始回调帧的 `req_id`。

设计如下：

1. `replyCollector.startCollect(sessionId, ...)` 时保存：
   - `frame`
   - `msgId`
   - `streamId`
   - `identity`

2. `agentMessage`
   - 从消息中提取文本
   - 使用 `replyStreamNonBlocking(frame.headers, streamId, content, false)`
   - 避免中间帧积压

3. `agentResult`
   - 结束流式输出
   - 在 final frame 发送收集的图片
   - 优先考虑使用 `finish=true + msgItem` 一次结束
   - 如果稳定性不足，退化为：
     - finish stream
     - 再 `replyMedia(...)` 顺序补发图片

推荐第一版采用更稳的实现：

- 文本流式单独 finish
- 图片逐张 `replyMedia(frame.headers, 'image', mediaId)`

这样排错最简单。

### 7.6 桌面端介入回传

对齐飞书：

- 只要该 session 已绑定企业微信，且桌面端发言不是 `im-inbound`
- 就视为“桌面介入”
- 通过 `ImReplyCollector.recordDesktopIntervention(...)` 记录

回传策略：

1. 文本：
   - 优先走主动发送到该会话 `chatId`
2. 图片：
   - 走 `uploadMedia + sendMediaMessage`
3. 如果 session 已失去有效 target：
   - 给桌面侧错误提示，不 silently ignore

### 7.7 图片双向链路

#### IM -> 桌面

1. 收到 `image` 或 `mixed.image`
2. `downloadFile(url, aeskey)`
3. 用临时目录落盘
4. 传给 `appendExternalUserMessage(...)`
5. 再送入 `sendMessage(...)`

#### 桌面 -> IM

与飞书/钉钉保持一致：

1. `agentMessage`
   - 递归提取 tool_use / tool_result / 结构化块中的图片路径
2. `agentResult`
   - 汇总 reply collector 中记录的图片路径
3. 去重、存在性校验、大小校验
4. `uploadMedia`
5. 被动回复用 `replyMedia`
6. 主动发送用 `sendMediaMessage`

图片提取逻辑必须复用 `im-utils.extractImagePaths`，不要重写一套企业微信特有扫描器。

### 7.8 主动发送与桌面工具栏

这是企业微信对齐飞书必须补的一块。

目标能力：

1. 桌面端工具栏出现企业微信图标
2. 能列出可发送 target
3. 选 target 后可绑定到当前 session
4. 会话重启后保留绑定
5. 未绑定时支持手工切换 target

设计决策：

企业微信不像飞书那样天然有“通讯录用户列表 REST API”可直接复用，因此主动发送 target 不能假设后台可全量拉人。

本轮采用两层策略：

#### 方案 A：最近活跃目标

从最近与机器人互动过的企业微信身份中形成 sendable targets 列表。

来源：

- 当前运行时 `_sessionTargets`
- 历史 session 数据库里 `im_channel = 'enterprise-weixin'` 的绑定记录

这样至少保证：

- 和机器人聊过一次的人
- 桌面就能主动继续发

#### 方案 B：当前会话已绑定 target

只要已有绑定，无需依赖用户列表拉取，也可桌面继续发送。

IPC 需要补齐：

- `enterprise-weixin:listTargets`
- `enterprise-weixin:bindSessionToTarget`
- `enterprise-weixin:unbindSessionTarget`
- `enterprise-weixin:getSessionBinding`
- `enterprise-weixin:sendText`

UI 目标：

- `ChatInputToolbar` 里企业微信入口表现与飞书一致
- 选定后仅显示当前选定渠道和目标

### 7.9 状态恢复

企业微信重启后，应恢复：

1. session 的 `imChannel`
2. session 对应的 target 绑定
3. 近期可发送 targets

恢复来源：

- session DB 的 `im_channel`
- session 元信息中的企业微信 target identity
- 运行时消息进入时再次刷新 identity

建议像飞书一样维护：

- `_sessionTargets`
- `_targetSessionMap`
- `_sessionIdentities`

### 7.10 事件回调

企业微信 SDK 明确支持：

- `enter_chat`
- `template_card_event`
- `feedback_event`
- `disconnected_event`

本轮处理策略：

1. `enter_chat`
   - 发送欢迎语
   - 文案参考飞书首次接入提示
   - 可附带简版命令帮助

2. `template_card_event`
   - 本轮只保留框架，不做主交互依赖
   - 为后续卡片扩展留入口

3. `feedback_event`
   - 先记录日志
   - 暂不接业务

4. `disconnected_event`
   - 明确记录日志
   - 更新前端状态
   - 允许自动重连

## 8. 代码改造计划

### 8.1 主桥接文件

重点改造：

- `src/main/managers/enterprise-weixin-bridge.js`

需要补的核心方法：

- `_syncSessionDatabase()`
- `_createSessionMapper()`
- `_bindWsEvents()`
- `_unbindWsEvents()`
- `_normalizeInboundMessage(frame)`
- `_downloadInboundImages(...)`
- `_handleCommand(...)`
- `_handlePendingChoice(...)`
- `_getActiveSessionsByChat(...)`
- `_sendHistoryChoiceText(...)`
- `_sendHelpText(...)`
- `_sendStatusText(...)`
- `_sendSessionsText(...)`
- `_onDesktopIntervention(...)`
- `_extractImagePaths(...)`
- `listSendableTargets(...)`
- `bindSessionToTarget(...)`
- `unbindSessionTarget(...)`
- `getSessionBinding(...)`
- `_restoreSessionBindings()`

### 8.2 IPC

扩展：

- `src/main/ipc-handlers/enterprise-weixin-handlers.js`

不能只停留在共享工厂，还需要企业微信专属 handler：

- `listTargets`
- `bindSessionToTarget`
- `unbindSessionTarget`
- `getSessionBinding`

### 8.3 Renderer

需要补企业微信工具栏发送入口，使其与飞书一致：

- `ChatInputToolbar.vue`
- 对应 locale 文案

需要的文案类型：

- quick send title
- hint
- placeholder
- no targets
- sending / failed

### 8.4 共享能力复用

必须复用：

- `im-command-presenter.js`
- `im-utils.extractImagePaths`
- `ImSessionMapper`
- `ImReplyCollector`
- `external-im-meta.js`

避免重复造轮子。

## 9. 测试设计

至少补以下测试集：

### 9.1 主桥接测试

新增：

- `tests/main/enterprise-weixin-bridge.test.js`

覆盖：

1. 启动/停止/状态
2. 文本消息建会话
3. 历史会话选择
4. `/help`
5. `/status`
6. `/sessions`
7. `/new`
8. 未知命令
9. 桌面端主动发送绑定
10. 桌面端介入回传
11. 图片提取与发送
12. IM 入站图片下载解密
13. 重复消息去重
14. 重启后恢复绑定

### 9.2 IPC 测试

新增：

- `tests/main/enterprise-weixin-handlers.test.js`

覆盖：

- `listTargets`
- `bindSessionToTarget`
- `unbindSessionTarget`
- `getSessionBinding`

### 9.3 冒烟清单

手工联调最少覆盖：

1. 单聊文本往返
2. 群聊文本往返
3. `/help`
4. `/status`
5. `/sessions`
6. 历史会话选择
7. `/new`
8. 企业微信发图片到桌面
9. 桌面生成图片回企业微信
10. 桌面介入文本回企业微信
11. 重启后绑定恢复
12. 多会话切换不串线

## 10. 风险与处理

### 风险 1：企业微信 reply 依赖原始回调 frame

处理：

- 在 pending choice、reply collector、session identity 中显式保留 frame/headers

### 风险 2：流式过程中 ack 积压

处理：

- 优先使用 `replyStreamNonBlocking`
- final frame 必发

### 风险 3：图片回复时序

处理：

- 第一版采用“文本 finish 后再逐张 replyMedia”
- 先求稳定，再做合并优化

### 风险 4：主动发送 target 列表来源不足

处理：

- 第一版不强行做通讯录拉取
- 先用“最近活跃 target + 已绑定 target”
- 满足实际使用闭环

## 11. 实施顺序

建议分三批实施。

### 第一批：会话与命令闭环

目标：

- 文本消息
- `/help`
- `/status`
- `/sessions`
- `/new`
- 历史会话选择
- 状态/绑定恢复基础能力

### 第二批：图片与桌面主动发送

目标：

- IM 入站图片
- 桌面回 IM 图片
- quick send target/bind/unbind/get binding
- renderer 工具栏入口

### 第三批：事件与回归

目标：

- `enter_chat`
- `disconnected_event`
- 完整测试
- 手工冒烟

## 12. 验收标准

以下全部满足，才算企业微信接入完成：

1. 用户在企业微信单聊中可直接与桌面会话往返
2. 同一用户存在历史会话时，可选择恢复或新建
3. `/help` `/status` `/sessions` `/new` 可用
4. 桌面端可绑定企业微信目标并主动发送
5. 企业微信发来的图片能进入桌面会话
6. 桌面生成或引用的图片能回传企业微信
7. 重启程序后会话绑定仍能恢复
8. 不影响飞书、钉钉、个人微信现有链路
9. 测试覆盖达到可回归状态

## 13. 结论

企业微信这轮不应做成“单独一套弱化版通道”，而应做成基于企业微信 SDK 的“飞书同等级渠道”。

实现策略明确为：

- 功能语义对齐飞书
- 传输细节遵循企业微信 SDK
- 先文本菜单闭环，再补图片与主动发送，再补事件和测试

后续开发按本设计分批推进，不再以“先连上再说”的方式零散补丁。
