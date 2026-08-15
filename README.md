# CrossBrowserBookmarkSync

跨浏览器书签同步扩展，支持 S3 和 WebDAV 存储后端，可选端到端加密。

## 功能特性

- **跨浏览器同步** — 同时支持 Chrome (Manifest V3) 和 Firefox (Manifest V2)
- **多种存储后端** — 支持 S3（含 MinIO、Cloudflare R2、腾讯 COS 等）和 WebDAV
- **智能合并** — 基于 SHA-256 稳定 ID 的三路合并算法，正确处理跨设备的书签变更，跨浏览器同步不产生重复书签
- **冲突自动解决 + 事后审阅** — 同一书签在两台设备被同时修改时按"较新者胜"（Last-Write-Wins）自动解决，不打断同步；冲突会记录在选项页的冲突审阅界面，可随时改选保留本地或远程版本
- **端到端加密（可选）** — 上传前在本地使用 AES-256-GCM 加密快照（PBKDF2-SHA256 派生密钥），存储服务商只能看到密文；支持启用、停用与修改主密码
- **自动同步** — 基于 `chrome.alarms` 的定时同步（默认 30 分钟，可选 5 分钟至 24 小时）+ 书签变更监听自动触发（5 秒防抖，批量操作只触发一次同步）
- **WAL 恢复** — 写前日志机制，Service Worker 崩溃或浏览器意外退出后自动恢复未完成的书签写入
- **互斥锁** — 防止多个同步任务并发执行导致数据竞争
- **多语言界面** — 中文 / English 双语，首次运行按系统语言自动选择，可手动切换
- **纯 Node.js 可测** — 核心合并与加密逻辑零浏览器 API 依赖，可独立单元测试

## 技术栈

- [WXT](https://wxt.dev/) — 跨浏览器扩展开发框架
- TypeScript
- Vite
- Vitest（单元测试）
- aws4fetch（S3 签名请求）
- Web Crypto API（AES-256-GCM / PBKDF2，无第三方加密库）

## 项目结构

```
src/
├── core/           # 纯逻辑层（无浏览器 API 依赖，可在 Node.js 中测试）
│   ├── types.ts        # 统一书签数据模型与类型定义
│   ├── merge.ts        # 三路合并算法（LWW 冲突解决 + 去重）
│   ├── diff-engine.ts  # 差异计算引擎
│   ├── stable-id.ts    # SHA-256 稳定 ID 生成
│   ├── checksum.ts     # 快照校验和
│   ├── serializer.ts   # 书签树序列化
│   ├── encryption.ts   # 端到端加密信封（加密/解密/探测）
│   └── override.ts     # 强制覆盖快照
├── config/         # 配置与状态存储
│   ├── store.ts        # 设置、同步状态、基准快照、冲突记录（chrome.storage）
│   ├── key-manager.ts  # 主密码密钥管理（派生、持久化、校验、轮换）
│   └── crypto.ts       # 凭据加密工具（AES-256-GCM）
├── browser/        # 浏览器 API 适配层
│   ├── bookmark-reader.ts  # 读取浏览器书签（含根文件夹映射）
│   └── bookmark-writer.ts  # 写入浏览器书签（含 WAL 写前日志）
├── storage/        # 远程存储后端
│   ├── s3.ts             # S3 兼容存储（aws4fetch 签名）
│   ├── webdav.ts         # WebDAV 存储
│   ├── factory.ts        # 后端工厂（加密时注入 Cipher）
│   ├── types.ts          # 存储接口定义
│   └── origins.ts        # 主机权限来源管理
├── sync/           # 同步引擎
│   ├── engine.ts         # 同步状态机
│   └── mutex.ts          # 互斥锁
├── platform/       # 平台适配层
│   ├── alarms.ts         # 定时器适配
│   ├── http.ts           # HTTP 请求适配
│   └── sw-lifecycle.ts   # Service Worker 生命周期（保活/中断检测）
├── entrypoints/    # 扩展入口
│   ├── background.ts     # 后台 Service Worker（消息路由、监听、加密流程）
│   ├── popup/            # 弹出窗口（状态、立即同步、冲突提示）
│   └── options/          # 选项页（后端配置、加密、冲突审阅、语言）
└── utils/          # 工具函数
    ├── i18n.ts           # 中英双语国际化
    ├── logger.ts         # 日志
    ├── retry.ts          # 重试机制
    └── chunked.ts        # 分块处理

tests/              # Vitest 单元测试
```

## 快速开始

### 安装依赖

```bash
pnpm install
```

### 开发

```bash
# Chrome
pnpm dev:chrome

# Firefox
pnpm dev:firefox
```

### 构建

```bash
# Chrome
pnpm build:chrome

# Firefox
pnpm build:firefox

# 打包为 zip
pnpm zip:chrome
pnpm zip:firefox
```

### 测试与检查

```bash
pnpm test           # 单元测试
npx tsc --noEmit    # 类型检查
pnpm lint           # ESLint
```

## 同步机制

### 同步状态机

每次同步按以下状态推进，状态实时写入本地存储供 popup 展示：

```
IDLE → READING_LOCAL → DOWNLOADING → MERGING → UPLOADING → WRITING_LOCAL → DONE
                                                                    ↘ ERROR
```

- **首次同步**：远端无数据时直接上传本地书签树（revision = 1）
- **正常同步**：读取本地树 → 下载远端快照 → 与本地保存的基准快照（上次同步结果）做三路合并 → 上传新快照 → 将合并结果写回浏览器

### 同步触发方式

| 触发方式 | 说明                                                                                               |
| -------- | -------------------------------------------------------------------------------------------------- |
| 手动     | popup 点击"立即同步"，或解决冲突后自动触发                                                         |
| 定时     | `chrome.alarms` 定时器，默认每 30 分钟，可在选项页调整（5 / 15 / 30 / 60 / 360 / 720 / 1440 分钟） |
| 书签变更 | 监听书签增删改移事件，5 秒防抖后触发一次同步                                                       |

### 三路合并规则

以 SHA-256 稳定 ID 为节点主键（跨浏览器一致，不受浏览器内部 ID 差异影响）：

1. 同一节点仅一侧修改 → 采修改侧
2. 同一节点两侧都修改 → 较新者胜（Last-Write-Wins），并记录冲突供事后审阅
3. 一侧删除 + 对侧未修改 → 传播删除
4. 一侧删除 + 对侧已修改 → 保留修改版本
5. 同一父文件夹下相同 URL → 视为重复，保留较新者

Chrome 与 Firefox 的根文件夹（书签栏 / 其他书签 / 移动书签等）通过浏览器固定 ID 与多语言名称（英/中/日/德）双重映射为统一锚点，根文件夹本身由浏览器管理、同步引擎不做增删改。

### 数据安全

- **快照格式**：带 schema 版本号与单调递增 revision（乐观并发控制）的 JSON，附 SHA-256 校验和
- **WAL 写前日志**：写回浏览器前先落盘操作日志，崩溃后启动时自动重放/回滚
- **互斥锁**：同步期间持有锁，重复触发直接跳过
- **SW 保活**：长同步期间保活 Service Worker，避免 MV3 30 秒超时中断

## 端到端加密

在选项页设置主密码即可启用（需先配置存储后端）：

- **算法**：AES-256-GCM，密钥由主密码经 PBKDF2-SHA256（100,000 次迭代）派生，全部使用浏览器原生 Web Crypto API
- **多设备一致**：PBKDF2 salt 存于远端加密信封中，所有使用相同主密码的设备自动派生出相同密钥
- **无人值守权衡**：为支持后台自动同步，派生密钥会保存在本设备浏览器配置文件中（`chrome.storage.local`），主密码本身永不上传。机密性依赖浏览器配置文件不被他人访问
- **生命周期管理**：支持停用加密（远端数据自动转为明文重新上传）与修改主密码（远端数据用新密钥重新加密）；新设备启用加密时会校验密码能否解密既有远端数据，密码错误会自动回滚

## 多语言

界面支持中文与 English：

- 首次运行按系统语言（`navigator.language`）自动选择并持久化
- 选项页顶部可随时切换，popup 与选项页即时生效

## 配置存储后端

### S3 兼容存储

支持任何 S3 兼容服务：AWS S3、Cloudflare R2、腾讯 COS、MinIO 等。

| 参数              | 说明                                                                               |
| ----------------- | ---------------------------------------------------------------------------------- |
| Endpoint          | S3 服务端点地址                                                                    |
| Bucket            | 存储桶名称                                                                         |
| Region            | 区域                                                                               |
| Access Key ID     | 访问密钥 ID                                                                        |
| Secret Access Key | 秘密访问密钥                                                                       |
| Path Style        | 路径风格访问（MinIO 等自建服务设为 `true`；AWS、腾讯 COS、Cloudflare R2 保持关闭） |

### WebDAV

| 参数     | 说明            |
| -------- | --------------- |
| URL      | WebDAV 服务地址 |
| Username | 用户名          |
| Password | 密码            |

填写后可点击"测试连接"验证连通性与主机权限，再保存设置。

## 许可证

[Apache License 2.0](LICENSE)
