# agent_conversations IM 字段迁移备用方案

> 最后更新：2026-06-09
> 状态：备用迁移方案，未落地
> 适用对比版本：旧库结构 `fb3640d` -> 当前代码结构 `adc66c9`

本文档用于整理 `agent_conversations` 从旧 IM 身份模型迁移到当前统一模型时的精确方案，作为后续数据库迁移实现的备用依据。

本文不是当前代码事实说明。当前已实现事实应以：

- [im-session-fields-and-binding.md](./im-session-fields-and-binding.md)
- [im-bridge-refactoring.md](./im-bridge-refactoring.md)

为准。

---

## 一、迁移目标

将旧版 `agent_conversations` 中依赖以下旧字段/旧语义的 IM 绑定数据：

- `type`
- `source`
- `staff_id`
- `conversation_id`

迁移到当前统一模型：

- `type` 只表示会话类型，不再承担渠道语义
- `source` 只表示会话来源，不再承担渠道语义
- `im_channel`
- `im_user_id`
- `im_chat_id`
- `im_chat_type`

同时移除旧字段：

- `staff_id`
- `conversation_id`

补充边界说明：

- 本次迁移仅处理 `agent_conversations` 的 IM 身份字段迁移
- 不处理 IM 配置页里的 `defaultCwd` 配置迁移
- 不重写已有会话的 `cwd / cwd_auto`

---

## 二、当前代码已确认的真实语义

本节不是迁移目标，而是当前代码已经形成的共享约束，迁移结果必须服从这些约束。

### 2.1 单聊身份语义

单聊历史查询、绑定恢复、共享 key 的主身份为：

```text
im_channel + im_user_id
```

对应落库形式为：

```text
im_user_id = 对端用户 ID
im_chat_id = ''
im_chat_type = 'p2p' / 'single'
```

### 2.2 群聊身份语义

群聊历史查询、绑定恢复、共享 key 的主身份为：

```text
im_channel + im_chat_id
```

对应落库形式为：

```text
im_user_id = ''
im_chat_id = 群 chatId
im_chat_type = 'group' / 'chat'
```

重点是：群聊当前不以发送人维度持久化主身份，因此迁移时不应把群聊用户 ID 填进 `im_user_id`。

### 2.3 工作目录语义边界

随着四个 IM 通道统一工作目录规则，当前代码已经形成以下边界：

1. `defaultCwd` 属于 IM 配置层，不属于 `agent_conversations` 身份迁移范围
2. IM 默认目录现在表示“该通道新会话的工作区根目录”
3. 实际会话目录仍会在该根目录下继续自动分配 `conv-xxxx`
4. 已经存在的历史会话，其 `agent_conversations.cwd` 仍是实际会话目录快照，迁移时不得按新的默认目录规则回写或改造

这意味着：

- 迁移只修复 IM 身份字段，不修复也不重算历史 `cwd`
- 即使后续四个通道的默认目录统一为“全局 Agent 默认目录 + 通道子目录”，旧会话仍应保持原有 `cwd`
- 数据库迁移不能把“配置默认目录”误当成“历史会话真实 cwd”

### 2.4 `type` 的迁移边界

不能简单把所有带 IM 绑定的会话都改成 `type = 'chat'`。

原因：

- `type = 'notebook'` 等宿主类型，也可能带有 IM 绑定
- 当前设计要求 `type` 保留宿主/会话类型语义

因此迁移时只应归一化“历史上把渠道名误写进 `type`” 的记录，例如：

- `dingtalk`
- `feishu`
- `weixin`
- `enterprise-weixin`

这些值迁移后改为：

```text
type = 'chat'
```

而真实宿主类型如 `notebook`、`embedded` 等必须保留。

---

## 三、旧字段到新字段的精确映射规则

### 3.1 `im_channel` 的推导优先级

迁移 `im_channel` 时，建议使用以下优先级：

1. 若现有 `im_channel` 已非空，则保留现值
2. 否则若 `type` 是历史渠道名，则从 `type` 推导
3. 否则若 `source` 是历史渠道名，则从 `source` 推导
4. 否则为 `NULL`

说明：

- 这样可以兼容“混合时代数据”：既有旧字段，又已经部分写入 `im_*`
- 已存在的新字段优先级应高于旧字段推断，避免覆盖新数据
- 若某条记录已经存在完整 `im_*`，迁移不应再依据旧 `staff_id / conversation_id` 去重算其它字段

### 3.2 钉钉旧数据映射

#### 单聊

旧特征：

```text
staff_id != ''
conversation_id == ''
```

迁移结果：

```text
im_channel   = 'dingtalk'
im_user_id   = staff_id
im_chat_id   = ''
im_chat_type = 'p2p'
```

#### 群聊

旧特征：

```text
conversation_id != ''
```

迁移结果：

```text
im_channel   = 'dingtalk'
im_user_id   = ''
im_chat_id   = conversation_id
im_chat_type = 'group'
```

### 3.3 飞书旧数据映射

#### 单聊

旧特征：

```text
staff_id != ''
conversation_id == ''
```

迁移结果：

```text
im_channel   = 'feishu'
im_user_id   = staff_id
im_chat_id   = ''
im_chat_type = 'p2p'
```

#### 群聊

旧特征：

```text
conversation_id != ''
```

迁移结果：

```text
im_channel   = 'feishu'
im_user_id   = ''
im_chat_id   = conversation_id
im_chat_type = 'group'
```

### 3.4 微信旧数据映射

旧版微信的语义与钉钉/飞书不同：

- `staff_id`：目标用户/联系人 ID
- `conversation_id`：旧链路中的账号或会话侧标识，但不再属于当前统一单聊身份

迁移结果应为：

```text
im_channel   = 'weixin'
im_user_id   = staff_id
im_chat_id   = ''
im_chat_type = 'p2p'
```

说明：

- 这是旧微信链路的历史特殊语义
- 不能按“`conversation_id != ''` 就是群聊”套通用规则
- `conversation_id` 不再迁入 `agent_conversations.im_chat_id`
- 微信主动发送所需的 `accountId/context` 应由微信目标注册表承担，而不是继续污染会话身份字段

### 3.5 企业微信

`fb3640d` 阶段没有企业微信旧字段模型，因此：

- 不需要设计 `staff_id / conversation_id` 到企业微信的历史迁移规则
- 若数据库中已存在 `im_*`，则按“已有新字段优先”保留

---

## 四、迁移顺序

建议迁移顺序如下。

### 第一步：补齐新字段

若缺失则新增：

- `im_channel`
- `im_user_id`
- `im_chat_id`
- `im_chat_type`

### 第二步：基于旧字段回填 `im_*`

对尚未完整写入 `im_*` 的历史记录，按第三节规则回填：

- 渠道
- 单聊/群聊身份
- `im_chat_type`

这一阶段必须在删除旧字段前完成。

### 第三步：归一化历史错误 `type`

仅将历史上被当成渠道名使用的 `type` 改为：

```text
chat
```

不要修改：

- `notebook`
- `embedded`
- 其他真实宿主类型

### 第四步：重建 `agent_conversations`

重建表时彻底移除：

- `staff_id`
- `conversation_id`

注意：重建时 `INSERT ... SELECT ...` 不能只复制已有 `im_*`，必须使用前面已回填/计算好的结果。

### 第五步：补齐索引

在新结构上补齐 IM 历史查询所需索引。

### 第六步：创建 `im_known_chats`

创建群聊别名/已知目标表及索引。

---

## 五、推荐实现策略

### 5.1 当前迁移实现的主要问题

当前 `adc66c9` 中的 `agent_conversations` 重建迁移，核心问题是：

- 会删除 `staff_id` / `conversation_id`
- 但重建时主要复制已有 `im_*`
- 对真正来自 `fb3640d`、且尚未写入 `im_*` 的历史数据，无法正确迁移

这会造成：

- 旧 IM 绑定身份丢失
- 后续按 `im_channel / im_user_id / im_chat_id` 恢复失败

### 5.2 推荐落地方式

推荐在迁移逻辑中保持“存在旧字段则重建”的整体思路，但把重建前后的处理改成以下形式：

1. 先检测旧表是否存在 `staff_id` / `conversation_id`
2. 若存在，先确保 `im_*` 列存在
3. 通过 `UPDATE` 或重建时的 `CASE WHEN`，根据旧字段计算出完整 `im_*`
4. 再执行重建，删除旧列

也可以直接在重建时使用显式计算，例如：

```sql
CASE
  WHEN COALESCE(im_channel, '') <> '' THEN im_channel
  WHEN type IN ('dingtalk', 'feishu', 'weixin', 'enterprise-weixin') THEN type
  WHEN source IN ('dingtalk', 'feishu', 'weixin', 'enterprise-weixin') THEN source
  ELSE NULL
END
```

以及按渠道/旧字段组合计算：

- `im_user_id`
- `im_chat_id`
- `im_chat_type`

推荐原则是：优先保留已有新字段，其次再用旧字段推导。

---

## 六、`createTables()` 的结构冗余问题

当前结构上还有一个设计层面的冗余：

- `createTables()` 创建的 `agent_conversations` 不是最终结构
- 随后 `runMigrations()` 又继续为新库补 `im_*`

这会导致：

- 新库初始化也要走迁移
- 初始结构和最终结构不一致
- 后续维护时容易误判“哪些字段是当前正式字段”

建议修正为：

1. `createTables()` 直接创建最终版 `agent_conversations`
2. `runMigrations()` 只处理旧库升级

---

## 七、索引建议

结合当前历史查询与恢复语义，建议新增或确认以下索引：

### 7.1 主 IM 身份历史索引

```text
idx_agent_conv_im_identity
(im_channel, im_user_id, im_chat_id, updated_at DESC)
```

用途：

- 单聊按 `im_channel + im_user_id`
- 群聊按 `im_channel + im_chat_id`
- 历史按 `updated_at` 倒序取最新

### 7.2 用户维度历史索引

```text
idx_agent_conv_im_user
(im_channel, im_user_id, updated_at DESC)
```

用途：

- 单聊恢复/找回旧会话
- 某些兼容性查询

若 SQLite 使用上认为第一个复合索引已足够，也可以在落地阶段再用真实查询计划确认是否保留第二个索引。

### 7.3 与工作目录统一后的边界

本次四通道工作目录统一后，`agent_conversations` 仍建议保持以下职责分离：

- `cwd / cwd_auto`：记录该具体会话实际使用的工作目录
- `im_channel / im_user_id / im_chat_id / im_chat_type`：记录 IM 身份
- 通道级默认目录：仍由配置层负责，不新增到 `agent_conversations` 身份迁移中

因此本迁移无需新增任何“IM 默认目录”相关数据库字段。

---

## 八、`im_known_chats` 的迁移边界

当前方案需要明确：

1. 本次迁移应创建 `im_known_chats` 表结构及索引
2. 但 `fb3640d` 旧库中没有现成的标准别名表可直接可靠回填
3. 因此本迁移方案默认：

- 创建结构
- 不强制做历史别名回填

若后续需要恢复历史群名/别名，应另行设计“从旧配置或旧缓存回填”的独立迁移。

---

## 九、测试计划

当前仅验证“删除旧列时保留已有 `im_*`”是不够的，必须覆盖真实旧库行。

建议至少补以下测试。

### 9.1 真实旧库迁移测试

1. 钉钉单聊旧行
2. 钉钉群聊旧行
3. 飞书单聊旧行
4. 飞书群聊旧行
5. 微信旧单聊行
6. 历史 IM 会话 `cwd` 保持原值

每条测试都应验证：

- `im_channel`
- `im_user_id`
- `im_chat_id`
- `im_chat_type`
- 旧字段已被删除

### 9.2 混合时代数据测试

构造“既有旧字段，也已有 `im_*`” 的记录，验证：

- 现有 `im_*` 优先保留
- 不会被旧字段错误覆盖

### 9.3 `type` 归一化测试

验证：

- `type='dingtalk'` -> `chat`
- `type='feishu'` -> `chat`
- `type='weixin'` -> `chat`
- `type='enterprise-weixin'` -> `chat`
- `type='notebook'` 保持不变

### 9.4 新库初始化测试

验证全新数据库直接创建后：

- `agent_conversations` 已包含最终 `im_*`
- 不依赖后续迁移补列

### 9.5 工作目录不被误迁移测试

验证：

- 旧 IM 会话若已有 `cwd`，迁移后 `cwd` 保持原值
- 迁移不会把“全局 Agent 默认目录 + 通道子目录”回填进历史 `cwd`
- `cwd_auto` 保持原值，不因新默认目录规则发生变化

---

## 十、验收标准

迁移完成后，应满足以下验收标准。

1. 从 `fb3640d` 升级到当前版本后，旧钉钉/飞书/微信绑定不会因旧字段删除而丢失
2. 单聊迁移后统一表现为：
   `im_user_id != '' && im_chat_id == ''`
3. 群聊迁移后统一表现为：
   `im_user_id == '' && im_chat_id != ''`
4. 旧渠道型 `type` 被纠正为 `chat`，但 `notebook` 等真实宿主类型保留
5. 新库初始化时直接落最终结构，不再依赖自迁移补齐当前字段
6. `staff_id` / `conversation_id` 最终不再出现在正式表结构中
7. `im_known_chats` 结构存在，且不因本次迁移引入错误历史别名
8. 历史会话 `cwd / cwd_auto` 不因四通道默认目录统一而被迁移改写

---

## 十一、建议的实施拆分

若后续要真正落迁移，建议按以下顺序提交：

1. 先补迁移测试，证明当前方案存在缺口
2. 修正 `runMigrations()` 的旧字段回填与重建逻辑
3. 修正 `createTables()` 直接生成最终结构
4. 增补索引与新库初始化测试
5. 再根据需要决定是否做 `im_known_chats` 历史别名恢复

这样做的好处是：

- 每一步都可独立回归
- 可以清晰区分“数据保真修复”和“结构清理优化”
