# Los Santos Role Play (LSRP)

基于 **[open.mp](https://open.mp)** 的 RP 游戏服务器.游戏模式逻辑通过 **omp-node**(Node.js)使用 **TypeScript** 编写.客户端:SA-MP 0.3.7 / open.mp.

| 项目 | 说明 |
|---|---|
| 技术栈 | open.mp,omp-node,TypeScript,esbuild,MySQL(`mysql2`) |
| 代码 | `resources/src/` → 构建到 `resources/dist/`(不要手动修改构建产物) |
| 数据 | MySQL,连接设置位于 `.env` |
| 文档 | [基础文档](docs/docs.zh-CN.md) . [v2 文档](docs/docs_v2.zh-CN.md) . [v3 文档](docs/docs_v3.zh-CN.md) |
| 部署 | [部署文档](docs/deploy.zh-CN.md) . [deploy.yml](deploy.yml) |

## 目录结构

```text
.
├── omp-server.exe
├── config.json
├── .env                 # 从 .env.example 复制
├── maps/                # 地图物体
├── sql/                 # 数据库结构参考(启动时创建表)
├── gamemodes/lsrp.amx   # Pawn 占位程序
├── docs/                # 文档
└── resources/
    ├── src/             # 游戏模式源码
    │   ├── index.ts     # 模块加载顺序
    │   ├── shared/      # 品牌,颜色,数据库,辅助函数
    │   └── modules/     # auth, houses, businesses, vehicles,
    │                    # jobs, anticheat, org, chat, commands, ...
    ├── dist/            # JS 构建产物(由 gitignore 排除)
    └── tests/           # 单元测试(Vitest)
```

- 新模块:在 `modules/` 中创建目录,并在 `src/index.ts` 导入.
- 新命令:在 `modules/commands/` 中创建文件,并在 `commands/index.ts` 中添加 `import`.
- 玩法,注册和命令说明位于 `docs/`.

## 启动

1. 安装 **Node.js** 和 **MySQL**(例如使用 OSPanel).
2. 创建一个**空数据库**.无需手动导入 SQL;服务器启动时会自行创建表和初始数据.
3. 复制 `.env.example` → `.env`,填写数据库连接信息.
4. 安装依赖,构建并启动:

```powershell
cd resources
npm install
cd ..
npm run build
npm start
```

客户端连接地址:`127.0.0.1:7777`,昵称格式为 `Name_Surname`.每次 `build` 后都需要**重启**服务器(不支持热重载).

| 命令 | 执行位置 | 用途 |
|---|---|---|
| `npm run build` | 项目根目录 | 构建 `resources/dist` |
| `npm run dev` | 项目根目录 | 监视文件变化并构建 |
| `npm run typecheck` | 项目根目录 | 类型检查 |
| `npm start` | 项目根目录 | 启动 `omp-server.exe` |
| `npm test` | `resources/` | 单元测试 |

建议的开发流程:在一个终端中运行 `npm run dev`,修改后手动重启服务器.
