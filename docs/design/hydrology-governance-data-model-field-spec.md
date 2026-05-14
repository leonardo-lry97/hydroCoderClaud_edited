# 水文数据治理模型字段说明

> 状态：实时数据页首版已落地，检测算法待后续细化  
> 适用范围：水文站点数据治理工作台  
> 说明：本文档面向“已解析完成的数据治理”场景，不再强调原始报文采集。

## 1. 设计目标

本文档说明水文站点治理系统的数据表结构与字段语义，目标是：

- 兼容人工、遥测、视频识别三类已解析数据
- 保留来源差异，但提供统一治理主表
- 支撑缺测、边界、时序、变幅、毛刺、一致性、统计、摘录、人工修正

## 2. 建模原则

- 来源数据分开保存
- 治理主表统一口径
- 结果表独立留痕
- 所有修正动作可追溯
- 业务时槽与观测事实分离

## 3. 总体结构

```text
source_*  →  governance_observations  →  observation_slots  →  anomalies / tasks / statistics / corrections
```

## 4. 来源层

### 4.1 `source_manual_observations`

人工已解析观测数据。

- `id`：记录主键
- `station_id`：站点 ID
- `observation_type`：观测类型，水位或气温
- `observed_at`：人工观测时刻
- `value`：观测值
- `unit`：单位
- `operator`：录入人员
- `source_record_id`：外部来源记录编号
- `quality_flag`：来源质量标记
- `created_at`：创建时间

### 4.2 `source_telemetry_observations`

自动遥测已解析观测数据。

- `id`：记录主键
- `station_id`：站点 ID
- `observation_type`：观测类型
- `observed_at`：遥测时刻
- `value`：观测值
- `unit`：单位
- `device_id`：设备编号
- `packet_no`：报文序号
- `quality_flag`：来源质量标记
- `created_at`：创建时间

### 4.3 `source_video_ocr_observations`

视频识别已解析结果。

- `id`：记录主键
- `station_id`：站点 ID
- `observation_type`：观测类型
- `observed_at`：识别对应时刻
- `value`：识别值
- `unit`：单位
- `image_id`：截图或帧编号
- `ocr_text`：原始识别文本
- `confidence`：置信度
- `quality_flag`：来源质量标记
- `created_at`：创建时间

## 5. 治理层

### 5.1 `governance_observations`

统一治理主表，承载所有来源的标准化观测记录。

- `id`：记录主键
- `station_id`：站点 ID
- `observation_type`：观测类型
- `source_type`：来源类型
- `observed_at`：原始观测时刻
- `value`：标准化后的值
- `unit`：标准化单位
- `source_ref_id`：来源层记录 ID
- `normalized_time`：归一化后的业务时刻
- `governance_status`：治理状态
- `review_status`：复核状态
- `created_at`：创建时间
- `updated_at`：更新时间

说明：

- 这是后续查询、对比、统计的统一入口
- `source_ref_id` 用于回链来源表
- `normalized_time` 用于对齐整点时槽

### 5.2 `observation_slots`

业务时槽表，用于把多源数据归并到统一检查窗口。

- `id`：记录主键
- `station_id`：站点 ID
- `observation_type`：观测类型
- `slot_time`：时槽时间
- `manual_value`：人工值
- `telemetry_value`：遥测参考值
- `video_ocr_value`：视频识别值
- `chosen_value`：最终采用值
- `compare_status`：对比状态
- `missing_flags`：缺测标记集合
- `created_at`：创建时间
- `updated_at`：更新时间

说明：

- `slot_time` 通常按整点组织
- `chosen_value` 是治理后参与统计或摘录的值
- `compare_status` 记录各来源是否一致

## 6. 结果层

### 6.1 `observation_anomalies`

异常结果表。

- `id`：记录主键
- `station_id`：站点 ID
- `observation_type`：观测类型
- `slot_time`：异常发生时槽
- `anomaly_type`：异常类型
- `severity`：严重等级
- `description`：异常描述
- `evidence_ref`：证据引用
- `status`：处理状态
- `created_at`：创建时间
- `updated_at`：更新时间

### 6.2 `review_tasks`

人工复核任务表。

- `id`：记录主键
- `station_id`：站点 ID
- `observation_type`：观测类型
- `task_type`：任务类型
- `target_time`：目标时刻
- `status`：任务状态
- `assignee`：处理人
- `related_anomaly_id`：关联异常 ID
- `created_at`：创建时间
- `updated_at`：更新时间

### 6.3 `daily_statistics`

日统计结果表。

- `id`：记录主键
- `station_id`：站点 ID
- `observation_type`：观测类型
- `stat_date`：统计日期
- `stat_time`：统计时间
- `summary_json`：统计结果 JSON
- `result_status`：结果状态
- `created_at`：创建时间
- `updated_at`：更新时间

### 6.4 `manual_corrections`

人工修正留痕表。

- `id`：记录主键
- `station_id`：站点 ID
- `observation_type`：观测类型
- `target_time`：修正目标时刻
- `before_value`：修正前值
- `after_value`：修正后值
- `reason`：修正原因
- `approver`：确认人
- `created_at`：创建时间
- `updated_at`：更新时间

## 7. 字段语义说明

### 7.1 `station_id`

站点唯一标识，所有表都以它作为业务归属键。

### 7.2 `observation_type`

观测类型，当前至少包括：

- 水位
- 气温

设计上不把“水位”和“气温”直接做成独立数值字段，而是作为 `observation_type` 的枚举值，原因如下：

- 统一一套治理主表结构，避免为不同要素重复建表或重复写规则
- 统一查询方式，按站点、要素、时间范围筛选更自然
- 统一规则框架，缺测、边界、时序、变幅等规则只需按类型取不同阈值
- 适配多来源数据，避免形成 `manual_water_level`、`telemetry_air_temperature` 这类持续膨胀的宽表结构
- 后续若扩展雨量、流量等新要素，只需增加类型枚举和规则配置，不必整体改表

因此：

- 在底层事实表和治理主表中，推荐使用“纵表”设计，即 `observation_type + value`
- 在结果层或展示层中，允许按业务需要使用“横表”字段，例如 `manual_value`、`telemetry_value`、`video_ocr_value`

### 7.3 `source_type`

来源类型，建议枚举：

- `manual`
- `telemetry`
- `video_ocr`

### 7.4 `observed_at`

来源数据真实发生时间，不是统计时点。

### 7.5 `normalized_time`

治理系统计算出的对齐时间，通常用于整点时槽归并。

### 7.6 `slot_time`

业务时槽时间，用于审核和统计的统一检查窗口。

### 7.7 `governance_status`

治理状态，表示这条记录是否完成标准化、校验或等待复核。

### 7.8 `review_status`

复核状态，表示是否已进入人工复核流程。

### 7.9 `quality_flag`

来源质量标记，记录来源自身是否存在异常。

### 7.10 `compare_status`

多来源对比状态，表示人工、遥测、视频识别是否一致或存在偏差。

### 7.11 `summary_json`

统计结果的结构化载体，不同统计类型可使用不同 JSON 结构。

## 8. 关系图

```text
source_manual_observations
source_telemetry_observations
source_video_ocr_observations
            ↓
    governance_observations
            ↓
      observation_slots
        ├─ observation_anomalies
        ├─ review_tasks
        ├─ daily_statistics
        └─ manual_corrections
```

## 9. 结论

- 来源分表，避免字段污染
- 统一治理主表，保证查询和规则通用
- 时槽表承接业务审核
- 结果表承接异常、复核、统计、修正

## 10. 枚举值建议

### 10.1 `observation_type`

建议首版枚举值：

- `water_level`：水位
- `air_temperature`：气温

扩展预留：

- `rainfall`：雨量
- `flow_rate`：流量

### 10.2 `source_type`

建议首版枚举值：

- `manual`：人工观测
- `telemetry`：自动遥测
- `video_ocr`：视频截图识别

扩展预留：

- `corrected`：人工修正后生效值
- `external_import`：外部批量导入

### 10.3 `quality_flag`

建议首版枚举值：

- `normal`：来源记录正常
- `missing`：来源记录缺失
- `suspect`：来源记录可疑
- `invalid`：来源记录无效

### 10.4 `governance_status`

建议首版枚举值：

- `pending`：待治理
- `normalized`：已完成标准化
- `slotted`：已进入业务时槽
- `flagged`：已命中治理规则
- `closed`：治理闭环完成

### 10.5 `review_status`

建议首版枚举值：

- `none`：未进入复核
- `pending_review`：待人工复核
- `reviewing`：复核中
- `reviewed`：已完成复核
- `corrected`：已确认并修正

### 10.6 `compare_status`

建议首版枚举值：

- `not_compared`：未比较
- `consistent`：来源一致
- `slightly_diff`：轻微偏差
- `significant_diff`：明显偏差
- `conflict`：冲突
- `missing_reference`：缺少对比来源

### 10.7 `anomaly_type`

建议首版枚举值：

- `missing_manual`：人工值缺失
- `missing_telemetry`：遥测值缺失
- `missing_video_ocr`：视频识别值缺失
- `boundary_exceeded`：边界值异常
- `time_sequence_invalid`：时序不合法
- `amplitude_exceeded`：变幅异常
- `spike_detected`：毛刺
- `jump_detected`：突变
- `source_inconsistency`：多来源不一致
- `extract_deviation`：摘录偏差异常

### 10.8 `severity`

建议首版枚举值：

- `info`：提示
- `warning`：警告
- `critical`：严重

### 10.9 `status`

用于 `observation_anomalies` 与 `review_tasks` 时，建议根据实体拆分理解。

异常状态建议值：

- `open`：待处理
- `reviewing`：处理中
- `confirmed`：已确认
- `corrected`：已修正
- `ignored`：忽略
- `closed`：关闭

复核任务状态建议值：

- `pending`：待处理
- `running`：处理中
- `completed`：已完成
- `cancelled`：已取消

## 11. 实时数据页接口设计建议

本文档同步给出“实时数据页”首版接口建议，方便后续前后端对齐。

当前 desktop 首版实现说明：

- 已落地时槽列表、时槽明细、趋势视图、人工修正四条闭环链路
- 当前通过 Electron IPC 暴露接口，语义对应本文档的本地 API 设计
- 已支持 `stationId`、`observationType`、`fromTime`、`toTime`、`compareStatus`、`hasAnomaly` 等筛选
- 异常列表当前以“缺测 + 多源明显偏差/冲突”的首版规则派生，后续再细化边界值、时序、变幅、毛刺等检测算法

### 11.1 页面目标

实时数据页用于查看：

- 某站点某时间范围内的水位 / 气温观测记录
- 人工、遥测、视频识别三类来源的差异
- 当前数据是否已命中治理规则
- 某一整点时槽下的详细来源明细

### 11.2 页面展示原则

- 默认按站点 + 观测类型查看
- 默认展示“整点时槽视图”
- 支持展开查看 5 分钟遥测明细
- 列表和图形均基于 `observation_slots` + `governance_observations`

### 11.3 接口一：查询实时数据时槽列表

`GET /api/hydrology/realtime/slots`

请求参数建议：

- `stationId`
- `observationType`
- `date`
- `fromTime`
- `toTime`
- `compareStatus`
- `hasAnomaly`

返回结构建议：

```json
{
  "station": {
    "id": "st-qingxi",
    "name": "青溪站",
    "code": "QX001"
  },
  "observationType": "water_level",
  "date": "2026-05-14",
  "items": [
    {
      "slotTime": "2026-05-14T14:00:00+08:00",
      "manualValue": 5.18,
      "telemetryValue": 5.20,
      "videoOcrValue": 5.19,
      "chosenValue": 5.18,
      "compareStatus": "consistent",
      "missingFlags": [],
      "hasAnomaly": false,
      "anomalyCount": 0
    }
  ]
}
```

### 11.4 接口二：查询某个时槽明细

`GET /api/hydrology/realtime/slots/:slotId/detail`

返回结构建议：

```json
{
  "slot": {
    "id": "slot-001",
    "slotTime": "2026-05-14T14:00:00+08:00",
    "observationType": "water_level",
    "compareStatus": "slightly_diff"
  },
  "manualObservation": {
    "id": "manual-001",
    "observedAt": "2026-05-14T14:00:00+08:00",
    "value": 5.18,
    "operator": "值班员A"
  },
  "telemetryObservations": [
    {
      "id": "tm-001",
      "observedAt": "2026-05-14T13:55:00+08:00",
      "value": 5.21
    },
    {
      "id": "tm-002",
      "observedAt": "2026-05-14T14:00:00+08:00",
      "value": 5.20
    }
  ],
  "videoOcrObservation": {
    "id": "ocr-001",
    "observedAt": "2026-05-14T14:02:00+08:00",
    "value": 5.19,
    "confidence": 0.93
  },
  "anomalies": []
}
```

### 11.5 接口三：查询趋势图数据

`GET /api/hydrology/realtime/trend`

请求参数建议：

- `stationId`
- `observationType`
- `fromTime`
- `toTime`
- `viewMode`

说明：

- `viewMode=slot` 返回整点视图
- `viewMode=raw` 返回原始观测序列

返回结构建议：

```json
{
  "stationId": "st-qingxi",
  "observationType": "water_level",
  "viewMode": "slot",
  "series": [
    {
      "name": "人工值",
      "sourceType": "manual",
      "points": [["2026-05-14T14:00:00+08:00", 5.18]]
    },
    {
      "name": "遥测参考值",
      "sourceType": "telemetry",
      "points": [["2026-05-14T14:00:00+08:00", 5.20]]
    },
    {
      "name": "视频识别值",
      "sourceType": "video_ocr",
      "points": [["2026-05-14T14:00:00+08:00", 5.19]]
    }
  ]
}
```

### 11.6 接口四：发起人工修正

`POST /api/hydrology/realtime/corrections`

请求体建议：

```json
{
  "stationId": "st-qingxi",
  "observationType": "water_level",
  "targetTime": "2026-05-14T14:00:00+08:00",
  "beforeValue": 5.18,
  "afterValue": 5.16,
  "reason": "人工复核确认原值录入错误"
}
```

处理结果：

- 写入 `manual_corrections`
- 更新 `governance_observations` 或生成修正来源记录
- 回刷关联 `observation_slots`
- 必要时重算关联异常状态

## 12. 结论补充

- 枚举值建议优先在首版定死，避免前后端各自发散
- 实时数据页以“时槽视图”为主，以“来源明细”为辅
- 后续真正实现时，可先落 IPC 版接口，再决定是否追加本地 HTTP API
