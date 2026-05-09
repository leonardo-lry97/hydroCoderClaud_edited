# 水文站点数据检查工作台 — 设计方案大纲

> 基于需求文档 v2，进入骨架设计前的总体设计规划。
> 本文档列出需要决策的关键点，逐项确认后进入详细设计。

---

## 一、总体架构

### 1.1 应用形态 ✅ 已确认

| 决策 | 结论 |
|------|------|
| 入口 | **独立 BrowserWindow**，与主窗口并行存在 |
| 生命周期 | 懒加载，首次进入时初始化 |
| 与主窗口关系 | 从 Desktop 主应用链接进入时，不覆盖原有主窗口内容 |

> 类似现有 Notebook 独立窗口的实现方式，通过 `window:openHydrologyWorkspace` IPC 打开，主进程保证单例。

### 1.2 技术栈

| 层 | 建议选型 | 理由 |
|----|---------|------|
| UI 框架 | Vue 3 + Naive UI | 与 Hydro Desktop 现有技术栈一致 |
| 本地数据库 | better-sqlite3 | 与 Hydro Desktop 现有方案一致 |
| 规则引擎 | 代码内建规则模块 | 固定规则，不需要 Drools 等外部引擎 |
| AI 视觉 | 待定 | 水尺识别模型选型 / API 调用 / 本地 ONNX |
| 定时任务 | 复用 ScheduledTaskService | Hydro Desktop 现有能力 |
| Agent 对话 | 复用 Agent Session | 用于 AI 辅助解释/总结 |

---

## 二、技术设计（需要决策的点）

### 2.1 项目结构

```
src/
  main/
    hydrology/                    # 水文工作台主进程模块
      db/                         # 数据库层
        schema.js                 # 建表与迁移
        station-db.js             # 站点 CRUD
        data-db.js                # 水位/气温数据
        check-db.js               # 检查结果
        anomaly-db.js             # 异常记录
        statistics-db.js          # 统计结果
        extraction-db.js          # 摘录结果
      rules/                      # 规则引擎
        engine.js                 # 规则调度入口
        completeness.js           # 完整性规则
        consistency.js            # 一致性规则
        rationality.js            # 合理性规则
        time-series.js            # 时序质量规则
        config.js                 # 规则阈值配置
      video/                      # 视频识别管线
        capture.js                # 关键帧截取
        recognizer.js             # 水尺识别（模型调用）
        scheduler.js              # 识别任务调度
      services/
        check-service.js          # 检查任务编排
        statistics-service.js     # 统计服务
        extraction-service.js     # 摘录服务
        anomaly-service.js        # 异常管理服务
      ipc-handlers.js             # IPC 通道注册
    preload/
      hydrology-api.js            # contextBridge 暴露
    renderer/
      pages/hydrology/            # 水文工作台页面
        App.vue                   # 页面入口
        views/
          StationManagement.vue   # 站点管理
          RealTimeData.vue        # 实时数据
          CheckTasks.vue          # 检查任务
          AnomalyCenter.vue       # 异常中心
          StatisticsResult.vue    # 统计结果
          WaterLevelExtraction.vue # 水位摘录
          Achievements.vue        # 成果展示
        components/
          DataTable.vue           # 数据表格（通用）
          AnomalyCard.vue         # 异常卡片
          StationSelector.vue     # 站点选择器
          TimeRangePicker.vue     # 时间范围选择
          AiAssistantPanel.vue    # AI 助手侧边面板
```

**需要确认的点：**
- 结构是否合理？是按功能分层（db/rules/services/video）还是按业务模块分？
- 与主进程的 IPC 是集中在一个 handler 文件还是按领域拆多个？

### 2.2 数据库设计

主表初步规划：

| 表 | 用途 | 关键字段 |
|----|------|---------|
| stations | 站点主数据 | id, code, name, type, region, status, config(JSON) |
| water_level_data | 水位观测数据 | id, station_id, time, manual_value, video_value, source |
| temperature_data | 气温数据 | id, station_id, time, value, source |
| check_tasks | 检查任务记录 | id, station_id, task_type, trigger_time, status |
| check_results | 规则检查结果 | id, task_id, rule_code, level, description, raw_values(JSON) |
| anomalies | 异常记录 | id, check_result_id, status, handler, handled_at, remark |
| statistics | 统计结果 | id, station_id, type, period_start, period_end, result(JSON) |
| extractions | 摘录结果 | id, station_id, time, value, avg_value, deviation, status |

**已确认：**
- **独立数据库** `hydrology.db`，不与现有 `sessions.db` 混用
- **水位数据结构**：一行两列，`manual_value` + `video_value` 同一行存储
- 复用 Hydro Desktop 现有能力（定时任务、Agent Session 等）的部分仍使用主进程已有模块

**仍待确认：**
- 历史数据保留策略：保留多久？自动清理还是手动归档？

### 2.3 视频识别管线

**已确认：**
- **MVP 阶段**：本地视频文件模拟，后续再对接 RTSP 流

**仍待确认：**
- 识别模型：调用外部 API（如阿里云视觉）还是本地 ONNX 模型？
- 单站点单摄像头，还是单站点多角度多摄像头？

### 2.4 规则引擎架构

**需要确认的点：**
- 规则是写死代码还是做成可配置的（阈值动态修改）？
- 规则按站点独立配置，还是全局统一阈值？
- 异常级别（提示/警告/严重）是规则固定关联还是可调整？

### 2.5 与 Hydro Desktop 集成

**需要确认的点：**
- 数据库：使用现有的 sessions.db 扩充表，还是独立的 `hydrology.db`？
- IPC 通道：复用 `notebook:*` 风格，注册 `hydrology:*` 域
- 定时任务：直接在 ScheduledTaskService 中注册水文专用任务，还是设计一个内部调度器？

---

## 三、功能设计（需要决策的点）

### 3.1 站点管理 ✅ 已确认

- **MVP 阶段**：手动录入，后续支持批量导入（Excel/CSV）
- MVP 阶段预置站点字段待后续设计明确

### 3.2 数据来源

✅ 已确认：当前阶段以自有 `hydrology.db` 为数据来源，将来可接驳已有外部数据源。

### 3.3 人工观测值录入

- 手动录入：是在工作台内嵌表单录入，还是支持导入外部文件？
- 如果是导入，支持什么格式？

### 3.3 检查任务

- 每日检查是自动全量执行，还是按站点粒度手动选择执行？
- 是否需要支持"补跑"——对过去某一天重新执行检查？

### 3.4 异常处理

- 复核流程：单人确认即可，还是需要多级审批？
- 修正操作：修正后的值是否要保留原始值作为追溯？

### 3.5 AI 辅助面板

- 面板的触发方式：每个页面自动显示 / 点击按钮展开 / 固定在右侧？
- 面板上下文如何传递（当前正在查看的站点、异常、统计等）？

---

## 四、UI 设计（需要决策的点）

### 4.1 页面布局 ✅ 已确认

```
┌──────────────┬──────────────────────────────────┬──────────────┐
│  顶部导航栏   │  （站点 / 数据 / 检查 / 异常 /   │              │
│              │   统计 / 摘录 / 成果）            │              │
├──────────────┼──────────────────────────────────┤  AI 助手面板  │
│  左侧         │  中间内容区                      │  （可折叠）   │
│  站点导航树   │  （站点数据/成果/任务状态区域）   │              │
│              │                                  │              │
│              │                                  │              │
└──────────────┴──────────────────────────────────┴──────────────┘
```

布局结构：
- **顶部**：一级导航栏
- **左侧**：站点导航树（可按区域/分组筛选）
- **中间**：数据展示 + 成果 + 任务状态区域
- **右侧**：AI 助手面板（可折叠）

**仍待确认：**
- AI 助手面板默认展开还是收起？

### 4.2 导航风格

- 顶部 Tab 栏（类似现有 Developer/Agent 模式切换）？
- 左侧侧边栏导航？
- 每个视图是独立页面切换还是同一页内切换区块？

### 4.3 主题与组件

- 直接复用 Hydro Desktop 的 Naive UI 主题和配色？
- 是否需要水文业务专属的图表库（如 ECharts 用于水位过程线展示）？

---

## 五、实施阶段建议

### Phase 1：骨架 + 核心数据链路
- 独立入口 + 页面框架 + 导航
- SQLite 建表 + 站点 CRUD
- 数据展示（水位/气温列表）
- 基础规则引擎 + 检查任务触发

### Phase 2：视频识别 + 规则完善
- 视频流连接 + 关键帧截取 + 水尺识别
- 完整规则体系（W-001 ~ W-008 + 气温规则）
- 异常中心 + 复核流转

### Phase 3：统计 + 摘录 + AI 辅助
- 定时统计 + 水位摘录
- 成果展示
- AI 助手面板（异常解释 / 总结输出）

---

## 决策状态总览

### ✅ 已确认

| # | 决策 | 结论 |
|---|------|------|
| 1 | 应用形态 | 独立 BrowserWindow |
| 2 | 数据库 | 独立 `hydrology.db` |
| 3 | 水位数据结构 | 一行两列（`manual_value`, `video_value`） |
| 4 | 视频 MVP | 本地文件模拟 |
| 5 | 页面布局 | 顶部导航 + 左侧站点树 + 中间内容 + 右侧 AI 面板 |
| 6 | 站点管理 | 先手动录入，后续批量导入 |
| 7 | 数据来源 | 自有数据库，将来可接驳外部源 |

### ❓ 仍待确认

1. ~~**规则引擎**：阈值写死还是可配置？~~ → ✅ **可配置**，不同算法参数不同，设计时展开
2. ~~**AI 面板**：默认展开还是收起？~~ → ✅ **默认展开**
3. ~~**复核流程**：单人确认即可，还是需要多级审批？~~ → ✅ **单人确认即可**
4. **识别模型**：调用外部 API 还是本地 ONNX 模型？
5. **历史数据保留策略**：保留多久？

其余设计阶段细节按文档确认的结论开展。
