# CrossBrowserBookmarkSync

跨浏览器书签同步扩展，支持 S3 和 WebDAV 存储后端。

## 功能特性

- **跨浏览器同步** — 同时支持 Chrome (Manifest V3) 和 Firefox (Manifest V2)
- **多种存储后端** — 支持 S3（含 MinIO、Cloudflare R2、腾讯 COS 等）和 WebDAV
- **智能合并** — 基于稳定 ID 的三路合并算法，正确处理跨设备的书签变更
- **冲突处理** — 支持强制覆盖模式，用于设备间数据不一致时的手动干预
- **自动同步** — 基于 `chrome.alarms` 的定时同步 + 书签变更监听自动触发
- **WAL 恢复** — 写前日志机制，确保崩溃后书签数据不丢失
- **互斥锁** — 防止多个同步任务并发执行导致数据竞争
- **纯 Node.js 可测** — 核心合并逻辑零浏览器 API 依赖，可独立测试

## 技术栈

- [WXT](https://wxt.dev/) — 跨浏览器扩展开发框架
- TypeScript
- Vite
- Vitest（单元测试）
- aws4fetch（S3 签名请求）

## 项目结构

```
src/
├── core/           # 纯逻辑层（无浏览器 API 依赖）
│   ├── types.ts        # 统一书签数据模型与类型定义
│   ├── merge.ts        # 三路合并算法
│   ├── diff-engine.ts  # 差异计算引擎
│   ├── stable-id.ts    # SHA-256 稳定 ID 生成
│   ├── checksum.ts     # 快照校验和
│   ├── serializer.ts   # 书签树序列化
│   └── override.ts     # 强制覆盖检测
├── browser/        # 浏览器 API 适配层
│   ├── bookmark-reader.ts  # 读取浏览器书签
│   └── bookmark-writer.ts  # 写入浏览器书签（含 WAL）
├── storage/        # 远程存储后端
│   ├── s3.ts             # S3 兼容存储
│   ├── webdav.ts         # WebDAV 存储
│   ├── factory.ts        # 后端工厂
│   ├── types.ts          # 存储接口定义
│   └── origins.ts        # 权限来源管理
├── sync/           # 同步引擎
│   ├── engine.ts         # 同步状态机
│   └── mutex.ts          # 互斥锁
├── platform/       # 平台适配层
│   ├── alarms.ts         # 定时器适配
│   ├── http.ts           # HTTP 请求适配
│   └── sw-lifecycle.ts   # Service Worker 生命周期
├── entrypoints/    # 扩展入口
│   ├── background.ts     # 后台 Service Worker
│   ├── popup/            # 弹出窗口
│   └── options/          # 选项页
└── utils/          # 工具函数
    ├── logger.ts         # 日志
    ├── retry.ts          # 重试机制
    └── chunked.ts        # 分块处理
```

## 快速开始

### 安装依赖

```bash
pnpm install
```

### 开发

```bash
# Chrome
pnpm dev

# Firefox
pnpm dev:firefox
```

### 构建

```bash
# Chrome
pnpm build

# Firefox
pnpm build:firefox

# 打包为 zip
pnpm zip
pnpm zip:firefox
```

### 测试

```bash
pnpm test
```

## 配置存储后端

### S3 兼容存储

支持任何 S3 兼容服务：AWS S3、Cloudflare R2、腾讯 COS、MinIO 等。

| 参数 | 说明 |
|------|------|
| Endpoint | S3 服务端点地址 |
| Bucket | 存储桶名称 |
| Region | 区域 |
| Access Key ID | 访问密钥 ID |
| Secret Access Key | 秘密访问密钥 |
| Path Style | 路径风格访问（MinIO 等自建服务设为 `true`） |

### WebDAV

| 参数 | 说明 |
|------|------|
| URL | WebDAV 服务地址 |
| Username | 用户名 |
| Password | 密码 |