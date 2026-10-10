# LSRP - 版本 2

本文介绍基础文档 [docs.md](docs.zh-CN.md) **之后**新增的内容.基础系统(登录,医院,市政厅,矿场,军队组织,使用 `/alogin` 的 1-7 级管理员系统)见基础文档.这里记录 v2 的变化.

玩家可见文字为**俄语(UTF-8)**.

---

## 目录

1. [新增模块与启动顺序](#新增模块与启动顺序)
2. [数据库](#数据库)
3. [出生点与世界](#出生点与世界)
4. [车辆](#车辆)
5. [速度表](#速度表)
6. [银行](#银行)
7. [发薪与守法度](#发薪与守法度)
8. [安全区](#安全区)
9. [监狱](#监狱)
10. [举报与管理员回复](#举报与管理员回复)
11. [聊天禁言](#聊天禁言)
12. [v2 管理员系统](#v2-管理员系统)
13. [军队车辆](#军队车辆)
14. [医院组织](#医院组织)
15. [帮派](#帮派)
16. [黑手党](#黑手党)
17. [帮派区域与争夺战](#帮派区域与争夺战)
18. [聊天与注册](#聊天与注册)
19. [玩家命令](#玩家命令)
20. [对话框](#对话框)
21. [音效](#音效)
22. [修改位置索引](#修改位置索引)

---

## 新增模块与启动顺序

新增 `vehicles`,`bank`,`prison`.安全区位于 `zones`,速度表位于 `hud/speedo.ts`.

`src/index.ts` 中的顺序(很重要):

1. `database`,`persist`,`auth`,`spawn`,`mapping`
2. `hospital`,`cityhall`,`bank`,`miner`,`gps`,`prison`,`afk`,`payday`,`worldtime`,`zones`
3. `hud`,`session`,`chat`,`commands`
4. `admin`,`org`,`autoschool`
5. **最后加载 `vehicles`**:车辆应在组织和大门之后创建.

```text
resources/src/modules/
  vehicles/     生成,引擎,车灯,限速,军队 / 医院 / 帮派
  bank/         室内场景,柜台,转账
  prison/       图标和监狱工作人员入口
  hud/speedo.ts 驾驶员 HUD
  zones/        禁入区,安全区,帮派区域,争夺战
  org/          军队,医院,帮派 9-13
```

v2 GPS 新增:**LS 火车站,监狱,银行,地区警察,LSPD,FBI,驾校,LCN,Yakuza,俄罗斯黑手党,Grove Street,Ballas,Vagos,Rifa,Aztecas**.

`/mn` 的 **Svyaz' s administraciey**(联系管理员)选项打开举报对话框.

---

## 数据库

结构参考为 `sql/schema.sql`,迁移在 `auth/repository.ts`.新增字段:

| 字段 | 含义 |
|---|---|
| `bank` | INT,银行余额,默认 0 |
| `lawfulness` | SMALLINT,−100...100,新角色为 **100** |
| `muted_until` | INT UNSIGNED NULL,Unix 时间戳,单位为**秒**;NULL 表示未禁言 |
| `jail_seconds` | INT UNSIGNED,剩余刑期;0 表示未入狱;**只在线上**倒计时 |
| `license_car` `license_moto` `license_fly` `license_boat` `license_gun` | TINYINT,0 表示没有许可证 |
| `banned_until` | DATETIME NULL,封禁**结束**日期时间;NULL 表示未封禁;手动填写如 `2026-09-27 18:00:00`,不是"7 天" |
| `ban_reason` | VARCHAR(128) NULL,封禁原因 |

内存字段:`Account.bank`,`Account.lawfulness`,`Account.mutedUntil`(毫秒),`Account.jailSeconds`,`Account.licenses`.

**`gang_zones`** 表保存帮派地图格子.种子数据也在 `schema.sql`(104 行),提供坐标和初始所有者.**再次导入种子数据不会覆盖 `org_id`**,从而保留争夺战结果.

| 字段 | 含义 |
|---|---|
| `id` | 格子 ID,0-103 |
| `min_x` `min_y` `max_x` `max_y` | 矩形边界 |
| `org_id` | 当前所有者(帮派 9-13) |

---

## 出生点与世界

平民出生点在 LS 火车站:`1760.25, -1898.83, 13.56`(`spawn/point.ts`).

车站的心形拾取物恢复至 100 HP.

虚拟世界:街道 `0`,医院 `1`,银行 `2`,监狱 `3`,监狱院子 `4`.

---

## 车辆

模块为 `vehicles`.只能通过 `createServerVehicle` 创建;初始关闭引擎和车灯,位于街道世界.

### 火车站的踏板车

11 辆 **Faggio(462)**,颜色 **191**,角度 −90,重生时间 100 秒.X 坐标 `1775.908`,Y 从 `-1933.96` 到 `-1917.94`.无需驾照.

无相应许可证不能驾驶:汽车要求 `license_car`,摩托车要求 `license_moto`(Faggio / Pizzaboy 和自行车除外),直升机 / 飞机要求 `license_fly`.乘客不需要许可证.驾校考试期间,学员可以驾驶 Premier / Wayfarer.文件:`vehicles/drive-license.ts`.

### 引擎

`Vehicle.useManualEngineAndLights()` 禁用自动启动.

驾驶时按 **左 Ctrl**(`KEY_ACTION = 1`)启停引擎.提示分别为"引擎已启动"和"引擎已关闭"(原文使用俄语转写).启动会开灯,熄火会关灯.车辆重生后再次熄火,关灯.

### 车灯

驾驶时按 **鼠标左键**(`KEY_FIRE = 4`)开关灯,不受引擎状态限制.音效 **4604** 只播放给驾驶员.亮灯时,速度表上的 **L** 为绿色.重生会关灯.

Hunter 上鼠标左键同时触发开火和切换车灯,与 Pawn 示例相同.

### 限速器 `/limit`

限速属于**车辆**,不属于玩家.下一位驾驶员也受限,且能在 HUD 上看到.

| 命令 | 效果 |
|---|---|
| `/limit` | 查看当前限速或提示 |
| `/limit [10-200]` | 设置此车的公里/小时上限 |
| `/limit 0` | 取消限速 |

需要坐在驾驶位.每 100 毫秒限制 XY 速度;定时器**只对设置了限速的车辆**运行.

**爆炸**(`vehicleDeath`)和**重生**(`vehicleSpawn`,包括 `/respcar`)时重置.`/respcar` 不会重生有人乘坐的车,因此其限速保留.

---

## 速度表

只向**驾驶员**显示.背景位于右下角,与 Pawn HUD 类似.

| 行 | 动态 / 静态 |
|---|---|
| 速度(公里/小时) | 动态 |
| `Fuel N` | 动态油量 0-100(燃油系统见 v3 文档) |
| 车身 HP | 动态 |
| 状态 | Open / max / E / S / M / L / B |

字母含义:

| 标记 | 含义 | 此版本状态 |
|---|---|---|
| Open / Lock | 车门 | 始终为 Open |
| max | 限速器 | 关闭为白色;启用 `/limit` 后以红色显示**公里/小时数值** |
| E | 低油量 | 静态白色 |
| S | 警报器 | 静态白色 |
| M | 引擎 | 绿色 / 白色 |
| L | 车灯 | 绿色 / 白色 |
| B | 引擎盖或后备箱 | 静态白色 |

---

## 银行

独立室内场景,VW 为 **2**.柜台拾取物打开对话框:

- 余额.
- 存款 / 取款(现金 ↔ 银行).
- 按玩家 ID 转账(P2P).

金钱上限为 `2147483647`.柜台忙碌时,第二笔操作等待.发薪和向银行执行 `/givemoney` 也会考虑柜台占用状态.

GPS 名称为 **Bank**.`/stats` 显示银行余额.

---

## 发薪与守法度

每小时 `:00`,已登录且非 AFK 的玩家:

1. 获得 1 经验,最高升至 100 级,达到升级阈值后扣除对应经验.
2. 组织工资发至**银行账户**,不是现金.提示"工资......已存入银行账户";账户已满则不发放.
3. 守法度低于 100 时增加 1.
4. 音效 **6400** 仅播放给收到发薪的玩家.

`lawfulness` 范围为 −100...100,初始为 100.`/stats` 和护照中的项目为守法度.

---

## 安全区

不可见,不绘制 GangZone 或文字.步行时不能造成伤害,HP / 护甲会回滚.

区域包括火车站,市政厅,医院,矿场和驾校.仅作用于街道 VW,interior 0.

---

## 监狱

地图图标(槽位 4,类型 30)在约 300 米内显示:`1810.86, -1576.44, 13.52`.GPS:**监狱**.

工作人员入口(拾取物 **19132**,仅 LSPD / 地区警察 / FBI):街道 `1797.87, -1578.79, 14.09` ↔ 室内 VW **3** `-95.76, 2446.23, 1179.32`.出口:`-95.70, 2448.59, 1179.32` → 街道 `1800.35, -1578.62, 14.07`.`maps/jail.txt` 的室内物体放在该 VW,室外警局地图仍放在街道.

内部通道(任何人,同一 VW **3**):大厅 `-101.09, 2440.26` ↔ 牢房 `-92.98, 2437.12`;牢房 `-92.95, 2430.61` ↔ 健身房 `-101.42, 2425.09`;值班室 `-103.09, 2447.47` ↔ 厨房 `-104.36, 2431.46`.院子(任何人,VW **4**):室内 `-58.45, 2435.01` ↔ 院子 `1770.91, -1546.76`.

警卫室(仅 LSPD / 地区警察 / FBI):值班室 `-90.12, 2444.77` ↔ 警卫室 `-107.13, 2436.37`(楼层高度 `1186.34`).武器库也在此处(拾取物 **19134**,对话框 **25**),仅提供护甲和警棍.文件:`prison/prison-locker.ts`.

监狱旁车辆为 FBI Truck 528,Enforcer 427,Ranger 599,位于街道,重生时间 1800 秒.只有 **LSPD,地区警察和 FBI** 可以乘坐.外人看到车门锁定.文件:`vehicles/prison.ts`.

控制台 `/pult`(提示文字位于 `-96.09, 2434.69`,仅上述组织且需靠近提示):开关院子;牢房控制暂为占位功能.院子关闭时不能从室内进入.对话框 **26-27**.文件:`prison/control.ts`.

`/jail [id] [minuty] [prichina]`(分钟,原因)要求管理员 **3+**,刑期 1-10080 分钟.不能关押 `adminLevel >= 1` 的管理员,也不能重复关押已入狱玩家.刑期存入 `jail_seconds`.随机牢房有 20 个位置,VW **3**.囚犯皮肤:男性 **42**,女性 **69**.死亡,被杀和重连不会重置刑期:返回牢房,跳过医院.刑期大于 0 时,可以到大厅 / 牢房,健身房,厨房和开放的院子;不能去街道,警卫室或使用 `/pult`.刑满后到街道 `1806.36, -1574.08, 13.45`.`/unjail [id]` 释放到组织或默认出生点;目标离线或未入狱则拒绝.文件:`prison/sentence.ts`,`admin/jail.ts`.

---

## 举报与管理员回复

### `/report` 和 `/mn` 菜单项

对话框 **20**.按 `account.id` 设置 **30 秒**冷却,重连不会重置.空白提交不消耗冷却.聊天禁言**不会**阻止举报.

发送者看到:`Name_Surname[id]: text`.  
已 `/alogin` 的管理员看到:`玩家 Name_Surname[id] 发来消息:text`(原文按角色性别使用不同词形).  
这**不是** `/a` 聊天,颜色为 `Color.info`.

### `/ans`(管理员 1+)

`/ans [id] [tekst]`(回复内容).

向玩家和所有已 `/alogin` 的管理员发送一行:

`[A] Administrator Name[id] 回复玩家 Name[id]:text`

使用管理员聊天颜色,音效 **1085** 只播放给目标.如果目标也是管理员,不重复发送.

---

## 聊天禁言

`/mute [id] [minuty] [prichina]` 要求管理员 **2** 级,时长 1-10080 分钟.不能禁言 `adminLevel >= 1` 的管理员.记录到 `muted_until`.

阻止普通聊天及 `/me /do /try /todo /b /s /w /r /d /gov /f`,**不阻止** `/report`.

到期提示"你可以再次使用聊天了".通过定时器及出生时检查.

---

## v2 管理员系统

点击地图传送和 `/ahelp` 与 v1 相同.新增:

| 等级 | 命令 | 行为 |
|---|---|---|
| 1 | `/ans [id] [tekst]` | 回复举报,见上文 |
| 1 | `/slap [id]` | 向上抛起,车内目标会被踢下车;可对自己和管理员使用;灰色日志只发给管理员 |
| 2 | `/mute [id] [min] [prichina]` | 聊天禁言 |
| 3 | `/veh` `/delveh` | 创建 / 删除管理员车辆 |
| 3 | `/spawn [id]` | 使自己或目标出生:监狱 / 医院 / 组织 / 默认点 |
| 3 | `/jail [id] [min] [prichina]` | 关押,见上文 |
| 3 | `/unjail [id]` | 释放到组织 / 默认出生点 |
| 3 | `/tpcor [x] [y] [z]` | 传送,不重置 VW / interior;驾驶时连车传送 |
| 4 | `/respcar` | 30 秒后重生**无人乘坐**的车辆;管理员退出后定时器仍继续 |
| 4 | `/setskin [id] [1-311]` | 平民皮肤写入数据库;属于组织期间仍使用组织皮肤 |
| 4 | `/ban [id] [dni] [prichina]` | 1-3650 天;踢出并向目标显示对话框;全服公告;`banned_until` 前禁止登录 |
| 4 | `/unban [Nick_Name]` | 离线解封;灰色日志只发给管理员 |
| 4 | `/tpint [id]` | 按列表编号传送到室内;不带 ID 时显示分页对话框 |
| 5 | `/makeleader [id]` | 组织列表或撤职;需护照;职级 10 |
| 5 | `/gzcolor [id]` | 设置脚下帮派区域的所有者;仅帮派 9-13;该格正在争夺时禁止 |
| 6 | `/givemoney [id] [0-1] [summa]` | 0 为现金,1 为银行;可以给自己 |
| 6 | `/setlevel [id] [1-100]` | 设置等级,经验归零 |

`/kick` 不变(2 级).`/makeadmin` / `/makeleader` 与 v1 相同;撤销组织成员身份会将目标踢出组织车辆.

---

## 军队车辆

基地旁共 25 辆,重生时间 100 秒.**只有**军队成员(`org_id = 1`)可以乘坐.外人看到车门锁定,并提示"你不属于军队".乘坐期间被撤销成员身份会被踢下车.

模型 **431,445,500** 的两个颜色槽均为 **173**.其余为 `-1`(随机).

| 模型 | 车辆 |
|---|---|
| 425 | Hunter |
| 470 | Patriot ×10 |
| 500 | Mesa ×3,颜色 173 |
| 431 | Bus,颜色 173 |
| 433 | Barracks ×4 |
| 445 | Admiral ×2,颜色 173 |
| 430 | Predator ×3 |
| 548 | Leviathan |

坐标:`vehicles/army.ts`.

---

## 医院组织

`org_id = 2`,`gov: true`,颜色 `0xff7a8aff`.在医院室内出生,共 10 个职级.

入口旁车辆(Ambulance 416,Maverick 487,FBI Rancher 490)仅医院成员可用.坐标:`vehicles/hospital.ts`.

屋顶 ↔ 停车场:`org/hospital-roof.ts`.

---

## 市政厅

`org_id = 3`,`gov: true`.颜色 `0xffff00ff`(昵称和聊天).在市政厅 interior **3** 的 `357.3111, 162.1018, 1025.7964` 出生.10 个职级,目录:`org/meriya.ts`.

`/r`,`/d`,`/gov`(10 级)及 **9-10** 级人事权限,与军队和医院相同.

建筑旁车辆(Washington 421 ×4,Landstalker 400 ×4,Stretch 409,Maverick 487)使用白色 **1**,仅市政厅成员可用.坐标:`vehicles/meriya.ts`.

室内仓库(拾取物 **19134**,`357.6911, 150.9142, 1025.7891`):100 护甲,警棍 3,Desert Eagle 24(50 发).仅市政厅成员可用.文件:`org/meriya-locker.ts`.

工作人员入口(拾取物 **19132**):停车场 `1413.03, -1790.49, 15.44` ↔ 室内 `368.42, 194.10, 1008.38`.屋顶:室内 `350.13, 178.06, 1014.19` ↔ 屋顶 `1445.25, -1803.03, 33.43`.仅市政厅成员可用.文件:`org/meriya-doors.ts`.

---

## 政府组织 4-8

均为 `gov: true`,`illegal: false`.支持 `/r`,`/d`,`/gov`(10 级),**9-10** 级有人事权限.除地区警察(interior **6**),LSPD(interior **10**)和 FBI(interior **3**)外,均在街道出生.共用辅助函数:`org/define.ts`.

| ID | 名称 | 颜色 | 文件 |
|---|---|---|---|
| 4 | 地区警察 | `0x2641feff` | `org/police.ts` |
| 5 | LSPD | `0x2641feff` | `org/lspd.ts` |
| 6 | FBI | `0x000080ff` | `org/fbi.ts` |
| 7 | 驾校 | `0xfff3b0ff` | `org/autoschool.ts` |
| 8 | 广播中心 | `0xff8c00ff` | `org/radio.ts` |

广播中心室内:`maps/radio.txt`,VW **8**,interior **0**(空中的自定义地图).员工出生点:`1429.54, 1071.88, 1058.79`.

入口使用拾取物 **19132**.街道 `1786.60, -1300.62, 13.56` 打开对话框 **36**:**Ofis**(办公室,任何人)/ **Krysha**(屋顶,仅 `org_id = 8`).室内 `1433.64, 1056.58, 1058.78`:**Ulica**(街道,任何人)/ **Krysha**(屋顶,员工).屋顶 `1831.16, -1301.14, 131.73`:**Ulica** / **Ofis**(任何人都可下楼).传送目标:办公室 `1431.72, 1056.67, 1058.78`,街道 `1786.61, -1297.97, 13.38`,屋顶 `1829.10, -1301.09, 131.73`.文件:`org/radio-doors.ts`.

相机(拾取物 **367**,`1411.84, 1062.79, 1058.91`,VW **8**):仅员工可取,武器 **43**.文件:`org/radio-locker.ts`.

广播中心车辆(屋顶的 News Chopper 488,总部旁 Newsvan 582 ×4)使用颜色 **1/152**,仅 `org_id = 8` 可用,外人看到车门锁定.文件:`vehicles/radio.ts`.

`/ad`:任何人可用,对话框 **37**,收费现金 **$500**,禁言时不能使用,队列中只能有一条自己的广告.员工提示:"收到 Name[id] 的新广告,请输入 /edit."`/edit`(对话框 **38-39**)仅能在办公桌 `1424.46, 1056.62` 附近(半径 5 米,VW **8**)或广播中心车辆内使用.接受后至少 3 分钟才播出,两条广告间隔 3 分钟.拒绝原因发送给玩家和所有员工.播出格式:`LS | 文字. | 由 Name[id] 发送`,绿色,第二行颜色较深.文件:`commands/ads.ts`.

广播中心道闸(模型 **968**,`ry` 90→0)位于 `1739.45, -1309.92, 13.50`.按蹲下键操作,仅 `org_id = 8`.立柱 966 已在 `maps/radio.txt`.文件:`org/radio.ts` + `org/gates.ts`.

驾校入口(拾取物 **19132**,任何人):街道 `739.04, -1418.46, 13.52` → interior **3** `-2028.73, -105.08, 1035.17`.出口:`-2026.92, -103.71, 1035.17` → 街道 `739.00, -1415.03, 13.52`.停车场:`739.07, -1428.91, 13.90` ↔ `-2029.75, -117.98, 1035.17`.GPS:**驾校** `738.83, -1412.74, 13.53`.图标(槽位 10,类型 **55**)在约 300 米内显示:`741.35, -1417.58, 14.20`.员工出生点:interior **3** `-2024.38, -114.57, 1035.17`.文件:`org/autoschool-doors.ts`,`org/autoschool-map.ts`.

`/selllic [id]`:驾校任何职级可用,需步行站在柜台 `-2031.86, -116.98, 1035.17` 附近(interior **3**,半径 8 米).买方需在 10 米内,相同 VW / interior.列表仅显示买方缺少的许可证.现金价格范围:汽车 $5000-50000,摩托 $3000-30000,飞行 $20000-150000,水上 $10000-80000,枪械 $15000-100000.买方看到"员工 Name_Surname 向你出售......许可证,价格 $N",可选择**同意 / 拒绝**.有效期 60 秒.文件:`commands/selllic.ts`.

汽车 / 摩托考试:interior **3** `-2026.75, -114.34, 1035.17` 的红色检查点.选择车辆 → 简短交规 → 现金 **$500** 参加 5 题测试,全部正确才通过,否则显示 `N/5`.理论通过后有 10 分钟,去停车场驾驶**驾校的** Premier(426)或 Wayfarer(586).路线包含 29 个带箭头的竞速检查点;终点下车,车辆重生,许可证写入数据库.文件:`modules/autoschool/`.

地区警察和 LSPD(4,5)的职级共用 `org/police-ranks.ts`.

地区警察在 Dillimore 警局的车辆:Police LS 596 ×7,Ranger 599 ×2,Cheetah 415,Maverick 497,HPV1000 523 ×5,使用生成时的颜色,仅 `org_id = 4` 可乘坐,LSPD 不可用.文件:`vehicles/police.ts`.

LSPD 在 LS 警局的车辆:596 ×11,SWAT 601 ×2,Ranger 599 ×3,Enforcer 427 ×2,Cheetah 415 ×2,HPV1000 523 ×6,Maverick 497,使用相同颜色,仅 `org_id = 5`,地区警察不可用.文件:`vehicles/lspd.ts`.

FBI 车辆:FBI Rancher 490 ×7,Cheetah 415 ×2,Sultan 560 ×2,Maverick 487,颜色 0/0,仅 `org_id = 6`.文件:`vehicles/fbi.ts`.

驾校建筑旁车辆:Premier 426 ×5,Wayfarer 586 ×5,颜色 **124**,仅 `org_id = 7`;通过理论考试的学员也可使用对应类型.外人看到车门锁定.文件:`vehicles/autoschool.ts`.

FBI 图标(槽位 9,类型 30)在约 300 米内显示:`606.91, -1462.48, 14.44`.GPS:**FBI** `617.45, -1458.59, 14.43`.文件:`org/fbi-map.ts`.

FBI 入口(拾取物 **19132**,仅 `org_id = 6`):`607.14, -1458.50, 14.38` ↔ interior **3** `238.68, 140.52, 1003.02`.出口:`238.59, 139.00, 1003.02` → 街道 `610.28, -1458.62, 14.38`.文件:`org/fbi-doors.ts`.

FBI 员工室内出生点:`268.09, 188.48, 1008.17`.

FBI 武器库(拾取物 **19134**,对话框 **24**,仅 `org_id = 6`):与警察相同,额外提供 Sniper Rifle **34**,SWAT **285** 为临时皮肤.文件:`org/fbi-locker.ts`.

LSPD 旁有道闸(模型 968,通过 `ry` 90→0 抬起)和大门(19912,像医院大门一样向下移动).按蹲下键操作,**LSPD,地区警察,FBI** 可开启.文件:`org/lspd.ts` + `org/gates.ts`.

地区警察地图图标(槽位 7,类型 30)在约 300 米内显示:`632.74, -566.99, 16.34`.GPS:**地区警察** `635.69, -571.67, 16.34`.

LSPD 图标(槽位 8,类型 30)在约 300 米内显示:`1552.90, -1673.35, 16.20`.GPS:**LSPD** `1543.19, -1675.81, 13.56`.文件:`org/lspd-map.ts`.

街道入口(拾取物 **19132**,任何人):`1555.19, -1675.58, 16.20` ↔ interior **10** `246.07, 108.97, 1003.22`.出口:`246.39, 107.46, 1003.22` → 街道 `1552.69, -1675.57, 16.20`.文件:`org/lspd-doors.ts`.

LSPD 员工室内出生点:`274.08, 125.26, 1004.62`.

工作人员车库(LSPD / 地区警察 / FBI):室内 `214.20, 120.77, 999.02` ↔ 停车场 `1524.75, -1677.83, 5.89`.

LSPD 武器库(拾取物 **19134**,对话框 **23**,仅 `org_id = 5`):位于武器店(interior **6**,VW **5**)`312.41, -165.58`;标签"弹药:N"取自 `warehouses`;武器配置不变,额外提供 SWAT **285**.文件:`org/lspd-locker.ts`.

地区警察街道入口(拾取物 **19132**,任何人):`626.97, -571.77, 17.92` ↔ interior **6** `246.76, 62.45, 1003.64`.街道出口:`631.64, -571.75, 16.34`.

工作人员停车场(LSPD / 地区警察 / FBI):街道 `611.07, -583.50, 18.21` ↔ 室内 `242.48, 66.38, 1003.64`.

屋顶(LSPD / 地区警察 / FBI):`621.26, -569.20, 26.14` ↔ 室内 `246.40, 88.01, 1003.64`.文件:`org/police-doors.ts`.

室内武器库(拾取物 **19134**,对话框 **22**,仅 `org_id = 4`):护甲,警棍,Deagle,Shotgun,MP5,M4,临时 SWAT **285** 皮肤(死亡 / 重登后重置).文件:`org/police-locker.ts`.

---

## 帮派

五个非法组织.昵称和帮派区域使用组织颜色.`/f` 共用 `Color.radio`.在总部**房屋内**出生.

| ID | 名称 | 颜色 | 总部 |
|---|---|---|---|
| 9 | Grove Street | `0x009900aa` | interior 2 VW 9 `2449.47, -1690.28, 1013.51` |
| 10 | The Ballas | `0xcc00ffaa` | interior 4 VW 10 `224.96, 1158.23, 1082.61` |
| 11 | Los Santos Vagos | `0xffcd00aa` | interior 5 VW 11 `323.83, 1127.13, 1083.88` |
| 12 | The Rifa | `0x6666ffaa` | interior 6 VW 12 `-60.69, 1364.61, 1080.22` |
| 13 | Varios Los Aztecas | `0x00b4e1aa` | interior 2 VW 13 `231.23, 1246.63, 1082.14` |

每个帮派有 10 个职级.目录:`org/gangs.ts`.

总部入口(拾取物 **19132**,任何人)使用各自 VW.文件:`org/gang-doors.ts`.

| 帮派 | 街道 ↔ 房屋 |
|---|---|
| Grove | `2514.07, -1691.37` ↔ int 2 VW 9 `2468.77, -1698.32` |
| Ballas | `2022.87, -1120.26` ↔ int 4 VW 10 `221.87, 1140.55` |
| Vagos | `2756.28, -1182.81` ↔ int 5 VW 11 `318.62, 1114.64` |
| Rifa | `2787.07, -1926.13` ↔ int 6 VW 12 `-68.84, 1351.37` |
| Aztecas | `2185.82, -1815.23` ↔ int 2 VW 13 `226.46, 1240.00` |

### 人事管理

**9-10** 级可用 `/invite [id]`,`/uninvite [id]`,`/rang [id] [+/-]`(目标职级 1-9).邀请使用对话框 **21**,有效期 60 秒,要求护照.不能邀请自己.接受时必须在 **10 米**内,且 interior,VW 相同.

### 无线电

| 命令 | 使用者 |
|---|---|
| `/r` | `illegal: false` 且不是 `mafia` 的组织;帮派和黑手党不响应 |
| `/f` | `illegal`(帮派)或 `mafia`;平民 / 政府不响应 |
| `/d` | `gov: true`,政府共同部门频道 |
| `/gov` | `gov` 且职级 **10**,向所有人发布新闻 |

### 帮派车辆

仅本帮派成员可用,重生时间 100 秒.文件:`vehicles/gangs.ts`.

| 帮派 | 车辆配置 |
|---|---|
| Grove | Greenwood 492 ×5,颜色 86 |
| Ballas | Virgo 491 ×7,颜色 147 |
| Aztecas | Remington 534 ×5 + Blade 536 ×2,颜色 165 |
| Vagos | Oceanic 467 ×1(6/1)+ Hermes 474 ×4(6/6) |
| Rifa | Stallion 439 ×4 + Tahoma 566 ×4,颜色 198 |

---

## 黑手党

三个家族,不属于政府(`gov: false`)或帮派(`illegal: false`,`mafia: true`).昵称为家族颜色,`/f` 共用 `Color.radio`.没有区域争夺战,`/r`,`/d`,`/gov` 不响应.**9-10** 级的人事命令相同:`/invite`,`/uninvite`,`/rang`.目录:`org/mafias.ts`.

| ID | 名称 | 颜色 | 总部 |
|---|---|---|---|
| 14 | La Cosa Nostra | `0xff8000ff` | interior 5 VW 14 `1291.59, -833.19, 1085.63` |
| 15 | Yakuza | `0xcc0000ff` | interior 5 VW 15 `1291.59, -833.19, 1085.63` |
| 16 | Russkaya mafiya(俄罗斯黑手党) | `0x1a5c6eff` | interior 5 VW 16 `1291.59, -833.19, 1085.63` |

所有职级的女性皮肤:LCN **263**,Yakuza **56**,俄罗斯黑手党 **169**.

LCN 大门(模型 **19912**,向下 `60.60`→`55.01`)位于 `1282.35, -2050.72`,按蹲下键开启,仅 `org_id = 14`.文件:`org/mafias.ts` + `org/gates.ts`.

Yakuza 有三个 19912 大门,按蹲下键向下开启,仅本家族成员可用.文件:`org/mafias.ts` + `org/gates.ts`.

俄罗斯黑手党道闸(模型 **968**,`ry` −90→0)位于 `965.55, -942.07, 40.17`,按蹲下键开启,仅 `org_id = 16`.立柱 966 已在 `maps/rmMap.txt`.文件:`org/mafias.ts` + `org/gates.ts`.

Yakuza 总部车辆:Stretch 409,Maverick 487,Huntley 579 ×2,Sultan 560 ×4,FCR-900 521 ×4,颜色 **6**,仅 `org_id = 15`.外人看到车门锁定.文件:`vehicles/mafias.ts`.

LCN 总部车辆:Maverick 487,Huntley 579 ×4,Sultan 560 ×4,Stretch 409,FCR-900 521 ×5,颜色 **145**,仅 `org_id = 14`.外人看到车门锁定.文件:`vehicles/mafias.ts`.

俄罗斯黑手党总部车辆:FCR-900 521 ×6,Sultan 560 ×4,Maverick 487,Huntley 579 ×5,Stretch 409,颜色 **0**,仅 `org_id = 16`.外人看到车门锁定.文件:`vehicles/mafias.ts`.

GPS:**LCN** `1288.81, -2056.62, 58.63`,**Yakuza** `664.94, -1315.21, 13.45`,**Russkaya mafiya** `962.19, -946.55, 40.29`.

入口(拾取物 **19132**,任何人)通向 interior **5** `1299.02, -793.97, 1084.01`,出口 `1298.89, -796.61, 1084.01`.VW:LCN **14**,Yakuza **15**,俄罗斯黑手党 **16**.文件:`org/mafia-doors.ts`.

- LCN:街道 `1122.71, -2036.99, 69.89` ↔ `1125.11, -2037.00, 69.88`.
- Yakuza:街道 `678.36, -1281.72, 13.63` ↔ `675.76, -1281.69, 13.63`.
- Russkaya mafiya:街道 `952.56, -909.24, 45.77` ↔ `952.60, -912.13, 45.77`.

---

## 帮派区域与争夺战

LS 东部有 104 个格子,按所有者颜色绘制.地图上的黑色禁入区另行管理,不能争夺.

初始所有者来自种子数据.旧转储 ID 1-5 迁移对应:Aztecas 13,Ballas 10,Vagos 11,Grove 9(旧 ID 5 也为 Vagos).Rifa 初始没有格子.

不能争夺**帮派出生点**格子(ID 7,25,67,74,90,以及总部所在格子).

### `/makegun`(帮派)

仅帮派 **9-13**,需步行站在**自己的**帮派区域.`/makegun [1-7] [弹药 1-500]`.以 **1:1** 扣除玩家弹药,并扣金属(`金属 = 弹药 × 系数`).调用 `grantWeapon` 并播放动画.文件:`commands/makegun.ts`.

| ID | 武器 | 每发所需金属 |
|---|---|---|
| 1 | Deagle(24) | 2 |
| 2 | AK-47(30) | 3 |
| 3 | M4(31) | 3 |
| 4 | Shotgun(25) | 4 |
| 5 | SD Pistol(23) | 2 |
| 6 | MP5(29) | 2 |
| 7 | Sniper(34) | 10 |

### `/capture`

要求帮派职级 **8+**,站在**他帮**格子上,街道,interior 0,存活且非尸体 / 旁观状态.

- 全服同时只允许一场争夺战,持续 **420 秒**.
- **防守**帮派至少一名成员在线.
- 得分要求击杀者和受害者都在**该格**,双方为攻击 ↔ 防守.队杀,自杀,第三方帮派,其他格子不计分.车内击杀**计分**.
- 攻方平局或落后则区域不变;攻方分数严格更高时更新数据库 `org_id` 和格子颜色.
- 死亡仍送往医院.
- TextDraw(时间,名称,分数)和 GPS 标记只向双方帮派显示.格子以攻方颜色闪烁.

聊天中的地区名由 `zones/district.ts`(zone.inc)根据格子中心确定.

没有管理员开启 / 关闭争夺战的功能.格子正在争夺时不能使用 `/gzcolor`.

---

## 聊天与注册

普通聊天格式为 `Name_Surname[ID] skazal/skazala: text`("说"的男女词形).昵称为组织颜色,正文白色;平民使用灰色聊天,不带颜色标签.

注册皮肤选择:Pro-Laps 摄像机,TextDraw `<<<`,`SELECT`,`>>>`,按性别提供流浪汉 / 乡下人列表(`auth/skins.ts`).角色面对镜头.箭头音效 **1083**,SELECT 无音效.

---

## 玩家命令

相对 v1 新增:

| 命令 | 功能 |
|---|---|
| `/report` | 联系管理员,也可从 `/mn` 进入 |
| `/limit [kmh]` | 设置当前车辆限速 |
| `/invite` `/uninvite` `/rang` | 组织人事管理,职级 9-10 |
| `/r` `/f` `/d` `/gov` | 无线电,见帮派 / 黑手党章节 |
| `/capture` | 争夺帮派区域,帮派职级 8+ |
| `/time` | 看表;有禁言或刑期时显示剩余时间;标签为"看了看手表" |
| `/lic` | 自己的许可证;`/lic [id]` 向 5 米内玩家展示 |
| `/selllic [id]` | 驾校员工在柜台出售许可证 |
| `/ad` | 现金 $500 发布广告,进入广播中心队列 |
| `/edit` | 广播中心员工在办公室或组织车辆内编辑广告 |

`/stats` 和 `/pass` 增加银行,守法度和组织.`/stats` 对话框风格与 `/pass`,`/lic` 一致.`/lic` 显示汽车,摩托,飞行,水上和枪械许可证,默认均无.

---

## 对话框

不要占用已经使用的 ID.

| ID | 窗口 |
|---|---|
| 1-12 | 与 v1 相同(auth ... makeleader) |
| 13-19 | 银行 |
| 20 | 举报 |
| 21 | 组织邀请 |
| 22 | 地区警察武器库 |
| 23 | LSPD 武器库 |
| 24 | FBI 武器库 |
| 25 | 监狱武器库 |
| 26 | 监狱控制台 `/pult` |
| 27 | 开关监狱院子 |
| 28 | 许可证 `/lic` |
| 29 | `/selllic` 许可证列表 |
| 30 | `/selllic` 价格 |
| 31 | `/selllic` 买方确认 |
| 32 | 考试:汽车 / 摩托 |
| 33 | 考试:交通规则 |
| 34 | 考试:问题 |
| 35 | 考试:测试结果 |
| 36 | 广播中心:办公室 / 街道 / 屋顶 |
| 37 | `/ad` 广告正文 |
| 38 | `/edit` 编辑广告 |
| 39 | `/edit` 拒绝原因 |
| 40 | 封禁通知 |
| 41 | `/tpint` 室内场景列表 |

---

## 音效

`playGameSound` 对应 Pawn 的 `PlayerPlaySound`,只对该玩家播放.

| ID | 时机 |
|---|---|
| 1083 | 皮肤选择箭头 |
| 1085 | 收到 `/ans` 回复 |
| 4604 | 驾驶员切换车灯 |
| 6400 | 玩家收到发薪 |

---

## 修改位置索引

| 任务 | 文件 |
|---|---|
| 踏板车 / 公共车辆生成 | `vehicles/index.ts`,`vehicles/spawn.ts` |
| 车辆驾驶许可证 | `vehicles/drive-license.ts`,`vehicles/access.ts` |
| 军队车辆 | `vehicles/army.ts`,`vehicles/access.ts` |
| 医院组织 / 车辆 | `org/hospital.ts`,`vehicles/hospital.ts` |
| 市政厅 | `org/meriya.ts`,`vehicles/meriya.ts`,`org/meriya-locker.ts`,`org/meriya-doors.ts` |
| 警察 / LSPD / FBI / 驾校 / 广播 | `org/police.ts`,`org/lspd.ts`,`org/fbi.ts`,`org/autoschool.ts`,`org/radio.ts` |
| 广播中心室内 | `maps/radio.txt` |
| 广播中心入口 | `org/radio-doors.ts` |
| 广播中心相机 | `org/radio-locker.ts` |
| 广播中心道闸 | `org/radio.ts`,`org/gates.ts` |
| 驾校入口 | `org/autoschool-doors.ts` |
| 驾校图标 | `org/autoschool-map.ts` |
| 地区警察车辆 | `vehicles/police.ts` |
| LSPD 车辆 | `vehicles/lspd.ts` |
| FBI 车辆 | `vehicles/fbi.ts` |
| 驾校车辆 | `vehicles/autoschool.ts` |
| 广播中心车辆 | `vehicles/radio.ts` |
| 广告 `/ad` `/edit` | `commands/ads.ts` |
| 封禁 `/ban` `/unban` | `admin/ban.ts`,`auth/ban.ts` |
| `/tpint` 室内场景 | `admin/tpint.ts`,`admin/interiors.ts` |
| 监狱旁车辆 | `vehicles/prison.ts` |
| FBI 图标 | `org/fbi-map.ts` |
| FBI 入口 | `org/fbi-doors.ts` |
| FBI 武器库 | `org/fbi-locker.ts` |
| LSPD 道闸 / 大门 | `org/lspd.ts`,`org/gates.ts` |
| 地区警察图标 | `org/police-map.ts` |
| LSPD 图标 | `org/lspd-map.ts` |
| LSPD 入口 | `org/lspd-doors.ts` |
| 地区警察入口 | `org/police-doors.ts` |
| 地区警察武器库 | `org/police-locker.ts` |
| LSPD 武器库 | `org/lspd-locker.ts` |
| 帮派 | `org/gangs.ts`,`vehicles/gangs.ts` |
| 黑手党 | `org/mafias.ts` |
| 黑手党车辆 | `vehicles/mafias.ts` |
| LCN 大门 | `org/mafias.ts`,`org/gates.ts` |
| Yakuza 大门 | `org/mafias.ts`,`org/gates.ts` |
| 俄罗斯黑手党道闸 | `org/mafias.ts`,`org/gates.ts` |
| 黑手党入口 | `org/mafia-doors.ts` |
| 帮派入口 | `org/gang-doors.ts` |
| 邀请 / 职级 | `commands/org-staff.ts` |
| 帮派区域 | `zones/turf.ts`,`zones/repository.ts`,`sql/schema.sql` |
| 争夺战 | `zones/capture.ts`,`zones/capture-hud.ts`,`commands/capture.ts` |
| `/gzcolor` | `admin/gzcolor.ts` + `admin/catalog.ts` |
| SA 地区 | `zones/district.ts` |
| 引擎 / 车灯 | `vehicles/spawn.ts` |
| `/limit` | `vehicles/limit.ts`,`commands/limit.ts` |
| 速度表 | `hud/speedo.ts` |
| 银行 | `modules/bank/` |
| `/time` | `commands/time.ts` |
| `/ans` | `admin/ans.ts` + `admin/catalog.ts` |
| 禁言 | `admin/mute.ts`,`chat/mute.ts` |
| 发薪 / 守法度 | `payday/index.ts`,`auth/session.ts` |
| 安全区 | `zones/safe.ts` |
| 监狱(图标 / 入口) | `prison/index.ts` |
| 刑期 / 牢房 | `prison/sentence.ts` |
| `/jail` `/unjail` | `admin/jail.ts` + `admin/catalog.ts` |
| `/spawn` | `admin/spawn.ts` + `spawn/resolve.ts` |
| 监狱武器库 | `prison/prison-locker.ts` |
| 监狱控制台 `/pult` | `prison/control.ts` |
| 数据库结构 | `sql/schema.sql` + `auth/repository.ts` |
| 许可证 `/lic` | `auth/licenses.ts`,`commands/lic.ts` |
| 许可证出售 `/selllic` | `commands/selllic.ts` |
| 汽车 / 摩托考试 | `modules/autoschool/` |
