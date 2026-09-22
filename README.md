# 拍拍蓄网页游戏

基于 React、TypeScript、Node.js 和 Socket.IO 的同步回合制联机版本。当前版本支持基础策略 AI 人机1v1、2—10 人房间、秘密出牌、统一公开、服务器权威结算、自动回合超时和断线重连。

规则引擎采用确定性结算：给定相同的初始状态、玩家顺序、出牌提交和猜拳提交，最终状态及事件日志完全一致，可据此保存输入并完整重放牌局。房间码、连接令牌等网络标识不属于规则结算的一部分。

全场攻击会与指向使用者的攻击参与互攻：大伤害压掉小伤害、相同伤害抵消。1v1中，鄙视目标本轮使用耗蓄牌时进入隐藏猜拳；平局继续，鄙视方赢则本局平局，鄙视方输则目标获胜。除此之外不产生平局，普通结算全灭时该回合作废并重新出牌。

“拉”无需指定目标并检查全场其他玩家：任一人出蓄时清空使用者生命（金鸡独立免疫）；无人出蓄时，每个小反提供6蓄、每个大反提供12蓄；若蓄、小反、大反均无人使用，则获得3蓄。

## 本地运行

```bash
npm install
npm run dev
```

打开 `http://localhost:5173`。开发模式下，Vite 会把 API 和 Socket.IO 请求代理到 `http://localhost:3001`。

## 生产运行

```bash
npm run build
npm start
```

默认监听 `3001` 端口，并由同一个 Node.js 进程提供网页、API 和 Socket.IO 服务。

## 自动检查

```bash
npm run check
npm test
node tests/smoke-multiplayer.mjs
node tests/smoke-bot.mjs
node tests/smoke-rps.mjs
node tests/smoke-training.mjs
```

- `npm run check`：检查前端、规则引擎和服务器类型。
- `npm test`：执行核心规则测试。
- `smoke-multiplayer.mjs`：启动两个真实 Socket.IO 客户端，验证创建房间、准备、开始、出牌和同步结算。
- `smoke-bot.mjs`：验证人机房间、AI自动加入、暗牌隔离、AI出牌和回合重放记录。
- `smoke-rps.mjs`：验证鄙视猜拳的隐藏提交、平局重开、鄙视方赢时特殊平局以及鄙视方输时目标获胜。
- `smoke-training.mjs`：完成一局两回合牌局并确认 PostgreSQL 的匿名训练记录数增加。

## 基础策略 AI

人机模式的 AI 在服务端运行。每轮开始时，它会枚举双方全部合法动作，并使用正式规则引擎预演一轮结果，再根据胜负、蓄量、免费大枪、特殊状态和有限牌库存评分。AI只接收公开房间状态，不读取真人当前回合的隐藏提交。

AI选择由房间的 `botSeed`、回合编号和策略版本共同确定。每局的 `actionHistory` 保存双方逐轮动作，因此相同状态、种子和策略版本可完全重放。

可以运行 `npm run self-play -- 100 100 normal normal` 进行100局、每局最多100回合的无人自博弈评估。该命令用于检查胜率、平均回合、超时率和常用牌，是后续训练策略参数的基线工具。

## 匿名训练数据库

设置 `DATABASE_URL` 后，服务器会自动创建 `training_games` 表。每局完成时保存规则版本、AI版本、匿名座位、随机种子、逐回合动作、逐次猜拳、最终状态和胜负。数据库不保存昵称、房间码、重连凭证或IP地址；数据库暂时不可用时不会影响正常游戏。

- `GET /api/training/stats`：返回已保存对局数、总回合数和数据库实际占用。
- `GET /api/training/diagnostics?card=contempt&mode=human-vs-bot`：读取包含指定卡牌的匿名回放；也可使用 `outcome=draw` 筛选平局。
- `npm run export:training`：读取 `DATABASE_URL` 并将训练记录以 JSONL 输出到标准输出。
- Render Blueprint 会创建免费的 `paipai-charge-training-db` 并注入内部连接地址。

Render 免费 PostgreSQL 容量为1GB，创建30天后过期且没有备份。需要长期积累数据时，应在到期前导出JSONL、迁移到新数据库或升级数据库方案。

运行联机冒烟测试前，需要先启动服务器。可通过 `TEST_SERVER_URL` 指定地址。

## 当前架构

```text
React网页
  ↓ HTTPS / Socket.IO
Node.js游戏服务器
  ├── 房间与玩家连接
  ├── 隐藏提交
  ├── 规则合法性检查
  └── 权威回合结算
```

第一版使用单进程内存保存房间，服务器运行期间支持断线重连。服务器重启后房间会清空，这是当前版本有意保留的简化。

## 后续扩展

1. 接入 PostgreSQL，保存账号、牌局、回合日志和战绩。
2. 为进行中的房间定期保存快照，实现服务器重启恢复。
3. 多实例部署时加入 Redis，并使用 Socket.IO Redis Adapter 同步房间广播。
4. 加入观战、好友房、战绩查询和管理后台。

## Docker

```bash
docker build -t paipai-charge-game .
docker run --rm -p 3001:3001 paipai-charge-game
```

部署时只需要一个支持 Node.js 和 WebSocket 的服务。反向代理必须允许 Socket.IO 的 WebSocket Upgrade 请求。
