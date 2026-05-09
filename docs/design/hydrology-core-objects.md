# 水文站点数据检查工作台 — 核心对象设计

> 从核心对象开始，逐步构建完整模型。本文持续迭代。

---

## 1. 站点（Station）— 系统核心对象

### 1.1 属性定义

```
Station {
  // === 标识 ===
  id: string            // UUID，系统内部标识
  code: string          // 站点编号，业务唯一标识（如 "HD-001"）
  name: string          // 站点名称（如 "黄河流域·龙门站"）

  // === 分类 ===
  type: enum            // 站点类型：basic(基本站) / representative(代表站) / experimental(实验站)
  region: string        // 所属区域（如 "黄河上游" / "长江中游"）

  // === 状态 ===
  status: enum          // active / inactive / archived

  // === 规则配置（可覆盖全局默认值） ===
  ruleOverrides: {      // 未配置的项使用全局默认阈值
    boundaryMax?: number
    boundaryMin?: number
    maxDeviation?: number   // 摘录与平均值允许误差
    consistencyTolerance?: number // 人工值与视频值允许偏差
    // ... 更多规则参数待规则引擎设计时展开
  }

  // === 视频配置 ===
  videoConfig?: {
    source: string          // MVP阶段为本地文件路径，后续为 RTSP URL
    captureInterval: number // 截帧间隔（秒）
    enabled: boolean
  }

  // === 元数据 ===
  createdAt: datetime
  updatedAt: datetime
  description?: string
}
```

### 1.2 站点关联的其他对象

```
站点 Station
  │
  ├── 水位数据 WaterLevelData        (1:N)  — 该站点所有水位观测记录
  ├── 气温数据 TemperatureData       (1:N)  — 该站点所有气温记录
  ├── 检查任务 CheckTask             (1:N)  — 该站点的每日检查记录
  ├── 检查结果 CheckResult           (1:N)  — 规则执行结果
  ├── 异常记录 Anomaly               (1:N)  — 异常判定结果
  ├── 统计结果 Statistics            (1:N)  — 日统计
  ├── 摘录结果 Extraction            (1:N)  — 0点摘录
  └── 视频任务 VideoTask             (1:N)  — 视频识别任务记录
```

---

## 2. 水位数据（WaterLevelData）

```
WaterLevelData {
  id: string
  stationId: string          → Station.id

  // === 时间 ===
  time: datetime             // 观测时间点

  // === 水位值（两列并存） ===
  manualValue?: number       // 人工观测值（可为空，表示该时间点无人观测）
  videoValue?: number        // 视频识别值（可为空，表示该时间点无识别结果）

  // === 值状态标记 ===
  manualFlag?: enum          // normal / suspicious / corrected
  videoFlag?: enum           // normal / suspicious / unrecognized

  // === 元数据 ===
  source: enum               // manual_input / file_import / video_recognition
  createdAt: datetime
  updatedAt: datetime
}
```

**关键设计思路**：一行两列，`manualValue` 和 `videoValue` 独立存储，互不覆盖。
这样规则引擎做一致性检查时可以直接读同一行对比。

---

## 3. 检查任务与检查结果

### CheckTask

```
CheckTask {
  id: string
  stationId: string          → Station.id
  taskType: enum             // daily_check / statistics / extraction
  triggerTime: datetime      // 计划触发时间
  executedAt?: datetime      // 实际执行时间
  status: enum               // pending / running / completed / failed
  createdAt: datetime
}
```

### CheckResult

```
CheckResult {
  id: string
  taskId: string             → CheckTask.id
  stationId: string          → Station.id

  ruleCode: string           // 如 "W-001", "W-002", "T-001"
  level: enum                // hint / warning / critical

  // === 判定依据 ===
  dataTime?: datetime        // 涉及的数据时间点
  actualValue?: number       // 实际值（人工值或视频值）
  expectedValue?: number     // 期望值或对比值
  deviation?: number         // 偏差量或偏差百分比

  description: string        // 规则判定说明

  status: enum               // open / confirmed / dismissed / corrected
  createdAt: datetime
}
```

---

## 4. 异常记录（Anomaly）

```
Anomaly {
  id: string
  checkResultId: string      → CheckResult.id
  stationId: string          → Station.id

  // === 异常分类 ===
  category: enum             // missing / consistency / rationality / time_series_quality

  level: enum                // hint / warning / critical
  status: enum               // pending / reviewing / confirmed / corrected / closed

  // === 处理记录 ===
  handler?: string           // 处理人
  handledAt?: datetime       // 处理时间
  action?: enum              // ignored / confirmed_valid / confirmed_corrected / adopted_suggestion
  remark?: string            // 处理备注

  createdAt: datetime
  updatedAt: datetime
}
```

---

## 5. 统计结果（Statistics）

```
Statistics {
  id: string
  stationId: string          → Station.id
  type: enum                 // water_level / temperature
  periodStart: datetime      // 统计时段开始
  periodEnd: datetime        // 统计时段结束

  // === 统计值 ===
  resultJson: json           // 统计结果（JSON，不同统计类型结构不同）

  status: enum               // pending / completed / failed
  createdAt: datetime
}
```

---

## 6. 摘录结果（Extraction）

摘录时取 `manualValue` 作为主要值，`videoValue` 仅用于矫正流程，不参与摘录计算。

```
Extraction {
  id: string
  stationId: string          → Station.id
  date: date                 // 摘录日期（00:00）

  // === 摘录值 ===
  extractedValue: number     // 0点摘录值（取 manualValue，可能是人工或自动观测数据）
  averageValue: number       // 全量数据平均值
  deviation: number          // 误差值
  deviationRate: number      // 误差比例

  status: enum               // normal / suspicious / abnormal
  createdAt: datetime
}
```

---

## 7. 视频任务记录（VideoTask）

```
VideoTask {
  id: string
  stationId: string          → Station.id
  taskTime: datetime         // 计划识别时间
  sourcePath: string         // 视频源路径
  status: enum               // pending / capturing / recognizing / completed / failed
  errorMessage?: string      // 失败原因
  createdAt: datetime
}
```

---

## 对象关系总图

```
Station
  │
  ├── WaterLevelData (1:N)  ← 规则引擎读取对比
  ├── TemperatureData (1:N)  ← 规则引擎读取
  │
  ├── CheckTask (1:N)       ← 定时任务触发
  │     └── CheckResult (1:N)  ← 规则执行产出
  │           └── Anomaly (0:1)  ← 异常判定
  │
  ├── Statistics (1:N)      ← 定时统计产出
  ├── Extraction (1:N)      ← 定时摘录产出
  │
  └── VideoTask (1:N)       ← 视频识别定时任务产出
```

