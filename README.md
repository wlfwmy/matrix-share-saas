# Matrix Share — 多平台短视频矩阵分发系统

一站式自媒体矩阵管理平台。绑定账号 → 上传视频 → 选择平台 → 一键分发。支持视频格式标准化处理、自动 Token 续期、数据看板。

## 目录

- [功能总览](#功能总览)
- [系统架构](#系统架构)
- [技术栈](#技术栈)
- [项目结构](#项目结构)
- [快速开始](#快速开始)
- [环境变量参考](#环境变量参考)
- [API 文档](#api-文档)
- [生产部署](#生产部署)
- [使用须知与风险提示](#使用须知与风险提示)
- [接入清单](#接入清单)
- [开发指南](#开发指南)

---

## 功能总览

### 核心功能

| 功能               | 说明                                                   |
| ---------------- | ---------------------------------------------------- |
| **多平台 OAuth 绑定** | 小红书 · 抖音 · 快手 · B站 · 微信视频号，标准 OAuth 2.0 授权流程         |
| **视频矩阵分发**       | 单次上传，同时分发到多个已绑定的平台账号                                 |
| **视频格式标准化处理**    | FFmpeg 流水线：统一编码、尺寸、水印等，产出适配各平台规范的标准化视频文件           |
| **Token 自动续期**   | 后台定时检查，自动刷新各平台 Access Token，无需人工干预                   |
| **数据看板**         | 发布记录、各平台播放数据趋势                                       |
| **支付系统**         | 支付宝 + 微信支付 APIv3，支持套餐购买                              |

### 平台支持

| 平台    | 接入方式     | 当前能力            |
| ----- | -------- | --------------- |
| 小红书   | 开放平台 API | OAuth 绑定 + 视频发布 |
| 抖音    | 开放平台 API | OAuth 绑定 + 视频发布 |
| 快手    | 开放平台 API | OAuth 绑定 + 视频发布 |
| B站    | 开放平台 API | OAuth 绑定 + 视频发布 |
| 微信视频号 | 第三方平台    | OAuth 绑定 + 视频发布 |

> 数据看板已支持自动采集抖音/B站/快手的数据（播放/点赞/评论/分享），每日定时拉取。小红书和微信暂无可用的公开数据 API。

### 视频处理流水线

```
原始视频
  │
  ├─ 1. 格式标准化裁剪      crop=in_w*0.99:in_h*0.99:in_w*0.005:in_h*0.005
  ├─ 2. 色彩微调             eq=contrast=1.01:brightness=0.005:saturation=1.01
  ├─ 3. 微旋转校正 0.28°     rotate=0.005
  ├─ 4. 半透明水印           drawtext=white@0.35
  ├─ 5. 视频速度微调         setpts=0.99*PTS
  └─ 6. 音频速度微调         atempo=1.01
       │
       └─ 标准化 H.264 + yuv420p + faststart 输出
```

这套处理流程用于统一多平台分发所需的视频编码格式与元信息，附带轻量的画面/音频微调作为常规视频处理的一部分。**是否符合各平台的内容规范与查重机制，最终取决于内容本身，本工具不对绕过任何平台检测机制作出承诺或保证。**

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
└─────────────────────────────────────────────────────────┘
```

---

## 技术栈

| 层级       | 技术                             | 开发环境           | 生产环境        |
| -------- | ------------------------------ | -------------- | ----------- |
| **前端**   | React 18 + Vite + Tailwind CSS | 同左             | 同左          |
| **后端**   | Node.js + Express + TypeScript | 同左             | 同左          |
| **数据库**  | Prisma ORM                     | SQLite（无需安装）   | PostgreSQL  |
| **队列**   | BullMQ                         | 内存队列（无需 Redis） | Redis       |
| **缓存**   | ioredis                        | 内存 Map 模拟      | Redis       |
| **存储**   | 阿里云 OSS                        | 同左             | 同左          |
| **视频处理** | fluent-ffmpeg + FFmpeg         | 同左             | 同左          |
| **支付**   | alipay-sdk + wechatpay-node-v3 | 沙箱模式           | 正式商户        |
| **进程管理** | —                              | tsx watch      | PM2 cluster |

---

## 项目结构

```
matrix-share-saas/
│
├── frontend/                    # React 前端
│   └── src/
│       ├── api/
│       │   └── client.ts        # Axios 封装 + 拦截器
│       ├── components/
│       │   ├── Layout.tsx       # 页面布局外壳
│       │   ├── PublishPanel.tsx # 发布面板（上传+选账号+分发）
│       │   └── AccountCard.tsx  # 账号卡片组件
│       └── pages/
│           ├── Publish.tsx      # 发布页
│           ├── Bind.tsx         # 账号绑定页
│           ├── Billing.tsx      # 充值页
│           ├── Dashboard.tsx    # 数据看板
│           └── OAuthCallback.tsx # OAuth 回调中转页
│
├── prisma/
│   └── schema.prisma            # 数据模型定义
│       ├── Account             # 平台账号
│       ├── PublishRecord       # 发布记录
│       ├── DailyAnalytics      # 每日数据聚合
│       └── Order               # 支付订单
│
├── src/
│   ├── adapters/                # 各平台 OAuth 适配器
│   │   ├── types.ts             # PlatformOAuthAdapter 接口定义
│   │   ├── red.adapter.ts       # 小红书
│   │   ├── douyin.adapter.ts    # 抖音
│   │   ├── kuaishou.adapter.ts  # 快手
│   │   ├── bilibili.adapter.ts  # B站
│   │   └── wechat.adapter.ts    # 微信视频号
│   │
│   ├── controllers/
│   │   ├── oauth.router.controller.ts  # 统一 OAuth 路由
│   │   ├── wx.oauth.controller.ts      # 微信第三方平台事件
│   │   ├── payment.controller.ts       # 支付宝支付
│   │   └── wx.payment.controller.ts    # 微信支付
│   │
│   ├── queues/
│   │   ├── publish.queue.ts    # 队列定义（dev=内存/prod=BullMQ）
│   │   └── publish.worker.ts   # 消费者（转码→发布）
│   │
│   ├── services/
│   │   ├── transcoder.service.ts   # FFmpeg 视频格式标准化处理
│   │   ├── tokenRefresher.ts       # Token 自动续期
│   │   ├── analytics.service.ts    # 数据统计服务
│   │   └── mock.service.ts         # 开发环境模拟发布
│   │
│   ├── middleware/
│   │   └── auth.ts              # JWT 鉴权中间件
│   │
│   ├── utils/
│   │   ├── prismaClient.ts      # Prisma 客户端单例
│   │   ├── redis.ts             # Redis 客户端（dev=内存模拟）
│   │   ├── crypto.ts            # Token 加解密（AES-256-GCM）
│   │   └── appError.ts          # 标准化错误类 + 错误处理器
│   │
│   └── index.ts                 # 应用入口 + 路由注册
│
├── .env.example                  # 环境变量模板（含注释）
├── ecosystem.config.js           # PM2 集群配置
├── README.md                     # 本文件
└── docs/
    └── operation-manual.md       # 操作手册
```

---

## 快速开始

### 前置条件

- Node.js 18+
- npm 9+
- FFmpeg（可选，开发环境使用模拟发布可跳过）

### 1. 安装依赖

```
# 后端
npm install

# 前端
cd frontend && npm install && cd ..
```

### 2. 配置环境变量

```
cp .env.example .env
```

编辑 `.env`，**必须**设置 `JWT_SECRET` 和 `TOKEN_ENCRYPT_KEY`（缺失或长度不为 32 字节时服务会拒绝启动），其余可在需要时配置。

### 3. 初始化数据库

```
# 生成 Prisma Client
npx prisma generate

# 创建数据库表（SQLite，无需安装数据库）
npx prisma db push
```

### 4. 启动开发服务

```
# 终端 1：后端（端口 3000）
npm run dev

# 终端 2：前端（端口 5173）
cd frontend && npm run dev
```

访问 <http://localhost:5173>
> 开发环境下，后端使用内存队列、内存 Redis 模拟、SQLite 数据库，无需安装 Redis 和 PostgreSQL。

---

## 环境变量参考

### 基础配置

| 变量             | 说明        | 开发默认值            | 生产环境               |
| -------------- | --------- | ---------------- | ------------------ |
| `PORT`         | 服务端口      | `3000`           | `3000`             |
| `NODE_ENV`     | 运行模式      | `development`    | `production`       |
| `APP_DOMAIN`   | 前端域名      | `localhost:5173` | `yourdomain.com`   |
| `JWT_SECRET`   | JWT 签名密钥  | 开发环境默认值          | **必须更换**           |
| `REDIS_URL`    | Redis 连接串 | 开发环境用内存模拟        | `redis://...`      |
| `DATABASE_URL` | 数据库连接     | `file:./dev.db`  | `postgresql://...` |

### 加密密钥

| 变量                  | 说明            | 要求                              |
| ------------------- | ------------- | ------------------------------- |
| `TOKEN_ENCRYPT_KEY` | 平台 Token 加密密钥 | **必须 32 字节**，缺失或长度不对时服务拒绝启动，无默认值 |

### 阿里云 OSS

| 变量                      | 说明                                  |
| ----------------------- | ----------------------------------- |
| `ALI_ACCESS_KEY_ID`     | 阿里云 AccessKey ID                    |
| `ALI_ACCESS_KEY_SECRET` | 阿里云 AccessKey Secret                |
| `ALI_OSS_REGION`        | OSS Bucket 所在区域（如 `oss-cn-beijing`） |
| `ALI_OSS_BUCKET`        | OSS Bucket 名称                       |

### 开放平台

| 平台  | 变量名前缀           | 托管地址                            |
| --- | --------------- | -------------------------------- |
| 小红书 | `RED_`          | <https://open.xiaohongshu.com>   |
| 抖音  | `DOUYIN_`       | <https://open.douyin.com>        |
| 快手  | `KUAISHOU_`     | <https://open.kuaishou.com>      |
| B站  | `BILIBILI_`     | <https://openhome.bilibili.com>  |
| 微信  | `WX_COMPONENT_` | <https://open.weixin.qq.com>     |

### 支付

| 平台   | 变量名前缀     | 说明           |
| ---- | --------- | ------------ |
| 支付宝  | `ALIPAY_` | 开发环境默认使用沙箱网关 |
| 微信支付 | `WX_`     | APIv3，需要商户证书 |

---

## API 文档

### 鉴权

大部分接口需要 `Authorization: Bearer <token>` 请求头。
> 开发环境下未传 Token 自动使用 `dev_user` 用户，方便调试。

### 账号管理

#### 获取 OAuth 授权链接

```
GET /api/oauth/:platform/auth-url
```

平台：`red` `douyin` `kuaishou` `bilibili` `wechat`

#### OAuth 回调（服务端中转）

```
POST /api/oauth/finalize
Content-Type: application/json

{
  "code": "授权码",
  "platform": "RED",
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

```
npm run build
```

### 2. 数据库

1. 修改 `prisma/schema.prisma` 的 provider 为 `postgresql`
2. 修改 `.env` 的 `DATABASE_URL` 为 PostgreSQL 连接串
3. 部署并配置 Redis，修改 `REDIS_URL`

### 3. 启动（PM2 集群）

```
npm install -g pm2
pm2 start ecosystem.config.js
```

`ecosystem.config.js` 已配置两个进程：

| 进程              | 角色          | 实例数           |
| --------------- | ----------- | ------------- |
| `matrix-api`    | HTTP API 服务 | 2（cluster 模式） |
| `matrix-worker` | 队列消费者       | 1（fork 模式）    |

### 4. Nginx 反向代理

```
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

---

## 使用须知与风险提示

本工具提供多平台账号绑定、内容分发、数据统计等能力，帮助用户提升多平台运营效率。使用本工具时请注意：

- **平台规则合规**：各平台（小红书、抖音、快手、B站、微信视频号）均有各自的开放平台协议与内容规范，是否符合规则、账号是否会因发布内容或使用第三方工具受到处罚，由使用者自行判断和承担，本工具不作出规避或绕过任何平台检测机制的承诺
- **内容质量建议**：不同平台的受众和推荐机制不同，建议针对各平台做有实质差异的标题、封面与剪辑，而非同一素材原样分发，长期运营效果通常优于单纯格式转换
- **账号安全**：Token 使用 AES-256-GCM 加密存储在数据库中；`TOKEN_ENCRYPT_KEY` 属于高敏感信息，务必妥善保管，不要提交到代码仓库
- **服务条款**：面向多用户提供服务前，建议补充用户协议/服务条款，明确工具提供方与使用者之间的责任边界

---

## 接入清单

以下是接入生产环境前需要完成的配置，按优先级排列：

### P0 — 核心必须

- [ ] **阿里云 OSS 配置**
  * 创建 OSS Bucket
  * 获取 AccessKey ID / Secret
  * 配置 CORS 允许前端直传
  * 填入 `.env` 的 `ALI_*` 字段

- [ ] **各平台开放平台注册**
  * 小红书、抖音、快手、B站、微信
  * 获取 Client ID / Secret
  * 配置回调 URL（需 HTTPS）
  * 阅读并遵守各平台开放平台协议中关于第三方工具、批量发布的相关条款

- [ ] **域名 + HTTPS**
  * 购买域名 / 备案
  * 配置 SSL 证书
  * Nginx 反向代理

### P1 — 支付

- [ ] **支付宝商户号**（可选，上付费套餐时必需）
- [ ] **微信支付商户号**（可选）

### P2 — 生产环境升级

- [ ] 部署 PostgreSQL（替换 SQLite）
- [ ] 部署 Redis（替换内存模拟）
- [ ] 更换 JWT_SECRET 和 TOKEN_ENCRYPT_KEY
- [ ] 配置 PM2 进程守护
- [ ] 补充用户协议/服务条款，明确责任边界

---

## 开发指南

### 命令速查

```
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

| 决策                 | 理由                                |
| ------------------ | --------------------------------- |
| 开发环境零依赖            | SQLite + 内存 Redis + 内存队列，clone 即跑 |
| 适配器模式              | 统一 OAuth 流程，新增平台只需写一个 adapter 文件  |
| 队列解耦               | API 进程不阻塞，分发任务异步执行                |
| Token 加密存储         | 平台 Token 使用 AES-256-GCM 加密后入库     |
| dev\_user fallback | 开发调试免登录，生产环境强制鉴权                  |

---

*Matrix Share SaaS — 多平台内容分发管理工具。*
