# Agent Platform 基线索引

> 状态：Phase 0 基线文档  
> 目的：记录平台改造前的 Agent IPC、预加载 API、事件语义和当前实现边界，作为后续兼容重构的行为基线。

## 1. 文档范围

本基线文档只覆盖当前与 Agent Platform 改造直接相关的部分：

- 主进程 `agent:*` IPC handler
- preload 暴露给 renderer 的 Agent API
- main -> renderer 的 Agent 事件通道
- 当前实现中的关键耦合点

不覆盖：

- 完整聊天 UI 逻辑
- 钉钉 / 微信全部细节
- Notebook 全量行为

## 2. 当前核心文件

当前 Agent 平台相关主文件：

- `src/main/agent-session-manager.js`
- `src/main/agent-session.js`
- `src/main/ipc-handlers/agent-handlers.js`
- `src/preload/preload.js`
- `src/main/session-database.js`
- `src/main/database/agent-db.js`

## 3. 当前主进程 IPC 基线

当前 `src/main/ipc-handlers/agent-handlers.js` 中暴露的主要 `agent:*` IPC 如下。

### 3.1 会话生命周期

- `agent:create`
- `agent:sendMessage`
- `agent:cancel`
- `agent:reopen`
- `agent:switchApiProfile`
- `agent:close`
- `agent:get`
- `agent:list`
- `agent:rename`
- `agent:getMessages`
- `agent:compact`
- `agent:deleteConversation`
- `agent:clearAndRecreate`

### 3.2 宿主交互

- `agent:respondInteraction`
- `agent:cancelInteraction`

### 3.3 Streaming Input / 模型与运行信息

- `agent:setModel`
- `agent:getSupportedModels`
- `agent:getSupportedCommands`
- `agent:getAccountInfo`
- `agent:getMcpServerStatus`
- `agent:getInitResult`

### 3.4 输出目录与文件浏览

- `agent:getOutputDir`
- `agent:openOutputDir`
- `agent:listOutputFiles`
- `agent:listDir`
- `agent:readFile`
- `agent:saveFile`
- `agent:openFile`
- `agent:readAbsolutePath`
- `agent:createFile`
- `agent:renameFile`
- `agent:deleteFile`
- `agent:saveAbsoluteFile`
- `agent:searchFiles`

### 3.5 队列持久化

- `agent:saveQueue`
- `agent:getQueue`

## 4. 当前 preload API 基线

当前 `src/preload/preload.js` 暴露给 renderer 的 Agent API 主要如下。

### 4.1 会话生命周期

- `createAgentSession`
- `sendAgentMessage`
- `cancelAgentGeneration`
- `closeAgentSession`
- `switchAgentApiProfile`
- `reopenAgentSession`
- `getAgentSession`
- `listAgentSessions`
- `renameAgentSession`
- `getAgentMessages`
- `deleteAgentConversation`
- `compactAgentConversation`
- `clearAndRecreateAgentSession`

### 4.2 交互响应

- `respondAgentInteraction`
- `cancelAgentInteraction`

### 4.3 模型与运行信息

- `setAgentModel`
- `getAgentSupportedModels`
- `getAgentSupportedCommands`
- `getAgentAccountInfo`
- `getAgentMcpServerStatus`
- `getAgentInitResult`

### 4.4 文件与输出目录

- `getAgentOutputDir`
- `openAgentOutputDir`
- `listAgentOutputFiles`
- `listAgentDir`
- `readAgentFile`
- `saveAgentFile`
- `saveAbsoluteFile`
- `openAgentFile`
- `readAbsolutePath`
- `createAgentFile`
- `renameAgentFile`
- `deleteAgentFile`
- `searchAgentFiles`

### 4.5 队列持久化

- `saveAgentQueue`
- `getAgentQueue`

## 5. 当前 Agent 事件基线

当前 preload 中注册给 renderer 的 Agent 事件如下：

- `agent:init`
- `agent:message`
- `agent:stream`
- `agent:result`
- `agent:error`
- `agent:cliError`
- `agent:statusChange`
- `agent:toolProgress`
- `agent:systemStatus`
- `agent:otherMessage`
- `agent:renamed`
- `agent:compacted`
- `agent:usage`
- `agent:interactionRequest`
- `agent:interactionResolved`
- `agent:allSessionsClosed`

对应的 renderer 监听器工厂名如下：

- `onAgentInit`
- `onAgentMessage`
- `onAgentStream`
- `onAgentResult`
- `onAgentError`
- `onAgentCliError`
- `onAgentStatusChange`
- `onAgentToolProgress`
- `onAgentSystemStatus`
- `onAgentOtherMessage`
- `onAgentRenamed`
- `onAgentCompacted`
- `onAgentUsage`
- `onAgentInteractionRequest`
- `onAgentInteractionResolved`
- `onAgentAllSessionsClosed`

## 6. 当前行为特征

平台改造前，当前实现具有以下明显特征：

### 6.1 单宿主视角

- 当前 `agent:*` IPC 默认假设调用方就是宿主 renderer
- 当前 preload 暴露的是宿主级 API，不是多客户端隔离 API

### 6.2 事件回推依赖主窗口

- `agent:sendMessage` 异步错误路径直接调用 `agentSessionManager._safeSend(...)`
- `agent:compact` 异步错误路径也直接调用 `_safeSend(...)`

这说明当前事件分发仍然带有明显“主窗口直发”特征。

### 6.3 当前 list/get 查询未做 owner 过滤

- `agent:get` 直接走 `agentSessionManager.get(sessionId)`
- `agent:list` 直接走 `agentSessionManager.list()`

这也是后续 Broker 需要接管的重要原因。

## 7. 当前兼容性约束

后续 Agent Platform 改造必须保持以下行为兼容：

- 不删除现有 `agent:*` IPC 通道
- 不改变现有 preload API 命名和基本语义
- 不改变 `agent:sendMessage` 的“invoke 返回 success，实际结果走事件流”的模式
- 不改变现有事件名
- 不改变宿主 Renderer 侧对这些 API 的调用方式

## 8. 当前已知改造重点

后续改造必须重点处理：

1. `AgentSession` 增加 owner 元数据
2. `agent:*` IPC 从直连 manager 改为走 Broker
3. `_safeSend()` 从“主窗口发送”演进为“兼容事件发布器”
4. `agent:list` / `agent:get` 等查询改为在 Broker 层做 owner 过滤
5. 新增 embedded / local client 时不能影响现有宿主语义

## 9. 结论

当前代码已经具备平台化改造基础，但仍明显是“宿主单客户端”模型。

因此，第 1 期平台实施的关键不是重写 Agent 内核，而是：

- 在保持这些 IPC / preload / 事件语义不变的前提下
- 在主进程内新增 Broker、Router、owner 隔离和 bridge 能力
- 把当前宿主专用模型兼容升级为多客户端可隔离模型
