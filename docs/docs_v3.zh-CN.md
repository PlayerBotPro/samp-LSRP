# LSRP — 版本 3

本文介绍 [v2 文档](docs_v2.zh-CN.md)**之后**新增的内容。v3 的核心是**房屋系统**和**服务端反作弊**（`anticheat`）。之后按时间顺序加入：**搬运工工作**、仓库安全区、`/gps` 与 `/mn` 编号、管理员命令 `/goto` `/gethere` `/arang`、**组织仓库表**、军队弹药工厂、医院**药品运输**、贫民区的**贩子 Smoky**、**帮派 / 黑手党仓库**、**通缉 / 军人证 / 医疗卡**、**商铺**（购买、税费、银行利润）、**租车和私人车辆**、**24/7 商店和武器店**、**服装 / 修车厂**、**饥饿 / 电话**、**按类别划分的 GPS 和 /help**、**杀人通缉与 /clear**、**玩家家族**、**Y/N 提议**、**FBI / 黑手党自定义总部**、**`/pay` `/members` `/wanted`**、**平民工作**（`job_id`、公交司机）、**`/id`**、发薪时的帮派领地补贴，以及**聊天表情**（`)` `))` `(` `((` `=0`）。

玩家可见文字为**俄语（UTF-8）**。

UI 金额使用 `shared/money.ts` 的 `formatMoney`，每千位以空格分隔，末尾添加 `$`（`5 000$`、`2 000 000$`）。

---

## 目录

1. [新增模块与启动顺序](#新增模块与启动顺序)
2. [数据库](#数据库)
3. [地图上的房屋](#地图上的房屋)
4. [购买和进入](#购买和进入)
5. [室内和出口](#室内和出口)
6. [租金（每日缴费）](#租金每日缴费)
7. [银行：房屋缴费](#银行房屋缴费)
8. [玩家命令](#玩家命令)
9. [房屋菜单 /home](#房屋菜单-home)
10. [护照和统计](#护照和统计)
11. [对话框](#对话框)
12. [限制和已知细节](#限制和已知细节)
13. [房屋修改位置](#房屋修改位置)
14. [反作弊](#反作弊)
15. [反作弊：已启用检查](#反作弊已启用检查)
16. [反作弊：trust API](#反作弊trust-api)
17. [反作弊：处罚和配置](#反作弊处罚和配置)
18. [反作弊修改位置](#反作弊修改位置)
19. [搬运工工作](#搬运工工作)
20. [仓库安全区](#仓库安全区)
21. [/gps 和 /mn：编号](#gps-和-mn编号)
22. [管理员：/spawn](#管理员spawn)
23. [管理员：/goto 和 /gethere](#管理员goto-和-gethere)
24. [管理员：/sp 和 /spoff](#管理员sp-和-spoff)
24a. [管理员：/stats](#stats-id管理员)
25. [管理员：/arang](#管理员arang)
25. [组织仓库（数据库）](#组织仓库数据库)
26. [军队弹药工厂](#军队弹药工厂)
27. [药品运输（医院）](#药品运输医院)
28. [贫民区：贩子 Smoky](#贫民区贩子-smoky)
29. [通缉、军人证、医疗卡](#通缉军人证医疗卡)
30. [军队基地弹药箱（帮派突袭）](#军队基地弹药箱帮派突袭)
31. [商铺](#商铺)
32. [银行：商铺税费与利润](#银行商铺税费与利润)
33. [商铺商品：武器店和 24/7](#商铺商品武器店和-247)
34. [修车厂](#修车厂)
35. [饥饿和街头食物](#饥饿和街头食物)
36. [电话和广告](#电话和广告)
37. [GPS 和命令列表（/mn）](#gps-和命令列表mn)
38. [杀人通缉、/clear、/wanted](#杀人通缉clearwanted)
39. [玩家家族](#玩家家族)
40. [Y/N 提议](#yn-提议)
41. [燃油与加油站](#燃油与加油站)
42. [动画（/anim）](#动画anim)
43. [面具（/mask）](#面具mask)
44. [执法：手铐、/arrest、/eject](#执法手铐arresteject)
45. [平民工作（就业中心、公交）](#平民工作就业中心公交)
46. [帮派发薪：领地补贴](#帮派发薪领地补贴)
47. [`/id`：搜索玩家](#id--搜索玩家)
48. [聊天表情](#聊天表情)
49. [汇总：执法、工作、AC、聊天](#汇总执法工作ac聊天)
50. [后续功能修改位置](#后续功能修改位置)

---

## 新增模块与启动顺序

新增 **`houses`** 模块。在 `src/index.ts` 中位于 `bank` **之后**、`miner` **之前**：

```text
database → persist → auth → spawn → mapping → hospital → cityhall → bank
→ houses → warehouse → miner → … → vehicles → jobs → anticheat
```

```text
resources/src/modules/houses/
  repository.ts    数据库、房屋缓存、购买/出售/租金
  entrances.ts     街道拾取物、购买/进入对话框
  exits.ts         离开室内（拾取物旁按左 ALT）
  enter.ts         进入逻辑、传送到室内
  purchase.ts      现金购买
  sell.ts          /sellhouse：出售给政府
  menu.ts          /home：门锁、医疗箱、信息
  heal.ts          /heal：使用医疗箱治疗
  map-icons.ts     房屋附近地图图标
  interior.ts      检查是否在自己家内（20 米半径）
  access.ts        拾取物和房屋附近的交互半径
  session.ts       槽位 → 当前室内房屋 ID
  residence.ts     “无家可归” / “房屋（编号 N）”
  classes.ts       房屋档次名称
  rent-math.ts     租金费率和日期计算
  rent.ts          00:00 收回、登录提醒
  bank-rent.ts     银行缴费对话框
  index.ts         模块启动
```

种子数据：`sql/houses_seed.sql`（382 栋房屋，ID 1–382）。

---

## 数据库

**`houses`** 表（`sql/schema.sql` + `houses/repository.ts`）：

| 字段 | 含义 |
|---|---|
| `id` | SMALLINT UNSIGNED，主键，房屋编号 |
| `owner_id` | INT UNSIGNED NULL → `users.id`；NULL 表示空置 |
| `entrance_x/y/z` | 街道拾取物位置 |
| `interior_x/y/z` | 室内位置 |
| `vehicle_x/y/z`、`vehicle_angle` | 车辆位置（预留） |
| `price` | 政府定价（INT UNSIGNED） |
| `interior_id` | GTA 室内场景 ID |
| `has_medkit` | TINYINT，是否购买医疗箱 |
| `is_locked` | TINYINT，门锁，默认 1 表示上锁 |
| `class_id` | TINYINT 0–5，房屋档次 |
| 室内 VW | `1000 + 房屋 id`，房屋范围 **1000–1999**（`isHouseVirtualWorld`） |
| `rent_paid_until` | **DATE NULL**，最后一个**已缴费**的日历日 |
| `store_x/y/z` | FLOAT NULL，储物柜坐标（`/makestore`）；NULL 表示未放置 |
| `store_metal` / `store_ammo` / `store_money` / `store_drugs` | 储物柜内容，出售 / 收回时清空 |

**统一 Virtual World 范围：**

| 范围 | 用途 |
|---|---|
| `0` | 街道 |
| `1–16` | 组织 / 组织室内 |
| `1000–1999` | 房屋 |
| `2000–99999` | 商铺 |
| `100000+` | 家族（`FAMILY_WORLD_OFFSET + familyId`） |

启动时迁移 `rent_paid_until`：字段不存在则 `ALTER TABLE`。已有所有者但无日期的房屋设为 `CURDATE()`，避免更新后立即被收回。

**房屋档次**（`houses/classes.ts`）：

| `class_id` | 名称 |
|---|---|
| 0 | 经济 |
| 1 | 中等 |
| 2 | 标准 |
| 3 | 舒适 |
| 4 | 高档 |
| 5 | 豪华 |

---

## 地图上的房屋

- **入口拾取物：** 空置为模型 `1273`，已占用为 `19522`。交互半径 **1.5 米**。
- **地图图标**（`map-icons.ts`）：槽位 **11–99**，类型 `31`（出售）/ `32`（已占用），LOCAL，半径 **300 米**，显示最近的房屋。
- 每个玩家**最多一栋房屋**。

---

## 购买和进入

### 购买

条件（`purchase.ts`）：

- 等级 **≥ 3**。
- 拥有**护照**。
- 没有其他房屋。
- **现金**足够（`account.money`）。
- 位于拾取物旁（**1.5 米**）。

购买时：

- 扣除现金，将 `owner_id` 设为玩家。
- `rent_paid_until = CURDATE()`，即**今天**已缴费。
- 传送到室内。
- 更新拾取物和图标。

对话框和聊天会提示：**在银行续缴租金**，费率 **$X/天**（价格的 0.1%，最低 $1）。

### 进入已占用房屋

- **所有者**始终可以进入。
- **警察 / FBI**（执法组织）在房屋有所有者时始终可以进入。
- **访客**只能进入**未上锁**的房屋（`is_locked = 0`）。
- 对话框显示所有者、类型、编号、价格、状态（开启 / 上锁）。

---

## 室内和出口

- 室内出口为拾取物 `19132`，按**左 ALT**（`KEY_WALK = 1024`）离开，不自动传送。
- `insideHouse`（session）将槽位与房屋 ID 绑定，避免重叠室内场景导致出口错误。
- `/home`、`/heal` 只能在**自己家**使用，要求距 `interior_*` **20 米**以内（`HOUSE_INTERIOR_RADIUS`）。

---

## 租金（每日缴费）

| 参数 | 值 |
|---|---|
| 费率 | 每天 `price` 的 **0.1%**（`HOUSE_RENT_RATE = 0.001`），最低 **$1** |
| 购买时 | **当天**已缴费 |
| 续费 | 只能在**银行**用**银行余额**支付 |
| 天数 | 银行中输入 **1–999** |
| 宽限期 | **没有**；次日 **00:00** 政府收回房屋 |
| 补偿 | **没有** |
| 收回检查 | 每分钟定时检查日期变化，并在启动时检查；条件 `rent_paid_until < CURDATE()` |
| 收回操作 | `owner_id = NULL`，重置医疗箱和门锁，拾取物变为空置；室内玩家移到街道 |

缴费后日期公式：

```text
基准日期 = max(rent_paid_until, 今天)
rent_paid_until = 基准日期 + N 天
```

### 登录提醒

每次会话**首次出生**时（`houses/index.ts`）：

- 已缴费剩余天数 **≤ 5 天**时，提示剩余天数。
- **今天是最后一天**时，警告明天 00:00 政府收回房屋。

---

## 银行：房屋缴费

柜台菜单（`bank/tellers.ts`）中的**“房屋缴费”**：

- 无房屋 → “你没有房屋”窗口。
- 有房屋 → 房屋信息 → 输入天数（1–999）→ 确认 → 从 `bank` 扣款。
- 今天是最后已缴费日期时，在对话框中警告。

对话框逻辑：`houses/bank-rent.ts`。

**“商铺”**选项（税费和提取利润）见 [银行：商铺](#银行商铺税费与利润)。

---

## 玩家命令

| 命令 | 说明 |
|---|---|
| `/home` | 自己家中的房屋菜单 |
| `/heal` | 购买医疗箱（$7500）后恢复满 HP，仅自己家 |
| `/sellhouse` | 以完整 `price` 出售给政府，收到现金；需在自己房屋街道入口 **4 米**内 |
| `/makestore` | 在自己房屋室内放置 / 移动储物柜 |
| `/use` | 储物柜存取金属、弹药、金钱、毒品；仅柜旁的所有者 |
| `/pay [id] [1–5000]` | 向附近玩家交现金（`WHISPER_RADIUS`）；显示 `-N$` / `+N$` 标签 |
| `/findidhouse [id]` | 按 ID 标记房屋 / 设置检查点；重复相同 ID 取消，重置 GPS |
| `/findidbiz [id]` | 按 ID 标记商铺 / 设置检查点；重复相同 ID 取消，重置 GPS |
| `/members` | 自己组织的在线成员（对话框 **125**） |
| `/leaders` | 在线组织领导（对话框 **126**） |
| `/advokats` | 在线市政厅律师（职级 5，对话框 **129**）；所有玩家可用 |
| `/wanted` | 执法：通缉列表 → 寻找 / 取消通缉（对话框 **127** / **128**） |
| `/pursuit` | 执法：停止追踪 |
| `/su [id] [1-6] [原因]` | 执法：设置 / 增加通缉，最多 6 星；不能对执法人员 / 囚犯使用 |
| `/clear [id]` | 执法：取消通缉 |
| `/frisk [id]` | 执法：附近搜身（对话框 **140**）；FBI 可搜任何人，警察只可搜平民 |
| `/take [id]` | 执法：没收毒品 / 弹药 / 许可证（对话框 **141**），目标限制同上 |
| `/cuff [id]` | 执法：给附近目标上铐；FBI 可对任何人，警察只可对平民 |
| `/uncuff [id]` | 执法：解铐 |
| `/putpl [id]` | 执法：将目标放入自己驾驶的车，需 1–3 号座位空闲 |
| `/arrest [id]` | 执法：警局旁逮捕 → 检查点 → 按星数入狱 |
| `/demote [id] [原因]` | FBI **8+**：开除附近政府组织员工，目标 1–8 级且非 FBI |
| `/eject [id]` | 任何驾驶员：将乘客踢出自己的车 |
| `/id [ID 或昵称片段]` | 搜索在线玩家，最多 10 行：昵称、ID、等级、延迟 |
| `/makegun [1-7] [1-500]` | 帮派：在己方领地用弹药和金属制作武器 |
| `/sellgun [id] [弹药] [价格]` | 帮派：在己方领地出售手持武器，Y/N 确认，价格 1–50 000$ |
| `/selldrug [id] [数量] [价格]` | 帮派：在己方领地出售毒品，Y/N 确认，价格 1–50 000$ |

---

## 房屋菜单 /home

选项：

1. **状态**：切换门锁（开启 / 上锁）。
2. **医疗箱**：现金 **$7500** 购买一次。
3. **信息**：编号、档次、政府定价、缴费截止日期、剩余天数或“今天是最后一天”。

---

## 护照和统计

- `/pass` 和 `/mn` 统计增加**“居住”**：`无家可归` 或 `房屋（编号 N）`（`houses/residence.ts`）。
- 增加**“工作”**：`失业` 或工作名称（`users.job_id`、`jobs/catalog.ts` → `jobLabel`；原文失业有男女词形）。
- `/pass [id]` / `/lic [id]` 通过 **Y/N** 展示，见 [Y/N 提议](#yn-提议)，不立即显示。
- `/mn` → “统计”：显示**毒品 / 弹药 / 金属**库存、通缉、医疗卡、工作等（`commands/stats.ts`）。
- 管理员 **`/stats [id]`**（等级 **1+**，已 `/alogin`）：查看另一玩家的同款统计窗口；**不能**对 `adminLevel ≥ 1` 的目标使用，**不写入**管理员日志。

---

## 对话框

| ID | 模块 | 用途 |
|---|---|---|
| 42 | `houses/entrances` | 购买房屋 |
| 43 | `houses/entrances` | 进入已占用房屋 |
| 44 | `houses/menu` | /home 菜单 |
| 45 | `houses/menu` | 购买医疗箱 |
| 46 | `houses/sell` | /sellhouse 确认 |
| 47 | `houses/bank-rent` | 房屋缴费信息 |
| 48 | `houses/bank-rent` | 缴费确认 |
| 49 | `houses/bank-rent` | “你没有房屋” |
| 50 | `houses/menu` | 房屋信息 |
| 51 | `houses/bank-rent` | 输入天数 |
| 52 | `loader` | 搬运工入职 |
| 53 | `loader` | 搬运工结束班次 |
| 54 | `army-locker` | 军队武器库（武器店） |
| 55 | `police-doors` | 地区警察工作人员出口 |
| 56 | `fbi-doors` | FBI 屋顶 / 工作人员出口 |
| 57 | `admin/warehouse` | 管理员仓库列表 |
| 58 | `admin/warehouse` | 管理员仓库状态 |
| 130–136 | `admin/afamily` | 管理员 `/afamily`（家族） |
| 59 | `miner` | 矿场购买金属 |
| 60 | `army-factory` | 弹药工厂入职 |
| 61 | `army-factory` | 工厂结束班次 |
| 62 | `vehicles/hospital` | 药品运输开始 |
| 63 | `ghetto` | 贩子 Smoky 菜单 |
| 64 | `ghetto` | 购买毒品数量 |
| 65 | `warehouse/stock-interact` | 帮派 / 黑手党仓库菜单 |
| 66 | `warehouse/stock-interact` | 存取数量 |
| 67 | `commands/vbilet` | 军人证 |
| 68 | `commands/medcard` | 医疗卡 |
| 70 | `businesses/purchase` | /buybiz 确认 |
| 71 | `businesses/bank-tax` | 商铺税费信息 |
| 72 | `businesses/bank-tax` | 缴税确认 |
| 73 | `businesses/bank-tax` | “你没有商铺” |
| 74 | `businesses/bank-tax` | 输入纳税天数 |
| 75 | `businesses/menu` | /biz 菜单 |
| 76 | `businesses/menu` | 商铺统计 |
| 77 | `businesses/menu` | 出售给政府 |
| 78 | `businesses/menu` | 出售给玩家，输入 ID |
| 79 | `businesses/menu` | 出售给玩家确认 |
| 80 | `businesses/bank-tax` | 银行“商铺”子菜单 |
| 81 | `businesses/bank-tax` | 输入提取利润金额 |
| 82 | `businesses/bank-tax` | 提取利润确认 |
| 83 | `vehicles/rental` | 租车确认 |
| 84 | `vehicles/dealership` | 汽车店 / 摩托市场目录 |
| 85 | `vehicles/dealership` | 购车确认 |
| 86 | `vehicles/commands` | /car 菜单 |
| 87 | `vehicles/commands` | 私人车辆信息 |
| 125 | `commands/members` | /members 在线组织成员 |
| 126 | `commands/leaders` | /leaders 在线领导 |
| 127 | `commands/wanted` | /wanted 通缉名单 |
| 128 | `commands/wanted` | /wanted 寻找 / 取消通缉 |
| 129 | `commands/advokats` | /advokats 在线市政厅律师 |
| 139 | `org/lspd-surrender` | 向 LSPD 自首 |
| 140 | `commands/frisk` | /frisk 搜身结果 |
| 141 | `commands/take` | /take 没收列表 |
| 142 | `houses/store` | /use 储物柜菜单 |
| 143 | `houses/store` | /use 输入数量 |
| 144 | `businesses/workshop` | 修车厂服务菜单 |
| 145 | `businesses/workshop` | 修车厂选择颜色 1 |
| 146 | `businesses/workshop` | 修车厂选择颜色 2 |
| 150 | `jobs/hire` | 就业中心（TABLIST） |
| 151 | `jobs/bus/shift` | 公交班次确认 |
| 152 | `jobs/bus/shift` | 公交票价 |
| 153 | `jobs/bus/shift` | 公交路线选择 |

> 对话框 **144–146** 不要与家族 **115–123** 冲突。工作使用 **150–153**。

---

## 限制和已知细节

- 每栋房屋的室内使用独立 VW（`1000 + id`，范围 **1000–1999**）；街道 VW 为 `0`。
- 地图图标约有 89 个槽位（11–99）；300 米内房屋过多时显示最近的。
- 不支持玩家之间出售房屋；`/heal` 无冷却。
- **`/asellhouse [id]`**（管理员 **5+**，已 `/alogin`）可清空房屋，不向所有者付款。
- 出售给政府（`/sellhouse`）和欠费收回不同：出售获得金钱，收回没有补偿。

---

## 房屋修改位置

| 内容 | 文件 |
|---|---|
| 房屋结构和缓存 | `houses/repository.ts`、`sql/schema.sql` |
| 房屋坐标 | `sql/houses_seed.sql` |
| 租金费率 | `houses/rent-math.ts` → `HOUSE_RENT_RATE` |
| 午夜收回 | `houses/rent.ts` |
| 银行缴费 | `houses/bank-rent.ts`、`bank/tellers.ts` |
| 购买 / 进入 | `houses/purchase.ts`、`houses/entrances.ts`、`houses/enter.ts` |
| 出售 | `houses/sell.ts`、`commands/sellhouse.ts` |
| 管理员清空房屋 | `admin/asellhouse.ts`、`houses/repository.ts` → `adminVacateHouse` |
| 菜单 / 医疗箱 / 信息 | `houses/menu.ts`、`commands/home.ts` |
| 治疗 | `houses/heal.ts`、`commands/heal.ts` |
| 图标 | `houses/map-icons.ts` |
| 半径 | `houses/access.ts`、`houses/interior.ts` |
| 档次 | `houses/classes.ts` |
| 房屋 VW | `houses/world.ts` → `1000 + id`，最大 1999 |
| 护照中的居住信息 | `houses/residence.ts`、`commands/pass.ts`、`commands/stats.ts` |

---

## 反作弊

**`anticheat`** 模块无需客户端插件，在服务端保存预期金钱 / HP / 护甲 / 武器 / 位置的镜像，与客户端上报值比较。

在 `src/index.ts` 中**最后**加载（`vehicles` 之后），使游戏模式提供的 trust 接口在其他模块启动时已可使用。

```text
… → vehicles → anticheat
```

```text
resources/src/modules/anticheat/
  index.ts          模块启动，重新导出 trust/config
  codes.ts          AcCode 0–52、NopCode、武器槽位
  config.ts         阈值、启用代码列表、INSTANT_KICK
  state.ts          玩家状态、昵称+IP 重连检查
  trust.ts          “服务器已许可”API（宽限时间窗）
  punish.ts         日志、管理员通知、软警告次数、踢出
  loop.ts           检测定时器和事件绑定
  messages.ts       各代码的俄语名称
  math.ts           距离、时间
  detectors/
    movement.ts     airbreak / 飞行 / 加速 / 瞬移
    vitals.ts       HP / 护甲 / 金钱
    weapons.ts      武器 / 弹药 / 喷气背包 / 崩溃攻击
    vehicle.ts      车辆 HP 和相关检查
    connection.ts   延迟 / 刷包 / sandbox / 重连
```

原则：**任何合法修改**（传送、发武器、工资）都必须经过 trust / `applyWallet` / `grantWeapon`，否则反作弊会检测到差异。

伤害计算（`detectors/connection.ts` 的 `onTakeDamage`）：

- **安全区：** AC **不从镜像扣除** HP / 护甲，因为区域已经执行 `restoreVitals` + `trustHealth` / `trustArmour`；否则 slap / 跌落后会误报 HealthFoot / Armour。
- **跌落 / 碰撞 / 溺水 / 火焰 / 螺旋桨**（weapon **37、49、50、53、54**）：只扣 HP，不扣镜像护甲，与 GTA SA 相同。
- 其他武器先扣护甲，再扣 HP；伤害宽限**不会缩短**已有 trust 时间。

镜像加固，减少简单绕过：

- **金钱：** `client > account` 即踢出，不再允许 `+1$` 误差。
- **HP / 护甲：** 浮点容差 **1.0**（原为 1.5）；宽限期内**不按客户端提高**镜像值。
- **位置 / 宽限：** 使用 `posTrust*` 锚点。`trustPosition` 后只接受锚点范围内的位置：步行 `< teleportFootDist`，车内 `max(vehDist×3, 180)`。跨地图飞行不会成为新的基准位置。

---

## 反作弊：已启用检查

`config.ts` 默认启用具有实际逻辑、误报可接受的检测。其他代码在 `DISABLED_CODES` 中禁用，原因是占位实现或误报较多。

| 代码 | 名称 | 含义 |
|---|---|---|
| 0 / 1 | 步行 / 车辆 AirBreak | 位置突然断裂 |
| 2 / 3 | 步行 / 车辆瞬移 | 跳跃距离超过阈值 |
| 4 | 瞬移进入车辆 | 距车辆过远却上车 |
| 7 / 8 | FlyHack | 无合法依据的飞行 |
| 9 / 10 | SpeedHack | 超过速度上限 |
| 11 / 12 | 车辆 / 玩家 HP | 高于可信 HP |
| 13 | 护甲 | 高于可信护甲 |
| 14 | 金钱 | 现金高于镜像 |
| 15 / 16 | 武器 / 弹药增加 | 多余武器或 ammo 增长 |
| 18 | 特殊动作 | 未授权喷气背包 |
| 27 | Fake spawn | 非预期出生流程 |
| 37 | Reconnect | 同昵称、同 IP 过快重连 |
| 38 | High ping | 延迟超过 `maxPing`，先警告 |
| 40 | Sandbox | 同 IP 连接数过多 |
| 47 | Weapon crasher | 非法武器 ID |
| 49 | Callback flood | 回调刷屏 |
| 51 | DoS | 异常数据包流量 |

**禁用、不踢出：** Parkour、UnFreeze、FakeNpc、LagComp、ProAim、RCON brute、Attach / Tuning / Seat / Dialog crasher、GodMode、FullAiming、CarShot、QuickTurn、CarJack、AfkGhost、InvalidVersion、Connect / Seat flood、Invisible、DialogHack、TeleportVehToPlayer / Pickup、Tuning、FakeKill、NOP、AmmoInfinite、**RapidFire**、**CJ run**。

RapidFire 和 CJ run 因正常玩法误报而禁用。

---

## 反作弊：trust API

从 `modules/anticheat` 或 `modules/anticheat/trust` 导入。

| 函数 | 调用时机 |
|---|---|
| `trustPosition` | 传送、出生、slap、/tpcor、/goto、/gethere、管理员地图传送 |
| `trustMoney` | 通常经 `auth/session` 的 `applyWallet` |
| `trustHealth` / `setTrustedHealth` | 治疗、出生 HP |
| `trustArmour` / `grantArmour` | 发护甲，装备柜使用 `grantArmour` |
| `trustWeapon` / `grantWeapon` | 发武器，装备柜使用 `grantWeapon` |
| `clearTrustedWeapons` | 服务端清空武器 |
| `trustVehicle` | 服务端放入车辆 |
| `trustDialog` | 服务端打开对话框 |
| `markSpawned` / `markSpectating` | 出生 / 旁观 |

已接入 trust：

- 金钱：`applyWallet`（银行、房屋、矿工、管理员发钱、persist 等）。
- 位置：`spawn/point`、管理员地图 / tpcor / slap / goto / gethere。
- 武器和护甲：组织 / 监狱装备柜（`grantWeapon`、`grantArmour`）。

**新增功能规则：** 不要绕过这些路径直接调用 `player.setMoney` / `giveWeapon` / `setPos`，否则会误踢。

---

## 反作弊：处罚和配置

触发时（`punish.ts`）：

1. 服务器记录 `[AC] …` 日志。
2. 通知管理员（`adminLevel >= 1`）。
3. 通知玩家。
4. `kickOnDetect = true` 且达到警告次数阈值时踢出。

| 参数 | 此版本值 | 含义 |
|---|---|---|
| `enabled` | `true` | 模块启用 |
| `kickOnDetect` | `true` | 是否踢出 |
| `softStrikeMax` | `1` | 同代码触发多少次后踢出 |
| `softStrikeDecayMs` | `90000` | 无重复触发时重置计数的时间 |
| `reconnectMinMs` | `8000` | 同昵称+IP 最短重连间隔 |
| `maxPing` | `550` | High ping 阈值 |
| `maxConnectsPerIp` | `4` | Sandbox 阈值 |
| `speedFootMax` / `speedVehMax` | `300` / `380` | SpeedHack 阈值 |
| `teleportFootDist` / `teleportVehDist` | `50` / `60` | 瞬移阈值 |
| `moneyGraceMs` 等 | 2–3 秒 | trust 后宽限时间 |

**立即踢出、不累计：** Weapon crasher、Fake spawn、Sandbox、DoS，定义于 `INSTANT_KICK_CODES`。

自定义处理器：`setCheatHandler((player, code, detail) => …)`；返回 `false` 可取消默认处罚。

没有管理员调试命令。

---

## 反作弊修改位置

| 内容 | 文件 |
|---|---|
| 阈值和检测代码开关 | `anticheat/config.ts` |
| 代码列表 | `anticheat/codes.ts` |
| 聊天 / 日志名称 | `anticheat/messages.ts` |
| 踢出 / 次数 / 管理员通知 | `anticheat/punish.ts` |
| 定时器和事件 | `anticheat/loop.ts` |
| 状态 / 重连 | `anticheat/state.ts` |
| Trust API | `anticheat/trust.ts` |
| 检测器 | `anticheat/detectors/*.ts` |
| 避免金钱误踢 | `auth/session.ts` → `applyWallet` |
| 装备柜武器 | `org/*-locker.ts`、`prison/prison-locker.ts` |

---

## 搬运工工作

**`loader`** 是仓库兼职模块，在 `src/index.ts` 中位于 `miner` **之后**、`gps` **之前**：

```text
… → houses → miner → loader → gps → …
```

```text
resources/src/modules/loader/
  index.ts    招聘、班次、袋子、检查点、发薪
  points.ts   更衣室 / 装货 / 卸货坐标
```

### 地点

| 地点 | 坐标 | 用途 |
|---|---|---|
| 更衣室 | `2127.31, -2274.98, 20.67` | 拾取物 `1275`，“仓库 / 搬运工工作”标签，入职和结束班次 |
| 装货 | `2230.83, -2285.61, 14.38` | 领取袋子 |
| 卸货 | `2174.94, -2249.53, 13.30` | 交袋子 |
| GPS | `2236.53, -2212.79, 13.55` | `/gps` 的“仓库（搬运工）” |

地图图标：槽位 **4**、类型 **51**、LOCAL，更衣室周围约 **300 米**显示，与监狱共用槽位，按距离显示。

### 班次循环

1. 步行到更衣室 → 对话框 **52** 入职。
2. 男性皮肤 **260**、女性 **190**，设置装货检查点。
3. 取袋子 → `SPECIAL_ACTION_CARRY`，槽位 **2** 绑定物体 **2060**，设置卸货检查点。
4. 交袋子 → 班次工资 **+$25**，返回装货。
5. 班次中回到更衣室 → 对话框 **53**，结束并领取累计现金（`applyWallet` + `queueSave`）。

跳跃（`KEY_JUMP`）、开火（`KEY_FIRE`）或上车会掉袋子，阶段返回“装货”，但班次工资**保留**。死亡 / 断线导致班次失败，**未领取**工资清零。

### 入职限制

住院（`hospitalized`）、服刑、矿工班次中或驾校考试中不能入职。必须步行站在更衣室旁，街道 VW `0`。

GPS 与搬运工检查点不冲突：搬运工班次中 GPS 不放置自己的检查点（`isLoaderOnShift`）。

### 对话框

| ID | 用途 |
|---|---|
| 52 | 入职 |
| 53 | 结束班次 |
| 54 | 军队武器库（武器店） |
| 55 | 地区警察工作人员出口：停车场 / 武器店 |
| 56 | FBI 屋顶 / 工作人员出口：办公室·屋顶 / 武器店 |
| 57 | 管理员仓库列表（`/warehouse`） |
| 58 | 管理员仓库状态 |
| 59 | 矿场购买金属 |
| 62 | 药品运输开始 |
| 63 | 贩子 Smoky 菜单 |
| 64 | 从 Smoky 购买毒品 |
| 65 | 帮派 / 黑手党仓库菜单 |
| 66 | 仓库存取数量 |
| 67 | 军人证 |
| 68 | 医疗卡 |

---

## 仓库安全区

在 `zones/safe.ts` 添加不可见的仓库矩形区域，与火车站、市政厅、医院、矿场、驾校相同：

```text
minX 2153.8, minY -2292.9, maxX 2237.8, maxY -2218.9
```

覆盖装卸货区域，仅街道 VW、interior `0`。通过 HP / 护甲快照与 `trustHealth` / `trustArmour` 回滚伤害。

---

## /gps 和 /mn：编号

`DIALOG_STYLE_LIST` 列表显示选项编号：

- `/gps`：“1. 市政厅”“2. 城市医院”等，包括**仓库（搬运工）**。
- `/mn`：“1. 统计”“2. 命令列表”“3. 服务器规则”等。

按 `listItem` 处理选择的逻辑不变。

---

## 管理员：/spawn

等级 **3+**，要求 `/alogin`。文件：`admin/spawn.ts`。

| 命令 | 功能 |
|---|---|
| `/spawn` | 使自己出生 |
| `/spawn [id]` | 使目标出生 |

位置与登录后相同（`spawn/resolve.ts` → `resolveAccountSpawn`）：**监狱** → **医院**（`hospitalized`）→ **组织出生点** → **普通出生点**。车内玩家先下车；死亡 / 旁观状态调用 `spawn()` + `placeAt`。管理员收到灰色日志，目标收到提示。

## 管理员：/goto 和 /gethere

等级 **2+**，需已 `/alogin`。文件：`admin/goto.ts`，目录：`admin/catalog.ts`。

| 命令 | 行为 |
|---|---|
| `/goto [id]` | 管理员传送到玩家，复制**位置、interior、VW**；管理员先下车；`placeAt` + `trustPosition` + `refreshStreamForPlayer` |
| `/gethere [id]` | 玩家传送到管理员，复制管理员**位置、interior、VW**；车内目标先下车，再步行传送 |

目标必须在线且不是 NPC。不能对自己使用；wasted / spectating 状态拒绝。

`/gethere` 通知目标和管理员，并向所有已 `/alogin` 管理员发送灰色消息：

```text
[A] 管理员 Name_Surname[ID] 将玩家 Name_Surname[id] 传送到自己身边
```

`/goto` 和 `/gethere` 的灰色管理员日志均带 `[A]` 前缀。

---

## 管理员：/sp 和 /spoff

等级 **1+**，要求 `/alogin`。文件：`admin/spectate.ts`。

| 命令 | 行为 |
|---|---|
| `/sp [id]` | 旁观（`toggleSpectating` + `spectatePlayer` / vehicle），复制目标 **interior、VW**，保存管理员原位置；**不能旁观等级 ≥1 的管理员** |
| `/spoff` | 退出旁观，恢复原**位置、interior、VW** |

开始时向所有管理员发送灰色消息：`[A] 管理员 Name[id] 开始旁观 Name[id]。` `/admins` 中旁观者末尾显示 `| sp > id`。约每 400 毫秒同步目标 VW / interior / 车辆。反作弊调用 `markSpectating`。

### `/stats [id]`（管理员）

等级 **1+**，要求 `/alogin`。文件：`admin/stats.ts` → `commands/stats.ts` 的 `showStatsDialog`。

| 项目 | 说明 |
|---|---|
| 语法 | `/stats [id]` |
| 显示 | 与玩家 `/mn` → “统计”相同的 MSGBOX |
| 禁止 | 目标 `adminLevel ≥ 1`，包括管理员自己 |
| 日志 | **没有**灰色管理员日志 |

**没有**不带参数的玩家 `/stats` 命令。

---

## 管理员：/arang

等级 **7**，要求 `/alogin`。文件：`admin/arang.ts`。

| 项目 | 说明 |
|---|---|
| 语法 | `/arang [id] [+/-]`，必须有空格 |
| 目标 | 已是 **1–6** 级管理员且在线；**不能是自己**；**7** 级只能通过 `/makeadmin` 设置 |
| 结果范围 | **1–6**；设为 0 或 7 仍使用 `/makeadmin` |
| 数据库 | `saveAdminLevel` 只修改 `admin_level`，**不重置管理员密码** |

---

## 组织仓库（数据库）

**`warehouses`** 表（`sql/schema.sql` + `warehouse/repository.ts`）。`warehouse` 模块在 `houses` 后启动。补充来源：矿场金属、军队工厂弹药、医院运输药品。**帮派和黑手党**在各自总部仓库存取弹药、金属、毒品（`warehouse/stock-interact.ts`）。

| 字段 | 含义 | 默认值 |
|---|---|---|
| `org_id` | 主键，即组织 ID | — |
| `ammo` | 弹药 | `0` |
| `meds` | 药品 | `0` |
| `metal` | 金属 | `0` |
| `drugs` | 毒品 | `0` |
| `is_locked` | 1 上锁、0 开启 | 帮派 / 黑手党 **1**；政府 / 矿场 **0**，不使用锁 |

启动时 `INSERT IGNORE` 创建以下行：

| org_id | 仓库 | is_locked |
|---|---|---|
| **0** | **矿场** | 0 |
| 1 | 军队 | 0 |
| 2 | 医院 | 0 |
| 4 | 地区警察 | 0 |
| 5 | LSPD | 0 |
| 6 | FBI | 0 |
| 9–13 | Grove、Ballas、Vagos、Rifa、Aztecas | 1，可开关 |
| 14–16 | LCN、Yakuza、俄罗斯黑手党 | 1，可开关 |

启动时 `unlockNonLockableWarehouses` 将政府 / 矿场仓库强制设为 `is_locked = 0`，即使已有行原为 1。辅助函数：`warehouseUsesLock(orgId)`。

矿工交矿（`miner` → `deliver`）：**1 公斤矿石 → +1 公斤 `metal`**，存入 `org_id = 0` 仓库（`addMineMetal`），更新仓库标签。

金属出售拾取物为模型 **19134**，标签“出售金属 / 每公斤 15$”。对话框 **59** 输入公斤数，价格 **$15/公斤**。从矿场仓库扣除并加入 `users.metal`，扣现金。使用 `takeMineMetal`、`saveUserInventory` / `saveUserMoney`。

**黑手党（LCN / Yakuza / RM）：** 自定义总部（`maps/mafia.txt`，interior **0**，VW **14/15/16**）。仓库 `939.97, 1716.95, 3001.09`，红色检查点约 45 米可见，附库存标签。出生点 `953.95, 1755.95, 3001.09`。入口 / 出口：`org/mafia-doors.ts`。仓库：`warehouse/mafia-stock.ts`。

**帮派（Grove / Ballas / Vagos / Rifa / Aztecas）：** 各总部有同类仓库，使用各自 interior 和 VW 9–13。坐标：Aztecas `217.64, 1251.28, 1082.15`；Ballas `227.90, 1155.78, 1082.61`；Vagos `331.03, 1128.74, 1083.88`；Rifa `-71.28, 1365.81, 1080.22`；Grove `2455.68, -1706.20, 1013.51`。文件：`warehouse/gang-stock.ts`。

### 帮派 / 黑手党仓库交互

文件：`warehouse/stock-interact.ts`。对话框 **65** 菜单、**66** 数量。

步行进入检查点：

1. **本组织成员**看到列表，仓库上锁也会打开菜单：白色“存入弹药 / 金属 / 毒品”；`{9ACD32}` 颜色的“取出弹药 / 金属 / 毒品”；“关闭仓库 / 打开仓库”随状态变化，切换后重新显示更新菜单。
2. 输入数量，每次最多 **10 000**；更新 `users`（`drugs` / `ammo` / `metal`）和 `warehouses` 的扣除 / 发放，刷新标签。
3. **外人**收到“只有 {org_name} 可以使用仓库”，冷却约 2.5 秒。

上锁时“取出”提示“仓库已关闭”；**存入**不受锁限制。**开关仓库**需要 **7+** 级。重新打开菜单只需离开红色标记再进入，无需离开总部。

向所有在线组织成员发送：

```text
[仓库] {职级} Name_Surname[ID] 存入仓库：弹药 N 个。
[仓库] {职级} Name_Surname[ID] 从仓库取出：金属 N 个。
[仓库] {职级} Name_Surname[ID] 打开了仓库。 / 关闭了仓库。
```

**武器店（弹药仓库）：** interior **6**，VW 为 `org_id`：军队 **1**、地区警察 **4**、LSPD **5**、FBI **6**。入口：

| 仓库 | 来源 | 可进入者 |
|---|---|---|
| LSPD | 车库 `1568.63, -1690.08` | LSPD + FBI |
| 军队 | 基地 `2721.20, -2380.39` | 军队 + FBI |
| 地区警察 | 总部屋顶 / 工作人员出口 → 菜单 **55**“武器店”，无街道直达入口 | 地区警察 + FBI |
| FBI | 总部屋顶 / 工作人员出口 → 菜单 **56**“武器店”，无街道入口 | 仅 FBI |

内部出口 `316.42, -170.03`，各自 VW；地区警察和 FBI 使用菜单 **55** / **56** 选择屋顶 / 办公室。武器库位于 `312.41, -165.58`，拾取物 **19134**，标签“弹药：N”。**领取枪械**从组织仓库扣除配套弹药：DE 50、Shotgun 40、MP5 120、M4 150、Rifle 50、Sniper 30。库存不足不能领；护甲 / 警棍 / SWAT 制服免费。持久化：`takeWarehouseAmmo`，通用逻辑：`org/locker-ammo.ts`。

武器库：

| 仓库 | VW | 对话框 | 可领取者 | 配置 |
|---|---|---|---|---|
| LSPD | 5 | **23** | 仅 LSPD | 护甲、警棍、DE、Shotgun、MP5、M4、SWAT |
| 地区警察 | 4 | **22** | 仅地区警察 | 与 LSPD 相同 |
| 军队 | 1 | **54** | 仅军队 | 护甲、DE、M4、Rifle |
| FBI | 6 | **24** | 仅 FBI | 护甲、警棍、DE、Shotgun、MP5、M4、Sniper、SWAT |

地区警察工作人员出口：停车场独立，无菜单直接进出。屋顶 `621.26, -569.20` 使用菜单 **55** 选择办公室 / 武器店；总部屋顶出口旁 `246.40, 88.01` 标签为“屋顶 / 武器店”。

**FBI 总部：** 自定义地图 `maps/fbi.txt`，interior **0**、VW **6**（`ORG_FBI_ID`）。出生点 `668.72, 2560.29, -89.46`。街道 `607.14, -1458.50` ↔ 办公室 `654.10, 2538.15`；出口 `652.19, 2538.19`。屋顶 `595.61, -1476.19` 和总部点 `681.51, 2545.59` 使用菜单 **56**（办公室 / 屋顶 / 武器店）。总部物体通过 `assignStreamWorld` 放到 VW 6。相关文件：`org/fbi.ts`、`org/fbi-doors.ts`、`org/police-doors.ts`、`org/ammunation-doors.ts`、`org/fbi-locker.ts`、`org/police-locker.ts`、`org/lspd-locker.ts`、`org/army-locker.ts`。

所有仓库共用资源字段；实际使用哪些字段（如矿场只用 `metal`）由游戏逻辑决定。

**管理员 `/warehouse`**（等级 **5+**，已 `/alogin`）：仓库列表 → 分类信息：矿场为金属，医院为药品，军队 / 地区警察 / LSPD / FBI 为弹药，帮派 / 黑手党为弹药、金属、毒品和开关状态。对话框 **57** / **58**，文件 `admin/warehouse.ts`。

**管理员 `/afamily`**（等级 **5+**，已 `/alogin`）：分页家族列表 → 信息（含仓库）/ 管理（名称、描述、删除）。对话框 **130–136**，文件 `admin/afamily.ts`。

---

## 军队弹药工厂

只向**军队员工**提供的工厂工作，interior **2**，VW 为 `ORG_ARMY_ID` **1**。军队和 FBI 可进入该 VW，只有军队可开始班次。

门：`org/army-factory-doors.ts`（军队基地 ↔ 室内）。班次逻辑：`army-factory/`。

### 循环

1. **更衣室**（拾取物 `1275`）：对话框 **60** 入职 / **61** 结束班次。女性皮肤 **190**、男性 **260**。
2. **弹壳坯料**（黄色 `19135`）：取坯料，设置搬运动作。
3. **机器**（`18635`，约 20 秒动画）：组装，约 70% 成功得到成品箱，否则为次品，结算时罚款。
4. **成品仓库**（`1575`）：交货，军队仓库 **+40 发弹药**（`addWarehouseAmmo`），更新武器店标签。

结束时工资为每批 `$30` − 每个次品 `$15`，最低 0。通过工厂门离开会**自动**结束班次、结算并恢复组织皮肤。死亡 / 断线导致失败，无工资。

非军队、住院、服刑、矿工 / 搬运工班次中或驾校考试中不能入职。

---

## 药品运输（医院）

**仅医院员工**（`ORG_HOSPITAL_ID`）可做。文件：`vehicles/hospital.ts`。工作人员区域的药品仓库：`org/hospital-stock.ts`，位于医院 VW，含拾取物和“药品：N”标签。

### 循环

1. 医院旁的货车（**模型 428**）位于 `1148.13, -1304.40`，标签“药品运输”。
2. 对话框 **62** 确认运输，设置**供应商仓库**检查点 `1351.37, 355.83`。
3. 装货点停留约 **12 秒**，保持在货车内，装入 **50 单位**药品。
4. 检查点返回货车停车处。
5. 步行在货车旁使用 **`/pickmed`**，拿取箱子 **1580**，每箱 **10 单位**，送到工作人员区域仓库 `1156.48, -1342.85`（医院 VW）。
6. 交货：`addWarehouseMeds`，每箱获得 **$40**（`applyWallet` / persist）。重复直到货车清空。

每次运输可搬多箱（50 / 10 = 5），更新仓库标签（`refreshHospitalMedsStockLabel`）。

### 医生医疗包和 `/medhelp`

文件：`org/hospital-medkit.ts`、`commands/medhelp.ts`。

| 项目 | 说明 |
|---|---|
| 领取 | 医院员工步行到仓库 `1156.48, -1342.85`（医院 VW），扣除最多 **20 单位**（`takeWarehouseMeds`），手持箱 **11738**，bone 6、attach slot **2**；slot 1 用于运输箱 |
| 治疗 | `/medhelp [id] [金额]`，医生定价 **1–5000$**；患者在 `WHISPER_RADIUS` 内；区域必须是 **HOSPITAL_WORLD** 或**同一辆**医院车辆。患者 **Y/N** 确认；按 **Y** 后患者付款给医生，消耗 1 药品，HP → 100；通知医院全体员工：`(MED) 职级 Name[id] 治愈玩家 Name[id]。费用：N$。` |
| 隐藏医疗箱 | 死亡 / 入狱 / 离开医院 VW 时隐藏，但药品**仍留在医生身上**；药品为 0 也隐藏 |
| 断线 / 离职 | 隐藏箱子，剩余药品**退回**仓库（`addWarehouseMeds`） |
| 冲突 | 运输中（`/pickmed` / 运输班次）不能领医疗包；手持医疗箱不能 `/pickmed` |

### 医院档案室

文件：`org/hospital-archive.ts`。医院 VW（interior 0）的 **ALT** 拾取物：大厅 `1163.47, -1330.92` ↔ 档案室 `1161.67, -1330.91`。只能通过拾取物进出；仅**医院**和 **FBI** 员工可进入。

---

## 贫民区：贩子 Smoky

面向 Grove / Ballas / Vagos / Rifa / Aztecas **帮派**（组织 **9–13**）的街头贩子。模块 `ghetto/` 在 `src/index.ts` 的 `warehouse` 后启动。

| 项目 | 说明 |
|---|---|
| 名称 / 皮肤 | **Smoky**，皮肤 **28** |
| 坐标 | `2515.93, -1474.61, 24.00`，角度 `2.69`，街道 VW `0` |
| 交互 | 步行在约 2.2 米内按**左 Alt**（`KEY_WALK`） |
| 购买 | 毒品每个 **$50**，加入 `users.drugs`，扣现金 |
| 单次限制 | **1–500** 个 |
| 外人 | “我只跟本地人做生意”，约 2.5 秒冷却 |

对话框 **63** 菜单“购买毒品”、**64** 输入数量。保存：`saveUserMoney` + `saveUserInventory`。

Actor 循环动画：`DEALER` / `DEALER_IDLE`。客户端必须预加载动画库（`player.applyAnimation` + `clearAnimations`），并在 **`actorStreamIn`** 时重新播放，否则待机动画经常不可见。

Smoky 菜单（对话框 **63**）：

1. 购买毒品 → 对话框 **64**。
2. **军服（$100 000）**：伪装，男性皮肤 **287** / 女性 **191**，昵称 / 标签使用军队颜色（`0x9c7a4b`），可以开启**军队大门**。帮派身份、`/f` 和军队聊天权限不变。**死亡**或**断线**后移除。文件：`org/army-disguise.ts`。

---

## 通缉、军人证、医疗卡

`users` 字段及 `COLUMN_MIGRATIONS` 迁移：

| 字段 | Account | 默认 |
|---|---|---|
| `wanted_level` | `wantedLevel`，0–6 | `0` |
| `military_id` | `militaryId` | 无 |
| `medcard` | `medcard` | 无 |

### 通缉

通过 `player.setWantedLevel` 显示 GTA SA 星级；登录 / 出生时用 `applyWantedLevel` 同步。持久化：`saveUserWantedLevel`。辅助函数：`auth/wanted.ts` → `setPlayerWantedLevel`（0–6）。

**自动下降：** 玩家**在线**且 `wantedLevel > 0` 时，每 **20 分钟**减 1 并保存数据库。有通缉登录或首次被通缉时启动计时；`/su` 不重置当前倒计时。离线不计时。定时器延迟时补算遗漏次数，不超过当前星数。降到 **0** 会中止 `/pursuit` 追踪，与 `/clear` 共用钩子。文件：`auth/wanted.ts` → `bindWantedDecay`。

杀人通缉、`/clear`、`/wanted` 见 [杀人通缉、/clear、/wanted](#杀人通缉clearwanted)。

### 军人证

| 命令 | 使用者 | 功能 |
|---|---|---|
| `/givevbilet [id]` | 军队 **8+** 级 | 发证，目标在线且尚无证 |
| `/vbilet` | 持证者 | 查看自己的证件 |
| `/vbilet [id]` | 持证者 | 向 `WHISPER_RADIUS` 内目标提议展示，目标 **Y/N** 确认，见 [Y/N 提议](#yn-提议) |

查看对话框 **67**。文件：`commands/vbilet.ts`。

### 医疗卡

| 命令 | 使用者 | 功能 |
|---|---|---|
| `/givemedcard [id] [金额]` | 医院 **6+** 级 | 提议办卡，**$2000–5000**；患者 **Y** 购买 / **N** 拒绝，付款给医生 |
| `/medhelp [id] [金额]` | 医院 | 提议治疗，Y/N 确认，**1–5000$**；需仓库药品，见 [药品运输](#药品运输医院) |
| `/medcard` | 持卡者 | 查看自己的卡 |
| `/medcard [id]` | 持卡者 | 提议展示，目标 **Y/N** 确认 |

发卡**仅限医院内**：`1165.07, -1350.39, 4001.10`，VW `HOSPITAL_WORLD`、interior `0`、半径 **20 米**。查看对话框 **68**，文件 `commands/medcard.ts`。

`/pass [id]` 和 `/lic [id]` 同样先在聊天提议，按 **Y** 后打开证件。

统计（`/mn` / 管理员 `/stats`）显示通缉、军人证、医疗卡。

---

## 军队基地弹药箱（帮派突袭）

文件：`ghetto/army-crates.ts`。无标签的拾取物 **3013**，街道 VW 0：

| 编号 | 坐标 |
|---|---|
| 1 | `2792.68, -2393.04, 13.96` |
| 2 | `2743.31, -2454.36, 13.86` |

仅贫民区帮派（组织 **9–13**）。步行站在拾取物上，每约 **2.5 秒**从军队仓库（`warehouses`，org_id **1**）扣除 **20 发**，加入 `users.ammo`。库存空则提示“箱子空了……”并设冷却。更新军队武器店标签。

**在基地内死亡**（矩形 `2664.8,-2589.1` … `2864.8,-2306.1`，街道）损失当前弹药的 **30%**；原有弹药时至少损失 1 发。

---

## 商铺

**`businesses`** 模块在 `src/index.ts` 的 `houses` 后加载。种子数据：`sql/businesses_seed.sql`。

```text
resources/src/modules/businesses/
  repository.ts    数据库、缓存、购买/出售/税费/利润
  markers.ts       3D 标签和入口拾取物
  enter.ts         ALT 进入，门票计入 balance
  exits.ts         室内出口，拾取物 19132
  purchase.ts      1274 拾取物旁 /buybiz
  menu.ts          /biz：统计、出售
  bank-tax.ts      银行缴税和提取利润
  map-icons.ts     图标，槽位 50–99
  types.ts         type_id、名称、地图图标
  tax-math.ts      BUSINESS_TAX_RATE = 0.001
  world.ts         VW = 2000 + id，范围至 99999
  session.ts       槽位 → 当前室内商铺 ID
  ammu.ts          武器店商品
  shop-247.ts      24/7 商品
  clothes.ts       服装店试穿
  workshop.ts      修车厂服务
  gas.ts           加油站，H 鸣笛
  street-food.ts   街头食物
  …
```

### `businesses` 表

| 字段 | 含义 |
|---|---|
| `id` | SMALLINT，主键 |
| `name` | 名称 |
| `owner_id` | NULL 表示空置 |
| `type_id` | TINYINT，24/7、加油站、赌场等 |
| `entrance_*` | 街道拾取物 |
| `interior_*` / `buy_pickup_*` | 室内和 /buybiz 点；NULL 表示无室内 |
| `price` | 政府定价 |
| `entrance_fee` | 门票，现金计入 `balance` |
| `balance` | 商铺账户**利润** |
| `tax_paid_until` | 税费缴纳截止日期 |
| 室内 VW | `2000 + id`，上限 **99999**，家族从 `100000+` 开始 |

### 玩家操作

| 操作 | 方法 |
|---|---|
| 购买 | 室内拾取物旁 `/buybiz`，要求护照、等级 ≥3，现金支付 |
| 菜单 | `/biz`：统计，**利润** = `balance`，出售给政府 / 玩家 |
| 进入 | 入口按左 ALT；`entrance_fee > 0` 时扣现金，**80%** 计入 `balance` |
| 税费 / 利润 | 仅在**银行**的**“商铺”**菜单 |
| GPS | 分类和“寻找最近的……”：24/7、加油站、武器、租车、餐饮 |

### 出售

- **政府：** 返还现金 `price`，`balance` **清零**，利润不返还。
- **玩家：** 协商价格，`balance` 和 `tax_paid_until` 一并转移；卖方可先在银行取走利润。

### 税费

每天 `price` 的 **0.1%**，最低 $1，与房屋相同。从**银行账户**续缴。

**收回**（`businesses/tax.ts`，与房屋相似）：

- 服务器启动和日历日期变化时检查，每分钟检查一次。
- 条件：`owner_id IS NOT NULL`，且 `tax_paid_until IS NULL` 或 `< CURDATE()`。
- 数据库更新为 `owner_id = NULL`、`tax_paid_until = NULL`、`balance = 0`、`is_locked = 0`。
- 室内玩家移到街道入口；通知所有者，不补偿。
- 登录出生时，缴费剩余天数 ≤5 则提醒。

管理员 `/tpbiz [id]` 传送到商铺入口。

### 租车

商铺 **#49**（Santa Maria Beach）和 **#50**（Jefferson），类型 `VEHICLE_RENT`，每处 **5** 辆 Sentinel（405）。文件：`vehicles/rental.ts`。

| 规则 | 说明 |
|---|---|
| 驾照 | 要求 `license_car` |
| 一次一辆 | `/unrent` 前不能租第二辆 |
| 价格 | 每次现金 **500$** |
| 商铺利润 | 价格的 **80%** → `businesses.balance` |
| 确认 | 进入驾驶位后显示“租赁 / 取消”；取消则下车 |
| 外人 | 不能进入已被他人租用的车 |
| 下车 | **5 分钟**内返回，否则租赁失败，车辆回原点 |
| `/unrent` | 结束租赁；车内玩家下车，车辆重生 |
| 退出游戏 | 立即终止租赁，车辆回原点 |

### 购买私人车辆

汽车店 / 摩托市场（`vehicles/dealership.ts`）：商铺 **#13** 豪华、**#14** 经济、**#15** 摩托市场。

| 规则 | 说明 |
|---|---|
| 条件 | 护照 + 汽车 / 摩托许可证 + **自己的房屋** |
| 上限 | 每玩家 **1** 辆 |
| 付款 | 现金，**80%** → `businesses.balance` |
| 颜色 | `1, 1`，白色 |
| 生成位置 | 所有者房屋的 `houses.vehicle_x/y/z` + `vehicle_angle` |
| 数据表 | `player_vehicles` |

**目录和价格：**

- 豪华：Buffalo `95 000$`、Infernus `350 000$`。
- 经济：Landstalker `28 000$`、Bravura `18 000$`。
- 摩托市场：Faggio `5 000$` … NRG-500 `120 000$`，另有 PCJ、Freeway、Sanchez、Quad、FCR、BF-400、Wayfarer。

站到入口拾取物 → 列表 → 确认。

### 私人车辆：/lock 和 /car

| 命令 | 操作 |
|---|---|
| `/lock` | 在自己车旁或车内开关锁，状态写入数据库 |
| `/car` → 信息 | ID、燃油、HP、开锁 / 上锁 |
| `/car` → 停放 | 在房屋 `houses.vehicle_*` 处重生，将乘客移出 |

- 上锁后**任何人**都不能上车，包括所有者；未锁时任何人可上车。
- 速度表中**绿色 Open** 表示未锁，**红色 Open** 表示已锁。
- 进入驾驶位提示“车辆属于 Name_Surname[ID]”。
- 下车 / 断线 / 停放时保存 HP。
- 退出游戏时**删除**运行时车辆；再次通过 `/car` → 停放生成。

### 后备箱与出售私人车辆

| 命令 / 操作 | 说明 |
|---|---|
| `/trunk` | 在已开锁私人车辆旁存取现金，后备箱最多 **$500** |
| `/car` → 出售给政府 | 返还 `purchase_price` 的 **50%** 现金，删除记录 |
| `/car` → 出售给玩家 | 向附近玩家发送 Y/N 提议 |

文件：`vehicles/trunk.ts`、`vehicles/sell.ts`、`shared/yn-offer.ts`。

---

## 银行：商铺税费与利润

柜台的**“商铺”**选项（`bank/tellers.ts` → `businesses/bank-tax.ts`）：

1. 无商铺 → **“你没有商铺。”** → “返回”银行菜单。
2. 有商铺 → 子菜单：“商铺缴费”依次显示信息、输入天数（1–999）、确认，扣 `users.bank` 并更新数据库和缓存的 `tax_paid_until`；“提取商铺资金”依次输入金额、确认，扣 `businesses.balance`，发放**现金**（`users.money`）。

事务位于 `repository.ts`（`payBusinessTax`、`withdrawBusinessBalance`）。提交后**不再重复**调用 `saveUserMoney`，因为数据库中的金钱已更新。

`/biz` 统计中的**“利润”**为当前 `balance`。

---

## 商铺商品：武器店和 24/7

通用流程：站到商铺室内的**购买拾取物** → 列表 → 现金付款，**80%** → `businesses.balance`（`payBusinessCashShare`）。

### 武器店（`type_id` 为 AMMU）

文件：`businesses/ammu.ts`，对话框 **94**。

- 进入要求 `license_gun`，店主无需许可证即可进入。
- 购买必须持枪械许可证。

| 商品 | 价格 | 发放 |
|---|---|---|
| 防弹衣 | $2 500 | 100 护甲（`grantArmour`） |
| Desert Eagle（24） | $4 500 | 49 发 |
| Shotgun（25） | $4 000 | 30 发 |
| UZI（28） | $3 000 | 100 发 |
| AK-47（30） | $9 000 | 90 发 |
| Rifle（33） | $7 000 | 30 发 |

### 24/7 商店（`type_id` 为 SHOP_247）

文件：`businesses/shop-247.ts`，对话框 **95**，进入无需许可证。

| 商品 | 价格 | 效果 |
|---|---|---|
| 手机 | $2 000 | 唯一 6 位 `users.phone`，unique，只能购买一次 |
| 相机（43） | $1 000 | 36 次“拍照”（`grantWeapon`） |
| 面具 | $500 | 会话中 +1 个面具，不存数据库，`/mask` 佩戴 |

手机事务 `payBusinessPhonePurchase` 原子更新金钱和号码。

### 服装店（`type_id` CLOTHES = 9）

文件：`businesses/clothes.ts` + `clothes-catalog.ts`，通过 `auth/skin-picker.ts` 试穿。

- 与普通商铺一样按 ALT 进入。
- 室内购买拾取物 **1275** → 皮肤目录 → 独立 VW 试穿 → 购买，**80%** → `balance`。

---

## 修车厂

`type_id` **WORKSHOP = 12**。文件：`businesses/workshop.ts`；地图：`maps/workshop.txt`；种子数据：`sql/businesses_seed.sql` 的 `#36–38`。

### 地图位置

| ID | 名称 | 街道入口 |
|---|---|---|
| 36 | Temple 修车厂 | `1041.33, -1027.58, 32.10` |
| 37 | Blueberry 修车厂 | `296.76, -159.31, 1.58` |
| 38 | Idlewood 修车厂 | `2074.30, -1831.32, 13.55` |

共用室内坐标（`interior_id` **20**，入口 `1278.00, -20.64, 1000.95`，服务点 `1288.52, -6.41, 1000.95`），但每家使用**独立 VW** `2000 + id`，与其他商铺相同。同店玩家互相可见，不同店不可见。地图物体设置 `world = -1`，在 interior 20 的所有 VW 中可见。

### 进入 / 离开

| 项目 | 说明 |
|---|---|
| 街道 | 普通商铺入口拾取物，步行按**左 ALT**进入；与其他室内一样短暂冻结等待稳定 |
| 出口 | 拾取物 **19132** + ALT，返回**进入时对应的**街道入口（`session`） |
| 驾车进入 | **不支持**，车留在外面 |
| 会话 | 进入时 `setInsideBusiness`；退出 / 死亡 / 断线时重置，否则出口和驱逐逻辑会出错 |

### 室内服务

步行站到购买拾取物 **19131**（“服务”标签）打开菜单 **144**。

| 项目 | 说明 |
|---|---|
| 条件 | 私人车辆必须已通过 `/car` 生成；服务作用于该车，即使车在街道 |
| 喷漆 | **$1 500**，对话框 **145** / **146**，主色 / 副色 |
| 修理 | **$800**，HP → 1000 |
| 加油 | 每缺少一升 **$10**，与加油站相同 |
| 氮气 | **$5 000**，组件 **1010**，标记 `player_vehicles.has_nitro` |
| 利润 | **80%** → `businesses.balance`（`payBusinessCashShare`） |

颜色 / HP / 燃油 / 氮气同时更新运行时车辆和数据库。付款后运行时车辆消失，升级仍保存到车库，可通过 `/car` 更新。

---

## 饥饿和街头食物

| 项目 | 说明 |
|---|---|
| 字段 | `users.hunger`，0–100（`Account.hunger`） |
| 初始 | 100 |
| 下降 | 每 **15 分钟** −5；为 **0** 后每 15 分钟扣 1 HP，不低于 `MIN_HEALTH` |
| 持久化 | `saveUserVitals` / `saveUserHunger`、`persist/index.ts` |
| /mn → 统计 | “饥饿”一行 |
| 警告 | 穿过 40 / 30 / 20 阈值时 |

**街头食物**（`type_id` STREET_FOOD）：`businesses/street-food.ts`，对话框 **93**，街道拾取物按 ALT 打开菜单。

| 食物 | 价格 | 饱食度 |
|---|---|---|
| 热狗 | $50 | +20 |
| 汉堡 | $100 | +40 |

80% 计入商铺余额。进食动画：`FOOD/EAT_Burger`。

**快餐店**（`type_id` FASTFOOD）：`businesses/fastfood.ts`，对话框 **98**。站到室内购买拾取物打开菜单，比摊位更贵、也更饱腹。

| 食物 | 价格 | 饱食度 |
|---|---|---|
| 可乐 | $80 | +15 |
| 薯条 | $150 | +30 |
| 热狗 | $180 | +40 |
| 汉堡 | $280 | +55 |
| 芝士汉堡 | $350 | +65 |
| 披萨 | $450 | +80 |
| 套餐 | $600 | +100 |

80% 计入商铺余额。动画：`FOOD/EAT_Burger`。

---

## 电话和广告

| 项目 | 说明 |
|---|---|
| 字段 | `users.phone`，`CHAR(6) NULL`，unique |
| 购买 | 24/7，见上文 |
| `/leaders` | 对话框 **126**；领导有电话时显示 `| 电话 NNNNNN` |

### `/ad`

- 必须有手机。
- 播出格式：“……由 Name_Surname[ID] 发送（电话 000000）”。
- 价格仍为 **$500**，由广播中心 `/edit` 审核。

文件：`commands/ads.ts`、`commands/leaders.ts`、`businesses/repository.ts` → `payBusinessPhonePurchase`。

---

## GPS 和命令列表（/mn）

### `/gps` — `gps/index.ts`，对话框 **7**

根菜单：

1. 公共场所：LS 火车站、银行。
2. 政府组织：市政厅、医院、监狱、地区警察、LSPD、FBI、驾校。
3. 帮派和黑手党。
4. 工作：矿场、仓库（搬运工）、**公交司机**（`1269.80, -1840.67`）。

最近地点以浅蓝色显示：加油站、24/7、武器店、租车、餐饮（FASTFOOD + STREET_FOOD）。

子菜单第二个按钮为**“返回”**，不是列表项。标记激活时再次 `/gps` 会关闭路线。

### 命令列表：`/mn` → “命令列表”

**没有 `/help` 命令**。UI 位于 `commands/help.ts`，对话框 **96** 分类菜单 / **97** 列表，从 `/mn` 打开。

分类：通用、交流、车辆、房屋、商铺、帮派与黑手党、组织、领导、**家族**。分类内以绿色 `/cmd` 配合 registry 描述显示，按钮为**返回 / 关闭**。管理员命令仅通过 `/ahelp` 查看。通用含 `/id`，车辆含 `/eject`，组织含 `/cuff` `/uncuff` `/putpl` `/arrest` `/demote`。**玩家没有 `/stats` 命令**，自己的统计只通过 `/mn` → “统计”查看。

---

## 杀人通缉、/clear、/wanted

文件：`zones/murder.ts`、`commands/clear.ts`、`commands/wanted.ts`、辅助函数 `org/law.ts`。争夺战豁免：`zones/capture.ts` → `isCaptureCombatKill`。

### 杀人 → 通缉 / 制服罪犯

`playerDeath` 时，如果存在玩家击杀者：

| 条件 | 结果 |
|---|---|
| 击杀者和受害者都是执法人员 | 忽略 |
| 击杀者是执法人员，受害者在区域内参加**进行中的争夺战** | 忽略，即使受害者有通缉 |
| 击杀者是执法人员，受害者 `wantedLevel > 0` | **制服罪犯**：`applyJail`，刑期为 `★ × 10` 分钟，通缉归零；执法聊天：`{职级} Name[ID] 在 {district} 制服了罪犯。` 不显示刑期 |
| 击杀者是执法人员，受害者无通缉 | 忽略，不给击杀者通缉 |
| 区域内争夺战攻守双方互杀，击杀者非执法人员 | 忽略 |
| 其他情况，平民击杀者 | 击杀者通缉 **+1**，最高 6；执法聊天通知 + 音效 **21001** |

地区名使用受害者坐标调用 `districtNameAt`（`zones/district.ts`）。争夺战参与者检查：`isCaptureParticipantOnTurf`（`zones/capture.ts`）。

### `/su [id] [1-6] [原因]`

执法组织（LSPD / 地区警察 / FBI）可用。星数在现有基础上**增加**，上限 **6**。不能对执法人员和囚犯使用。文件：`commands/su.ts`。

| 项目 | 说明 |
|---|---|
| 自己 / 执法人员 / 已入狱（`isJailed`） | 禁止 |
| 目标已有 6 星 | 拒绝 |
| 成功 | `wanted += N`，最高 6；执法聊天显示实际增加值，通知目标 |

### `/clear [id]`

仅 LSPD / 地区警察 / FBI。任何在线目标，无距离检查。通用逻辑：`clearWantedByOfficer`。

| 项目 | 说明 |
|---|---|
| 对自己 | 禁止 |
| 通缉为 0 | “该玩家未被通缉。” |
| 成功 | 通缉归零；执法聊天：“警察 / FBI Name[ID] 取消了玩家 Name[ID] 的通缉。”；目标：“你的通缉已取消。”；中止对目标的追踪 |

### `/wanted` 和 `/pursuit`

仅执法组织（LSPD / 地区警察 / FBI）。对话框 **127** 列表、**128** 操作。

列表显示在线 `wantedLevel > 0` 玩家，以“姓名 / 通缉等级”表格按星数排序。列表存储 `accountId`，断线后槽位变化不会导致目标被替换。

选择玩家后：

1. **寻找**：在目标位置设置检查点，每 **5 秒**更新。不能选自己、interior `>0` 或 VW ≠`0` 的目标。目标退出 / 死亡 / 改变 interior / VW / 通缉归零，或警员失去执法身份时中止。手动停止使用 **`/pursuit`**。
2. **取消通缉**：与 `/clear` 相同。

### 向 LSPD 自首

文件：`org/lspd-surrender.ts`。LSPD 室内拾取物 **1247**，位置 `240.77, 112.91, 1003.22`，interior **10**、VW **0**。对话框 **139**。

| 项目 | 说明 |
|---|---|
| 条件 | `wantedLevel > 0`、未服刑、步行站在拾取物上 |
| 刑期 | `wantedLevel × 10` 分钟，1 星 10 分钟，6 星 60 分钟 |
| 成功 | `applyJail` 随机牢房，通缉归零，通知执法组织 |

---

## 玩家家族

**`family`** 模块（`resources/src/modules/family/`）在 `src/index.ts` 的 `warehouse` **之后**、`ghetto` **之前**启动。独立于组织 / 黑手党，使用 `families` 表和玩家字段 `users.family_id` / `users.family_rank`。

### 数据库

**`families`** 表（`sql/schema.sql` + `family/repository.ts`）：

| 字段 | 含义 |
|---|---|
| `id` | 主键 |
| `name` | UNIQUE，拉丁字母和空格，2–24 字符 |
| `description` | 最多 128 字符 |
| `level` / `exp` | 预留，仅显示 |
| `owner_id` | 所有者 `users.id` |
| `ammo` / `metal` / `drugs` / `money` | 仓库 |
| `is_locked` | 仓库上锁，默认 1 |
| `created_at` | 日期 |

**`users`**：`family_id`（0 为无家族）、`family_rank`（1–10）。持久化：`saveUserFamily`。

### 创建家族（市政厅）

拾取物 **19131**，标签“家族注册”，位于市政厅室内（`MERIYA_WORLD` / 自定义室内），坐标 `-812.81, -672.91, 4001.09`。

| 要求 | 说明 |
|---|---|
| 护照 | 必须 |
| 等级 | **≥ 5** |
| 现金 | **250 000$** |
| 尚未加入家族 | 必须 |
| 名称 | 只能用 `A–Z` / `a–z` 和单个空格 |

对话框 **113** 确认、**114** 名称。创建者获得 **10 级（老板）**。

### 家族房屋

| 项目 | 说明 |
|---|---|
| 街道入口 | 拾取物 **19132**，`1327.75, -1556.41, 13.55` |
| 内部出口 / 出生点 | `200.12, 4.91, 1501.01` / `198.03, 4.91, 1501.01` |
| VW | `100000 + familyId`（`family/world.ts`） |
| 地图 | `maps/family_home.txt`，文件中 world / interior 为 **-1** |
| 进入权限 | 仅家族成员 |

### 家族仓库

拾取物 **19134**，坐标 `199.30, -3.63, 1500.99`，附 3D 标签：弹药 / 金属 / 毒品 / 金钱和开关状态。

菜单与帮派 / 黑手党相同，可存取资源和**金钱**，**7** 级可操作锁。单次上限：资源 **10 000**，现金 **1 000 000$**。对话框 **110** / **111**。

### 治疗

心形拾取物 **1240**，位置 `197.47, 13.33, 1500.99`，为非住院家族成员恢复满 HP。

### 犯罪家族职级

| ID | 名称 |
|---|---|
| 1 | 小混混 |
| 2 | 打手 |
| 3 | 自己人 |
| 4 | 老手 |
| 5 | 头面人物 |
| 6 | 监管人 |
| 7 | 小队长 |
| 8 | 左右手 |
| 9 | 副手 |
| 10 | 老板 |

人事管理（邀请 / 开除 / 调职）要求 **≥9** 级。`/frang` 可调整 **1–9** 级。不能开除所有者（`owner_id`），不能通过 `/frang` 设置 10 级。

### 命令

| 命令 | 使用者 | 功能 |
|---|---|---|
| `/family` | 成员 | 信息、管理（人事权限）、离开家族菜单 |
| `/fam [文字]` | 成员 | 家族聊天（`Color.familyChat`） |
| `/fmembers` | 成员 | 在线成员职级、Name_Surname[id]、电话（如有），对话框 **123** |
| `/finvite [id]` | 职级 ≥9 | 聊天 **Y/N** 邀请，60 秒有效，10 米内，需护照 |
| `/funinvite [id] [原因]` | 职级 ≥9 | 开除 |
| `/frang [id] [+/-]` | 职级 ≥9 | 晋升 / 降职，范围 1–9 |

`/family` 管理：改名、描述、**转让所有权**（新所有者 → 10 级，原所有者 → 9 级）、删除家族（所有者）。离开时，所有者若是唯一成员则原子解散；若仍有其他成员，必须先转让所有权。

昵称上方家族标签：`family/tags.ts`。

### 家族对话框

| ID | 用途 |
|---|---|
| 110 / 111 | 仓库菜单 / 数量 |
| 112 | **已过时**，邀请原为对话框，现为 Y/N |
| 113 / 114 | 创建确认 / 名称 |
| 115–122 | `/family` 菜单：信息、管理、离开、改名、描述、转让、删除 |
| 123 | `/fmembers` |
| 130–136 | 管理员 `/afamily`：列表、主页、信息、管理、改名、改描述、删除 |

文件：`family/index.ts`、`repository.ts`、`create-office.ts`、`home.ts`、`stock.ts`、`stock-display.ts`、`heal.ts`、`commands.ts`、`menu.ts`、`ranks.ts`、`tags.ts`、`world.ts`。管理员：`admin/afamily.ts`。

---

## 燃油与加油站

文件：`vehicles/fuel.ts`、`businesses/gas.ts`；速度表：`hud/speedo.ts`；持久化：`player_vehicles.fuel` / `updatePlayerVehicleFuel`。

| 项目 | 说明 |
|---|---|
| 油箱 | 所有使用燃油的内燃机车辆统一为 **0–100** |
| 消耗 | 只在引擎开启且有驾驶员时消耗：驾驶约 **45 分钟**耗尽，怠速约 **90 分钟**，熄火不耗油 |
| 不用燃油 | 航空 / 水上车辆、自行车 |
| 空油箱 | 不能启动；耗尽时熄火 |
| 私人车辆 | 运行时 fuel，并在离开车辆 / 停放 / 断线时保存数据库 |
| 其他车辆 | 仅运行时保存，重生后回到 100 |

### 加油站

商铺 `type_id = GAS (6)`，拾取物 **1650**。驾驶员在油泵约 5.5 米内按**鸣笛 H**：

1. 熄火，`toggleControllable(false)` 冻结 **6 秒**。
2. 价格为缺少的升数 × **$10**，从空加满 **$1000**；**80%** → `businesses.balance`。
3. 油量设为 100，解除冻结，启动引擎。

速度表显示 `Fuel N`；油量 ≤15 时文字和 **E** 为红色。

---

## Y/N 提议

每玩家共用一个提议槽位：**`shared/yn-offer.ts`**（`claimYnOffer` / `releaseYnOffer`）。已有任意提议时不能接收新提议，提示“该玩家已有进行中的提议”。有效期 **60 秒**。使用聊天中的 **Y / N** 按键回答，不是对话框。

| Kind | 来源 |
|---|---|
| `pass` / `lic` / `show_medcard` / `vbilet` | 证件展示（`shared/doc-show-offer.ts`） |
| `medcard` | 购买医疗卡（`/givemedcard`） |
| `invite` | `/invite` 组织邀请 |
| `finvite` | `/finvite` 家族邀请 |
| `selllic` | `/selllic` 买方确认 |
| `biz` / `car` | 出售商铺 / 私人车辆 |

**证件展示**（带 ID 的 `/pass` `/lic` `/medcard` `/vbilet`）：`WHISPER_RADIUS` 内 → 聊天提示 → **Y** 打开证件对话框，重新核对距离和 `fromUserId`。

**邀请**（`/invite`、`/finvite`）：由对话框改为聊天 Y/N；接受时重新检查人事权限、距离、护照；提议槽位一直占用到数据库写入结束。

**`/selllic`**：卖方仍使用列表 / 价格对话框 **29** / **30**；买方改为聊天 Y/N，对话框 **31** 已过时。

---

## 动画（/anim）

| 项目 | 说明 |
|---|---|
| 命令 | `/anim` 打开对话框；`/anim [1-74]` 直接播放 |
| 停止 | 左 ALT（`KEY_WALK`），有 TextDraw 提示 |
| 限制 | 只允许步行，车内不可用 |
| 文件 | `modules/anim/catalog.ts`、`index.ts`、`commands/anim.ts` |

---

## 面具（/mask）

| 项目 | 说明 |
|---|---|
| 购买 | 24/7，$500，存入会话内存计数，不写数据库 |
| 命令 | `/mask` 佩戴 / 摘下 |
| 时长 | **10 分钟**，佩戴时消耗 1 个 |
| 雷达 | `player.setColor` 的 alpha 为 **0**，从小地图消失 |
| 昵称 | 深灰色 `0x2A2A2A`，仅普通 IC 聊天 |
| 移除 | 再次 `/mask`、死亡、入狱、计时到期 |
| 退出 | 已购和已佩戴面具全部清除 |
| `/unmask [id]` | 附近警察 / FBI 扯下面具，按 `/me` 扮演，无动画 |

文件：`modules/mask/index.ts`、`commands/mask.ts`、`commands/unmask.ts`、`businesses/shop-247.ts`。

---

## 搜身和没收（/frisk、/take）

执法组织（LSPD / 地区警察 / FBI），目标在 `WHISPER_RADIUS` 内。监狱中不可用。

| 项目 | 说明 |
|---|---|
| 目标 | FBI 可对任何玩家；警察仅可对非执法玩家 |
| `/frisk [id]` | MSGBOX：电话、金属、毒品、弹药；“关闭”按钮 |
| `/take [id]` | LIST，只显示持有的毒品、弹药、各许可证 |
| 持久化 | 库存 / 许可证写入数据库 |
| RP | 搜身和没收时使用 `/me` 式扮演 |

文件：`commands/frisk.ts`、`commands/take.ts`、`commands/law-target.ts`、`org/law.ts`（`canLawSearchTarget`）。

---

## 执法：手铐、/arrest、/eject

通用附近目标解析：`commands/law-target.ts` → `resolveLawNearbyTarget`。操作者须有执法身份、未入狱 / 被铐；目标在 `WHISPER_RADIUS` 内，非 wasted / spectate；FBI 可对任何人，警察仅可对平民。

### 手铐 — `cuff/index.ts`、`commands/cuff.ts`

| 项目 | 说明 |
|---|---|
| `/cuff [id]` | 冻结和动画，车内目标下车，RP `/me` |
| `/uncuff [id]` | 解铐，恢复控制 |
| 乘客 | 被铐者可通过 `/putpl` 放入乘客位；进入驾驶位则踢下车 |
| 死亡 | 手铐标志**保留到出生时**，否则 Wasted 状态退出可绕过入狱 |
| 出生 | 移除手铐，如医院出生 |
| `applyJail` | 移除手铐 |

### `/putpl [id]` — `commands/putpl.ts`

警员必须**在驾驶位**，目标在附近，放入第一个空闲座位 **1–3**，不限制车型。被铐目标短暂解冻 → 放入车辆 → 约 1 秒后再次冻结。

### `/arrest [id]` — `commands/arrest.ts`

| 项目 | 说明 |
|---|---|
| 开始 | 警员在警局点 **10 米**内，街道 VW 0：地区警察 `626.08, -590.18, 16.76`，或 LSPD `1529.20, -1678.83, 5.89` |
| 目标 | 已上铐、`wantedLevel > 0`、非执法、未服刑 |
| 检查点 | 同一警局点，半径 **4** |
| 完成 | 警员驾驶到 CP，目标在**同一辆车**，入狱 `★ × 10` 分钟，通缉归零、解铐 |
| 奖励 | 仅警员获得 **$500 × ★**，刑期只在给警员的消息中显示 |
| 执法聊天 | `{职级} Name[ID] 将 Name[ID] 送入监狱（{警局}）。` **不显示**刑期 |
| 有效期 | pending **10 分钟**；警员或目标死亡 / 退出则取消 |

### 上铐后断线逃跑

`cuff` → `applyCuffDisconnectJail`，由 `persist` 在 `queueSave` **之前**调用。

| 项目 | 说明 |
|---|---|
| 条件 | 带手铐标志退出 |
| 刑期 | **60 分钟**，相当于 6 星 |
| 数据库 | `jail_seconds`，通缉 0，非 hospitalized |
| 全服通知 | 红色，类似封禁：`玩家 Name_Surname 在被捕时退出，已被送入监狱。` 不带 ID |
| 登录 | 监狱出生，继续服刑 |

### `/demote [id] [原因]` — `commands/demote.ts`

FBI 职级 **8+**（督察及以上），目标在 `WHISPER_RADIUS` 内。

| 项目 | 说明 |
|---|---|
| 目标 | 政府组织（`org.gov`），**非 FBI**，职级 **1–8** |
| 操作 | 与 `/uninvite` 相同，`orgId = 0`，更新外观和组织车辆权限 |
| 政府全体聊天 | `{FBI 职级} Name[ID] 将 Name[ID] 从 {org} 开除。原因：……`（`Color.dept`） |
| 禁止 | 自己、FBI、9–10 级、非政府、距离过远 |

### `/eject [id]` — `commands/eject.ts`

任何已登录的**驾驶员**都可以将乘客踢出**当前自己驾驶的车辆**。**不检查**所有权 / 租赁 / 组织 / 出生点踏板车身份，只需在驾驶位。不能踢自己。

### 监狱：市政厅律师

工作人员门（`prison/index.ts` 的 `staffOnly`）除执法组织外，仅允许市政厅**律师**（`ORG_MERIYA_ID` + `MERIYA_ADVOKAT_RANK`，与 `/advokats` 相同）。  
**不授予** `/pult`、监狱武器库或关闭院子的进入权限。

---

## 帮派交易（/sellgun、/selldrug）

仅**帮派**（Grove / Ballas / Vagos / Rifa / Aztecas），需步行在街道**己方**区域（`findTurfAtPlayer`）。买方在 `WHISPER_RADIUS` 内，Y/N 有效期 60 秒。

| 命令 | 说明 |
|---|---|
| `/sellgun [id] [弹药 1–500] [价格]` | 手持武器须来自 `/makegun` 配置；武器不写数据库；金钱使用 `transferUserCash` |
| `/selldrug [id] [数量] [价格]` | 扣除 / 发放毒品并持久化；价格 1–50 000$ |

文件：`commands/sellgun.ts`、`commands/selldrug.ts`、`commands/gang-deal.ts`。

---

## 房屋储物柜（/makestore、/use）

所有者在自己房屋室内（`findOwnedHouseAtInterior`：VW + `interior_id` + 距 `interior_*` ≤20 米）。

| 项目 | 说明 |
|---|---|
| `/makestore` | 在玩家当前位置放置 / 移动储物柜，不改变内容 |
| 标签 | 与帮派仓库相同，3D 文字显示弹药 / 金属 / 毒品 / 金钱，无拾取物和检查点 |
| `/use` | 仅储物柜 **2 米**内的所有者；访客能看标签，不能打开菜单 |
| 清空 | 出售 / 收回 / `/asellhouse` 时清空坐标和库存 |

文件：`houses/store.ts`、`houses/store-display.ts`、`commands/makestore.ts`、`commands/use.ts`。

---

## 平民工作（就业中心、公交）

**`jobs`** 模块（`resources/src/modules/jobs/`）在 `src/index.ts` 的 `vehicles` **之后**启动。

### 数据库

| 项目 | 说明 |
|---|---|
| 字段 | `users.job_id`，`SMALLINT UNSIGNED NOT NULL DEFAULT 0` |
| 迁移 | `auth/repository.ts` → `COLUMN_MIGRATIONS` + `saveUserJob` |
| 内存 | `Account.jobId` |

`0` 表示失业，`1` 表示公交司机（`JOB_BUS_DRIVER`）。

### 就业中心 — `jobs/hire.ts`

市政厅室内（`MERIYA_WORLD`）的红色 `Checkpoint` 和标签：`-808.3898, -672.9396, 4001.0859`。

对话框 **150**（`TABLIST_HEADERS`）：

| 工作 | 等级 |
|---|---|
| 辞职 | — |
| 公交司机 | 2 LVL |

| 规则 | 说明 |
|---|---|
| 一份工作 | 换工作前必须先辞职 |
| 等级 | 公交司机要求 **2** 级；入职时**不检查**驾照 |
| 班次 | 公交班次中不能辞职 |
| 防刷 | 关闭对话框后需离开 CP 才能重开 |

### 公交司机 — `jobs/bus/*`

| 项目 | 说明 |
|---|---|
| 停车场 | `1275.3, -1796…-1818` 附近 5 辆 Enforcer `431`（车型名称按原文保留） |
| 权限 | `registerJobVehicle`，驾驶要求 `job_id = 1` 和汽车驾照；任何人可当乘客 |
| 开始班次 | 对话框 151→152→153：确认 → 票价 **1–2000$** → “城市”路线 |
| 拒绝 | 移出公交车 |
| 标签 | 车顶显示路线名称和票价 |
| 路线 | 带箭头 `RaceCheckpoint`（`bus/route.ts`） |
| 停站 | 熄火、冻结 **15 秒**，**15 米**范围深绿色聊天；然后解冻、启动 |
| 票款 | 乘客上车即付款给司机（`transferUserCash`）；`away` 时不收费 |
| CP 报酬 | 每点 **$80**，**仅终点结算** |
| 终点 | 下车 → **2 秒**后公交车在停车场重生，移除标签 |
| 下车 | **30 秒**内返回，否则班次终止、不发 CP 报酬；已收到票款保留 |

GPS“工作” → **公交司机**（`1269.8052, -1840.6724, 13.3936`）。

---

## 帮派发薪：领地补贴

文件：`payday/index.ts` + `zones/turf.ts` → `countTurfsOwnedBy` / 快照 `snapshotGangTurfCounts`。

| 项目 | 说明 |
|---|---|
| 对象 | `orgPaydayPay` 时的帮派成员（`isGangOrgId`） |
| 公式 | 职级工资 + `区域数量 × GANG_TURF_PAY_BONUS` |
| 常量 | `GANG_TURF_PAY_BONUS = 100`（`org/gangs.ts`） |
| 收据 | 只用“工资”一行显示总额，不单列区域补贴 |
| 快照 | 每次发薪只计算**一次**区域数量 |

---

## `/id` — 搜索玩家

文件：`commands/id.ts`。所有已登录玩家可用。

| 项目 | 说明 |
|---|---|
| 用法 | `/id [ID 或昵称片段]` |
| 范围 | 仅**在线**、已登录且不是 NPC 的玩家 |
| 输出 | 最多 **10** 行，字段为昵称、ID、等级、延迟 |
| 昵称 | 不区分大小写的 `includes` |
| ID | 输入为整数时精确匹配槽位 |

---

## 聊天表情

文件：`chat/emotions.ts`，在 `chat/index.ts` → `playerText` 挂钩。整个消息必须精确匹配，不含其他文字。禁言与普通聊天一样阻止表情。

| 输入 | 聊天（类似 `/me`，`Color.action`） | 头顶气泡 | 动画 |
|---|---|---|---|
| `)` | `Name 微笑` | `微笑` | — |
| `))` | `Name 大笑` | `大笑` | — |
| `=0` | `Name 感到惊讶` | 相同文字 | — |
| `(` | `Name 感到难过` | 相同文字 | — |
| `((` | `Name 感到非常难过` | 相同文字 | `GRAVEYARD` / `mrnF_loop`，步行时 |

气泡使用 `setChatBubble`、**`Color.action`**（与 `/me` 相同）、聊天半径，约 4 秒。

---

## 汇总：执法、工作、AC、聊天

简要功能索引，详细说明见上述章节和修改位置表。

- **AC：** 安全区不会在 slap / 受伤后破坏 HP 镜像；跌落不扣镜像护甲；金钱不允许 `+1$`；HP / 护甲 eps 为 **1.0**；位置宽限使用 `posTrust*` 锚点，步行范围较小、车内较大。
- **聊天表情：** `)` `))` `(` `((` `=0`，类似 `/me` 的扮演与气泡（`chat/emotions.ts`）。
- **平民工作：** `users.job_id`、市政厅就业中心、公交司机的路线 / 票价 / 停站 / RaceCP。
- **`/id`：** 按昵称 / ID 搜索在线玩家。
- **帮派发薪：** 每块控制区域 **+$100**，并入工资，不单列收据行。
- **执法 / 组织：** `/demote`（FBI 8+）、`/cuff` `/uncuff` `/putpl` `/arrest`、`/eject`。
- **命令 UI：** 没有 `/help` 和玩家 `/stats`，通过 `/mn` 的“命令列表 / 统计”访问；管理员 `/stats [id]` 独立。
- **单元测试：** `resources/tests/`，在 `resources/` 中执行 `npm test`。

---

### 军队弹药运输

文件：`vehicles/army-ammo-delivery.ts`，从 `spawnArmyVehicles` 启动。

1. 基地 `2735.95, -2465.98` 的拾取物 **19134**：军人取箱 **2358**，扣军队仓库 **100 发**。
2. Barracks **433** 旁使用 `/putammo`，最多 **5** 箱，标签“已装箱数：N”；`/takeammo` 取回手中。
3. 卸货点，**10 米**内显示检查点：FBI `607.31, -1520.50`、地区警察 `618.85, -586.44`、LSPD `1593.86, -1614.30`。
4. 检查点交货：给接收方 `addWarehouseAmmo`，奖励 **$75**，更新武器库标签。
5. 持箱死亡 / 上车时，退回货车或军队仓库。载货 Barracks 重生时，弹药退回军队仓库。

## 后续功能修改位置

| 内容 | 文件 |
|---|---|
| 搬运工班次逻辑 | `loader/index.ts` |
| 搬运工坐标 | `loader/points.ts` |
| GPS 仓库和编号 | `gps/index.ts` |
| /mn 编号 | `commands/mn.ts` |
| 仓库安全区 | `zones/safe.ts` → `SAFE_ZONES` |
| /spawn | `admin/spawn.ts`、`spawn/resolve.ts` |
| /findidhouse /findidbiz | `commands/find-id.ts` |
| /goto /gethere | `admin/goto.ts` |
| /arang | `admin/arang.ts`、`auth/repository.ts` → `saveAdminLevel` |
| 仓库表 / 种子数据 | `warehouse/repository.ts`、`sql/schema.sql` |
| 仓库矿场金属 | `warehouse` → `addMineMetal`、`miner/index.ts` → `deliver` |
| 仓库医院药品 | `warehouse` → `addWarehouseMeds` |
| 医院药品仓库标签 | `org/hospital-stock.ts` |
| 医院档案室（ALT） | `org/hospital-archive.ts` |
| 医生医疗包 /medhelp | `org/hospital-medkit.ts`、`commands/medhelp.ts` |
| 医院药品运输 | `vehicles/hospital.ts` |
| 仓库扣除药品 | `warehouse/repository.ts` → `takeWarehouseMeds` |
| 帮派 / 黑手党仓库位置 | `warehouse/gang-stock.ts`、`warehouse/mafia-stock.ts` |
| 帮派 / 黑手党仓库存取 / 锁 | `warehouse/stock-interact.ts` |
| 武器店门 | `org/ammunation-doors.ts` |
| 地区警察门 / 工作人员出口 | `org/police-doors.ts` |
| LSPD 武器店武器库 | `org/lspd-locker.ts` |
| 地区警察武器库 | `org/police-locker.ts` |
| FBI 武器库 | `org/fbi-locker.ts` |
| FBI 门 / 屋顶 | `org/fbi-doors.ts` |
| 军队工厂，interior 2、VW 1 | `org/army-factory-doors.ts`、`army-factory/points.ts` → `ARMY_FACTORY_WORLD` |
| 军队弹药工厂 | `army-factory/index.ts`、`army-factory/points.ts` |
| 工厂弹药入库 | `warehouse` → `addWarehouseAmmo` |
| 军队武器库 | `org/army-locker.ts` |
| 贫民区贩子 Smoky | `ghetto/index.ts` |
| 通缉星数 / 数据库 / 自动下降 | `auth/wanted.ts`、`auth/session.ts` → `applyWantedLevel` |
| 杀人通缉 / 制服罪犯 | `zones/murder.ts`、`org/law.ts`、`capture.ts` → `isCaptureParticipantOnTurf` |
| 通缉 /su | `commands/su.ts` |
| 通缉 /clear | `commands/clear.ts` → `clearWantedByOfficer` |
| 通缉 /wanted /pursuit | `commands/wanted.ts` |
| 手铐 | `cuff/index.ts`、`commands/cuff.ts` |
| /putpl | `commands/putpl.ts` |
| /arrest | `commands/arrest.ts` |
| /demote，FBI 8+ | `commands/demote.ts` |
| /id | `commands/id.ts` |
| 聊天表情 | `chat/emotions.ts`、`chat/index.ts` |
| Vitest 单元测试 | `resources/tests/*.test.ts`，在 `resources/` 执行 `npm test` |
| 平民工作模块 | `jobs/*`、`src/index.ts` → `jobsModule` |
| 就业中心 | `jobs/hire.ts`、`jobs/catalog.ts` |
| 公交车辆 / 路线 / 班次 | `jobs/bus/vehicles.ts`、`route.ts`、`shift.ts`、`active.ts` |
| job_id 数据库 / 会话 | `auth/repository.ts` → `saveUserJob`、`Account.jobId` |
| 帮派领地发薪补贴 | `payday/index.ts`、`org/gangs.ts` → `GANG_TURF_PAY_BONUS`、`zones/turf.ts` |
| 上铐后断线逃跑 | `cuff` → `applyCuffDisconnectJail`、`persist/index.ts` |
| /eject | `commands/eject.ts` |
| 监狱门 / 律师 | `prison/index.ts`（`MERIYA_ADVOKAT_RANK`） |
| 监狱 /pult | `prison/control.ts`，仅执法 |
| /pay | `commands/pay.ts`、`auth/repository.ts` → `transferUserCash` |
| /members | `commands/members.ts` |
| /leaders 对话框 | `commands/leaders.ts` |
| FBI 自定义总部 | `org/fbi.ts`、`org/fbi-doors.ts`、`maps/fbi.txt` |
| 黑手党自定义总部 | `org/mafias.ts`、`org/mafia-doors.ts`、`maps/mafia.txt`、`warehouse/mafia-stock.ts` |
| 争夺战击杀豁免 | `zones/capture.ts` → `isCaptureCombatKill` |
| 帮派 /makegun | `commands/makegun.ts` |
| 军人证 | `commands/vbilet.ts` |
| 医疗卡 | `commands/medcard.ts` |
| 护照 / 许可证展示 | `commands/pass.ts`、`commands/lic.ts` |
| Y/N 共用槽位 | `shared/yn-offer.ts` |
| Y/N 证件展示 | `shared/doc-show-offer.ts` |
| /invite Y/N | `commands/org-staff.ts` |
| /selllic Y/N | `commands/selllic.ts` |
| 家族模块 | `family/*`、`src/index.ts` → `familyModule` |
| 家族数据库结构 | `sql/schema.sql` → `families`、`users.family_*` |
| 家族 VW | `family/world.ts`、`houses/world.ts`、`businesses/world.ts` |
| 家族房屋地图 | `maps/family_home.txt`、`mapping` |
| /mn 命令列表 | `commands/help.ts`、`commands/mn.ts` |
| 管理员 /stats [id] | `admin/stats.ts`、`commands/stats.ts` |
| 军队弹药箱，帮派突袭 | `ghetto/army-crates.ts` |
| 帮派军服伪装，Smoky | `org/army-disguise.ts`、`ghetto/index.ts` |
| 军队 Barracks 弹药运输 | `vehicles/army-ammo-delivery.ts` |
| 管理员仓库 | `admin/warehouse.ts` |
| 管理员家族 /afamily | `admin/afamily.ts` |
| /ahelp 列表 | `admin/catalog.ts` |
| 启动顺序 | `src/index.ts` |
| 商铺结构 / 缓存 / 数据库 | `businesses/repository.ts`、`sql/businesses_seed.sql` |
| 银行商铺税费 / 利润 | `businesses/bank-tax.ts`、`bank/tellers.ts` |
| 商铺欠税收回 | `businesses/tax.ts`、`repository.ts` → `forfeitExpiredBusinesses` |
| 海滩 / Jefferson 租车 | `vehicles/rental.ts` |
| 燃油 / 消耗 / 油箱 | `vehicles/fuel.ts`、`player-vehicles.ts` → `updatePlayerVehicleFuel` |
| 加油站 H 加油 | `businesses/gas.ts` |
| 速度表 Fuel | `hud/speedo.ts` |
| 汽车店 / 摩托市场 | `vehicles/dealership.ts`、`vehicles/player-vehicles.ts` |
| 私人车 /lock /car /trunk / 出售 | `vehicles/personal.ts`、`commands.ts`、`trunk.ts`、`sell.ts` |
| 商铺 /biz /buybiz | `businesses/menu.ts`、`businesses/purchase.ts` |
| 商铺入口 / 出口 / 标记 | `businesses/enter.ts`、`exits.ts`、`markers.ts` |
| 武器店商品 | `businesses/ammu.ts` |
| 24/7 商品 | `businesses/shop-247.ts` |
| 服装店 | `businesses/clothes.ts`、`clothes-catalog.ts`、`auth/skin-picker.ts` |
| 修车厂 | `businesses/workshop.ts`、`maps/workshop.txt`、种子数据 `#36–38` |
| 商铺室内会话 | `businesses/session.ts` |
| 面具 /mask | `mask/index.ts`、`commands/mask.ts` |
| 动画 /anim | `anim/catalog.ts`、`anim/index.ts`、`commands/anim.ts` |
| 街头食物 / 饥饿 | `businesses/street-food.ts`、`persist/index.ts` |
| 快餐店食物菜单 | `businesses/fastfood.ts` |
| 电话 /ad | `commands/ads.ts`、`repository` → `payBusinessPhonePurchase` |
| 分类命令列表 | `commands/help.ts` → `showHelpMenu` |
| 商铺图标 / 类型 | `businesses/map-icons.ts`、`businesses/types.ts` |
| 管理员 /tpbiz | `admin/tpbiz.ts` |
| GPS 分类与最近地点 | `gps/index.ts` |
