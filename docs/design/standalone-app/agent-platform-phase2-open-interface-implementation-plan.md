# Agent Platform 第 2 期实施文档：开放复用接口与 Skill 接入

> 状态：实施文档草案  
> 适用范围：Hydro Desktop Agent Platform  
> 关联阶段：平台路线中的“开放接口层”，不是水文工作台业务分期  
> 关联文档：
> - `docs/design/standalone-app/agent-platform-technical-design.md`
> - `docs/design/standalone-app/agent-platform-implementation-breakdown.md`
> - `docs/design/standalone-app/hydro-agent-app-dev-skill-design.md`
> - `docs/code-index/agent-platform-baseline.md`
> - `docs/design/standalone-app/phase0-baseline-checklist-and-report.md`

## 1. 文档目标

本文档用于定义 Agent Platform 在第 1 期兼容层完成后的下一步正式实施范围，即：

- 如何把底层 Agent Session 能力以稳定接口形式开放出去
- 如何同时支持内嵌页面与本地 Node.js 应用
- 如何保证开放后不误伤宿主现有聊天能力
- 如何把“优先复用平台而不是重复接底层 SDK”的开发指导注入到聊天开发链路

本文档只定义第 2 期平台实施，不讨论水文工作台业务细节，也不推进完整扩展应用安装器。

## 2. 第 2 期目标

第 2 期有两个核心目标：

1. **开放复用接口**
2. **上线官方 Skill 引导**

具体落地目标如下：

- 让宿主内嵌页面通过精简 bridge 访问 Agent Platform
- 让本地 Node.js 应用通过本机 API 访问 Agent Platform
- 保持宿主原有聊天入口继续可用，且仍由原结构驱动
- 用官方 skill + 最小 append prompt，让聊天开发场景优先产出平台复用方案

## 3. 设计边界

第 2 期只做以下事情：

- 本地接口控制面
- 事件订阅面
- 内嵌页 preload bridge
- client 注册与最小权限模型
- Skill 接入策略
- 示例与用户文档的最小闭环

第 2 期明确不做：

- 公网 web 服务
- 完整插件市场
- `.hydroapp` 安装器
- 远程多租户服务端
- 全量宿主 API 对外暴露
- 复杂 ACL 或组织级权限体系

## 4. 总体策略

第 2 期采用“双入口、同底座”的策略：

- **内嵌页面**：通过 preload bridge 调用主进程 broker
- **本地 Node.js 应用**：通过 `127.0.0.1` 本地 API 调用主进程 broker

两种入口最终都走：

- `AgentSessionBroker`
- 后续新增的 `AgentEventRouter`
- 原有 `AgentSessionManager`

因此第 2 期不是复制第二套 Agent 实现，而是在现有 Phase 1 之上增加统一入口层。

## 5. 架构关系

目标架构如下：

```text
宿主聊天窗口
  -> agent:* IPC
  -> AgentSessionBroker
  -> AgentSessionManager

内嵌页面
  -> window.hydroAgent
  -> preload bridge
  -> AgentSessionBroker
  -> AgentSessionManager

本地 Node.js 应用
  -> @hydro/agent-client
  -> Local HTTP + WebSocket API
  -> AgentSessionBroker
  -> AgentSessionManager

统一事件流
  <- AgentSessionManager standard events
  <- AgentEventRouter
  <- host renderer / embedded page / local node client
```

## 6. 第 2 期实施主线

第 2 期建议拆成四条主线：

### 6.1 主线 A：本地 API

负责：

- 本机 HTTP 控制面
- WebSocket 事件面
- Node.js client 协议闭环

### 6.2 主线 B：内嵌页 bridge

负责：

- `window.hydroAgent`
- `window.hydroHostTheme`
- 宿主内嵌页权限收口

### 6.3 主线 C：事件与隔离

负责：

- `AgentEventRouter`
- client 注册
- owner 校验
- 事件定向投递

### 6.4 主线 D：Skill 与开发引导

负责：

- 官方 skill
- append prompt 最小兜底
- 示例与使用文档

## 7. 接口策略

## 7.1 统一语义

不论是内嵌页还是本地 Node.js，应尽量保持同一组能力语义：

- 创建会话
- 获取会话
- 列出会话
- 发送消息
- 取消生成
- 关闭会话
- 恢复会话
- 获取历史消息
- 响应交互请求
- 订阅事件流

这样做的好处：

- 宿主、内嵌页、本地 app 三方更容易共享示例
- Skill 指导成本低
- 后续如果抽 SDK，只需做薄封装

## 7.2 第一版开放能力范围

第一版建议只开放以下能力：

- Agent Session 生命周期
- 消息发送与事件流
- interaction request / response
- 会话级文件操作
- 模型切换

第一版暂不开放：

- 宿主窗口控制
- 全局配置写入
- 全盘任意读写
- 任意能力市场管理
- 宿主专属 Electron 控制接口

## 8. 本地 API 方案

## 8.1 形态

第一版本地 API 采用：

- HTTP：控制面
- WebSocket：事件流

不建议第一版做成：

- 对外公网服务
- 纯 SSE 单向流
- 直接暴露主进程内部对象

## 8.2 监听范围

本地 API 必须满足：

- 只绑定 `127.0.0.1`
- 默认随机端口，或由配置固定
- 不对局域网开放
- 生命周期跟随桌面应用

## 8.3 client 识别

本地 Node.js client 第一次连接时必须携带：

- `clientId`
- `clientType = node`
- `appId`
- 可选 `clientMeta`

建议规则：

- `clientId` 示例：`node:hydrology-helper`
- `appId` 示例：`hydrology-helper`

## 8.4 HTTP 接口建议

第一版建议开放：

- `POST /v1/agent/sessions`
- `GET /v1/agent/sessions`
- `GET /v1/agent/sessions/:id`
- `GET /v1/agent/sessions/:id/messages`
- `POST /v1/agent/sessions/:id/messages`
- `POST /v1/agent/sessions/:id/cancel`
- `POST /v1/agent/sessions/:id/close`
- `POST /v1/agent/sessions/:id/reopen`
- `POST /v1/agent/sessions/:id/set-model`
- `POST /v1/agent/sessions/:id/interactions/:interactionId/respond`
- `POST /v1/agent/sessions/:id/interactions/:interactionId/cancel`

首版可以先不开放：

- delete conversation
- compact
- output file open in shell

这些能力可以在接口稳定后再补。

## 8.5 WebSocket 事件面

建议：

- `WS /v1/agent/events`

连接后客户端发送订阅请求，至少包含：

- `clientId`
- `appId`
- `sessionId` 或订阅范围

第一版事件类型沿用现有宿主语义：

- `agent:init`
- `agent:message`
- `agent:stream`
- `agent:result`
- `agent:error`
- `agent:cliError`
- `agent:statusChange`
- `agent:interactionRequest`
- `agent:interactionResolved`

## 8.6 返回结构原则

控制面返回结构建议统一：

```json
{
  "success": true,
  "data": {}
}
```

失败时：

```json
{
  "success": false,
  "error": {
    "code": "SESSION_NOT_FOUND",
    "message": "Session not found"
  }
}
```

不要把主进程内部异常对象直接透给外部 client。

## 8.7 第一版本地 API 代码范围建议

- `src/main/agent-platform/local-agent-api-server.js`
- `src/main/agent-platform/local-agent-event-gateway.js`
- `src/main/agent-platform/agent-event-router.js`
- `src/main/index.js`
- 如有必要：`src/main/ipc-handlers.js`

## 9. 内嵌页面 bridge 方案

## 9.1 目标

让内嵌页面能安全复用 Agent 能力，但不拿到宿主全量 `electronAPI`。

## 9.2 bridge 命名

建议暴露：

- `window.hydroAgent`
- `window.hydroHostTheme`

不建议继续扩散：

- `window.electronAPI` 给内嵌页面

## 9.3 `window.hydroAgent` 最小接口

建议首版：

- `createSession(options)`
- `listSessions()`
- `getSession(sessionId)`
- `getMessages(sessionId)`
- `sendMessage(sessionId, payload)`
- `cancel(sessionId)`
- `close(sessionId)`
- `reopen(sessionId)`
- `setModel(sessionId, model)`
- `respondInteraction(sessionId, interactionId, payload)`
- `cancelInteraction(sessionId, interactionId, reason)`
- `onEvent(sessionId, callback)`

## 9.4 app 身份注入

内嵌页面不应自行伪造宿主身份。

建议由宿主在 bridge 层注入：

- `clientId = embed:<appId>`
- `clientType = embedded`
- `clientMeta = { windowId, pageId, appVersion }`

## 9.5 文件能力边界

第一版若开放文件能力，只开放会话作用域内文件：

- `listDir`
- `readFile`
- `saveFile`
- `searchFiles`

明确不开放：

- 全盘绝对路径任意读取
- 宿主系统目录写入
- 高权限 shell 调用

## 9.6 代码范围建议

- `src/preload/preload.js`
- 如有必要：`src/preload/embedded-agent-api.js`
- `src/main/agent-platform/agent-embedded-bridge.js`

## 10. 事件路由与隔离

## 10.1 为什么第 2 期必须补 Event Router

Phase 1 已经把入口改为 broker，但事件仍主要带有宿主窗口直发特征。  
如果不补 event router，开放接口后会有两个风险：

- 事件串到宿主聊天窗口
- 外部 client 订阅不到属于自己的结果

## 10.2 第 2 期的 router 职责

`AgentEventRouter` 第 2 期最小职责：

- 注册 client -> transport 映射
- 注册 sessionId -> ownerClientId 映射回查
- 根据 `ownerClientId` 把事件定向发给宿主、内嵌页或本地 API
- 保持宿主现有 renderer 事件名不变

## 10.3 兼容策略

为了不影响原有聊天：

- 宿主 renderer 继续收到原有 `agent:*` 事件
- 外部 client 收到标准事件对象
- manager 内部不直接关心 transport

## 10.4 第 2 期不做什么

第 2 期的 router 不做：

- 多播复杂策略
- 远程订阅集群
- 复杂事件持久队列

## 11. 权限模型

## 11.1 第一版原则

第一版只做最小权限模型，不做复杂 RBAC。

基本原则：

- 一个 session 只属于一个 owner client
- client 只能看到自己的 session
- 文件能力默认受 session `cwd` 约束
- 外部 client 拿不到宿主级控制接口

## 11.2 clientType 建议

建议先固定三类：

- `host`
- `embedded`
- `node`

## 11.3 appId / clientId 约定

建议约定：

- `host-ui`
- `embed:<appId>`
- `node:<appId>`

这样后续日志、排障、审计都更清晰。

## 11.4 第 2 期不做复杂授权弹窗

第 2 期不建议一开始就做复杂 app 安装授权。  
只要满足以下条件即可：

- 内嵌页由宿主内建或宿主明确加载
- 本地 Node 应用需要显式提供 `clientId/appId`
- 配置上支持关闭本地 API

## 12. 主题桥接策略

## 12.1 结论

第 2 期主题桥接应作为可选能力，而不是默认强绑定。

## 12.2 原则

- Agent 能力强复用
- UI 风格弱绑定
- 默认允许自由样式
- 仅提供只读主题快照

## 12.3 推荐接口

- `window.hydroHostTheme.getSnapshot()`
- `window.hydroHostTheme.onThemeChanged(cb)`

建议快照字段：

- `theme`
- `colorScheme`
- `locale`
- 可选 `tokens`

## 12.4 第 2 期不做

- 不注入整套宿主 CSS
- 不强制使用宿主 design token
- 不把主题桥接当成内嵌页接入前置条件

## 13. Skill 接入策略

## 13.1 第 2 期目标

让聊天开发场景在需要本地 AI 能力时，优先生成平台复用方案，而不是重新接底层 SDK。

## 13.2 主方案

主方案是官方 skill：

- `hydro-agent-app-dev`

其职责是指导：

- 何时应该复用 Hydro Platform
- 内嵌页用 `window.hydroAgent`
- 本地 Node 应用用 `@hydro/agent-client`
- 何时不应该复用 Hydro

## 13.3 辅助方案

在 `AgentSessionManager` 注入极短 append prompt 作为兜底。  
这段 prompt 只做原则提醒，不承载长篇说明。

建议内容仅包含三点：

- 开发需要本地 Agent 能力的内嵌页或本地 Node 应用时，优先复用 Hydro 平台
- 不要重复接 Claude SDK，除非用户明确要求独立运行
- 普通应用开发不强制导向 Hydro

## 13.4 Skill 安装策略

建议第 2 期就定义为：

- 官方内置全局 skill

不要等到市场体系成熟后再装，否则聊天开发阶段无法稳定复用。

## 14. SDK 与示例策略

## 14.1 Node SDK 处理方式

第 2 期可以先不急着单独发布 npm 包，但要先把接口形式定下来。

建议先以仓库内文档或示例形式定义：

- `createHydroClient()`
- `createSession()`
- `sendMessage()`
- `onEvent()`
- `cancel()`
- `close()`
- `respondInteraction()`

后续稳定后再抽成独立 `@hydro/agent-client`。

## 14.2 示例项目建议

建议新增两个最小示例：

- `examples/embedded-chat-page`
- `examples/local-node-agent-client`

这样可以直接作为：

- Skill 示例来源
- 用户文档示例
- 开发联调样板

## 15. 测试与验收

## 15.1 必保留回归

必须继续回归：

- Agent 模式
- Notebook
- Weixin bridge
- DingTalk bridge
- Scheduled task

## 15.2 第 2 期新增测试建议

- `tests/main/agent-session-broker.test.js`
- `tests/main/agent-event-router.test.js`
- `tests/main/local-agent-api-server.test.js`
- `tests/main/embedded-agent-bridge.test.js`
- `tests/main/host-theme-bridge.test.js`
- `tests/main/agent-skill-injection.test.js`

## 15.3 验收标准

第 2 期完成的标志应当是：

1. 宿主聊天继续正常工作
2. 内嵌页面可独立创建并使用自己的 Agent Session
3. 本地 Node 应用可通过本机接口创建并使用自己的 Agent Session
4. 宿主、内嵌页、本地 Node 三方不会串事件
5. 聊天开发场景中，Agent 能稳定优先推荐平台复用方案

## 16. 灰度顺序

建议灰度顺序固定如下：

1. 仅 broker 服务宿主
2. 启用 `AgentEventRouter`
3. 启用内嵌页 bridge
4. 启用本地 API
5. 默认安装官方 skill
6. 再补主题桥接

不建议一上来同时放开本地 API、bridge、skill 和业务 app。

## 17. 推荐实际执行顺序

建议第 2 期按这个顺序推进：

1. 先补 `AgentEventRouter`
2. 再做本地 API server
3. 再做内嵌页 bridge
4. 再补最小 Node client 形式与示例
5. 再接官方 skill
6. 最后补主题桥接与用户文档

## 18. 结论

第 2 期的本质不是“多开放几个接口”，而是把 Hydro Desktop 从“内部可用的 Agent 能力”升级为“可被自身生态复用的平台能力”。

只要第 2 期做到以下四点，就算方向正确：

- 开放入口统一走 broker
- 宿主零回归
- 内嵌页与本地 Node 能各自独立接入
- Skill 能把聊天开发导向平台复用

这样后面不论是做水文工作台，还是做其它内置业务 App，都会站在同一个平台基础上推进。
