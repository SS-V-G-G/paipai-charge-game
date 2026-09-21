# 拍拍蓄网页游戏

基于 React、TypeScript、Node.js 和 Socket.IO 的同步回合制联机版本。当前版本支持 2—10 人房间、秘密出牌、统一公开、服务器权威结算、自动回合超时和断线重连。

规则引擎采用确定性结算：给定相同的初始状态、玩家顺序和出牌提交，最终状态及事件日志完全一致，可据此保存回合输入并完整重放牌局。房间码、连接令牌等网络标识不属于规则结算的一部分。

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
```

- `npm run check`：检查前端、规则引擎和服务器类型。
- `npm test`：执行核心规则测试。
- `smoke-multiplayer.mjs`：启动两个真实 Socket.IO 客户端，验证创建房间、准备、开始、出牌和同步结算。

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
