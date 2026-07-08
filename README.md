# WPS表格导入工具

提交金山文档在线表格链接，自动读取不同子表数据，按配置导入到目标在线表格。

## 功能

- **店铺管理**：配置不同店铺名称
- **表格类型**：每个店铺下配置多种表格类型（销售表、库存表等）
- **子表映射**：配置源表格的哪些子表需要导入，以及目标表格位置
- **一键导入**：提交源表格链接 → 自动读取子表 → 追加写入目标表格
- **导入日志**：记录每次导入操作的结果

## 技术栈

- 前端：HTML + CSS + JavaScript（无框架依赖）
- 后端：Cloudflare Pages Functions
- 数据库：Cloudflare D1（SQLite）
- API：金山文档开放平台

## 部署到 Cloudflare

### 1. 前置条件

- Cloudflare 账号
- Node.js 18+
- 金山文档开放平台应用（获取 app_id 和 app_key）

### 2. 安装依赖

```bash
cd wps-import-site
npm install
```

### 3. 创建 D1 数据库

```bash
npx wrangler login
npx wrangler d1 create wps-import-db
```

将输出的 `database_id` 填入 `wrangler.toml`：

```toml
[[d1_databases]]
binding = "DB"
database_name = "wps-import-db"
database_id = "这里填入你的database_id"
```

### 4. 初始化数据库

```bash
# 本地
npx wrangler d1 execute wps-import-db --local --file=./schema.sql

# 远程（生产环境）
npx wrangler d1 execute wps-import-db --remote --file=./schema.sql
```

### 5. 部署

```bash
npx wrangler pages deploy public
```

### 6. 本地开发

```bash
npx wrangler pages dev public --local --d1 DB=wps-import-db
```

## 配置金山文档 API

### 获取 app_id 和 app_key

1. 访问 [金山文档开发者后台](https://developer.kdocs.cn/admin/selectservicer)
2. 创建应用，获取 `app_id` 和 `app_key`
3. 设置回调地址为你的部署地址 + `/api/auth/callback`

### 在系统中配置

1. 打开网站 → 设置页
2. 填入 `app_id` 和 `app_key`，保存
3. 点击"前往授权"，完成 OAuth 授权
4. 授权成功后即可使用导入功能

## 使用流程

### 配置阶段（一次性）

1. **配置页** → 添加店铺（如：店铺A、店铺B）
2. 选择店铺 → 添加表格类型（如：销售表、库存表）
3. 配置表格类型的目标表格链接和子表索引
4. 添加子表映射（源表格中哪个子表对应这个表格类型）

### 日常使用

1. **导入页** → 选择店铺
2. 粘贴源表格链接
3. 点击"获取子表列表" → 预览数据
4. 点击"开始导入" → 数据自动追加到目标表格

## 项目结构

```
wps-import-site/
├── functions/
│   └── api/
│       └── [[path]].js     # 后端API（Pages Functions）
├── public/                  # 前端静态文件
│   ├── index.html
│   ├── style.css
│   └── app.js
├── schema.sql               # D1数据库建表语句
├── wrangler.toml            # Cloudflare配置
├── server.js                # 本地预览服务器（演示模式）
└── package.json
```

## 金山文档 API 说明

- API 文档：https://developer.kdocs.cn
- 认证方式：OAuth 2.0
- 读取表格：`GET /api/v1/openapi/et/:file_token/sheets/:sheet_idx/cells`
- 写入表格：`POST /api/v1/openapi/ksheet/:file_token/sheets/:sheet_idx/cells`
- access_token 有效期：24小时，refresh_token 有效期：90天
