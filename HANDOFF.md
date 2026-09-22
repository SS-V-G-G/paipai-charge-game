# 拍拍蓄项目交接文档

最后更新：2026-09-22

## 1. 项目概览

拍拍蓄是一个支持 2—10 人联机及 1v1 人机对战的同步回合制网页卡牌游戏。玩家每回合秘密选择一张牌及其目标，所有存活玩家提交后由服务器统一公开并结算。

- 生产地址：https://paipai-charge-game.onrender.com
- GitHub：https://github.com/SS-V-G-G/paipai-charge-game
- 技术栈：React、TypeScript、Vite、Node.js、Express、Socket.IO、PostgreSQL
- 部署：Render Blueprint，单个 Node.js Web Service 与一个 PostgreSQL 数据库

规则引擎、AI 和服务器均使用 TypeScript。服务端是唯一权威状态源；客户端只提交动作，不决定伤害、资源或胜负。

## 2. 快速开始

要求 Node.js 22—24。

```bash
npm install
npm run dev
```

- 网页开发服务器：http://localhost:5173
- 游戏服务器：http://localhost:3001
- Vite 会将 API 与 Socket.IO 请求代理至 3001 端口。

生产方式运行：

```bash
npm run build
npm start
```

环境变量参考 `.env.example`：

- `PORT`：Node.js 监听端口，默认 3001。
- `NODE_ENV`：生产环境设为 `production`，服务器才会托管 `dist/client`。
- `CLIENT_ORIGIN`：前后端分离时允许的网页来源；同源部署可以不填。
- `DATABASE_URL`：PostgreSQL 连接地址。不要提交真实地址到 Git。
- `BASIC_AI_MODEL_PATH`：可选，覆盖基础 AI 模型路径；默认读取 `models/styled-policy-v2-10k.json`。

## 3. 代码结构

```text
src/                    React 网页与牌桌 UI
server/index.ts         房间、Socket.IO、回合时序、人机模式
server/database.ts      PostgreSQL 初始化、匿名回放存储与诊断查询
server/trained-policy.ts 生产训练模型的加载、风格选择与回退
shared/cards.ts         卡牌定义和分类
shared/engine.ts        确定性规则结算引擎
shared/rps.ts           鄙视猜拳规则
shared/bot.ts           基础搜索 AI 与地狱 AI
shared/training.ts      训练样本、局面编码、奖励和策略选择
scripts/                自博弈、回放转换、训练、评估和导出脚本
tests/                  规则、AI、数据库及联机冒烟测试
models/                 经过评估并允许部署的生产模型
render.yaml             Render Web Service 与 PostgreSQL Blueprint
```

## 4. 必须保持的规则与数据约束

1. 每回合每名存活玩家只能提交一次卡牌操作；所有人提交后同时亮牌。
2. 客户端不能计算或覆盖胜负。所有操作必须先通过 `validateAction`，再由服务端调用规则引擎。
3. 给定相同初始状态、座位顺序、种子、逐轮动作和猜拳提交，结算结果必须完全相同。
4. 全场攻击必须参与互攻对撞：大伤害压掉小伤害，相同伤害抵消。
5. 普通回合所有存活玩家同时死亡时判为平局；鄙视猜拳具有自己的特殊胜负规则。
6. 地狱 AI 在真人提交后才选择动作，并在猜拳时后手克制；界面不提示其暗牌读取机制。
7. 地狱 AI 对局不得写入 PostgreSQL，也不得进入训练集。
8. 训练数据库只保存匿名座位、动作和规则状态；不得保存昵称、房间码、重连凭证、IP 或其他个人信息。

## 5. AI 模式

### 基础 AI

normal 难度优先使用 `models/styled-policy-v2-10k.json`。每局通过牌局种子选择均衡、进攻、防守、经济、技巧或混沌风格。局面或动作样本不足、收益优势不够显著、模型缺失或版本不匹配时，自动回退 `shared/bot.ts` 中的搜索策略。

生产模型必须满足：

- `schemaVersion` 与 `TRAINING_SCHEMA_VERSION` 一致；
- `rulesVersion` 与当前规则引擎一致；
- 使用独立种子评估，不得只报告训练集成绩；
- 候选策略没有通过评估时，不覆盖当前生产模型。

### 地狱 AI

地狱 AI 会读取真人已经提交但尚未公开的动作，枚举自身全部合法行动并选择最佳后手；猜拳同样后手选择克制项。它仍然必须提交规则允许的卡牌，不能直接修改生命、蓄或胜负。

## 6. 本地训练完整流程

### 6.1 数据来源

训练支持两类数据：

1. Render PostgreSQL 中的匿名真人/基础 AI 回放；
2. 本地带探索率和风格采样的自博弈回放。

地狱 AI 对局不保存，也不允许混入公平信息策略训练。

### 6.2 下载并转换线上回放

```bash
npm run training:download -- https://paipai-charge-game.onrender.com training-data/render-replays.jsonl
npm run training:convert -- training-data/render-replays.jsonl training-data/render-training.jsonl
```

`training:download` 从公开匿名诊断接口分批读取回放；`training:convert` 只保留当前规则版本可重建的 1v1 决策，并转换为统一训练格式。

如需直接从数据库导出，可配置本地 `DATABASE_URL` 后执行：

```bash
npm run export:training > training-data/database-export.jsonl
```

不要将包含连接地址的命令历史、`.env` 或数据库备份提交到仓库。

### 6.3 生成自博弈数据

```bash
npm run training:generate -- 1000 training-data/self-play-v1.jsonl 0.40 60
```

参数依次为：对局数、输出文件、探索率、每局最大回合数。自博弈双方会独立抽取策略风格，探索动作始终从规则引擎认可的合法动作中选择。

大规模训练示例：

```bash
npm run training:generate -- 10000 training-data/self-play-10k.jsonl 0.40 80
```

### 6.4 训练候选策略

```bash
npm run training:train -- "training-data/self-play-v1.jsonl,training-data/render-training.jsonl" models/combined-policy-v1.json
```

训练器使用逐决策 Monte Carlo 收益，按“风格 + 蓄量区间 + 限次牌 + 免费大枪 + 金鸡独立 + 占星术 + 最近公开动作”建立表格策略。训练时会跳过规则版本不一致的数据。

### 6.5 离线评估

```bash
npm run training:evaluate -- models/combined-policy-v1.json 500 80
```

参数依次为：候选模型、评估局数、最大回合数。评估使用训练集之外的种子，并交换双方座位。至少检查：

- 对当前 normal AI 的胜率；
- 平局率和超时率；
- 双方交换座位后是否存在明显先后手偏差；
- 每种风格是否都能加载并提交合法动作；
- 规则版本和模型格式是否匹配。

### 6.6 晋升生产模型

只有评估通过后才执行：

1. 将候选模型复制为新的稳定文件名，例如 `models/styled-policy-v3-20k.json`；
2. 更新 `server/trained-policy.ts` 中的默认路径与 `TRAINED_BOT_STRATEGY_VERSION`；
3. 更新 `.gitignore` 的模型白名单和 `Dockerfile` 的模型复制路径；
4. 执行完整检查：

```bash
npm run check
npm test
npm run build
npm run smoke:bot
```

5. 本地以生产模式启动，并确认 `/api/health` 中 `trainedPolicy.loaded` 为 `true`；
6. 提交模型、版本号及评估摘要，再部署到 Render。

### 6.7 训练文件管理

- `training-data/*.jsonl` 默认被 Git 忽略，避免把大量原始回放提交到公共仓库。
- 普通 `models/*.json` 默认忽略，只对白名单中的生产模型例外。
- 当前生产模型为 `models/styled-policy-v2-10k.json`。
- 训练可在普通本地电脑上运行，当前实现不依赖 GPU。
- PostgreSQL 仅负责积累匿名回放，训练和评估都在本地离线执行。

## 7. 测试与发布检查

每次修改规则、AI 或网络时至少执行：

```bash
npm run check
npm test
npm run build
```

启动生产服务器后再执行：

```bash
npm run smoke:bot
npm run smoke:hell
npm run smoke:rps
node tests/smoke-multiplayer.mjs
```

有 `DATABASE_URL` 时额外执行 `npm run smoke:training`。地狱 AI 冒烟测试前后，数据库对局数应保持不变。

## 8. 部署

`render.yaml` 会创建：

- 免费 Node.js Web Service `paipai-charge-game`；
- 免费 PostgreSQL `paipai-charge-training-db`；
- 自动注入数据库内部连接地址。

Render 跟踪 GitHub `main` 分支并自动部署。生产启动流程为：

```bash
npm ci --include=dev
npm run build
npm start
```

免费 Web Service 会休眠，首次访问可能需要等待唤醒。免费 PostgreSQL 有容量、期限和备份限制；到期前应使用 `export:training` 导出匿名数据并迁移。

## 9. 已知限制与后续优先级

1. 房间保存在单进程内存中，服务重启后进行中的房间会消失。
2. 暂无账号、战绩页、观战和好友系统。
3. 多实例部署前需要 Redis 和 Socket.IO Redis Adapter。
4. 训练模型是表格策略，不具备深度网络的跨局面泛化能力。
5. 地狱 AI 是规则内的全知后手模式，不代表所有可达状态已经获得形式化的 100% 必胜证明。
6. 修改卡牌定义或结算规则后必须提升规则版本，并重新转换、训练和评估模型。

## 10. 安全与公开仓库注意事项

- 仓库不包含真实 `.env`、数据库连接串、API 密钥或用户身份信息。
- 不要提交 Render 的外部数据库 URL、GitHub Token 或重连凭证。
- 公开诊断接口只应返回匿名回放；增加新字段前先检查是否可能识别玩家。
- 若未来加入账号系统，应将认证、权限和数据保留策略单独设计，不要复用当前重连令牌作为长期账号凭据。
