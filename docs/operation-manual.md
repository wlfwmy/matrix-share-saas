# Matrix Share SaaS — 操作手册

> 版本 1.0 | 面向部署者（你的朋友）的完整操作指南

---

## 目录

1. [系统概述](#1-系统概述)
2. [服务器环境准备](#2-服务器环境准备)
3. [阿里云 OSS 配置](#3-阿里云-oss-配置)
4. [各平台开放平台注册](#4-各平台开放平台注册)
5. [支付配置](#5-支付配置)
6. [生产环境部署](#6-生产环境部署)
7. [FFmpeg 去重流水线详解](#7-ffmpeg-去重流水线详解)
8. [队列与 Worker 系统](#8-队列与-worker-系统)
9. [Token 自动续期](#9-token-自动续期)
10. [日常运维](#10-日常运维)
11. [排错指南](#11-排错指南)

---

## 1. 系统概述

### 1.1 这是什么

Matrix Share 是一个**多平台短视频矩阵分发系统**，帮助创作者和管理者将一条视频同时发布到多个短视频平台的多个账号。

### 1.2 核心流程

```
用户上传视频 → OSS 存储 → 用户选择平台账号 → 提交分发任务
                                                    ↓
                                             任务队列（异步）
                                                    ↓
                    ┌───────────────────────────────────┐
                    │         Worker 处理流程            │
                    │                                   │
                    │  1. 从 OSS 下载视频到本地           │
                    │  2. FFmpeg 去重转码                 │
                    │  3. 上传转码后视频到 OSS            │
                    │  4. 调用平台 API 发布               │
                    │  5. 记录发布结果                    │
                    └───────────────────────────────────┘
```

### 1.3 两个进程

| 进程 | 职责 | 推荐实例数 |
|------|------|-----------|
| **API 服务** (`matrix-api`) | HTTP 请求处理：OAuth、账号管理、支付、OSS 签名 | 2（cluster） |
| **Worker** (`matrix-worker`) | 异步消费队列：转码、上传、发布 | 1 |

> 两个进程独立部署，通过 Redis / 数据库通信。API 进程收到分发请求后立即返回，Worker 在后台处理实际发布。

---

## 2. 服务器环境准备

### 2.1 最低配置

| 环境 | 配置 | 用途 |
|------|------|------|
| 开发 | 任意 Windows/Mac | 本地开发调试 |
| 生产 | 2C4G Linux 服务器 | 正式运行 |

### 2.2 安装依赖

```bash
# Node.js 18+（推荐使用 nvm）
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.0/install.sh | bash
nvm install 18

# FFmpeg（视频转码必需）
apt install ffmpeg -y           # Ubuntu/Debian
yum install ffmpeg -y           # CentOS/RHEL

# PM2 进程管理
npm install -g pm2

# Redis
apt install redis-server -y     # Ubuntu/Debian
```

### 2.3 FFmpeg 验证

```bash
ffmpeg -version
# 确认输出包含 libx264 编码器支持
```

---

## 3. 阿里云 OSS 配置

视频文件通过前端直传到 OSS，Worker 从 OSS 下载处理后回传。

### 3.1 创建 Bucket

1. 登录[阿里云 OSS 控制台](https://oss.console.aliyun.com)
2. 创建 Bucket：
   - **区域**：选择离你最近的（如 `oss-cn-beijing`）
   - **读写权限**：`私有`（后续通过签名 URL 访问）
   - **版本控制**：建议关闭

### 3.2 创建 RAM 用户

1. 登录[RAM 控制台](https://ram.console.aliyun.com)
2. 创建用户 → 勾选"OpenAPI 调用访问"
3. 保存 **AccessKey ID** 和 **AccessKey Secret**
4. 添加权限策略：`AliyunOSSFullAccess`

### 3.3 配置 CORS

在 OSS Bucket 的「权限管理 → 跨域设置」中添加：

| 项 | 值 |
|------|------|
| 来源 | `https://你的前端域名`（开发: `http://localhost:5173`） |
| 允许 Methods | PUT |
| 允许 Headers | `*` |

### 3.4 配置到 .env

```ini
ALI_ACCESS_KEY_ID=LTAI5txxxxxxxxx
ALI_ACCESS_KEY_SECRET=xxxxxxxx
ALI_OSS_REGION=oss-cn-beijing
ALI_OSS_BUCKET=your-bucket-name
```

---

## 4. 各平台开放平台注册

### 4.1 通用步骤

所有平台的注册流程类似：

1. 注册开发者账号（通常需要企业资质或实名认证）
2. 创建应用，选择需要的 API 权限
3. 配置 OAuth 回调 URL
4. 获取 Client ID / App ID 和 Client Secret / App Secret
5. 填入 `.env` 对应字段

> 回调 URL 必须使用 HTTPS（本地开发可用 `localhost` 跳过此限制）。

### 4.2 小红书

| 项目 | 值 |
|------|-----|
| 注册地址 | https://open.xiaohongshu.com |
| 回调 URL 示例 | `https://api.yourdomain.com/api/oauth/red/callback` |
| 环境变量 | `RED_CLIENT_ID`, `RED_CLIENT_SECRET`, `RED_REDIRECT_URI` |

注意点：
- 小红书需要企业资质才能申请开放平台
- 视频发布权限需要额外申请
- Access Token 有效期 7 天，系统会自动续期

### 4.3 抖音

| 项目 | 值 |
|------|-----|
| 注册地址 | https://open.douyin.com |
| 回调 URL 示例 | `https://api.yourdomain.com/api/oauth/douyin/callback` |
| 环境变量 | `DOUYIN_CLIENT_KEY`, `DOUYIN_CLIENT_SECRET`, `DOUYIN_REDIRECT_URI` |

注意点：
- 抖音开放平台区分"移动应用"和"网站应用"，选网站应用
- 需要申请 `video.create` 和 `video.data` 权限
- Client Key 对应 `CLIENT_KEY`（不是 App ID）

### 4.4 快手

| 项目 | 值 |
|------|-----|
| 注册地址 | https://open.kuaishou.com |
| 回调 URL 示例 | `https://api.yourdomain.com/api/oauth/kuaishou/callback` |
| 环境变量 | `KUAISHOU_APP_ID`, `KUAISHOU_APP_SECRET`, `KUAISHOU_REDIRECT_URI` |

注意点：
- 快手使用 App ID + App Secret 而非 Client ID
- 视频上传需要先申请上传权限

### 4.5 B站

| 项目 | 值 |
|------|-----|
| 注册地址 | https://openhome.bilibili.com |
| 回调 URL 示例 | `https://api.yourdomain.com/api/oauth/bilibili/callback` |
| 环境变量 | `BILIBILI_CLIENT_ID`, `BILIBILI_CLIENT_SECRET`, `BILIBILI_REDIRECT_URI` |

注意点：
- B站开放平台需要企业资质
- 视频发布需要 `video.upload` 权限

### 4.6 微信视频号（第三方平台）

微信视频号的接入方式比较特殊，使用**微信开放平台（第三方平台）**模式，而非标准 OAuth：

| 项目 | 值 |
|------|-----|
| 注册地址 | https://open.weixin.qq.com |
| 授权事件接收 URL | `https://api.yourdomain.com/v1/weixin/open/event/authorize` |
| 环境变量 | `WX_COMPONENT_APPID`, `WX_COMPONENT_APPSECRET`, `WX_COMPONENT_TOKEN`, `WX_COMPONENT_AES_KEY` |

配置步骤：
1. 在微信开放平台注册为"第三方平台"
2. 创建平台后，获取 Component AppID 和 Component AppSecret
3. 在开发配置中设置：
   - **授权事件接收 URL**：指向 `/v1/weixin/open/event/authorize`
   - **消息校验 Token**：自定义，填入 `WX_COMPONENT_TOKEN`
   - **消息加解密 Key**：生成 43 位字符，填入 `WX_COMPONENT_AES_KEY`
4. 全网发布后，第三方平台才正式生效
5. 视频号发布权限需要在功能插件中申请

微信第三方平台的流程更复杂，涉及 ticket 推送、component_access_token、预授权码等。系统已完整实现这些流程，只需要正确配置即可。

---

## 5. 支付配置

### 5.1 支付宝

#### 沙箱环境（开发调试）

`.env` 默认使用支付宝沙箱网关，无需真实商户号即可测试：

```ini
ALIPAY_GATEWAY=https://openapi-sandbox.dl.alipaydev.com/gateway.do
```

1. 登录[支付宝沙箱应用](https://open.alipay.com/develop/sandbox)
2. 获取 APP_ID
3. 生成 RSA 密钥对（工具：支付宝开放平台助手）
4. 将公钥上传到沙箱应用配置，私钥填入 `ALIPAY_PRIVATE_KEY`

> 沙箱买家账号在支付宝沙箱页面中可以找到，用于测试支付。

#### 正式环境

1. 企业资质申请支付宝商户号
2. 创建应用，签约"电脑网站支付"和"手机网站支付"
3. 配置 RSA 密钥（与沙箱密钥不同，需重新生成）
4. 配置回调 URL 和通知 URL
5. 修改 `ALIPAY_GATEWAY` 为正式网关

### 5.2 微信支付

微信支付使用 APIv3 协议：

```ini
WX_MCH_ID=你的商户号
WX_MCH_SERIAL_NO=商户证书序列号
WX_API_V3_KEY=APIv3 密钥（32位）
WX_PRIVATE_KEY=商户私钥（PEM 格式）
```

配置步骤：
1. 微信支付商户平台 → 账户中心 → API 安全
2. 申请 APIv3 密钥（设置一个 32 位随机字符串）
3. 生成并上传商户证书
4. 将证书对应的私钥填入 `WX_PRIVATE_KEY`

> 开发环境下，如果 `WX_MCH_ID` 等配置为占位符，系统会自动返回模拟二维码，方便开发调试。

---

## 6. 生产环境部署

### 6.1 编译项目

```bash
# 安装依赖
npm install
cd frontend && npm install && cd ..

# 编译后端 TypeScript
npm run build

# 构建前端
cd frontend && npm run build && cd ..
```

### 6.2 切换数据库

开发环境使用 SQLite，生产环境切换到 PostgreSQL：

1. 编辑 `prisma/schema.prisma`，将 `provider = "sqlite"` 改为 `provider = "postgresql"`
2. 修改 `.env`：
   ```ini
   DATABASE_URL="postgresql://user:password@localhost:5432/matrix_share"
   ```
3. 初始化数据库：
   ```bash
   npx prisma generate
   npx prisma db push
   ```

### 6.3 启动服务

使用 PM2 进程管理，配置文件 `ecosystem.config.js`：

```bash
# 启动所有进程
pm2 start ecosystem.config.js

# 查看状态
pm2 status

# 查看日志
pm2 logs matrix-api
pm2 logs matrix-worker

# 重启
pm2 restart ecosystem.config.js

# 设置开机自启
pm2 startup
pm2 save
```

### 6.4 Nginx 配置

```nginx
# API 反向代理
server {
    listen 443 ssl;
    server_name api.yourdomain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    # 如果有文件上传限制，调整大小
    client_max_body_size 500m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
    }
}

# 前端静态文件
server {
    listen 443 ssl;
    server_name yourdomain.com;

    ssl_certificate /path/to/cert.pem;
    ssl_certificate_key /path/to/key.pem;

    root /path/to/frontend/dist;
    index index.html;

    location / {
        try_files $uri $uri/ /index.html;
    }
}
```

### 6.5 HTTPS / SSL 证书

推荐使用 Let's Encrypt 免费证书：

```bash
apt install certbot -y
certbot --nginx -d api.yourdomain.com -d yourdomain.com
```

---

## 7. FFmpeg 去重流水线详解

### 7.1 为什么需要去重

短视频平台对重复内容会进行查重（MD5 比对 + 感知哈希 + 特征指纹），相同视频重复发布会被限流。去重转码的目的就是在 **保持人眼观感不变** 的前提下，改变视频的底层特征。

### 7.2 基础转码（标准输出）

```bash
ffmpeg -i input.mp4 \
  -c:v libx264 -crf 23 -preset veryfast \
  -c:a aac \
  -pix_fmt yuv420p \
  -movflags +faststart \
  -vf "scale='min(1080,iw)':-2" \
  output.mp4
```

这步做了：
- 编码标准化为 H.264 + AAC
- 像素格式统一为 yuv420p（最广泛兼容）
- 添加 faststart 标记（支持边下边播）
- 缩放至 1080p

### 7.3 深度去重管道（Ant-Deduplication）

```bash
ffmpeg -i input.mp4 \
  -c:v libx264 -crf 23 -preset veryfast \
  -c:a aac \
  -pix_fmt yuv420p \
  -movflags +faststart \
  -vf "
    crop=in_w*0.99:in_h*0.99:in_w*0.005:in_h*0.005,
    eq=contrast=1.01:brightness=0.005:saturation=1.01,
    rotate=0.005:ow=rotw(0.005):oh=roth(0.005),
    drawtext=text='@账号昵称':x=30:y=30:fontsize=24:fontcolor=white@0.35
  " \
  -filter_complex "[0:v]setpts=0.99*PTS[v];[0:a]atempo=1.01[a]" \
  -map [v] -map [a] \
  output.mp4
```

### 7.4 每项改动的作用

| 步骤 | 参数 | 影响 | 反查重效果 |
|------|------|------|-----------|
| 微裁剪 1% | `crop=in_w*0.99` | 裁掉边缘 0.5% | 消除边缘像素指纹 |
| 色彩微调 | `eq=contrast=1.01` | 人眼不可察觉 | 改变色彩直方图 |
| 极微旋转 | `rotate=0.005` | 约 0.28°，无黑边 | 改变像素坐标指纹 |
| 半透明水印 | `fontcolor=white@0.35` | 隐约可见但无干扰 | 增加专属特征 |
| 视频加速 1% | `setpts=0.99*PTS` | 10 分钟视频快 ~6 秒 | 改变时间戳指纹 |
| 音频减速 1% | `atempo=1.01` | 与人声同步匹配 | 改变音频指纹 |

> 这些参数经过测试，单步改动人眼几乎无法察觉，叠加后综合特征已完全改变。

---

## 8. 队列与 Worker 系统

### 8.1 架构

```
API 进程                            Worker 进程
  │                                    │
  │  收到分发请求                       │
  │  (POST /api/publish/matrix)         │
  │                                    │
  ├─ 创建 N 个任务（每个账号一个）       │
  ├─ 任务放入队列                       │
  └─ 返回 200 OK 给前端                │
       │                               │
       ▼                               │
  ┌──────────┐                         │
  │  队列     │ ◄──────────────────── 等待
  │  (Redis)  │                        │
  └──────────┘                         │
       │                               │
       ▼                               │
  ┌──────────┐                         │
  │ Worker   │ ── 取出下一个任务        │
  └──────────┘                         │
       │                               │
       ├─ 1. 从 OSS 下载视频           │
       ├─ 2. FFmpeg 去重转码           │
       ├─ 3. 上传转码后视频到 OSS      │
       ├─ 4. 调用平台 API 发布         │
       └─ 5. 记录 PublishRecord        │
```

### 8.2 开发环境（零依赖）

开发模式下无需 Redis，使用内存队列（`DevQueue`）：

- `publish.queue.ts` 根据 `NODE_ENV` 自动选择实现
- Worker 使用 `MockSocialMediaService` 模拟发布（1.5s 上传 + 1.5s 发布，90% 成功率）
- 无需 OSS、无需 Redis、无需真实平台密钥，即可完整测试流程

### 8.3 任务数据格式

```typescript
interface PublishJobData {
  taskId: string;
  userId: string;
  accountId: string;
  platform: string;
  title: string;
  description: string;
  videoUrl: string;
  watermarkText?: string;
}
```

### 8.4 任务队列可视化

生产环境开启 Bull Board（需 Redis），访问 `https://api.yourdomain.com/admin/queues` 可查看：

- 待处理任务数
- 处理中的任务
- 失败任务（含错误信息）
- 重试/删除任务

---

## 9. Token 自动续期

### 9.1 为什么需要

各平台的 Access Token 有时效：

| 平台 | Token 有效期 |
|------|-------------|
| 小红书 | 7 天 |
| 抖音 | 一般 30 天 |
| 快手 | 一般 30 天 |
| B站 | 一般 30 天 |
| 微信 | 视配置而定 |

如果不续期，Token 过期后发布接口会返回 401 错误。

### 9.2 续期机制

`src/services/tokenRefresher.ts` 实现：

- 每隔 **30 分钟** 检查一次
- 查询所有 `expiresAt < 当前时间 + 1天` 的账号
- 使用各 adapter 的 `refreshToken()` 方法刷新
- 新 Token 加密后更新到数据库
- 失败不重试（下次检查周期继续尝试）

### 9.3 启动方式

应用启动时自动调用 `startTokenRefresher()`，无需额外配置。

---

## 10. 日常运维

### 10.1 健康检查

```bash
# 检查服务是否正常运行
curl https://api.yourdomain.com/api/accounts

# 检查 PM2 状态
pm2 status

# 检查系统资源
htop
```

### 10.2 日志查看

```bash
# API 日志
pm2 logs matrix-api --lines 100

# Worker 日志
pm2 logs matrix-worker --lines 100

# 合并日志
pm2 logs --lines 50
```

日志文件位于 `logs/` 目录，按日期轮转。

### 10.3 数据库备份

```bash
# SQLite（开发环境）
cp dev.db backup/$(date +%Y%m%d).db

# PostgreSQL（生产环境）
pg_dump matrix_share > backup/$(date +%Y%m%d).sql
```

### 10.4 安全事项

| 事项 | 说明 |
|------|------|
| `.env` 文件 | **永远不要**提交到 Git，包含所有密钥 |
| `JWT_SECRET` | 生产环境必须更换为强随机字符串 |
| `TOKEN_ENCRYPT_KEY` | 生产环境必须更换，且**必须 32 位** |
| 平台 Token | 数据库中加密存储（AES-256-CBC） |
| HTTPS | 生产环境强制使用 |
| 开放平台回调 URL | 只在备案域名下使用 |

---

## 11. 排错指南

### 11.1 后端启动失败

**症状**：`npm run dev` 报错退出

**排查**：
```bash
# 1. 检查端口被占用
netstat -an | findstr :3000   # Windows
lsof -i :3000                 # Linux

# 2. 检查 Prisma 客户端是否生成
npx prisma generate

# 3. 检查数据库文件权限
ls -la dev.db

# 4. 检查 TypeScript 编译
npx tsc --noEmit
```

### 11.2 OAuth 回调失败

**症状**：绑定平台账号时跳转后报错

**排查**：
1. 检查回调 URL 是否与平台配置完全一致（包括末尾 `/`）
2. 检查 `.env` 中的 `CLIENT_ID` / `SECRET` 是否正确
3. 检查平台应用的 API 权限是否已申请
4. 如果是微信，检查 ticket 推送接口是否可访问
5. 查看后端日志中具体的错误信息

### 11.3 发布任务失败

**症状**：任务提交成功但视频未发布

**排查**：
1. 查看 Worker 日志：`pm2 logs matrix-worker`
2. 检查 OSS 配置：Worker 需要从 OSS 下载并上传视频
3. 检查 Token 是否过期：数据库中的 `expiresAt` 字段
4. 检查平台 API 返回的错误信息
5. 确定平台账号的视频发布权限是否已开通

### 11.4 FFmpeg 转码失败

**症状**：Worker 日志中提示 FFmpeg 错误

**排查**：
```bash
# 1. 确认 FFmpeg 已安装
ffmpeg -version

# 2. 确认 libx264 编码器支持
ffmpeg -encoders | grep libx264

# 3. 手动测试转码
ffmpeg -i test.mp4 -c:v libx264 -c:a aac output.mp4
```

常见 FFmpeg 问题：
- **输入文件损坏**：从 OSS 下载不完整 → 检查网络和文件大小
- **编码器不支持**：FFmpeg 未编译 libx264 → 重新安装 FFmpeg
- **内存不足**：大文件转码耗内存 → 检查服务器内存

### 11.5 支付宝支付问题

**症状**：创建订单或支付回调失败

**排查**：
1. 确认使用正确的公私钥（沙箱和正式环境密钥不同）
2. 检查通知 URL 是否公网可访问（支付宝回调必须是公网可达的 HTTPS）
3. 调试模式默认使用沙箱网关，正式环境需切换

### 11.6 微信支付问题

**症状**：创建订单或支付回调失败

**排查**：
1. 检查商户号是否正确
2. 确认 APIv3 密钥已设置（不是 APIv2 密钥）
3. 确认商户证书和私钥匹配
4. 开发环境下如果配置为占位符，会返回模拟二维码，不实际扣款

### 11.7 数据库问题

**症状**：查询报错或数据异常

**排查**：
```bash
# 1. 重新生成 Prisma Client
npx prisma generate

# 2. 同步数据库结构
npx prisma db push

# 3. 使用 Prisma Studio 查看数据
npx prisma studio
```

---

> *如遇未涵盖的问题，查看后端日志中的错误堆栈是最直接的排查方式。日志会输出 FFmpeg 命令、平台 API 请求参数和响应、队列任务状态等详细信息。*
