# Embedded Agent Minimal

这是一个最小内嵌页面示例，用于验证：

- `window.hydroAgent`
- `window.hydroHostTheme`
- embedded session 的创建、发消息、收事件、响应交互

## 1. 适用场景

这个示例不是独立浏览器页面，而是给 Hydro Desktop 内嵌页面联调用的最小样板。

它适合验证：

- 内嵌页面能否正常 `connect`
- session 是否按 `embed:<appId>` 创建
- 流式事件是否只回到当前页面
- 主题桥是否能工作

正式内嵌 app 不建议直接以本示例目录作为长期安装目录。

正式目录规范建议为：

```text
<userData>/embedded-apps/<appId>/
  app.json
  web/
  assets/
  data/
  workspace/
  skills/
```

本示例只承担两件事：

- 演示 bridge 怎么接
- 作为未来正式内嵌 app 的最小页面模板

## 2. 文件

- `index.html`
- `app.js`
- `styles.css`

## 3. 当前能力

- 连接 embedded agent bridge
- 创建新会话
- 发送消息
- 展示事件流
- 自动处理最简单的 `ask_user_question`
- 宿主题同步

## 4. 接入说明

页面加载后会先检测：

- `window.hydroAgent`
- `window.hydroHostTheme`

如果不在 Hydro Desktop 的 embedded 环境中打开，页面会显示“bridge 不可用”的提示。

## 5. 建议联调步骤

1. 把这个目录作为一个内嵌页面资源入口接到 desktop
2. 打开页面
3. 点击 `Connect`
4. 点击 `New Session`
5. 输入消息并发送
6. 观察右侧事件流
7. 切换宿主主题，观察页面风格同步

## 6. 说明

- 这是最小示例，不代表正式业务 UI
- 样式保持轻量，重点是验证平台复用链路
- 如果后续要做业务工作台，应在这个样板上替换界面，而不是重复接底层 SDK
- 如果进入正式内嵌 app 形态，应把页面资源迁入 `<userData>/embedded-apps/<appId>/web/`
