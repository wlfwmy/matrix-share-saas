# 改动说明

## 1. 代码修复（4 个文件）

- `src/services/transcoder.service.ts`
  - 修复 `-vf` 与 `-filter_complex` 混用导致 FFmpeg 报错的问题
  - 无音轨视频不再强制 `-map [a]` 崩溃
  - `setpts` / `atempo` 变速比统一，避免音画累积漂移
  - `drawtext` 转义补全（反斜杠、`%`）
  - 加 `-max_muxing_queue_size 9999`，规避高帧率素材下的 buffer 报错

- `src/queues/publish.queue.ts`
  - 支持透传 `jobId`，同一 `taskId` 重复提交会被去重，避免重复发布
  - `removeOnFail` 加了保留上限，避免 Redis 里失败任务无限堆积
  - `publishQueue` 兼容层的 Proxy 对 `.then` 显式返回 `undefined`，
    避免被误当成 thenable 触发诡异报错

- `src/queues/publish.worker.ts`
  - **最关键的修复**：catch 块最后重新 `throw error`，
    之前吞掉异常导致 BullMQ 配置的 `attempts: 3` + 指数退避完全不生效
  - 下载视频时同时监听可读流和可写流的 `error`，避免网络中断时
    未捕获异常打崩整个 worker 进程
  - 下载加 60s 超时，避免卡住占用并发槽
  - 未接入的平台会显式抛错而不是静默标记 `SUCCESS`——
    防止漏接平台时用户误以为视频已发布

- `src/utils/crypto.ts`
  - **⚠️ 破坏性变更**：从 AES-256-CBC 换成 AES-256-GCM（自带完整性校验，
    篡改密文会被检测到，而不是解出乱码或含糊报错）
  - `TOKEN_ENCRYPT_KEY` 不再有硬编码 fallback，缺失或长度不对时直接
    拒绝启动，而不是用公开仓库里写死的默认密钥"加密"

  **迁移注意**：密文格式从 `iv:ciphertext` 变成了 `iv:authTag:ciphertext`，
  数据库里用旧算法加密的历史 access_token 无法直接用新代码解密。上线前
  需要写一次性迁移脚本，用旧的 CBC 逻辑解出明文，再用新的 GCM 逻辑重新
  加密写回，或者让所有账号在切换后重新走一次 OAuth 绑定。

- `src/middleware/auth.ts`
  - **⚠️ 高优先级安全修复**：`JWT_SECRET` 去掉公开仓库里的硬编码 fallback，
    生产环境缺失时直接拒绝启动——之前的默认值已经在 GitHub 公开可见，
    等于任何人都能自己签发任意用户的登录 token
  - `dev_user` 免登录兜底不再只依赖 `NODE_ENV`，加了"`JWT_SECRET` 是否
    已配置"作为第二重判断，防止部署时漏设 `NODE_ENV=production` 导致
    生产环境所有未带 token 的请求被直接放行
  - `jwt.verify` 显式限定 `algorithms: ['HS256']`，避免算法混淆攻击
  - 补充 `payload.userId` 存在性校验

- `src/controllers/payment.controller.ts`（支付宝，已按你贴出的真实 schema 调整）
  - **⚠️ 最高优先级修复**：`createPayment` 下单前先把订单写入 `Order` 表
    （之前完全没有落库）。`Order.id` 本身就是订单号（同时作为传给支付宝
    的 `out_trade_no`），schema 里没有单独的 `outTradeNo` 字段
  - `Order` 表没有 `credits` 列，结算时按订单里的 `planId` 反查
    `PLAN_CONFIG` 得到该发多少 credits——**注意**：如果以后套餐价格/
    额度会调整，老订单结算时会用"现在"的 `PLAN_CONFIG`，而不是下单
    当时的配置。如果套餐权益可能变化，建议后续给 `Order` 加一个
    快照字段存下单时的 credits 数量，避免历史订单结算对不上
  - `handleAlipayNotify` 用两层幂等：先按支付宝的 `notify_id` 写入
    `WebhookEvent` 表（唯一约束冲突 = 这条通知已处理过），再按订单
    `status === 'PAID'` 做业务层幂等判断
  - 金额核对只信自己数据库记录的 `amount`，不单纯信任回调参数
  - 去掉 `userId || 'user_123456'` 的硬编码兜底

- `src/controllers/wx.payment.controller.ts`（微信支付，已按真实 schema 调整）
  - **⚠️ 最高优先级修复**：`handleWxPayNotify` 之前是完全空实现，现在补上
    签名验证（`pay.verifySign`）+ APIv3 密钥手动解密 `resource`（微信
    V3 回调体本身加密，不解密拿不到 `out_trade_no`）
  - 同样用 `WebhookEvent`（按微信回调 `body.id` 去重）+ 订单状态两层幂等
  - 金额核对时注意单位换算：`Order.amount` 是元，微信回调金额单位是分
  - `credits` 同样是从 `PLAN_CONFIG` 按 `planId` 反查，跟支付宝那边的
    快照问题一致

  **需要你确认的运行时细节（不是我能替你验证的）**：
  - 微信支付回调路由必须拿到**原始请求 body**才能正确验签，建议单独给
    这条路由挂 `express.raw({ type: 'application/json' })`，不要跟其他
    路由共用全局的 `express.json()` 中间件
  - `wechatpay-node-v3` 的 `verifySign` 方法签名、平台证书获取方式因
    库版本而异，务必对照你实际安装的版本文档核实调用方式，`certs: {}`
    这行部署前必须确认已经有可用的证书来源


## 2. 产品定位调整（README + 代码注释）

已按照"去重转码降级为辅助手段、核心卖点改为分发效率"的方向重写了
`README.md`，主要改动：

- 标题、功能表、流水线图示里的"去重转码 / 抗查重 / 规避平台查重"统一
  改成中性表述"视频格式标准化处理"
- 流水线说明后加了一句明确声明：**不对绕过任何平台检测机制作出承诺或
  保证**，把责任边界说清楚
- 新增「使用须知与风险提示」章节，写明平台合规责任在使用者、建议做
  差异化内容而非单纯格式转换、`TOKEN_ENCRYPT_KEY` 的保管要求
- 「朋友接入清单」改名「接入清单」（面向多客户场景，不再是朋友帮忙搭
  的语气），P0 里加了一条"阅读并遵守各平台开放平台协议中关于第三方
  工具、批量发布的相关条款"
- P2 里加了"补充用户协议/服务条款，明确责任边界"
- 代码里的中文日志/注释也同步做了措辞调整（如 worker 里的
  `[转码]` 替代 `[去重]`，transcoder 方法注释加了责任边界说明）

**这里没有改、也不该由我来改的部分**：真正的用户服务条款/协议文本、
是否要在营销物料/落地页上做类似调整、要不要针对具体平台的开放平台
协议条款做逐条合规审查——这些建议还是走公司法务流程，我这边只能把
代码和 README 层面的措辞先统一好。
