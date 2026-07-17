# Matrix Share — 多平台短视频矩阵去重分发系统

一站式自媒体矩阵管理平台。绑定账号 → 上传视频 → 选择平台 → 一键分发。支持去重转码防查重、自动 Token 续期、数据看板。

## 目录

- [功能总览](#功能总览)
- [系统架构](#系统架构)
- [技术栈](#技术栈)
- [项目结构](#项目结构)
- [快速开始](#快速开始)
- [小红书浏览器登录](#小红书浏览器登录)
- [环境变量参考](#环境变量参考)
- [API 文档](#api-文档)
- [生产部署](#生产部署)
- [朋友接入清单](#朋友接入清单)
- [开发指南](#开发指南)

---

## 功能总览

### 核心功能

| 功能 | 说明 |
|------|------|
| **多平台 OAuth 绑定** | 抖音 · 快手 · B站 · 微信视频号，标准 OAuth 2.0 授权流程 |
| **小红书浏览器登录** | 创作者中心无公开 API，使用 Playwright + 系统 Edge 浏览器自动化采集 |
| **视频矩阵分发** | 单次上传，同时分发到多个已绑定的平台账号 |
| **智能去重转码** | FFmpeg 流水线：微裁剪 + 色彩扰动 + 极微旋转 + 半透明水印 + 音视频微调速，规避平台查重 |
| **Token 自动续期** | 后台定时检查，自动刷新各平台 Access Token，无需人工干预 |
| **数据看板** | 发布记录、各平台播放数据趋势 |
| **支付系统** | 支付宝 + 微信支付 APIv3，支持套餐购买 |

### 平台支持

| 平台 | 接入方式 | 当前能力 |
|------|---------|---------|
| 小红书 | **浏览器自动化**（Playwright + Edge CDP） | 数据看板自动采集 |
| 抖音 | 开放平台 API | OAuth 绑定 + 视频发布 + 数据采集 |
| 快手 | 开放平台 API | OAuth 绑定 + 视频发布 + 数据采集 |
| B站 | 开放平台 API | OAuth 绑定 + 视频发布 + 数据采集 |
| 微信视频号 | 第三方平台 | OAuth 绑定 + 视频发布 |

> **小红书说明**：小红书开放平台暂不支持数据类 API，且创作者中心采用 SSO + localStorage 登录态。
> 本项目使用 Playwright 启动系统 Edge 浏览器，通过 CDP 协议连接，从 Dashboard DOM 中提取指标数据。
> 登录态保存在 `edge-profile/` 目录，一次登录后续重启服务自动恢复。

### 去重转码流水线

```
原始视频
  │
  ├─ 1. 微裁剪 1%         crop=in_w*0.99:in_h*0.99:in_w*0.005:in_h*0.005
  ├─ 2. 色彩微调           eq=contrast=1.01:brightness=0.005:saturation=1.01
  ├─ 3. 极微旋转 0.28°     rotate=0.005
  ├─ 4. 半透明水印         drawtext=white@0.35
  ├─ 5. 视频速度微调       setpts=0.99*PTS
  └─ 6. 音频速度微调       atempo=1.01
       │
       └─ 标准化 H.264 + yuv420p + faststart 输出
```

每项改动幅度控制在人眼不易感知的范围，但足以改变文件的 MD5/感知哈希，从底层规避平台查重算法。

---

## 系统架构

```
┌─────────────────────────────────────────────────────────┐
│                        前端                             │
│            React 18 + Vite + Tailwind CSS                │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐  ┌─────────┐  │
│  │  发布页  │  │  绑定页  │  │  充值页  │  │ 数据页  │  │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘  └────┬────┘  │
│       └──────────────┴──────────────┴──────────────┘     │
└─────────────────────────┬───────────────────────────────┘
                          │ HTTP / JSON
┌─────────────────────────▼───────────────────────────────┐
│                        后端                               │
│              Node.js + Express + TypeScript               │
│                                                         │
│  ┌──────────┐  ┌──────────┐  ┌──────────────────────┐   │
│  │ OAuth 认证├─►│ 业务路由 ├─►│ 账号管理 / OSS 直传  │   │
│  └──────────┘  └────┬─────┘  └──────────────────────┘   │
│                     │                                     │
│            ┌────────▼────────┐                           │
│            │   BullMQ 队列    │                           │
│            │  (dev=内存队列)  │                           │
│            └────────┬────────┘                           │
│                     │                                     │
│            ┌────────▼────────┐                           │
│            │  Worker 消费者   │                           │
│            │ 转码→上传→发布  │                           │
│            └────────────────┘                           │
│                                                         │
│  ┌──────────────────┐  ┌──────────────────┐             │
│  │ Token 续期服务    │  │  支付服务         │             │
│  │ (定时刷新)        │  │  支付宝+微信支付   │             │
│  └──────────────────┘  └──────────────────┘             │
│                                                         │
│  ┌──────────────────┐                                   │
│  │ 小红书浏览器采集   │  ← Playwright + Edge CDP         │
│  │ browserManager.ts│     常驻进程，Dashboard DOM 提取   │
│  └──────────────────┘                                   │
└─────────────────────────────────────────────────────────┘
```

---

## 技术栈

| 层级 | 技术 | 开发环境 | 生产环境 |
|------|------|---------|---------|
| **前端** | React 18 + Vite + Tailwind CSS | 同左 | 同左 |
| **后端** | Node.js + Express + TypeScript | 同左 | 同左 |
| **数据库** | Prisma ORM | SQLite（无需安装） | PostgreSQL |
| **队列** | BullMQ | 内存队列（无需 Redis） | Redis |
| **缓存** | ioredis | 内存 Map 模拟 | Redis |
| **存储** | 阿里云 OSS | 同左 | 同左 |
| **视频处理** | fluent-ffmpeg + FFmpeg | 同左 | 同左 |
| **浏览器自动化** | Playwright + 系统 Edge | 同左 | 同左 |
| **支付** | alipay-sdk + wechatpay-node-v3 | 沙箱模式 | 正式商户 |
| **进程管理** | — | tsx watch | PM2 cluster |

---

## 项目结构

```
matrix-share-saas/
│
├── frontend/                    # React 前端
│   └── src/
│       ├── api/
│       │   └── client.ts        # API 客户端
│       ├── components/
│       │   ├── Layout.tsx       # 页面布局外壳
│       │   ├── PublishPanel.tsx # 发布面板（上传+选账号+分发）
│       │   └── AccountCard.tsx  # 账号卡片组件
│       └── pages/
│           ├── Publish.tsx      # 发布页
│           ├── Bind.tsx         # 账号绑定页（含小红书浏览器登录）
│           ├── Billing.tsx      # 充值页
│           ├── Dashboard.tsx    # 数据看板
│           └── OAuthCallback.tsx # OAuth 回调中转页
│
├── prisma/
│   └── schema.prisma            # 数据模型定义
│
├── src/
│   ├── adapters/                # 各平台 OAuth 适配器
│   │   └── ...                  # douyin / kuaishou / bilibili / wechat
│   │
│   ├── collectors/              # 浏览器自动化采集器
│   │   └── red.collector.ts     # 小红书 Dashboard 数据提取
│   │
│   ├── services/
│   │   ├── browserManager.ts    # Edge 浏览器生命周期管理 + CDP 连接
│   │   ├── transcoder.service.ts   # FFmpeg 转码+去重
│   │   ├── tokenRefresher.ts       # Token 自动续期
│   │   ├── dataCollector.ts        # 定时数据采集调度
│   │   ├── analytics.service.ts    # 数据统计服务
│   │   └── mock.service.ts         # 开发环境模拟发布
│   │
│   ├── queues/
│   │   ├── publish.queue.ts    # 队列定义（dev=内存/prod=BullMQ）
│   │   └── publish.worker.ts   # 消费者（转码→发布）
│   │
│   ├── controllers/
│   │   ├── oauth.router.controller.ts  # 统一 OAuth 路由
│   │   ├── wx.oauth.controller.ts      # 微信第三方平台事件
│   │   ├── payment.controller.ts       # 支付宝支付
│   │   └── wx.payment.controller.ts    # 微信支付
│   │
│   ├── middleware/
│   │   └── auth.ts              # JWT 鉴权中间件
│   │
│   ├── utils/                   # 工具库
│   │   ├── prismaClient.ts
│   │   ├── redis.ts
│   │   ├── crypto.ts
│   │   └── appError.ts
│   │
│   └── index.ts                 # 应用入口 + 路由注册
│
├── edge-profile/                 # Edge 浏览器持久化配置（含登录态，已 gitignore）
├── .env.example                  # 环境变量模板
├── ecosystem.config.js           # PM2 集群配置
└── docs/
    └── operation-manual.md       # 操作手册
```

---

## 快速开始

### 前置条件

- Node.js 18+
- npm 9+
- FFmpeg（可选，开发环境使用模拟发布可跳过）
- **Microsoft Edge**（系统自带即可，用于小红书浏览器自动化）

### 1. 克隆并安装依赖

```bash
git clone https://github.com/wlfwmy/matrix-share-saas.git
cd matrix-share-saas

# 后端
npm install

# 前端
cd frontend && npm install && cd ..
```

### 2. 配置环境变量

```bash
cp .env.example .env
```

编辑 `.env`，至少设置以下三项，其余可按需配置：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| `JWT_SECRET` | JWT 签名密钥 | 开发有默认值，生产必须换 |
| `TOKEN_ENCRYPT_KEY` | Token 加密密钥 | **必须改为 32 位字符** |
| `ALI_ACCESS_KEY_ID` / `ALI_ACCESS_KEY_SECRET` | 阿里云 OSS 密钥 | 上传视频需要 |

> 小红书数据采集无需任何环境变量配置，直接浏览器登录即可。

### 3. 初始化数据库

```bash
# 生成 Prisma Client
npx prisma generate

# 创建数据库表（SQLite，无需安装数据库）
npx prisma db push
```

### 4. 安装 Playwright 浏览器

```bash
# 安装 Chromium（用于 Cookie 模式的浏览器上下文，可选）
npx playwright install chromium
```

### 5. 启动开发服务

```bash
# 终端 1：后端（端口 3000）
npm run dev

# 终端 2：前端（端口 5173）
cd frontend && npm run dev
```

访问 http://localhost:5173

> 开发环境下，后端使用内存队列、内存 Redis 模拟、SQLite 数据库，无需安装 Redis 和 PostgreSQL。

---

## 小红书浏览器登录

小红书是唯一不使用 OAuth 的平台。因为小红书开放平台不提供数据 API，且创作者中心采用 SSO + localStorage 登录态，本系统使用 Playwright + 系统 Edge 浏览器 实现自动化数据采集。

### 首次登录

1. 启动服务后，打开前端 http://localhost:5173
2. 进入「账号绑定」页面
3. 找到小红书卡片，点击「登录」按钮
4. 系统会自动打开一个 Edge 浏览器窗口，导航到创作者中心登录页
5. 在浏览器窗口中扫码登录（或使用手机号验证码登录）
6. 登录成功后，前端会自动检测到状态变为「已登录」

### 登录态持久化

- 登录信息保存在项目根目录的 `edge-profile/` 中（已加入 `.gitignore`）
- **服务重启后无需重新登录**，Edge 浏览器会复用该配置目录
- 浏览器进程在服务运行期间保持打开，请勿手动关闭 Edge 窗口
- 如需更换账号，可在前端点击「登录」重新打开浏览器窗口登出后换号

### 数据采集

- 系统每 6 小时自动从创作者中心 Dashboard 提取指标数据
- 支持采集的指标：曝光数、观看数、点赞数、评论数、收藏数、分享数、净涨粉、粉丝数、关注数
- 采集到的数据会存入数据库，可在数据看板查看趋势

---

## 环境变量参考

### 基础配置

| 变量 | 说明 | 开发默认值 | 生产环境 |
|------|------|-----------|---------|
| `PORT` | 服务端口 | `3000` | `3000` |
| `NODE_ENV` | 运行模式 | `development` | `production` |
| `APP_DOMAIN` | 前端域名 | `localhost:5173` | `yourdomain.com` |
| `JWT_SECRET` | JWT 签名密钥 | 开发环境默认值 | **必须更换** |
| `REDIS_URL` | Redis 连接串 | 开发环境用内存模拟 | `redis://...` |
| `DATABASE_URL` | 数据库连接 | `file:./dev.db` | `postgresql://...` |

### 加密密钥

| 变量 | 说明 | 要求 |
|------|------|------|
| `TOKEN_ENCRYPT_KEY` | 平台 Token 加密密钥 | **必须 32 位字符** |

### 阿里云 OSS

| 变量 | 说明 |
|------|------|
| `ALI_ACCESS_KEY_ID` | 阿里云 AccessKey ID |
| `ALI_ACCESS_KEY_SECRET` | 阿里云 AccessKey Secret |
| `ALI_OSS_REGION` | OSS Bucket 所在区域（如 `oss-cn-beijing`） |
| `ALI_OSS_BUCKET` | OSS Bucket 名称 |

### 开放平台

| 平台 | 变量名前缀 | 托管地址 |
|------|-----------|---------|
| 抖音 | `DOUYIN_` | https://open.douyin.com |
| 快手 | `KUAISHOU_` | https://open.kuaishou.com |
| B站 | `BILIBILI_` | https://openhome.bilibili.com |
| 微信 | `WX_COMPONENT_` | https://open.weixin.qq.com |

> 小红书不需要配置开放平台密钥，使用浏览器自动化方案。

### 支付

| 平台 | 变量名前缀 | 说明 |
|------|-----------|------|
| 支付宝 | `ALIPAY_` | 开发环境默认使用沙箱网关 |
| 微信支付 | `WX_` | APIv3，需要商户证书 |

---

## API 文档

### 鉴权

大部分接口需要 `Authorization: Bearer <token>` 请求头。

> 开发环境下未传 Token 自动使用 `dev_user` 用户，方便调试。

### 小红书登录管理

#### 获取登录状态

```
GET /api/platform/red/status
```

返回：
```json
{
  "platform": "RED",
  "loginStatus": "ok"   // ok | need_login | expired | unknown
}
```

#### 打开浏览器等待登录

```
POST /api/platform/red/login
```

返回后浏览器窗口已打开，用户在浏览器中完成登录后系统自动检测。

### 账号管理

#### 获取 OAuth 授权链接

```
GET /api/oauth/:platform/auth-url
```

平台：`douyin` `kuaishou` `bilibili` `wechat`

#### OAuth 回调（服务端中转）

```
POST /api/oauth/finalize
Content-Type: application/json

{
  "code": "授权码",
  "platform": "DOUYIN",
  "state": "状态参数（可选）"
}
```

#### 获取已绑定账号

```
GET /api/accounts
```

#### 解绑账号

```
DELETE /api/accounts/:id
```

### 视频分发

#### 获取 OSS 直传链接

```
GET /api/oss/upload-url?fileName=video.mp4&fileType=video/mp4
```

返回签名 URL，前端可直接 PUT 上传视频文件到阿里云 OSS。

#### 提交矩阵分发任务

```
POST /api/publish/matrix
Authorization: Bearer <token>
Content-Type: application/json

{
  "title": "视频标题",
  "description": "视频描述",
  "videoUrl": "https://oss-bucket.oss-cn-beijing.aliyuncs.com/videos/xxx.mp4",
  "accounts": [
    { "id": "account-id-1", "platform": "RED", "nickname": "昵称" },
    { "id": "account-id-2", "platform": "DOUYIN", "nickname": "昵称" }
  ]
}
```

### 支付

#### 创建支付宝订单

```
POST /api/v1/payment/create
```

#### 创建微信支付订单

```
POST /api/v1/payment/wechat/create
```

#### 查询订单状态

```
GET /api/v1/payment/status?orderId=xxx
```

### 数据看板

#### 获取数据趋势

```
GET /api/analytics/trend?days=7
```

返回按平台分组的每日播放/点赞/评论/分享数据，用于前端折线图。系统每 6 小时自动从各平台拉取最新数据。

---

## 生产部署

### 1. 编译

```bash
npm run build
```

### 2. 数据库

1. 修改 `prisma/schema.prisma` 的 provider 为 `postgresql`
2. 修改 `.env` 的 `DATABASE_URL` 为 PostgreSQL 连接串
3. 部署并配置 Redis，修改 `REDIS_URL`

### 3. 启动（PM2 集群）

```bash
npm install -g pm2
pm2 start ecosystem.config.js
```

`ecosystem.config.js` 已配置两个进程：

| 进程 | 角色 | 实例数 |
|------|------|--------|
| `matrix-api` | HTTP API 服务 | 2（cluster 模式） |
| `matrix-worker` | 队列消费者 | 1（fork 模式） |

### 4. Nginx 反向代理

```nginx
server {
    listen 443 ssl;
    server_name api.yourdomain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}
```

### 生产环境注意事项

- 小红书浏览器自动化需要服务器有桌面环境（或 Xvfb），纯 CLI 服务器无法使用 `headless: false`
- 生产环境建议将 Edge 浏览器配置为 `headless: true`（修改 `browserManager.ts`）
- 如需多人共用，小红书需切换到扫码登录或 Cookie 方式

---

## 朋友接入清单

### 基础（clone 即用）

- [x] **Node.js 18+ / npm**
- [x] **Microsoft Edge**（系统自带）
- [x] **克隆项目** `git clone ... && npm install`
- [ ] **配置 `.env`** — 至少设置 `JWT_SECRET` 和 `TOKEN_ENCRYPT_KEY`
- [ ] **初始化数据库** — `npx prisma generate && npx prisma db push`
- [ ] **启动前后端** — 两个终端分别跑 `npm run dev`

### 小红书（5 分钟搞定）

- [ ] **点「登录」按钮** — 前端绑定页 → 小红书卡片 → 登录
- [ ] **Edge 浏览器弹出来** — 扫码登录创作者中心
- [ ] **自动采集** — 登录后每 6 小时自动拉取数据

### 其他平台

- [ ] **阿里云 OSS** — 创建 Bucket，配 CORS，填入 `.env`
- [ ] **抖音开放平台** — 注册应用，获取 `DOUYIN_CLIENT_KEY/SECRET`
- [ ] **快手开放平台** — 注册应用，获取 `KUAISHOU_APP_ID/SECRET`
- [ ] **B站开放平台** — 注册应用，获取 `BILIBILI_CLIENT_ID/SECRET`
- [ ] **域名 + HTTPS** — 回调地址需要公网可访问

### 支付 / 生产（可选）

- [ ] 支付宝商户号 / 微信支付商户号
- [ ] PostgreSQL + Redis
- [ ] PM2 进程守护
- [ ] 更换密钥

---

## 开发指南

### 命令速查

```bash
npm run dev          # 启动后端开发服务（tsx watch）
npm run build        # 编译 TypeScript
npm start            # 启动编译后的生产版本
npx prisma generate  # 更新 Prisma Client
npx prisma db push   # 同步数据库表结构
npx prisma studio    # Prisma 数据库管理界面
```

### 添加新平台

1. 在 `src/adapters/` 下创建适配器文件，实现 `PlatformOAuthAdapter` 接口
2. 在 `oauth.router.controller.ts` 的 `adapterMap` 中注册
3. 在 `.env` 和 `.env.example` 中添加对应环境变量
4. 在 `prisma/schema.prisma` 的 Account 模型的 `platform` 枚举中添加新值

### 核心设计决策

| 决策 | 理由 |
|------|------|
| 开发环境零依赖 | SQLite + 内存 Redis + 内存队列，clone 即跑 |
| 适配器模式 | 统一 OAuth 流程，新增平台只需写一个 adapter 文件 |
| 队列解耦 | API 进程不阻塞，分发任务异步执行 |
| Token 加密存储 | 平台 Token 使用 AES-256-CBC 加密后入库 |
| dev_user fallback | 开发调试免登录，生产环境强制鉴权 |
| Edge CDP 方案 | 小红书创作者中心无可用 API，通过 Playwright + CDP 连接系统 Edge，DOM 提取指标 |
| 持久化 Profile | Edge 用户数据目录保存 localStorage，重启服务保持登录态 |

---

*Matrix Share SaaS — Built for creators, deployed by friends.*
