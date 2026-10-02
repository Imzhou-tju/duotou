# 投递模块前端调研报告

调研对象：`index.html` / `app.js` / `style.css`（commit `d2c7bac`）
调研范围：添加 / 编辑投递表单、单个单位与集团投递两条入口、列表与详情展示、搜索、Supabase 接口调用。

---

## 1. 代码结构盘点

### 1.1 入口

| 入口 | 位置 | 行为 |
| --- | --- | --- |
| 悬浮按钮 FAB | `index.html:108` → `app.js:1025` | `editingId=null; draftGroup=''; draftMode='single'; showView('edit')` |
| 集团卡片 | `app.js:1037` | `openGroupSheet(groupName)` |
| 集团弹层「在此集团下新增投递」 | `app.js:1057` | `draftGroup=集团名; draftMode='group'; editingId=null; showView('edit')` |
| 单条详情「编辑全部」 | `app.js:1071` | `editingId=id; showView('edit')` |

四个入口最终都落到 `showView('edit')` → `renderEdit()`（`app.js:447`）。模式（单/集团）由 `renderEdit` 内的启发式决定，不由调用方显式传入：

```js
// app.js:455-457
const singleTagged = !!(rec && initGroup && rec.company && rec.company !== rec.group_name);
draftMode = (initGroup && !singleTagged) ? 'group' : 'single';
```

> 结论：入口本身是干净的，问题都在表单内部。

### 1.2 表单字段与 DOM

`index.html:127-159`，一个 `.form-card` 里塞了三种语义不同的东西：

```
.form-card
├── .seg#f-mode                       分段控件（单个单位 / 集团投递）
├── #single-fields                    单个单位模式字段组（display:contents）
│   ├── 单位名称 / 二级单位 / 集团名称   三个普通 .form-row
│   └── .form-row.col 岗位名称 + 批量粘贴 + #single-positions + #p-add-single + 批量粘贴 textarea + 提示
├── #group-fields                     集团模式字段组（display:contents）
│   ├── 集团名称
│   └── .form-row.col「该集团下的单位」+ #g-rows + #g-add + 提示 + #g-count
├── #row-base     Base 地             单模式显示 / 集团模式隐藏
├── 投递链接                            两模式共用
├── #row-remark   备注                 单模式显示 / 集团模式隐藏
└── <datalist id="group-list">        两处集团名输入共用
```

`#single-fields / #group-fields` 用 `display: contents`（`style.css:97`）让子行参与桌面端 `.form-card` 的两列网格。**这是布局问题的根源之一**：`display:contents` 让这两个容器在盒模型上消失，它们的子元素直接成为网格项，因此「集团名称」只能占一个格，右侧必然留空。

### 1.3 状态管理

| 状态 | 位置 | 语义 |
| --- | --- | --- |
| `draftMode` | `app.js:31` | `'single' \| 'group'` |
| `draftUnits` | `app.js:32` | 单位数组，每个单位挂 `positions[]`；单模式只用 `[0]` 装岗位 |
| `draftDates` / `draftStage` | `app.js:35-36` | 各阶段日期 / 当前阶段（仅单模式可见可编辑） |
| `groupEditStageDates` / `groupEditStage` | `app.js:33-34` | 集团模式编辑时保留原记录的其他阶段日期 |
| `editingId` / `draftGroup` | `app.js:29-30` | 编辑目标 / 预填集团名 |

单位对象：`{ key, recId, sub, base, date, remark, positions: [{ key, recId, name }] }`。
`recId` 是 update / insert 的分流依据（`app.js:771`、`app.js:803-804`）——**这个字段不能丢**，此前 `renderEdit` 漏回填导致编辑变新增（已在 `d2c7bac` 修复）。

### 1.4 接口调用

| 动作 | 代码 | 说明 |
| --- | --- | --- |
| 读 | `app.js:272` | `select('*').order('update_time', desc)`，**一次全量拉取，无分页无服务端筛选** |
| 单模式写 | `app.js:724-754` | 首条 `update(id)`，其余 `insert(数组)` |
| 集团模式写 | `app.js:758-821` | 按单位×岗位扁平展开；有 `id` 走 `update`，无 `id` 走 `insert`；逐个 update 串行 |
| 详情改日期 | `app.js:951-968` | `update` 单条 `stage_dates` |
| 删除 | `app.js:822-833` | `delete().eq('id')` |

数据库仍是**单表 `applications`，一条记录 = 一个单位 × 一个岗位**，没有 units / positions 实体表。所以「同一单位多岗位」在库里天然就是多行，前端要靠聚合展示。

---

## 2. 问题定位

### 2.1 输入框视觉层级（截图 1 / 2 / 4）

**原因 A：单位卡内的输入被显式去掉了边框，与卡片同为浅灰底。**

```css
/* style.css:99-106 */
.g-row      { background: var(--bg); }              /* 卡片底 = #F5F6F8 */
.g-row input{ border: none; background: transparent; }
.g-row textarea { border: none; background: transparent; }
```

`.g-row` 用浅灰底，输入又透明无边框 —— 于是「具体单位 / 分行」「Base 地，选填（如 成都）」「备注，选填」渲染出来**与静态文字完全一致**，用户看不出哪里可以打字。对比同一屏上方的「集团名称」，它是带 1px 边框 + 白底的 `input`，聚焦时变蓝（`style.css:86-90`）——**同一张表单里两套完全不同的输入样式**，这是最刺眼的不一致。

**原因 B：岗位输入框 `.pi-name` 也是无边框，且落在白色卡片上。**

```css
/* style.css:125-129 */
.pi-name { border: none; background: transparent; height: 44px; padding: 4px 0; }
```

白底 + 无边框 + 只有 placeholder 文字 → 截图 3 里那行「岗位名称，选填」看起来就是一行说明文字。

**原因 C：`.p-row` 的缩进与卡片内其他字段不对齐。**

```css
/* style.css:118-124 */
.p-row { margin: 0 4px 0 12px; }        /* 集团模式：左缩进 12px */
#single-positions .p-row { margin-left: 0; margin-right: 0; }   /* 单模式：不缩进 */
```

`.g-row` 自身 `padding-left: 4px`，`.g-row input` 再 `padding-left: 12px`，合计 16px；而岗位行是 `4px(卡) + 12px(p-row margin)` 再叠加 `.pi-name` 的 `padding: 4px 0`（左右 0）→ 文字起点约 16px，**视觉上却因为少了那 12px 输入内边距而显得更靠右、与上方字段错位**。截图 2、4 里「岗位名称，选填」明显比「Base 地」右偏。

**原因 D：标签与占位符文字重复。**

- 单模式：「岗位名称」标签 + 输入框 placeholder「岗位名称，选填」→ 同一行出现两次"岗位名称"。
- 集团模式：小标题「该单位下的岗位」+ 每个输入 placeholder「岗位名称，选填」→ 三层同义文字叠加。

### 2.2 层级与分组（截图 2 / 4）

单位卡内部**五个字段完全平权**：具体单位 / Base / 投递日 / 备注 / 岗位列表。实际语义是三层：

1. 这个单位是谁（具体单位 / 分行）
2. 这个单位的投递属性（Base、投递日、备注）
3. 这个单位下投了哪些岗位（1..N 行）

现在三者只有一条 1px 上边框都没有（`.u-pos-label` 只是一行 12px 蓝字，`style.css:116`），「备注」和上面的「Base + 投递日」之间也没有分隔。**备注 textarea 与岗位列表在视觉上糊成一片**（截图 2：Base 行 → 备注 → 蓝色小标题 → 岗位，四段之间间距几乎相等）。

另外 `.g-row` 的 `padding: 4px 8px 8px 4px` 左右不对称（左 4 右 8），卡内元素左右边缘不齐。

### 2.3 填写流程（截图 3 / 4）

| 问题 | 具体表现 |
| --- | --- |
| 模式切换后内容高度剧变 | 集团模式隐藏了 `#row-base`、`#row-remark`、`#sec-stage-*`、`#sec-dates-*`（`app.js:516-521`），单模式又全部显示。同一个 `.edit-scroll` 容器，切模式后滚动位置停在原地，用户容易迷失。 |
| 单模式下阶段/日期被推到最底 | 「当前阶段」「各阶段日期」在 `.form-card` **外面**（`index.html:160-163`），要滚过整个表单才能看到，而这两个是最高频的编辑项。 |
| 桌面端网格留空洞 | 单模式下「集团名称」独占左列，右列空；「岗位」区因为是 `.col` 跨两列，导致上方形成 L 形空白（截图 3 上半部分右侧大片空白）。 |
| 提示文案堆叠 | 截图 4 底部：灰色说明 +「共将创建 1 条投递记录」两行紧贴，与「投递链接」标签之间只隔 0 间距，读起来像乱码。 |
| 「批量粘贴」是 label 里的小胶囊 | `style.css:153`：11px 字号、`padding: 3px 10px`，命中区域远小于 44px 触控标准，移动端不好点；且它的状态（展开的多行框）没有其他视觉反馈。 |
| 集团模式没有阶段入口 | 集团模式隐藏了阶段/日期区，但用户在这个模式里同样想直接看到「当前阶段」，现在完全看不到，只能保存后进详情。 |

### 2.4 校验与反馈

- 全站只有 `toast()`（`app.js:219`）一种反馈。必填校验是「toast + focus」：

```js
// app.js:727
if (!base.company) { toast('单位名称必填'); $('#f-company').focus(); return; }
// app.js:760
if (!group) { toast('集团名称必填'); $('#f-group').focus(); return; }
```

- **字段本身没有错误态**：输入框不变红、不出现行内错误文案。toast 2.2 秒后消失（`app.js:224`），用户滚到别处就再也看不到是哪一项错了。
- 唯一有行内提示的是 Base 地（`#f-base-hint`，`app.js:1086-1100`）和集团名（`#group-hint`，`app.js:660-672`），但它们只报「识别成功 / 将归并」，**不报错**。
- 岗位重名是「toast + 输入回滚」（`app.js:611-622`），同样没有行内标记。
- `#btn-save` 没有 loading / 禁用态，慢网络下用户会连点，可能重复提交。

### 2.5 多岗位的展示与查询（现状）

| 能力 | 现状 |
| --- | --- |
| 列表聚合 | 只有**集团**聚合：`renderFeed` 按 `group_name` 分组，≥2 条成集团卡（`app.js:382-394`）。**同一单位多岗位在首页是散开的 N 张独立卡片**，看不出「这是同一个单位的 3 个岗位」。 |
| 详情 | 单条详情只显示自己（`renderSheet`，`app.js:891`），不提示同单位还有哪些岗位。 |
| 筛选 | 只有 `kw` / `stage` / `base` 三个条件（`app.js:420-434`）。**没有按单位筛选，也没有独立的岗位筛选**。 |
| 关键字 | `hay` 已含 `company / sub_unit / position / remark / base / group_name`（`app.js:428`），字段覆盖够，但只有单一输入框。 |
| 排序 | 硬编码 `update_time desc`（`app.js:274`），用户不可改。 |
| 分页 | **无**。全量渲染，记录多了首屏必卡。 |

---

## 3. 结论

问题的性质分两类：

**一类是纯样式缺陷**（边框被去掉、缩进不一致、padding 不对称、标签与 placeholder 重复）—— 改 CSS 就能解决。

**一类是结构缺陷**（单位卡内五个字段平权无分组、单模式下高频的阶段区被推到最底部、`display:contents` 造成的桌面网格空洞、集团模式完全没有阶段可见性）—— 需要调整 DOM 结构与渲染顺序。

**多岗位维度是能力缺口**（不是缺陷）：数据层已经是「一行一岗位」，但展示层只做到了集团聚合，没做到单位聚合，查询维度里也没有「单位」这一项，更没有分页。

对应的改版方案见 `docs/design-apply-revamp.md`。
