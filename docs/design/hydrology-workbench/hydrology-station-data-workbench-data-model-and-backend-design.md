# 水文站点数据检查工作台数据模型与后端分层设计

> 状态：设计草案
> 关联需求：`docs/design/hydrology-workbench/hydrology-station-data-workbench-requirements.md`
> 关联主设计：`docs/design/hydrology-workbench/hydrology-station-data-workbench-design.md`
> 关联平台设计：`docs/design/standalone-app/agent-platform-technical-design.md`

## 1. 文档目标

本文档用于明确“水文站点数据检查工作台”的后端实现骨架，重点回答以下问题：

- 业务主数据、过程数据、结果数据分别如何建模
- Node.js 与 Python 在后端中分别承担什么职责
- 定时任务、规则检查、异常流转、统计摘录如何串成可执行链路
- AI 助手在业务系统中如何复用 Desktop 底层 Agent Session
- 多站点并发时，后端如何保持可控、可追溯、可扩展

本文档的核心结论是：

- **Node.js 是统一后端主控层**
- **Python 仅作为算法执行层 / worker 服务**
- **业务系统不直接复用宿主聊天 session，而是通过 embedded client 方式复用底层 Agent Session 能力**

## 2. 总体后端架构

### 2.1 分层结论

```text
Hydrology Workbench UI
        ↓
Hydrology Application Service（Node.js 主控）
        ↓
Domain Services / Rule Engine / Task Orchestrator（Node.js）
        ↓
Data Access + Integration Gateway（Node.js）
        ├─ hydrology.db / 业务存储
        ├─ Desktop Scheduler / Notification / Agent Bridge
        └─ Python Algorithm Worker
```

### 2.2 角色划分

#### Node.js 主控层负责

- 业务 API / IPC / 页面调用入口
- 站点、数据、任务、异常、统计、摘录的状态管理
- 定时任务注册、调度、重跑、补跑、幂等控制
- 规则执行编排
- 调用 Python 算法服务并接收结果
- 复用 Desktop Agent Session、MCP、通知、配置能力
- 写入数据库、生成审计记录、控制权限边界

#### Python 算法层负责

- 视频水尺识别
- 图像预处理与识别辅助
- 毛刺检测
- 突变检测
- 变幅分析
- 更复杂的时序质量算法
- 后续重计算型数值分析

### 2.3 明确边界

Python **不负责**：

- 业务任务编排
- 任务调度主控
- 异常状态流转
- Agent Session 管理
- Desktop 能力接入
- 最终业务结果入库

这意味着后端不需要改造成“Python 主系统”。正确模式是：

```text
Node.js 编排业务
  → 调 Python 算法
  → 回收算法结果
  → Node.js 做业务判定、状态流转、入库和通知
```

## 3. 模块划分设计

### 3.1 Node.js 业务模块建议

建议在主进程业务域下按“领域 + 能力”拆分：

```text
src/main/hydrology/
  app/
    hydrology-app-service.js
    hydrology-router.js
  domain/
    station/
    reading/
    task/
    rule/
    anomaly/
    stats/
    extract/
    assist/
  integrations/
    scheduler/
    notifications/
    desktop-agent/
    python-algorithm/
  db/
    hydrology-schema.js
    hydrology-migrations.js
```

### 3.2 核心服务职责

#### `StationService`

- 站点主数据维护
- 站点状态维护
- 站点规则参数覆盖
- 站点视频配置维护

#### `ReadingService`

- 录入人工观测值
- 接收视频识别值
- 管理数据修正与版本留痕
- 按站点 / 时间范围输出统一数据视图

#### `TaskService`

- 创建检查、统计、摘录、识别等任务实例
- 记录计划触发与实际执行
- 管理补跑、重跑、失败重试
- 提供站点级并发控制

#### `RuleEngineService`

- 编排完整性、一致性、合理性、时序质量规则
- 接收 Node 原生规则结果和 Python 算法结果
- 统一生成 `RuleHit`

#### `AnomalyService`

- 将规则命中转成异常记录
- 去重、合并、升级严重度
- 维护异常生命周期
- 记录人工复核动作

#### `StatsService`

- 负责气温 20:00 统计
- 负责水位 00:00 统计
- 管理统计口径、状态和结果

#### `ExtractService`

- 负责水位 00:00 摘录
- 对比摘录值与平均值
- 输出偏差判断结果

#### `AlgorithmGateway`

- 封装对 Python worker 的调用
- 管理超时、重试、失败分类、输入输出协议
- 保证上层业务不依赖 Python 实现细节

#### `AIAssistService`

- 组装业务上下文
- 创建 / 复用 `embed:hydrology-workbench` 会话
- 请求异常解释、修正建议、统计总结
- 记录 AI 生成结果和引用上下文

## 4. 核心数据模型

## 4.1 建模原则

- 业务主数据与过程执行数据分离
- 原始数据、修正数据、识别数据分离但可关联
- 规则命中、异常流转、统计结果、摘录结果各自独立存储
- 所有人工操作与 AI 输出都要可追溯
- 支持多站点并发运行和按日补跑

## 4.2 实体总览

建议首版至少包含以下核心实体：

- `Station`
- `StationRuleProfile`
- `StationVideoSource`
- `Reading`
- `ReadingRevision`
- `InspectionTask`
- `TaskRun`
- `RuleDefinition`
- `RuleHit`
- `Anomaly`
- `AnomalyReview`
- `DailyStatsResult`
- `ExtractResult`
- `AssistSession`
- `AssistArtifact`

## 4.3 站点主数据

### `Station`

用于描述一个业务站点。

建议字段：

- `id`
- `code`
- `name`
- `type`
- `regionCode`
- `regionName`
- `status`
- `timezone`
- `tags`
- `description`
- `createdAt`
- `updatedAt`

### `StationRuleProfile`

用于保存站点级规则参数覆盖。

建议字段：

- `id`
- `stationId`
- `waterLevelMin`
- `waterLevelMax`
- `temperatureMin`
- `temperatureMax`
- `manualVideoTolerance`
- `extractAverageTolerance`
- `maxAmplitudePerHour`
- `spikeThreshold`
- `jumpThreshold`
- `timeGapToleranceMinutes`
- `enabledRules`
- `createdAt`
- `updatedAt`

说明：

- 全局默认阈值保存在系统级配置
- 站点级配置只保存 override
- 规则执行时由 `RuleProfileResolver` 合并全局默认值和站点覆盖值

### `StationVideoSource`

用于管理视频配置。

建议字段：

- `id`
- `stationId`
- `sourceType`
- `sourceUri`
- `captureIntervalSeconds`
- `framePolicy`
- `enabled`
- `lastHealthCheckAt`
- `lastHealthStatus`
- `createdAt`
- `updatedAt`

## 4.4 数据模型

### `Reading`

统一承载水位和气温观测记录。

建议字段：

- `id`
- `stationId`
- `dataType`
- `observedAt`
- `sourceType`
- `value`
- `unit`
- `qualityStatus`
- `ingestBatchId`
- `sourceRef`
- `isDerived`
- `derivedFromReadingId`
- `createdAt`
- `updatedAt`

推荐 `sourceType` 枚举：

- `manual_observation`
- `video_recognition`
- `auto_collector`
- `external_import`
- `corrected_value`

推荐 `qualityStatus` 枚举：

- `raw`
- `checked`
- `suspected`
- `confirmed_error`
- `corrected`
- `ignored`

说明：

- 水位和气温统一使用一张 `Reading` 表，更利于任务与规则通用化
- 若后续性能或字段差异明显，再拆分只影响 repository 层，不影响领域模型

### `ReadingRevision`

用于保留“原始值 -> 修正值”的过程链。

建议字段：

- `id`
- `readingId`
- `previousValue`
- `newValue`
- `reasonType`
- `reasonText`
- `operatorType`
- `operatorId`
- `operatorName`
- `relatedAnomalyId`
- `createdAt`

说明：

- 任何人工修正都不覆盖审计链
- 业务展示层可显示“当前生效值”，审计层查看 revision 历史

## 4.5 任务模型

### `InspectionTask`

表示一个业务任务模板或业务任务实例。

建议字段：

- `id`
- `taskType`
- `stationScopeType`
- `stationId`
- `scheduleKey`
- `businessDate`
- `plannedAt`
- `triggerMode`
- `status`
- `idempotencyKey`
- `createdAt`
- `updatedAt`

推荐 `taskType`：

- `video_recognition`
- `daily_check`
- `temperature_daily_stats`
- `water_level_daily_stats`
- `water_level_extract`
- `anomaly_recheck`
- `daily_summary`

### `TaskRun`

用于记录某次实际执行。

建议字段：

- `id`
- `taskId`
- `runNo`
- `startedAt`
- `finishedAt`
- `status`
- `executorType`
- `executorRef`
- `inputSnapshot`
- `outputSummary`
- `errorCode`
- `errorMessage`
- `retryOfRunId`
- `createdAt`

说明：

- `InspectionTask` 负责“任务是什么”
- `TaskRun` 负责“这次执行发生了什么”

## 4.6 规则与异常模型

### `RuleDefinition`

用于定义业务规则元信息。

建议字段：

- `id`
- `ruleCode`
- `ruleName`
- `dataType`
- `ruleCategory`
- `severityDefault`
- `enabled`
- `algorithmType`
- `parameterSchema`
- `description`
- `createdAt`
- `updatedAt`

推荐 `ruleCategory`：

- `completeness`
- `consistency`
- `rationality`
- `time_series_quality`

推荐 `algorithmType`：

- `node_builtin`
- `python_worker`
- `hybrid`

### `RuleHit`

用于记录规则命中结果。

建议字段：

- `id`
- `taskRunId`
- `ruleDefinitionId`
- `stationId`
- `dataType`
- `timeRangeStart`
- `timeRangeEnd`
- `severity`
- `status`
- `sourceReadingIds`
- `compareReadingIds`
- `metrics`
- `decisionMessage`
- `suggestedAction`
- `createdAt`

说明：

- `metrics` 用于保存偏差值、变化幅度、毛刺评分等数值依据
- `sourceReadingIds` 和 `compareReadingIds` 用于追溯判定证据

### `Anomaly`

用于承载实际待处理问题。

建议字段：

- `id`
- `stationId`
- `dataType`
- `anomalyType`
- `severity`
- `status`
- `sourceRuleHitId`
- `title`
- `summary`
- `businessDate`
- `firstObservedAt`
- `lastObservedAt`
- `assigneeId`
- `assigneeName`
- `resolvedAt`
- `resolutionType`
- `createdAt`
- `updatedAt`

推荐 `status`：

- `pending`
- `reviewing`
- `confirmed`
- `corrected`
- `ignored`
- `closed`

### `AnomalyReview`

用于记录人工复核动作。

建议字段：

- `id`
- `anomalyId`
- `reviewAction`
- `decision`
- `reasonText`
- `appliedRevisionId`
- `reviewerId`
- `reviewerName`
- `createdAt`

说明：

- `Anomaly` 是当前状态
- `AnomalyReview` 是过程留痕

## 4.7 统计与摘录模型

### `DailyStatsResult`

建议字段：

- `id`
- `stationId`
- `dataType`
- `businessDate`
- `statsWindowStart`
- `statsWindowEnd`
- `statsMethod`
- `sourceReadingCount`
- `validReadingCount`
- `resultPayload`
- `status`
- `taskRunId`
- `createdAt`
- `updatedAt`

### `ExtractResult`

建议字段：

- `id`
- `stationId`
- `businessDate`
- `extractAt`
- `extractValue`
- `averageValue`
- `deviationValue`
- `deviationRate`
- `judgementStatus`
- `taskRunId`
- `relatedStatsResultId`
- `createdAt`
- `updatedAt`

## 4.8 AI 辅助模型

### `AssistSession`

用于记录业务侧 AI 会话映射。

建议字段：

- `id`
- `agentSessionId`
- `ownerClientId`
- `sceneType`
- `stationId`
- `relatedEntityType`
- `relatedEntityId`
- `contextSnapshot`
- `status`
- `createdAt`
- `updatedAt`

推荐 `sceneType`：

- `anomaly_explain`
- `correction_suggest`
- `daily_stats_summary`
- `result_report`

### `AssistArtifact`

用于保存 AI 输出结果。

建议字段：

- `id`
- `assistSessionId`
- `artifactType`
- `title`
- `content`
- `sourceRefs`
- `createdAt`

说明：

- 不建议只把 AI 输出当作聊天消息存在底层 agent 表里
- 业务侧需要结构化索引和业务对象关联

## 5. 数据库建议

### 5.1 首版存储结论

建议首版使用独立业务数据库：

- `hydrology.db`

不与现有会话数据库混用：

- `sessions.db`

### 5.2 原因

- 业务数据与聊天会话数据关注点完全不同
- 水文数据存在持续增长，后续会有清理和归档需求
- 独立数据库更利于迁移、备份、导出和后续接外部库

### 5.3 索引建议

至少建立以下索引：

- `readings(station_id, data_type, observed_at)`
- `inspection_tasks(task_type, business_date, station_id)`
- `task_runs(task_id, started_at)`
- `rule_hits(station_id, data_type, created_at)`
- `anomalies(status, severity, station_id, business_date)`
- `daily_stats_results(station_id, data_type, business_date)`
- `extract_results(station_id, business_date)`

## 6. 任务执行流设计

## 6.1 视频识别任务流

```text
定时器触发
  ↓
TaskService 创建 video_recognition task/run
  ↓
ReadingService 获取站点视频配置
  ↓
AlgorithmGateway 调 Python 识别 worker
  ↓
返回识别值、识别置信度、识别元数据
  ↓
ReadingService 写入 Reading(sourceType=video_recognition)
  ↓
必要时触发后续检查
```

## 6.2 每日检查任务流

```text
定时器触发 / 手工补跑
  ↓
TaskService 创建 daily_check run
  ↓
ReadingService 读取站点当日数据
  ↓
RuleEngineService 执行：
  1. 完整性规则
  2. 一致性规则
  3. 合理性规则
  4. 时序质量规则
  ↓
生成 RuleHit
  ↓
AnomalyService 生成 / 合并 Anomaly
  ↓
NotificationService 推送待办提醒
```

## 6.3 统计与摘录任务流

### 气温 20:00 统计

```text
20:00 定时触发
  ↓
读取气温数据
  ↓
检查是否可统计
  ↓
生成 DailyStatsResult(dataType=temperature)
  ↓
必要时生成 AI 总结
```

### 水位 00:00 统计与摘录

```text
00:00 定时触发
  ↓
读取水位数据
  ↓
完成水位统计
  ↓
同步执行摘录
  ↓
比较摘录值 vs 平均值
  ↓
若偏差超阈值，生成 RuleHit 与 Anomaly
  ↓
写入 DailyStatsResult + ExtractResult
```

## 7. 异常生命周期设计

### 7.1 生命周期

```text
规则命中
  ↓
pending（待处理）
  ↓
reviewing（人工复核中）
  ├─ confirmed（确认异常）
  ├─ corrected（已修正）
  ├─ ignored（忽略并说明原因）
  └─ closed（关闭）
```

### 7.2 关键原则

- 同一业务问题尽量归并到同一 `Anomaly`
- 新命中可升级已有异常严重度
- 人工处理必须形成 `AnomalyReview`
- 修正动作必须形成 `ReadingRevision`

## 8. Node 与 Python 的调用边界

## 8.1 推荐协议

首版建议抽象成统一 `AlgorithmGateway`，Node 不直接散落执行 Python 命令。

可选实现形态：

1. 本地 Python 进程 + HTTP API
2. 本地 Python 进程 + gRPC
3. 主进程拉起 Python worker，走 stdin/stdout 协议

设计上推荐优先保证：

- 输入输出协议固定
- 算法调用可超时
- 算法失败不拖死主业务流程
- 算法结果可审计

### 8.2 输入输出契约建议

Node -> Python 输入至少包含：

- `jobType`
- `stationId`
- `dataType`
- `timeRange`
- `readings`
- `stationRuleProfile`
- `contextMeta`

Python -> Node 输出至少包含：

- `success`
- `metrics`
- `candidateIssues`
- `artifacts`
- `errorCode`
- `errorMessage`

### 8.3 失败处理原则

- Python 超时：当前 task run 标记失败或部分失败
- Python 算法异常：不中断其他站点执行
- Node 负责记录错误并决定是否重试

## 9. 多站点并发与性能设计

## 9.1 并发原则

- 任务编排在 Node 统一调度
- 站点级并发，不同站点可并行
- 同一站点同一业务日期的同类任务必须串行

### 9.2 推荐策略

- 使用 `idempotencyKey` 防止重复触发
- 使用 `stationId + taskType + businessDate` 作为串行锁粒度
- Python worker 使用有限并发池，避免资源打爆
- 任务结果分站点落库，避免单批大事务

### 9.3 首版性能优先级

首版优先保证：

- 正确性
- 可追溯性
- 可补跑

不是优先追求：

- 极限吞吐
- 分布式复杂调度

## 10. AI 复用设计

## 10.1 业务侧 AI 的定位

AI 不是后端主控，不参与确定性业务判定。它负责：

- 异常解释
- 修正建议
- 统计总结
- 成果说明

## 10.2 会话复用方式

业务侧必须复用 Desktop 底层 Agent Session，但采用独立 owner：

- `clientId = embed:hydrology-workbench`

不直接复用：

- `host-ui` 聊天窗口 session

### 10.3 `AssistContext` 组装建议

在调用 `AIAssistService` 时，由 Node 统一组装上下文：

- 站点基础信息
- 当前数据类型
- 当前时间范围
- 最近观测数据摘要
- 当前规则命中详情
- 当前异常状态
- 相关统计结果
- 相关摘录结果
- 允许的处理动作

### 10.4 注入方式

运行时建议采用：

- **结构化上下文注入**
- **专用业务 MCP 工具**

开发时建议采用：

- **官方 skill 注入开发帮助**

这里要明确：

- `skill` 主要用于“让 Hydro Desktop 里的聊天开发能力知道应该如何帮用户开发这类内嵌应用”
- `skill` 不是业务应用运行时依赖

## 11. 与 Desktop 平台复用关系

本应用后端建议复用以下现有能力：

- 定时任务体系
- Agent Session 能力
- Provider / Model / Profile 配置
- 通知体系
- MCP 执行能力

本应用新增建设的部分：

- 业务数据库
- 业务领域服务
- 规则引擎
- Python 算法网关
- 业务专用 MCP
- 业务 AI 上下文组装层

## 12. 首版实施建议

### 12.1 第一批必须先落的后端骨架

- `hydrology.db` 与迁移
- `StationService`
- `ReadingService`
- `TaskService`
- `RuleEngineService`
- `AnomalyService`
- `StatsService`
- `ExtractService`
- `AlgorithmGateway`
- `AIAssistService`

### 12.2 第一批先做 Node 原生规则

优先落地：

- 缺失检查
- 边界值检查
- 人工值 vs 视频识别值一致性检查
- 摘录值 vs 平均值误差检查

### 12.3 第一批再接 Python 算法能力

优先放到 Python 的能力：

- 毛刺检测
- 突变检测
- 高级变幅分析
- 视频水尺识别

## 13. 结论

这套后端设计的关键不是“是否上 Python”，而是：

- **业务主控必须稳定收敛在 Node.js**
- **算法能力通过 Python 外接**
- **AI 会话能力通过 Desktop Agent Platform 复用**
- **业务主数据、异常流转、统计摘录、AI 辅助全部形成可追溯闭环**

因此，对你刚才的问题，正式结论就是：

**是的，Node 做后端服务主控，Python 仅作为算法调用即可，后端不需要由 Python 来控制。**
