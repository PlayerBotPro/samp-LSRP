# LSRP - 文档

**Los Santos Role Play.** 基于 [open.mp](https://open.mp) 的游戏服务器,逻辑通过 **omp-node** 使用 **TypeScript** 编写.客户端:SA-MP 0.3.7 或 open.mp.本地地址:`127.0.0.1:7777`.

快速入门(技术栈,结构,启动)见 [README](../README.zh-CN.md).  
各版本玩法见 [v2 文档](docs_v2.zh-CN.md),[v3 文档](docs_v3.zh-CN.md).  
部署见 [部署文档](deploy.zh-CN.md),流水线见 [deploy.yml](../deploy.yml).

本文介绍架构,注册,模块,数据库,命令和配置.

在原文编写时,`npm run typecheck` 检查通过,无错误.

玩家聊天和对话框文字为**俄语 UTF-8**.0.3.7 客户端所需的编码由 DLL / 组件处理.

---

## 目录

1. [启动机制](#启动机制)
2. [项目目录](#项目目录)
3. [游戏模式源码](#游戏模式源码)
4. [模块顺序](#模块顺序)
5. [模块](#模块)
6. [数据库](#数据库)
7. [事件流程](#事件流程)
8. [玩家命令](#玩家命令)
9. [管理员系统](#管理员系统)
10. [组织](#组织)
11. [open.mp 配置](#openmp-配置)
12. [构建和启动](#构建和启动)
13. [修改位置索引](#修改位置索引)
14. [项目检查](#项目检查)

---

## 启动机制

在根目录执行 `npm start` 会启动 `omp-server.exe`.它读取 `config.json`,加载**两个独立层**:

| 层 | 加载内容 | 作用 |
|---|---|---|
| Pawn | `gamemodes/lsrp.amx`(`pawn.main_scripts`: `lsrp 1`) | 占位程序,供 `Pawn.dll` 组件使用,没有游戏逻辑. |
| Node | `resources/` → `resources/omp-node.json` → `dist/index.js` | 完整游戏模式. |

```text
omp-server.exe
  ├─ Pawn.dll      → gamemodes/lsrp.amx          (占位程序)
  └─ omp-node.dll  → resources/omp-node.json
                       └─ dist/index.js         (TypeScript 构建产物)
```

**AMX 不会读取或构建 TypeScript.** 游戏模式需要单独构建:

```text
resources/src/*.ts  →  npm run build (esbuild)  →  resources/dist/index.js
```

服务器执行已经构建好的 JS.修改后执行 `npm run build`,再**重启** `omp-server.exe`.不支持热重载.

开发流程:在一个终端执行 `npm run dev`(监视变化),手动重启服务器.

Ctrl+C 有时会使 omp-node 内嵌的 Node 崩溃,这是运行时的特性.如果控制台卡住,关闭窗口后重新执行 `npm start`.

Windows 控制台中的西里尔字母经常显示为乱码,但 `log.txt` 中的文字正常.

---

## 项目目录

仓库根目录是 `omp-server.exe` 的工作目录(`process.cwd()`).`.env`,`maps/`,`config.json` 都从这里读取.

```text
public/
  omp-server.exe                 open.mp 二进制文件(Windows)
  libnode.dll                    omp-node 使用的 Node
  config.json                    服务器配置(纳入 Git)
  bans.json                      引擎 IP 封禁
  .env / .env.example            MySQL 配置(.env 在 .gitignore 中)
  package.json                   npm run build / dev / typecheck / start
  deploy.yml                     GitHub Actions 模板(已注释)
  README.md
  docs/
    docs.md                      本文档(架构,注册,命令)
    docs_v2.md / docs_v3.md      各版本玩法
    deploy.md                    部署到 VPS
  maps/                          CreateObject / CreateDynamicObject
  sql/                           数据库结构参考(含启动时读取的种子数据文件)
  gamemodes/lsrp.amx             Pawn 占位程序
  components/                    open.mp DLL
  resources/
    omp-node.json                { "name": "lsrp", "entry": "dist/index.js" }
    package.json
    vitest.config.ts
    tests/                       单元测试
    src/
    dist/                        构建产物(由 gitignore 排除)
```

**不要删除:** `components/`,`omp-server.exe`,`libnode.dll`,`config.json`,`resources/`,`maps/`,`sql/`,`bans.json`,`gamemodes/lsrp.amx`.

---

## 游戏模式源码

所有修改均在 `resources/src/` 中完成.新增系统时,在 `modules/` 建立目录,在 `src/index.ts` 导入并加入模块数组.

```text
resources/src/
  index.ts
  shared/
    brand.ts                     SERVER_NAME, SERVER_TAG
    colors.ts
    database.ts                  mysql2 连接池,从 cwd 读取 .env
    nearby.ts                    本地聊天,sanitizeChatText
    player.ts                    ID,名称,kickSamePlayer
  modules/
    types.ts
    database/                    SELECT 1
    persist/                     保存 HP;金钱只取 account.money
    auth/                        登录,会话,scrypt,迁移
    spawn/                       角色类别,死亡后送医院,首次出生到组织总部
    hospital/                    室内场景,病床 /hospital
    cityhall/                    护照,邀请人
    miner/                       矿场
    gps/
    afk/
    payday/                      每小时 :00,经验,组织工资
    worldtime/                   真实本地时间
    zones/
    hud/                         "Los Santos RP" TextDraw
    session/                     连接日志(不是 auth/session)
    chat/                        IC 聊天和动画
    commands/                    游戏命令
    admin/                       /alogin 和 1-7 级权限
    org/                         组织目录,军队,大门,外观
    mapping/                     maps/*.txt
```

构建使用 `esbuild`,ESM 和 `packages=external`(不打包 mysql2 与 `@omp-node/core`).目标为 ES2018.

---

## 模块顺序

`src/index.ts` 中的顺序**很重要**:

1. `database`
2. **`persist` 在 `auth` 之前**:断开连接时先保存,再清理会话.
3. `auth`
4. `spawn`
5. `hospital`,`cityhall`,`miner`,`gps`,`afk`,`payday`,`worldtime`,`zones`
6. `hud`,`session`,`chat`,`commands`
7. `admin`,`org`
8. `mapping`

open.mp 事件会通知所有订阅者.注册顺序就是 `start()` 的执行顺序.

---

## 模块

### database / persist

`.env` 从**服务器根目录**读取.mysql2 连接池:`connectionLimit: 10`,`utf8mb4`,`dateStrings: true`.

`queueSave` 将**血条上的 HP**和**账号内存中的金钱**写入数据库,不使用 `player.getMoney()`.保存时,客户端金钱缓存会与账号同步,防止修改器产生的金钱被保存.经济系统(矿场,发薪)应先调用 `patchAccount({ money })`,再调用 `giveMoney`.

退出时立即保存;每 3 分钟保存所有已登录玩家.每 15 分钟扣除 1 HP,最低为 20;`hospitalized` 状态除外.

受伤后立即更新内存,50 毫秒后核对.在旁观或死亡状态下,不将 0 HP 写入数据库.

服务器停止时不调用 `closeDatabase()`.

### auth - 注册和登录

昵称只取自客户端,格式为 `Name_Surname`,长度 5-24,匹配 `^[A-Z][a-z]+_[A-Z][a-z]+$`(例如 `John_Doe`).

**没有账号:** 规则(接受 / 拒绝;拒绝则踢出;文字在 `auth/rules.ts`)→ 邮箱 → 6-32 位密码 → 重复密码 → 出生日期 `日.月.年`(16-80 岁)→ 性别 → 皮肤(用箭头选择,男女列表独立)→ 确认.

**已有账号:** 只输入密码,错误 3 次则踢出.取消对话框也会踢出.

登录前处于旁观状态,禁用聊天和命令.

密码格式为 `scrypt:salt:key`,不保存明文.会话使用 `Map<玩家槽位, Account>`.**连接和断开连接时**都会重置会话.`await` 后调用 `isSamePlayer` 核对玩家.

性别为 `users.gender`(`male` / `female`).新角色的金钱和 HP 由数据库结构默认值决定;登录时从数据库恢复血条.

早期对话框 ID:auth **1**,stats **2**,pass **3**,菜单 **4**,rules **5**,invite **6**,GPS **7**,矿场 **8-10**,alogin **11**,makeleader **12**.新增 ID 见 v2 / v3 文档;未经检查不要重复占用.

### spawn

一个 `Class`,team 为 `255`.死亡 → 医院随机位置,设置 `hospitalized`,HP 为 20.会话首次出生且属于组织时,传送到总部,之后不再如此.F4 不会治疗.

### hud

一个全局 TextDraw:`Los_Santos_RP`(屏幕显示"Los Santos RP"),位置 545, 4,颜色 `0x0099FFFF`.文件为 `modules/hud/index.ts`.

### chat

IC 聊天范围 **20 米**,要求相同 VW 和 interior.格式为 `Name_Surname[ID] 说:text`(实际格式以当前代码为准,原文使用俄语男女变形).组织成员使用昵称标签颜色.`sanitizeChatText`(位于 `shared/chat-text.ts`)会删除文字中的 `{`.长度限制 128,有头顶聊天气泡.`/w` 范围 5 米,`/s` 范围 60 米.`game.use_chat_radius: false`.

括号表情(`)`,`))` 等)见 [v3 文档](docs_v3.zh-CN.md).

### mapping

`maps/*.txt` 支持 CreateObject / CreateDynamicObject,材质和文字.不应用 streamer 的 VW / interior 设置(世界为 0,绘制距离 300).`army.txt` 包含建筑;军队大门在 `org/gates.ts` 中创建,不要在 txt 中重复创建.

### hospital

从街道进入,只有 `hospitalized` 玩家可以使用病床.玩家在病床半径内时,每 4.5 秒恢复 10 HP.起身后治疗停止.治疗完成前禁止离开到街道.

### cityhall

护照和邀请人登记(仅一次,要求 `invited_by IS NULL`).

### miner

工作班次,矿石,在招聘点领取报酬.GPS 与矿场共用一个检查点.

### payday

每小时 `:00`:所有在线玩家获得经验;按组织职级发薪;无组织则无工资;AFK 不发薪(约 8 秒没有 `playerUpdate` 或长时间闲置).

### worldtime

服务器时钟使用本地 `Date`,每分钟及连接 / 出生时同步.

### afk

检测客户端暂停和闲置.

---

## 数据库

驱动为 `mysql2`,使用 `?` 占位符.结构参考:`sql/schema.sql`.

**只需创建空数据库:** 启动时会创建表,迁移字段并导入初始数据(房屋,商铺,帮派区域等),无需手动导入 SQL.

| 字段 | 含义 |
|---|---|
| `id` | 主键 |
| `name` | 客户端昵称,UNIQUE |
| `email` | 小写,UNIQUE |
| `password_hash` | scrypt |
| `gender` | male / female |
| `skin` | 平民皮肤 |
| `level` / `exp` | 发薪时更新 |
| `money` | 现金,新角色为 **500** |
| `donate` | 充值余额,尚无对应系统 |
| `health` | HP,新角色为 **100** |
| `passport` | 在市政厅办理 |
| `hospitalized` | 是否需要躺到病床治疗 |
| `invited_by` | 邀请人的昵称 |
| `register_ip` / `last_ip` | 注册 / 最近登录 IP |
| `admin_level` | 0-7 |
| `admin_password_hash` | scrypt;NULL 表示需在 `/alogin` 或 `/makeadmin` 后设置 |
| `org_id` / `org_rank` | 0 表示平民;职级 1-10 |
| `birth_date` / `created_at` | 出生日期 / 创建时间 |

提前创建 `lsrp` 数据库.VPS 上使用独立用户,不要使用无密码的 `root`.

---

## 事件流程

### 连接

```text
playerConnect
  → 重置槽位的 auth/admin/spawn/hospital 状态
  → spectating
  → 250 毫秒后显示 HUD
  → 500 毫秒后 beginAuth
playerSpawn(首次)
  → 从账号恢复现金/HP;有组织则到总部
```

### 死亡

```text
playerDeath → hospitalized,HP 20
playerSpawn → 医院,提示使用 /hospital
```

### 退出

```text
persist queueSave → auth clear → spawn/hospital/admin/chat cleanup
```

---

## 玩家命令

范围:聊天,/me,/do,/try,/todo,/b,/r 气泡为 **20 米**;`/s` 为 **60 米**;`/w` 为 **5 米**.

**没有 `/help` 命令**;命令列表和游戏统计通过 **`/mn`** 查看.管理员查看他人统计使用 `/stats [id]`(见 v3 文档).v2 / v3 的完整命令列表见对应文档.

| 命令 | 功能 |
|---|---|
| `/mn` | 菜单(统计,命令列表,规则等) |
| `/me` `/do` `/try` `/todo` | RP 扮演 |
| `/b` | 附近 OOC 聊天;`/alogin` 后显示 `Administrator` |
| `/s` `/w` | 喊话 / 耳语,消息含 `[ID]` |
| `/pass` | 护照;指定 ID 时通过 Y/N 展示,见 v3 文档 |
| `/hospital` | 使用病床 |
| `/gps` | 导航标记 |
| `/leaders` | 在线组织领导 |
| `/r` | 组织无线电 |
| `/id` | 按昵称 / ID 搜索在线玩家(v3 文档) |

未知命令会有提示.登录前不响应.

---

## 管理员系统

权限存于数据库的 `admin_level`.只有完成 **`/alogin`** 且等级足够时,命令才生效,否则**不响应**(与未知管理员命令相同).`/ahelp` **只显示当前等级以内**的命令.

所有已 `/alogin` 的管理员点击地图即可传送;如果正在驾驶,车辆也会传送.

| 等级 | 命令 |
|---|---|
| 1 | `/a`,`/ahelp`,`/admins`,`/slap [id]`,点击地图传送 |
| 2 | `/kick [id] [prichina]`(原因):所有人看到踢出消息;可以踢自己 |
| 3 | `/ao [text]`:向所有人发送 `Administrator Name[ID]:` |
| 4 | `/sethp [id] [0-100]`,不能对其他已 `/alogin` 的管理员使用;`/ban [id] [dni] [prichina]`(天数,原因);`/unban [Nick_Name]`;`/tpint [id]` |
| 5 | `/makeleader [id]`:组织列表或撤职;目标需有护照;设置为 10 级,不传送 |
| 6 | - |
| 7 | `/makeadmin [id] [0-7]`:重置管理员密码,目标通过对话框设置新密码;**不能对自己使用** |

`/makeadmin 0` 撤销管理员权限.重复授予也会再次重置密码.

---

## 组织

组织目录在 `modules/org/catalog.ts`.此版本为**军队,ID 1**(`army.ts`):颜色 `0x9c7a4bff`,在总部出生,10 个职级 / 皮肤 / 工资档位(1500...9000).

大门:两个模型 19912,步行按 C / 车内鸣笛开启;**军队,地区警察,LSPD,FBI** 可以开门,约 5 秒后自动关闭.

1-9 级只能通过修改数据库设置,除设置领导外没有游戏命令.

---

## open.mp 配置

| 键 | 用途 |
|---|---|
| `name` / `game.mode` | 与 `shared/brand.ts` 一致 |
| `network.port` | 7777 |
| `max_players` | 50 |
| `node.resources` | `["resources"]` |
| `pawn.main_scripts` | `["lsrp 1"]` |
| `game.use_chat_radius` | `false` |
| `rcon.enable` | 保持 `false`;启用**之前**设置密码,不要提交密码 |
| `announce` | 是否进入服务器列表;封闭测试时使用 `false` 或设置 `password` |
| `network.allow_037_clients` | `true` |

`bans.json` 只包含引擎 IP 封禁.账号封禁使用 `users.banned_until`(封禁结束时间的 **DATETIME**,不是天数)和 `users.ban_reason`.

---

## 构建和启动

简要步骤也见 [README](../README.zh-CN.md).

```powershell
copy .env.example .env
cd resources
npm install
cd ..
npm run build
npm run typecheck
npm start
```

单元测试(纯函数:金钱,税费,聊天文本等):

```powershell
cd resources
npm test
```

客户端地址为 `127.0.0.1:7777`,昵称 `Name_Surname`.`build` 后需要**重启**.`dist/` 不在 Git 中.生产部署见 [部署文档](deploy.zh-CN.md).

地图:将含 `CreateObject` / `CreateDynamicObject` 的 `.txt` 放在根目录的 `maps/`,然后重启.服务器名称:`shared/brand.ts` 与 `config.json`(`name`,`game.mode`)保持一致.

---

## 修改位置索引

| 任务 | 文件 |
|---|---|
| 出生 / 医院坐标 | `modules/spawn/point.ts` |
| HP,保存间隔 | `modules/auth/session.ts`,`persist` |
| 登录 | `modules/auth/flow.ts` |
| 规则 | `modules/auth/rules.ts` |
| 标志 | `modules/hud/index.ts` |
| 游戏命令 | `modules/commands/*.ts` + `index.ts` |
| 管理员命令 | `modules/admin/*.ts` + `catalog.ts` + `admin/index.ts` |
| 组织 | 新文件 + `org/catalog.ts` |
| 地图 | `maps/*.txt` |
| 名称 | `brand.ts` + `config.json` |
| 数据库结构 | `sql/schema.sql` + `auth/repository.ts` |

---

## 项目检查

原文记录已检查 `resources/src` 源码,`config.json`,`sql/schema.sql`,`.gitignore` 和部署文档.TypeScript 启用了 `strict`,类型检查通过.

### 已确认正常的内容

- SQL 使用 `?` 占位符,昵称 / 邮箱无法造成 SQL 注入.
- 玩家和管理员密码使用 scrypt,不写入日志.
- 登录前禁用命令和聊天.
- 管理员命令要求 `/alogin` 和相应等级.
- 连接时重置账号会话.
- 延迟踢出会核对槽位和昵称,不会误踢占用同一 ID 的新玩家.
- 数据库金钱不取自客户端.
- 病床只治疗躺着,处于半径内且 `hospitalized` 的玩家.
- IC / OOC / RP / 管理员聊天中的 `{` 会被删除.
- `.env` 和 `dist/` 不在 Git 中.

### 发布前已修复

- 金钱保存由 `getMoney()`(可作弊)改为只取 `account.money`.
- 连接时继承同槽位旧会话的问题.
- 120 毫秒后踢错槽位玩家的问题.
- 离开病床到街上仍能治疗的问题.
- 聊天中的颜色代码.
- 移除了车站旁的测试 Sultan.
- 从 `config.json` 删除硬编码 RCON 密码 `changeme1`(RCON 已关闭,密码为空;如启用,请自行设置).

### 尚存事项(不是登录漏洞,但需要了解)

- 没有聊天 / 命令防刷屏.
- 2 级 `/kick` 可以踢任何人,包括 7 级管理员.
- `/alogin`:错误 3 次会踢出;重新连接后次数恢复为 3(进程内按 `account.id` 管理).
- 玩家密码最短 6 位,无复杂度要求.
- 地图不设置 VW / interior;`setSpawnInfo` 不设置这些值(医院通过 `placeAt` 放置).
- `/stats` 会向自己显示邮箱;统计中的金钱取自账号内存,修改保存逻辑后这是正常行为.
- 同一组织可以有多个领导:`/makeleader` 不撤销上一任.
- 游戏内无法授予组织 1-9 级职级.
- 客户端最小化时(约 8 秒无 update)视为 AFK,不发薪.
- `users` 迁移失败会记录日志,但服务器仍然"启动".
- `resourceStop` 时不清理定时器和 MySQL 连接池.
- 注册密码在确认前保存在 `Pending` 内存中.
- 无哈希时首次 `/alogin` 会设置管理员密码;这是 `/makeadmin` 后的预期行为,但手动在 SQL 中设置 `admin_level` 时存在风险.
- `announce: true` 可能使服务器出现在公开列表中.

### 此版本尚未实现

完整车辆系统,房屋,物品栏,`/pm`,`/report`,1-9 级职级调整和热重载.

### 结论

按原文对代码的检查,普通客户端无法绕过登录,未 `/alogin` 执行管理员命令或进行 SQL 注入.修改器产生的金钱不再写入数据库.公开开放前应设置自己的 RCON 密码(如需使用),连接密码或 `announce`,添加防刷屏,并避免泄露 `.env`.
