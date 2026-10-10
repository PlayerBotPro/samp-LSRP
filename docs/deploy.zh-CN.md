# 将 LSRP 部署到服务器

如何将服务器从本地 OSPanel 迁移到 VPS 或独立服务器:所需环境,游戏模式构建,文件复制及更新方法.

本地开发见 [README](../README.zh-CN.md).游戏模式结构见 [基础文档](docs.zh-CN.md).

流水线:根目录中的 [deploy.yml](../deploy.yml),负责构建,类型检查和通过 SSH 部署.

当前目录面向 **Windows**(`omp-server.exe`,`*.dll`).Linux 使用相同的游戏模式文件,但 open.mp 二进制文件必须换成 **Linux 构建版本**,不能使用 `.exe`.

---

## 服务器需要安装什么

| 需要 | 用途 |
|---|---|
| 与服务器操作系统对应的 open.mp | `omp-server` / `omp-server.exe`,`libnode`,`components/` 目录 |
| **Node.js 18+** | 构建 TS,并在 `resources/` 中执行 `npm ci` |
| **MySQL 8** | `users` 表 |
| UDP **7777**(开启 artwork 时还需要 TCP 7777) | SA-MP / open.mp 客户端连接 |
| `lsrp` 数据库及 MySQL 用户,**不要使用无密码的 root** | 在 `.env` 中配置 |

omp-node 执行已经构建好的 `resources/dist/index.js`.如果提前完成构建,生产环境运行时不需要 `.ts` 源码.

`mysql2` 和 `@omp-node/core` **不会打包**进 JS(`packages=external`).服务器必须在执行 `npm ci` 后拥有 `resources/node_modules`.

---

## 构建游戏模式

在仓库根目录执行(本地或服务器均可):

```powershell
cd resources
npm ci
cd ..
npm run typecheck
npm run build
```

产物为 `resources/dist/index.js`(以及 `.map`).`dist/` 目录**不在 Git 中**;不执行 `build`,服务器就会加载空的或旧的游戏模式.

每次修改 TS 后,重新执行 `npm run build`,然后**重启** `omp-server`.不支持热重载.

---

## 需要复制到服务器的文件

### 必需文件

```text
config.json
bans.json                 (可以是空数组 [])
gamemodes/lsrp.amx
components/               (与服务器操作系统对应的 DLL/SO)
maps/
sql/schema.sql            (结构参考;表也会自动创建)
resources/omp-node.json
resources/package.json
resources/package-lock.json
resources/dist/           (执行 npm run build 后生成)
package.json              (提供 start 脚本;Linux 说明见下文)
```

此外还需要对应操作系统的 open.mp 二进制文件:Windows 为 `omp-server.exe` + `libnode.dll`,Linux 为 `omp-server` + `libnode.so`.

请**在服务器上创建** `.env`,不要复制家用电脑上的配置.

### 不要复制

| 路径 | 原因 |
|---|---|
| `.env` | 包含本机数据库密码 |
| `.git/` | 运行不需要 |
| `log.txt`,`*.log` | 无需部署的日志 |
| `resources/src/` | 如果已在本地构建 `dist`,运行时不需要 |
| `resources/node_modules/` | 不要从 Windows 复制到 Linux |
| 根目录的 `node_modules/` | 不存在 / 不需要 |

如果在服务器上通过 `git pull` 部署,就无需手动复制:克隆仓库,在服务器上构建并安装运行时依赖即可.

---

## 在服务器上首次启动

### 1. MySQL

```sql
CREATE DATABASE lsrp CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE USER 'lsrp'@'127.0.0.1' IDENTIFIED BY 'STRONG_PASSWORD';
GRANT ALL ON lsrp.* TO 'lsrp'@'127.0.0.1';
FLUSH PRIVILEGES;
```

`STRONG_PASSWORD` 表示需要替换的强密码.`users` 表在游戏模式启动时创建,也可以提前使用 `sql/schema.sql` 导入结构.

### 2. 服务器根目录中的 `.env`(与 `omp-server` 同目录)

```dotenv
MYSQL_HOST=127.0.0.1
MYSQL_PORT=3306
MYSQL_USER=lsrp
MYSQL_PASSWORD=STRONG_PASSWORD
MYSQL_DATABASE=lsrp
```

如果 MySQL 在另一台主机上,应填写实际地址,而不是 `127.0.0.1`.该用户必须有权从游戏服务器主机连接数据库.

### 3. Node 依赖(在服务器上安装)

```powershell
cd resources
npm ci --omit=dev
```

`--omit=dev` 只安装 `mysql2` 和 `@omp-node/core`.如果**就在这台服务器上构建**游戏模式,应执行完整的 `npm ci`(需要 esbuild 和 typescript).

不要将 `node_modules` 从 Windows 复制到 Linux.

### 4. 生产环境的 `config.json`

向玩家开放之前:

- `rcon.password`:**启用 RCON 之前**设置自己的密码;建议将 `enable` 保持为 `false`.不要提交实际使用的密码.
- `network.public_addr`:如果位于 NAT 后,填写公网 IP 或域名.
- `announce`:只有需要出现在服务器列表中时才设为 `true`.
- `password`:私服可设置连接密码.
- `name` / `game.mode`:与 `resources/src/shared/brand.ts` 一致(更改品牌名称后需要重新构建).

端口:`network.port`(默认 7777).防火墙需要放行 **UDP 7777**.如果 `artwork.enable: true`,artwork 还需要 TCP 7777.

### 5. 启动

Windows(与本地相同):

```powershell
npm start
```

也可以从根目录运行 `omp-server.exe`.

Linux:通常运行 `./omp-server`(通过 `chmod +x` 添加执行权限).根目录的 `npm start` 面向 `.exe`,所以 Linux 应直接运行二进制文件.

日志中应出现"MySQL 已连接""users 表已就绪""LSRP 已就绪"(原程序输出俄语).客户端连接 `IP:7777`,昵称为 `Name_Surname`.

---

## 更新已部署的游戏模式

1. 停止 `omp-server`.
2. 上传新文件(或执行 `git pull`).
3. 如果修改了 TypeScript,执行构建:

   ```powershell
   npm run build
   ```

4. 如果修改了 `resources/package.json` 或锁文件,再执行 `cd resources && npm ci --omit=dev`.
5. 如果修改了地图,上传 `maps/*.txt`.
6. 启动服务器.

玩家需要重新连接.内存中的会话无法跨重启保留;HP 和金钱应已写入 MySQL(退出时保存,另外每 3 分钟自动保存).

---

## 两种部署方式

### A. 本地构建,上传到服务器

在自己的电脑上:

```powershell
npm run build
```

上传 `resources/dist/`,`maps/`,`config.json`(注意不要覆盖生产环境配置),必要时上传 `gamemodes/`.服务器上首次执行 `cd resources && npm ci --omit=dev`,然后重启.

生产环境可以不上传 `resources/src`.

### B. 在服务器上使用 Git(便于更新)

```bash
git clone <url> /opt/lsrp
cd /opt/lsrp
# 如果仓库只有 Windows 版本,将 Linux 版 open.mp 二进制文件放入此目录
cd resources && npm ci && cd ..
npm run build
cd resources && npm ci --omit=dev && cd ..   # 也可以保留完整依赖
cp .env.example .env                         # 填写密码
# 修改 config.json
./omp-server                                 # Windows 则运行 omp-server.exe
```

---

## Windows Server(服务)

为了让服务器不随 RDP 会话结束而停止,可以使用 NSSM / WinSW 将 `omp-server.exe` 注册为服务.**Working directory** 设置为项目根目录(包含 `.env` 和 `maps/`).

NSSM 示例:

```text
Path:           D:\lsrp\omp-server.exe
Startup dir:    D:\lsrp
```

不要从其他目录启动:`.env` 和 `maps/` 都是相对于 `cwd` 读取的.

---

## Linux(systemd)

创建 `/etc/systemd/system/lsrp.service`(替换为自己的目录路径):

```ini
[Unit]
Description=LSRP open.mp
After=network.target mysql.service

[Service]
Type=simple
WorkingDirectory=/opt/lsrp
ExecStart=/opt/lsrp/omp-server
Restart=on-failure
RestartSec=5

[Install]
WantedBy=multi-user.target
```

```bash
sudo systemctl daemon-reload
sudo systemctl enable --now lsrp
sudo journalctl -u lsrp -f
```

open.mp 还会将日志写入工作目录中的 `log.txt`.

---

## GitHub Actions(`deploy.yml`)

配置文件位于根目录:[deploy.yml](../deploy.yml).

它不会安装 MySQL,也不会复制 `.env` / `config.json`;这些需要首次手动配置(见上文).流水线构建游戏模式,上传 `resources/dist` 和 `maps/`,然后在存在 `lsrp` 服务时重启该服务.

在仓库的 **Settings → Secrets and variables → Actions** 中添加密钥:

| 密钥 | 示例 |
|---|---|
| `DEPLOY_HOST` | `203.0.113.10` |
| `DEPLOY_USER` | `root` |
| `DEPLOY_SSH_KEY` | 完整的私钥内容 |
| `DEPLOY_PATH` | `/opt/lsrp` |

`deploy.yml` 中的 SSH 端口当前为 **22**.如使用其他端口,请修改文件中的 `port:`.

触发方式:**Actions → Deploy → Run workflow**,或推送标签:

```bash
git tag v1.0.0
git push origin v1.0.0
```

如果没有配置 `DEPLOY_HOST`,部署任务会跳过,但仍会执行构建.

---

## 简要检查清单

- [ ] MySQL:数据库,用户,密码.
- [ ] 在服务器上创建 `.env`,不复制家用电脑的配置.
- [ ] 执行 `npm run build`,确认存在 `resources/dist/index.js`.
- [ ] 在服务器执行 `npm ci --omit=dev` 生成 `resources/node_modules`(不要从 Windows 复制到 Linux).
- [ ] `gamemodes/lsrp.amx` 和 `components/` 已就位.
- [ ] 检查 `config.json` 中的 RCON,announce,public_addr.
- [ ] 防火墙放行 UDP 7777.
- [ ] 从项目**根目录**启动.
- [ ] 日志中出现 MySQL 和"LSRP 已就绪".
- [ ] 使用昵称 `Name_Surname` 从客户端连接.

---

## 常见错误

| 现象 | 检查内容 |
|---|---|
| "数据库不可用" | `.env`,MySQL 主机,用户,以及是否从根目录启动服务器 |
| 模块不加载 / 仍运行旧代码 | 是否忘记 `npm run build` 或重启进程 |
| `Cannot find package mysql2` | 缺少 `resources/node_modules`,需要执行 `npm ci --omit=dev` |
| Linux 无法启动 | 是否上传了 Windows `.exe` / `.dll`;需要 Linux 版 open.mp 二进制文件 |
| 玩家找不到服务器 | UDP 7777,`public_addr`,`announce` |
| 因昵称被踢出 | 客户端昵称必须使用拉丁字母,格式为 `Name_Surname` |
