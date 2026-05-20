# Phase 0 基线检查清单与记录

> 状态：执行中  
> 目的：作为正式进入平台改造前的检查清单和首轮基线记录。

## 1. Phase 0 目标

在真正进入 Agent Platform 改造和水文工作台开发前，先完成以下事情：

- 记录当前平台行为基线
- 确认关键测试范围
- 跑通第一轮最关键基线测试
- 明确当前工作区中的非本次任务改动

## 2. 当前工作区状态

基线检查时已确认：

- 当前工作区存在无关改动：`CLAUDE.md`
- 本轮 Phase 0 不应修改或提交该文件

## 3. 已完成的基线文档

本轮已完成：

- `docs/code-index/agent-platform-baseline.md`

该文档记录了：

- 当前 `agent:*` IPC 基线
- 当前 preload Agent API 基线
- 当前 main -> renderer 事件基线
- 当前单宿主模型的关键耦合点

## 4. 基线测试范围

建议把基线测试分成三层。

### 4.1 Agent 核心层

优先测试：

- `tests/main/agent-interactions.test.js`
- `tests/main/agent-handlers-set-model.test.js`
- `tests/main/agent-path-normalize.test.js`
- `tests/main/desktop-capability-query-options.test.js`
- `tests/main/claude-code-runner.test.js`

### 4.2 Notebook / 关联业务层

优先测试：

- `tests/main/notebook-manager.test.js`
- `tests/main/notebook-generation.test.js`

### 4.3 调度 / 外部桥接层

优先测试：

- `tests/main/scheduled-task-service.test.js`
- `tests/main/scheduled-task-meta.test.js`
- `tests/main/weixin-bridge.test.js`
- `tests/main/weixin-notify-service.test.js`

## 5. 首轮基线执行计划

首轮不追求一次跑完整个测试矩阵，先跑最关键的一组：

1. Agent 核心
2. Notebook 关键能力
3. Scheduled Task
4. Weixin bridge

如果首轮全部通过，再考虑完整回归。

## 6. 基线执行记录

### 6.1 文档基线

- 已完成 Agent IPC / preload / 事件语义基线记录

### 6.2 测试基线

已执行首轮关键测试：

- `tests/main/agent-interactions.test.js`
- `tests/main/agent-handlers-set-model.test.js`
- `tests/main/agent-path-normalize.test.js`
- `tests/main/desktop-capability-query-options.test.js`
- `tests/main/notebook-manager.test.js`
- `tests/main/scheduled-task-service.test.js`
- `tests/main/weixin-bridge.test.js`
- `tests/main/weixin-notify-service.test.js`

执行结果：

- 8 个测试文件中，7 个通过，1 个失败
- 总计 166 个测试中，165 个通过，1 个失败

通过的关键链路：

- Agent 核心交互
- Agent setModel IPC
- Agent 路径规范化
- Desktop capability 注入
- Scheduled Task 服务
- Weixin Bridge
- Weixin Notify Service

当前失败项：

- `tests/main/notebook-manager.test.js`
- 失败用例：`saveChatImageToAchievement: 写入 achievements/fromchat 并新增 done 索引`
- 断言差异：期望 `achievement.type === 'fromchat'`，实际为 `image`

初步判断：

- 这是 **当前工作区基线中已存在的 Notebook 相关失败**
- 不是本轮 Phase 0 文档工作引入的问题
- 在进入第 1 期平台改造前，应先决定是否需要把该失败修复到基线全绿

### 6.3 风险记录

当前已知风险：

- Agent 改造涉及主进程、preload、数据库和事件流，任何一步都会影响宿主现有体验
- 因此第 1 期必须以“兼容式重构”为原则，不允许直接替换当前宿主 API
- 当前关键基线测试并非全绿，存在 1 个 Notebook 相关失败，需要在进入正式编码前明确处理策略

## 7. Phase 0 结束标准

满足以下条件后，可认为 Phase 0 基线准备完成：

1. 基线文档完成
2. 关键测试首轮已执行并有记录
3. 当前非本轮任务改动已识别清楚
4. 已形成正式实施顺序共识

补充说明：

- 若要求“进入第 1 期前基线全绿”，则当前 Phase 0 还不能算完全结束
- 若接受“已知单个非平台相关失败先记录、后单独处理”，则可进入第 1 期准备阶段

## 8. 下一步

Phase 0 完成后，进入：

- 第 1 期：Agent Platform 底座改造

进入前必须再次确认：

- feature flag 策略
- owner 字段迁移策略
- 事件发布器兼容策略
