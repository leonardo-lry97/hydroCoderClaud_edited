# 内嵌 App 设计与实现标准

> 状态：当前实现标准  
> 适用范围：Hydro Desktop 内嵌 app 页面，以及复用桌面 Agent 能力的业务工作台  
> 当前对齐实现：
> - `src/main/embedded-app-registry.js`
> - `src/main/ipc-handlers.js`
> - `src/main/agent-platform/embedded-app-runtime-manager.js`
> - `src/main/managers/embedded-app-capability-query-options.js`
> - `src/renderer/components/embedded-agent/EmbeddedAgentPanel.vue`
> - `src/renderer/components/embedded-agent/embedded-app-runtime-bridge.js`
> - `src/renderer/pages/hydrology-workbench/`
> 关联文档：
> - [内嵌 App 开发 SOP](./embedded-app-development-sop.md)
> - [主进程设计](./main-process.md)
> - [渲染进程设计](./renderer.md)

## 1. 文档目标

本文档定义当前仓库内嵌 app 的正式实现标准，解决三件事：

1. 说明当前代码里的内嵌 app 模式到底怎么工作
2. 以水文工作台为例，总结一套后续可直接复制的实现规范
3. 约束未来新 app 优先复用宿主系统能力，而不是重新造一套聊天、文件、上下文和工具桥

## 2. 术语与边界

本文中的“内嵌 app”指：

- 由桌面主进程注册
- 运行在独立 `BrowserWindow` 页面中
- 通过 `window.hydroAgent` 复用宿主 Agent 会话能力
- 自身只提供业务 UI、业务上下文、受控页面动作

它不是：

- 主窗口内部的一个普通 tab
- 用户外部安装的公网 Web 应用
- 当前插件系统里的 skill / agent / MCP / plugin

## 3. 当前架构分层

```text
主进程
  ├─ embedded-app-registry
  ├─ openEmbeddedAppWindow + createSubWindow
  ├─ EmbeddedAppRuntimeManager
  ├─ EmbeddedAppPreferencesManager
  ├─ AgentSessionBroker
  └─ AgentSessionManager + embedded capability injection

渲染进程（每个内嵌 app 页面）
  ├─ 业务页面 main.js
  ├─ 业务状态与视图
  ├─ agent-panel.js
  ├─ EmbeddedAgentPanel
  └─ embedded-app-runtime-bridge
```

职责边界：

- 主进程负责注册、开窗、会话归属、能力注入、工作目录和偏好存储
- 内嵌 app 页面负责业务状态、上下文描述和页面受控动作
- 共享宿主组件负责聊天 UI、工作目录 UI、模型/API Profile 切换、微信通知入口

## 4. 当前正式入口模型

### 4.1 注册表

所有内嵌 app 必须先在 `src/main/embedded-app-registry.js` 注册。

当前字段模型：

```javascript
{
  id: 'hydrology-workbench',
  menuKey: 'hydrology-workbench',
  titleKey: 'app.windows.hydrologyWorkbench',
  labelKey: 'embeddedApps.hydrologyWorkbenchTitle',
  icon: 'activity',
  page: 'hydrology-workbench',
  window: {
    width: 1440,
    height: 920
  },
  enabled: true
}
```

标准要求：

- `id` 作为 app 的稳定技术标识，不得复用
- `menuKey` 作为 IPC 打开入口与菜单项 key，必须稳定
- `page` 必须对应 `src/renderer/pages/<page>/index.html`
- 窗口尺寸定义放在注册表，不散落到别处

### 4.2 打开链路

统一链路：

1. `embedded-app:list`
2. `embedded-app:open`
3. `openEmbeddedAppWindow(menuKey)`
4. `createSubWindow({ page, title, width, height })`

标准要求：

- 不为每个新 app 单独复制一套开窗逻辑
- 新 app 如需菜单入口，仍走注册表和统一 opener
- 子窗口统一走共享 `preload.js`

## 5. 当前安全与运行约束

子窗口统一约束：

- `contextIsolation: true`
- `nodeIntegration: false`
- `webviewTag: true`
- 通过 `contextBridge` 暴露受控 API

这意味着：

- 页面不能直接访问 Node.js API
- 所有系统能力必须通过 `window.electronAPI` 或 `window.hydroAgent` 进入
- 业务 app 不允许绕过宿主桥直接拼主进程能力

## 6. Agent 复用标准

### 6.1 必须复用 `window.hydroAgent`

内嵌 app 复用 Agent 能力时，必须使用共享桥：

- preload 暴露：`window.hydroAgent`
- 渲染侧适配：`createHydroAgentApiAdapter()`
- 宿主组件：`EmbeddedAgentPanel.vue`

不允许：

- 新 app 自己重新发明一套 `agent:*` IPC 协议
- 新 app 自己复制一套聊天消息渲染组件
- 新 app 直接在业务页面里堆聊天实现细节

### 6.2 会话类型

embedded client 创建的是受控 embedded 会话，主进程按 client 归属管理。实现要点：

- `window.hydroAgent.connect({ appId, defaultCwd, metadata })`
- `window.hydroAgent.listSessions()`
- 复用最近会话，必要时自动 `reopen`
- 新建会话时沿用共享 `AgentChatTab`

### 6.3 工作目录

每个内嵌 app 默认工作目录：

```text
{userData}/embedded-apps/{safeAppId}/workspace
```

标准要求：

- 不把业务数据直接写到主窗口 developer 工作区
- 不把 embedded app 工作目录和用户项目目录混用
- 文件树、预览、保存、插入路径统一走共享文件面板

## 7. 共享 UI 复用标准

### 7.1 标准宿主组件

`EmbeddedAgentPanel.vue` 是当前唯一推荐宿主组件。

当前固定形态：

- 平行 tab：`工作台助手` / `工作目录`
- 上下文信息以 tip 方式展示
- 会话能力以图标按钮打开面板
- 新建会话使用 `+` 图标按钮

标准要求：

- `工作台助手` 与 `工作目录` 必须是同级 tab
- 不再把工作目录切换嵌进助手区域内部
- 不为单个 app 定制另一套不同范式的右侧聊天壳

### 7.2 聊天区复用

聊天区必须复用：

- `AgentChatTab.vue`
- `useAgentChat.js`
- `ChatInput.vue`
- `ChatInputToolbar.vue`

原因：

- 这些组件已经承载模型切换、API Profile 切换、微信发送、交互请求响应、工具调用卡片、消息恢复等共享能力
- 新 app 自己再做一套，后续维护成本会直接失控

### 7.3 工作目录复用

工作目录页必须复用：

- `WorkspaceFilePanel.vue`
- `useEmbeddedAgentFiles.js`
- `useWorkspaceFiles.js`

原因：

- 当前预览、编辑、搜索、插入路径、打开输出目录等能力都已沉淀到共享文件面板
- 内嵌 app 只需要把 `hydroAgent` 文件 API 适配到统一数据模型

## 8. 上下文模型标准

### 8.1 必须提供结构化上下文

每个内嵌 app 必须提供 `contextProvider()`，返回：

```json
{
  "title": "当前对象 / 当前功能",
  "summary": "给模型看的上下文摘要",
  "payload": {}
}
```

标准要求：

- `title` 面向简短定位
- `summary` 面向模型快速理解当前状态
- `payload` 放结构化业务对象，不要只给一段长文本

### 8.2 上下文同步时机

业务页面状态变化后，必须显式调用上下文同步。

当前推荐做法：

1. 页面维护业务状态
2. 业务状态变化后调用 `notifyAgentContextChanged(force)`
3. `embedded-app-runtime-bridge.syncContext()` 推送到主进程

标准要求：

- 不要指望 Agent 从聊天记录“猜出”当前页面状态
- 当前站点、当前 tab、当前任务、当前记录等都应来自运行态上下文

## 9. 命令桥标准

### 9.1 受控动作模型

每个内嵌 app 必须提供 `commandHandler({ command, payload, appId, clientId })`。

用途：

- 把 Agent 请求转换成页面内部的受控动作
- 明确哪些动作允许执行，哪些不允许

标准要求：

- 只暴露受控动作，不暴露任意脚本执行
- 只返回结构化结果，不让模型假装“已经点了按钮”
- 页面跳转、切 tab、选中对象、刷新数据这类动作优先通过命令桥完成

### 9.2 当前通用工具契约

当前通用 MCP 工具：

- `context_get`
- `command_execute`

含义：

- `context_get` 读当前 app 上下文
- `command_execute` 执行 app 受控动作

新增 app 时，默认优先复用这两个通用工具，不要先急着新增专属工具。

## 10. 能力注入标准

### 10.1 通用注入层

所有 embedded session 都会注入：

- MCP server: `embeddedapp`
- system prompt: 内嵌 app 语义约束
- allowed tools: `mcp__embeddedapp__context_get`、`mcp__embeddedapp__command_execute`

### 10.2 业务专属注入层

仅当某个 app 确实需要更强领域语义时，再增加业务专属工具。

水文工作台是当前样板：

- 专属工具：当前站点、当前上下文、切 tab、打开审核页
- 专属 prompt：把“站点、审核任务、实时数据”等词优先解释为水文业务域
- 专属 disallowed tools：禁止为了查询当前 UI 状态去扫工作区

标准要求：

- 业务专属工具必须围绕“当前运行态业务对象”设计
- 不要用专属工具重复包装已有桌面级通用能力
- prompt 约束应解决语义歧义，而不是堆一段业务说明书

## 11. 偏好存储标准

内嵌 app 偏好统一由 `EmbeddedAppPreferencesManager` 保存。

当前允许保存：

- `apiProfileId`
- `modelId`

标准要求：

- 偏好与 appId 绑定
- 偏好保存在宿主配置，不保存在页面本地业务数据中
- 会话恢复可以读取本地最后 sessionId，但配置型偏好仍以主进程存储为准

## 12. 页面目录与实现模板

新内嵌 app 的推荐目录结构：

```text
src/renderer/pages/my-app/
  ├─ index.html
  ├─ main.js
  ├─ styles.css
  ├─ agent-panel.js
  ├─ views.js / state.js / actions.js
  └─ domain-specific files...
```

实现顺序建议：

1. 建页面骨架和业务状态
2. 在注册表中注册 app
3. 在 `index.html` 预留右侧 Agent 挂载点
4. 在 `agent-panel.js` 挂载 `EmbeddedAgentPanel`
5. 提供 `getContext()` 与 `commandHandler()`
6. 在关键状态变化时调用 `notifyAgentContextChanged()`
7. 如有必要，再补业务专属 capability 注入

## 13. 水文工作台样板拆解

水文工作台当前是完整样板，后续新 app 应优先对照它。

对应关系：

- 注册表：`embedded-app-registry.js`
- 页面入口：`pages/hydrology-workbench/index.html`、`main.js`
- Agent 面板挂载：`pages/hydrology-workbench/agent-panel.js`
- 运行态桥：`embedded-app-runtime-bridge.js`
- 共享宿主：`EmbeddedAgentPanel.vue`
- 专属能力：`embedded-app-capability-query-options.js`

它当前证明了以下复用方式可行：

- 业务页面和右侧 Agent 面板解耦
- 聊天与文件能力完全复用宿主
- 通过上下文同步把当前站点、功能页、审核任务暴露给 Agent
- 通过受控命令让 Agent 安全驱动业务页面

## 14. 测试标准

新增或调整内嵌 app 时，至少应覆盖以下几类测试：

1. 注册与开窗 wiring
2. preload / IPC bridge wiring
3. 宿主组件复用 wiring
4. 运行态上下文同步
5. 业务专属 capability 注入

当前可参考测试：

- `tests/main/embedded-app-demo-wiring.test.js`
- `tests/main/embedded-agent-bridge.test.js`
- `tests/main/embedded-agent-panel-wiring.test.js`
- `tests/main/hydrology-workbench-backend-wiring.test.js`
- `tests/main/hydrology-agent-panel-context.test.js`
- `tests/main/hydrology-capability-query-options.test.js`

## 15. 验收清单

一个新的内嵌 app 要达到可交付状态，至少满足：

1. 能通过注册表出现在主窗口 / Notebook 的嵌入 app 入口中
2. 能打开独立窗口，并正确加载页面入口
3. 右侧 Agent 能自动连接 embedded client
4. `工作台助手` 与 `工作目录` 为平行 tab
5. 工作目录可正常浏览、预览、保存、插入路径
6. 模型与 API Profile 切换能持久化
7. 当前上下文能随业务状态变化同步
8. Agent 能通过受控命令驱动关键页面动作
9. 业务语义不会误路由到不相关桌面能力
10. 对应 wiring 测试已补齐

## 16. 不再推荐的做法

后续新 app 不再推荐：

- 复制主窗口 `AgentRightPanel` 再改一版
- 在业务页面里手搓一个简化聊天组件
- 把“当前业务状态”写成 prompt 常量而不是运行态上下文
- 让 Agent 通过 Bash / Read / Grep 去猜当前 UI 状态
- 为每个 app 重新发明一套文件树或消息工具栏

## 17. 后续扩展方向

当前标准先服务于“内置内嵌 app”阶段。未来如果转向插入式安装，仍应保留以下稳定面：

- app 注册模型
- embedded runtime context / command bridge
- 共享 Agent 宿主组件
- 偏好存储模型
- 会话级能力注入模型

也就是说，将来即便 app 来源变成可安装包，内嵌 app 的复用契约也不应重新推倒。

## 18. 开发 Checklist

下面这份 checklist 面向“准备新增一个内嵌 app”的实际开发流程，按顺序执行。

### 18.1 立项前确认

- 明确这个功能是否真的需要独立 `BrowserWindow`
- 明确是否需要复用右侧 Agent 与工作目录
- 明确业务对象、当前上下文、可受控动作分别是什么
- 明确是否需要业务专属 MCP 工具，还是通用 `context_get` / `command_execute` 就够

如果这四点说不清，不要先开写页面。

### 18.2 主进程接入

- 在 `src/main/embedded-app-registry.js` 注册新 app
- 确认 `page`、`menuKey`、`titleKey`、`labelKey`、`icon` 都已定义
- 确认对应国际化文案已补齐
- 确认页面已加入 Vite 构建入口

检查结果：

- `embedded-app:list` 能列出该 app
- `embedded-app:open` 能正常开窗

### 18.3 页面骨架

- 新建 `src/renderer/pages/<app>/index.html`
- 新建 `main.js`
- 新建 `styles.css`
- 预留右侧 Agent 挂载容器
- 页面业务区先独立跑通，不要一开始就把 Agent 逻辑和业务逻辑混写

### 18.4 Agent 面板接入

- 新建 `agent-panel.js`
- 调用 `EmbeddedAgentPanel`
- 传入 `appId`
- 传入 `cwd`
- 传入 `contextProvider`
- 传入 `commandHandler`

检查结果：

- 打开页面后能建立 `window.hydroAgent.connect()`
- 页面首次进入能创建或恢复 embedded session
- `工作台助手` / `工作目录` 两个 tab 都能显示

### 18.5 上下文设计

- 定义 `title`
- 定义 `summary`
- 定义 `payload`
- 明确哪些业务状态变化后需要同步上下文

最少应覆盖：

- 当前对象
- 当前功能页
- 当前选中记录
- 当前任务或当前结果集

检查结果：

- 切换关键业务状态后，Agent 能回答“当前在看什么”
- 不需要依赖聊天历史猜测当前 UI

### 18.6 命令桥设计

- 列出允许 Agent 触发的页面动作
- 每个动作定义稳定命令名
- 为每个命令定义输入参数和返回结果
- 拒绝不安全或无边界的动作

建议优先支持：

- `refresh`
- `openTab`
- `selectXxx`
- `openXxxDetail`

检查结果：

- Agent 执行动作后，页面状态真实变化
- 返回结果能说明是否成功

### 18.7 共享能力复用检查

- 聊天是否复用了 `AgentChatTab`
- 工作目录是否复用了 `WorkspaceFilePanel`
- 文件 API 是否复用了 `useEmbeddedAgentFiles`
- 模型 / API Profile 切换是否沿用共享逻辑
- 微信通知入口是否沿用共享工具栏

如果这里出现“我单独写了一个简化版”，通常就是实现方向偏了。

### 18.8 能力注入检查

- 先确认通用 `embeddedapp` 工具是否已满足
- 只有在明确存在业务歧义时才新增专属工具
- 如有专属工具，补齐 prompt 约束与允许/禁用工具策略

检查结果：

- 问“当前站点 / 当前页 / 当前任务”时走运行态工具
- 不会误掉到桌面定时任务、工作区文件扫描等不相关路径

### 18.9 测试补齐

- 补注册与开窗 wiring
- 补 bridge wiring
- 补宿主组件复用 wiring
- 补上下文同步
- 补能力注入

最低要求不是“手点能用”，而是核心 wiring 有自动化测试兜底。

### 18.10 交付前验证

- 文档是否已同步
- 菜单入口是否正常
- 页面是否能正常打开和恢复
- 右侧 Agent 是否可连续对话
- 工作目录是否可浏览与预览
- 当前上下文是否实时更新
- 关键受控动作是否可执行
- 相关测试是否通过

## 19. 脚手架模板

这里给出一套“新内嵌 app 最小模板”，后续开发可以直接照着起。

### 19.1 注册表示例

```javascript
{
  id: 'my-workbench',
  menuKey: 'my-workbench',
  titleKey: 'app.windows.myWorkbench',
  labelKey: 'embeddedApps.myWorkbenchTitle',
  icon: 'panelLeft',
  page: 'my-workbench',
  window: {
    width: 1440,
    height: 920
  },
  enabled: true
}
```

### 19.2 页面目录模板

```text
src/renderer/pages/my-workbench/
  ├─ index.html
  ├─ main.js
  ├─ styles.css
  ├─ agent-panel.js
  ├─ state.js
  ├─ views.js
  └─ actions.js
```

### 19.3 `index.html` 模板

```html
<body>
  <div class="workbench-layout">
    <aside class="business-nav"></aside>
    <main class="business-main"></main>
    <section id="myWorkbenchAgentPanel" class="agent-side"></section>
  </div>
  <script type="module" src="./main.js"></script>
</body>
```

关键点：

- 右侧 Agent 容器单独留一个稳定 id
- 业务区和 Agent 区分开，不混写

### 19.4 `agent-panel.js` 模板

```javascript
import { createApp } from 'vue'
import EmbeddedAgentPanel from '@/components/embedded-agent/EmbeddedAgentPanel.vue'
import { createEmbeddedAppRuntimeBridge } from '@/components/embedded-agent/embedded-app-runtime-bridge'

export function mountMyWorkbenchAgentPanel({ target, getContext, commandHandler, cwd = '' }) {
  if (!target) return null
  let lastContextSignature = null

  const app = createApp(EmbeddedAgentPanel, {
    appId: 'my-workbench',
    appLabel: '',
    title: '',
    cwd,
    contextProvider: getContext
  })

  app.mount(target)

  const runtimeBridge = createEmbeddedAppRuntimeBridge(window.hydroAgent, {
    appId: 'my-workbench',
    getContext,
    commandHandler
  })

  const disposeCommandHandler = runtimeBridge?.registerCommandHandler?.() || (() => {})

  return {
    async notifyContextChanged(force = false) {
      const nextContext = typeof getContext === 'function' ? getContext() : null
      const nextSignature = JSON.stringify(nextContext || null)
      if (!force && nextSignature === lastContextSignature) {
        return false
      }
      lastContextSignature = nextSignature
      await runtimeBridge?.syncContext?.()
      window.dispatchEvent(new CustomEvent('embedded-agent:context-changed'))
      return true
    },
    unmount() {
      disposeCommandHandler()
      app.unmount()
    }
  }
}
```

### 19.5 `main.js` 模板

```javascript
import { mountMyWorkbenchAgentPanel } from './agent-panel'

const state = {
  currentObject: null,
  activeTab: 'overview',
  currentTask: null
}

function getAgentContext() {
  return {
    title: `${state.currentObject?.name || '未选择对象'} / ${state.activeTab}`,
    summary: `当前对象：${state.currentObject?.name || '无'}；当前页面：${state.activeTab}。`,
    payload: {
      appId: 'my-workbench',
      currentObject: state.currentObject,
      activeTab: state.activeTab,
      currentTask: state.currentTask
    }
  }
}

async function handleAgentCommand({ command, payload }) {
  switch (command) {
    case 'refresh':
      await reloadPageData()
      return { success: true }
    case 'openTab':
      state.activeTab = payload?.tabKey || 'overview'
      render()
      return { success: true, activeTab: state.activeTab }
    default:
      return { success: false, error: `Unsupported command: ${command}` }
  }
}

const agentPanel = mountMyWorkbenchAgentPanel({
  target: document.getElementById('myWorkbenchAgentPanel'),
  getContext: getAgentContext,
  commandHandler: handleAgentCommand,
  cwd: ''
})

function notifyAgentContextChanged(force = false) {
  agentPanel?.notifyContextChanged(force)
}
```

### 19.6 何时需要专属能力文件

只有满足下面条件之一，才建议扩展 `embedded-app-capability-query-options.js`：

- 通用 `context_get` / `command_execute` 不足以表达当前业务
- 存在明显语义歧义，模型常误判业务名词
- 某些高频操作值得抽成稳定工具，而不是让模型自己拼命令参数

否则，先保持最小实现。

## 20. 推荐交付物

新内嵌 app 第一版至少应包含这些交付物：

- 页面代码
- 注册表接入
- 共享 Agent 面板接入
- 上下文与命令桥
- wiring 测试
- 文档更新

不建议第一版就同时做：

- 自定义聊天壳
- 复杂专属 MCP 工具族
- 和宿主能力并行的另一套文件系统面板
- 大量抽象层提前建设
