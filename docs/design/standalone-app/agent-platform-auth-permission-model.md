# Agent Platform 鉴权与权限模型

> 状态：Phase 3 权限模型文档草案
> 适用范围：Hydro Desktop Agent Platform
> 关联实现：
> - `src/main/agent-platform/agent-session-broker.js`
> - `src/main/agent-platform/agent-event-router.js`
> - `src/main/agent-platform/local-agent-api-server.js`

## 1. 文档目标

本文档定义当前 Agent Platform 的第一版鉴权与权限模型，目标是：

- 解释 embedded / node client 如何识别
- 解释 session 如何隔离
- 明确当前权限边界
- 为后续更细粒度能力控制预留演进路径

第一版采用“最小可用、低侵入”的策略，不引入复杂 RBAC。

## 2. 设计原则

- 默认不影响现有宿主聊天行为
- 优先做 session 级隔离，而不是全平台 ACL
- 不暴露宿主专属能力
- 不让一个外部 client 读取另一个 client 的会话
- 文件能力默认受 session 工作目录约束

## 3. 鉴权模型概览

当前平台不是公网服务，因此第一版不采用复杂 token 认证，而采用：

- 运行边界鉴权
- client 身份鉴别
- owner 归属校验

对应三层：

### 3.1 运行边界鉴权

本地 API 只监听：

- `127.0.0.1`

因此默认只允许本机进程接入，不对局域网或公网开放。

### 3.2 client 身份鉴别

平台要求每个外部入口都提供一个明确 `appId`。

系统内部会归一化为：

- embedded: `embed:<appId>`
- node: `node:<appId>`

### 3.3 owner 归属校验

每个 session 都绑定一个 `ownerClientId`。

后续任何以下操作都必须经过 owner 校验：

- 发送消息
- 获取消息
- 恢复会话
- 关闭会话
- 文件访问
- interaction 响应

如果 owner 不匹配，外部看到的结果统一应视为“会话不存在”。

## 4. client 类型与信任边界

### 4.1 `host`

代表宿主聊天 UI。

特点：

- 最高兼容优先级
- 继续沿用原 `agent:*` 事件流
- 默认 owner 为 `host-ui`

### 4.2 `embedded`

代表运行在 Hydro Desktop 内部的独立页面。

特点：

- 通过 preload bridge 接入
- 不直接拿到全量 `electronAPI`
- 只能访问自己创建的 session

### 4.3 `node`

代表本机独立 Node.js 应用。

特点：

- 通过本地 `HTTP + WebSocket` 接入
- 仍只能访问自己创建的 session
- 不继承宿主 UI 能力

## 5. session 归属模型

### 5.1 创建时绑定

session 创建时即写入以下归属字段：

- `ownerClientId`
- `clientType`
- `clientMeta`

示例：

```json
{
  "ownerClientId": "embed:hydrology-workbench",
  "clientType": "embedded",
  "clientMeta": {
    "page": "station-review",
    "version": "0.1.0"
  }
}
```

### 5.2 访问时校验

任何后续操作都会先走 broker 的 owner 校验。

校验原则：

- owner 一致：允许访问
- owner 不一致：拒绝访问
- 拒绝时不透露真实 owner

### 5.3 持久化后仍保留 owner

即使 session 已不在内存中，只要数据库记录还在，平台仍可根据持久化 owner 做归属校验。

这保证：

- 重开桌面后归属关系仍有效
- reopen / getMessages 等不会丢失隔离语义

## 6. 事件权限模型

### 6.1 为什么需要 Event Router

如果没有事件路由，Agent 事件可能出现两类问题：

- 发到错误的 renderer
- 外部 app 收不到自己的事件

### 6.2 当前路由原则

`AgentEventRouter` 根据 `sessionId -> ownerClientId` 做事件定向：

- `host-ui` 事件发给宿主窗口
- `embed:<appId>` 事件发给对应 embedded 页面
- `node:<appId>` 事件发给对应 WebSocket 订阅方

### 6.3 广播事件

当前只有极少数全局事件可以广播，例如：

- `agent:allSessionsClosed`

除这类特殊事件外，事件默认不广播。

## 7. 文件权限模型

第一版文件权限采用“会话目录沙箱”：

- `listDir`
- `readFile`
- `saveFile`
- `searchFiles`

这些能力都应被理解为：

- 仅允许访问当前 session 语义下的工作目录
- 不等同于宿主级任意文件系统访问

对于正式内嵌 app，推荐的工作目录基线为：

```text
<userData>/embedded-apps/<appId>/
```

其中 Agent 开发该 app 时，推荐 `cwd` 进一步收口为：

```text
<userData>/embedded-apps/<appId>/workspace/
```

这条规范的目的有两点：

- 把内嵌 app 与宿主主工程目录隔离
- 让 session 文件能力默认落在 app 自己的边界内

当前不开放给外部 client 的能力：

- 任意绝对路径全盘读写
- 宿主级 shell 打开
- 任意系统目录修改

## 8. 本地 API 鉴权细节

### 8.1 必填头

除 `GET /v1/agent/status` 外，其余请求要求：

- `x-hydro-app-id`

缺失时返回：

```json
{
  "success": false,
  "error": {
    "code": "APP_ID_REQUIRED",
    "message": "x-hydro-app-id header is required"
  }
}
```

### 8.2 为什么第一版不加 token

原因不是“不需要安全”，而是当前运行模型下，主边界已是：

- 仅本机访问
- 仅本桌面宿主存在时可用
- 仅按 session owner 使用

在这个阶段，额外 token 会增加接入复杂度，但不能实质解决“同一用户本机进程之间的信任问题”。

因此第一版先把边界放在：

- 本机
- appId
- owner

## 9. embedded 鉴权细节

embedded 页面不直接自行声明 `clientId`，而是由 bridge 归一化：

- `clientId = embed:<appId>`
- `clientType = embedded`

这样做的原因：

- 避免页面伪造 `host-ui`
- 避免页面伪造其他 embedded app 的身份
- 保证 owner 归属稳定

此外，embedded app 的正式安装目录也应与身份绑定：

- `appId = hydrology-workbench`
- 正式根目录 = `<userData>/embedded-apps/hydrology-workbench/`

这使以下几件事可以统一：

- app 安装位置
- client 身份
- session 归属
- workspace 边界

## 10. 错误收口策略

当前权限失败时，外部不应看到以下差异：

- “session 不存在”
- “session 存在但不属于你”

统一表现为：

- `Session not found`

这是一种信息最小暴露原则。

## 11. 当前权限边界总结

当前外部 client 可以做的事：

- 创建自己的 session
- 查看自己的 session
- 发送消息
- 消费自己的事件
- 在自己 session 下做有限文件操作
- 响应自己的 interaction

当前外部 client 不可以做的事：

- 访问宿主聊天 session
- 访问其他 embedded app 的 session
- 访问其他 node app 的 session
- 获取宿主全量 Electron 能力
- 写全局配置
- 控制主窗口
- 管理插件市场或系统能力

## 12. 风险与后续演进

### 12.1 当前已接受的风险

第一版明确接受以下限制：

- 同一台机器上的同一用户进程，理论上可自行声明任意 `appId`
- 当前没有 app 级签名
- 当前没有用户确认授权弹窗

这在第一版可接受，因为目标是：

- 先打通平台内生态复用
- 不是构建公网多租户服务

### 12.2 建议的后续增强方向

后续如需要更强隔离，可追加：

- app registration registry
- 首次接入授权确认
- persistent app secret
- capability scope 白名单
- 每个 app 的独立工作目录策略
- 只读 / 可写文件能力拆分

其中“每个 app 的独立工作目录策略”在当前阶段已经建议先按目录规范落地：

- `<userData>/embedded-apps/<appId>/`

后续只是在这个基础上再增加更强的授权和能力声明。

## 13. Skill 与提示词约束

为了避免聊天开发时重复接底层 SDK，后续官方 skill 应持续注入以下原则：

- 开发 embedded 页面时优先使用 `window.hydroAgent`
- 开发本地 Node.js app 时优先复用本地 Agent API
- 除非用户明确要求独立于 Hydro 运行，否则不要重复接 Claude Agent SDK

## 14. 结论

当前权限模型的核心不是复杂授权，而是三件事：

- `appId` 识别 client
- `ownerClientId` 隔离 session
- `AgentEventRouter` 隔离事件

这足以支撑平台生态第一阶段落地，同时不会破坏现有宿主聊天主流程。
