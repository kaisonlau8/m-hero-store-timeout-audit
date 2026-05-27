# 门店超时提醒登记审计系统

比对飞书多维表格中的「门店清单」与「超时提醒专属名称」表，自动识别未登记门店，按督导私聊飞书通知，并通过仪表板实时跟踪登记进度。

## 功能

- **数据比对**：以 `store_list.xlsx` 为唯一主数据源，与飞书「超时提醒专属名称」表按店名匹配，识别未登记门店
- **差异告警**：检测 xlsx 与飞书「门店清单」多维表格之间的门店名、督导、区域差异，仪表板红色告警提示
- **飞书通知**：每天 17:00 定时私聊通知各督导其负责的未登记门店清单，同时发送全国汇总给管理者
- **Excel 导出**：按督导分 sheet 生成未登记门店明细
- **数据覆写**：将 xlsx 内容覆写到飞书门店清单表，保持两者一致
- **Vue 仪表板**：总览卡片、督导统计、区域分布图、门店列表筛选、历史趋势、配置管理

## 项目结构

```
store-timeout-audit/
├── store_list.xlsx           # 主数据源（唯一正确依据）
├── .env                      # 环境变量
├── config.js                 # 配置加载
├── config/
│   └── managers.json         # 全国收信管理者列表
├── src/
│   ├── index.js              # Express 入口 + 定时任务启动
│   ├── audit.js              # 核心比对逻辑 + Excel 生成
│   ├── messenger.js          # 飞书消息发送（手机号→open_id→私聊）
│   ├── scheduler.js          # node-cron 定时任务
│   ├── sync-stores.js        # 覆写脚本：xlsx → 飞书门店清单
│   └── api/
│       └── dashboard.js      # 仪表板 REST API
├── frontend/                 # Vue 3 + Element Plus
│   ├── src/views/Dashboard.vue
│   └── vite.config.js
├── output/                   # 生成的 Excel 文件
└── logs/                     # 审计日志
```

## 快速开始

### 1. 安装依赖

```bash
# 确保 feishu-bitable-middleware 在相邻目录
ls ../feishu-bitable-middleware   # 应存在

# 安装后端依赖
npm install

# 安装并构建前端
cd frontend
npm install
npm run build
cd ..
```

### 2. 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env`：

| 变量 | 说明 | 示例 |
|------|------|------|
| `FEISHU_APP_ID` | 飞书应用 App ID | `cli_a9574044xxx` |
| `FEISHU_APP_SECRET` | 飞书应用 App Secret | |
| `BITABLE_APP_TOKEN` | 多维表格 App Token | `F2TbbDVG1aA6xxx` |
| `STORE_TABLE_ID` | 门店清单表 ID | `tbl8T0kayGMQxxx` |
| `STORE_VIEW_ID` | 门店清单视图 ID | `veww6Jf0vj` |
| `REGISTRATION_TABLE_ID` | 超时提醒登记表 ID | `tblknmHlArNxxx` |
| `REGISTRATION_VIEW_ID` | 登记表视图 ID | `vewdEIPxUW` |
| `STORE_LIST_PATH` | xlsx 文件路径 | `./store_list.xlsx` |
| `SCHEDULE_CRON` | 定时任务 cron 表达式 | `0 17 * * *` |
| `PORT` | 服务端口 | `3001` |

### 3. 启动服务

```bash
npm run dev    # 开发模式（自动重载）
npm start      # 生产模式
```

访问 `http://localhost:3001` 查看仪表板。

## 生产部署

### PM2 守护进程

使用 [pm2](https://pm2.keymetrics.io/) 保持 Node 服务后台运行并自动重启：

```bash
# 安装 pm2
npm install -g pm2

# 启动服务
pm2 start src/index.js --name store-audit

# 常用命令
pm2 logs store-audit       # 查看日志
pm2 stop store-audit       # 停止
pm2 restart store-audit    # 重启
pm2 startup                # 设置开机自启
pm2 save                   # 保存当前进程列表（配合 startup 使用）
```

### Cloudflare Tunnel 公网访问

通过 Cloudflare Tunnel 将本地服务暴露到公网，无需开放端口或公网 IP。

**已完成配置：**

- 域名：`https://audit-m-hero.41box.com` → `localhost:3001`
- 隧道名：`store-audit`
- 隧道 ID：`b225afb2-2e7c-4f5f-acd7-c54916ea4d08`
- 凭证文件：`~/.cloudflared/b225afb2-2e7c-4f5f-acd7-c54916ea4d08.json`
- 配置文件：`~/.cloudflared/config.yml`

**启动隧道：**

```bash
# 前台运行（可看日志）
cloudflared tunnel run store-audit

# 后台运行
cloudflared tunnel run store-audit &

# 设为系统服务（开机自启，需 sudo）
cloudflared service install
```

**管理命令：**

```bash
cloudflared tunnel list                    # 查看所有隧道
cloudflared tunnel info store-audit        # 查看隧道状态
cloudflared tunnel cleanup store-audit     # 清理连接
```

## 覆写脚本

将 xlsx 内容覆写到飞书门店清单多维表格，xlsx 为唯一正确依据：

```bash
node src/sync-stores.js --dry-run   # 预览变更，不写入
node src/sync-stores.js --run       # 执行覆写
```

脚本以「门店编码」为唯一键，自动计算新增、更新、删除操作。

## API

| Method | Path | 说明 |
|--------|------|------|
| GET | `/api/dashboard/summary` | 审计摘要 + 差异告警 |
| GET | `/api/dashboard/stores` | 门店列表（`?supervisor=&area=&status=registered/unregistered`） |
| GET | `/api/dashboard/history` | 历史审计记录（`?days=30`） |
| GET | `/api/dashboard/export` | 下载最新 Excel |
| POST | `/api/dashboard/run` | 手动触发审计 + 发送通知 |
| POST | `/api/dashboard/refresh` | 刷新缓存数据 |
| GET | `/api/dashboard/config` | 获取配置（管理者列表） |
| PUT | `/api/dashboard/config` | 更新管理者列表 |

## 管理者配置

通过仪表板「配置管理」按钮或直接编辑 `config/managers.json`：

```json
[
  { "name": "张三", "phone": "13800138001" },
  { "name": "李四", "phone": "13800138002" }
]
```

## 飞书应用权限

需确保飞书应用已开通以下权限：

| 权限 | 权限ID | 用途 |
|------|--------|------|
| 获取与更新多维表格信息 | `bitable:app` | 读取门店清单和登记表 |
| 获取用户 ID | `contact:user.id:readonly` | 手机号解析 open_id |
| 以应用身份发消息 | `im:message:send_as_bot` | 私聊发送通知 |

## 数据源优先级

1. **`store_list.xlsx`** — 唯一主数据源，所有门店信息（名称、编码、区域、督导、手机号）以此为淮
2. **飞书「门店清单」表** — 从属，需与 xlsx 保持一致，不一致时仪表板告警，可用覆写脚本同步
3. **飞书「超时提醒专属名称」表** — 登记状态来源，仅取「经销商」关联的店名做匹配
