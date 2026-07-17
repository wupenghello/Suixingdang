# 随行档 部署安全指南

本文档说明如何在部署层面落地「静态数据加密」，并汇总应用层已内置的安全机制。
目标读者：负责部署运维的管理员。

---

## 一、威胁模型

静态数据加密（at-rest encryption）针对的是**磁盘 / 介质失窃**与**备份泄露**两个场景：
攻击者拿到硬盘或备份文件后，无法直接读取其中的文件、数据库与向量索引。

它**不**针对以下场景（需其他机制）：

| 威胁 | 是否由静态加密覆盖 | 应对 |
|------|------|------|
| 磁盘 / 介质失窃 | ✅ | LUKS/dm-crypt 加密卷 |
| 备份文件泄露 | ✅ | 加密卷 + 加密备份 |
| 运行进程被攻破（RCE） | ❌ | 卷已挂载、进程可读明文；需最小权限、隔离网络、及时更新 |
| 内存转储 | ❌ | 同上，需进程级隔离 |
| 传输中被窃听 | ❌（由 TLS 覆盖） | Caddy 自动 HTTPS |

简言之：静态加密让「拿到盘」≠「拿到数据」，是纵深防御的基础一层，但不是全部。

---

## 二、文件系统层加密 /data（推荐方案）

随行档的所有持久化数据都落在容器 `/data` 下：

- 文件本体：`/data/files/<user_id>/...`
- SQLite 数据库：`/data/db.sqlite`
- Chroma 向量库：`/data/chroma/`

因此**加密主机上的 `/data` 卷一次即可覆盖全部三类存储**，无需改动应用代码、
无运行时性能损耗、无历史数据迁移负担。

> 例外：Caddy 的访问日志（`Caddyfile` 里 `output file /data/access.log`）写在 caddy 容器自己的 named volume，**不在上述业务数据卷内**，加密卷与迁移都不覆盖它。如需随业务数据一起持久化，请为 caddy 单独挂载一个共享日志目录。

### 方案 A：LUKS 加密一个独立分区/卷（Linux 服务器）

```bash
# 1. 创建一个空白分区（假设 /dev/sdb1），或用文件作为后备卷
#    用文件示例（适合无空闲分区的 VPS）：
dd if=/dev/urandom of=/data-vol.img bs=1M count=20480   # 20GB，按需调整
losetup /dev/loop0 /data-vol.img

# 2. 格式化为 LUKS 加密卷（会要求设置一个强口令）
cryptsetup luksFormat /dev/loop0
cryptsetup luksOpen   /dev/loop0 suixingdang_crypt

# 3. 在加密卷上建文件系统
mkfs.ext4 /dev/mapper/suixingdang_crypt

# 4. 挂载到 /data/suixingdang
mkdir -p /data/suixingdang
mount /dev/mapper/suixingdang_crypt /data/suixingdang
```

### 方案 B：直接加密一个物理分区

若 `/dev/sdb1` 是专用于本服务的分区：

```bash
cryptsetup luksFormat /dev/sdb1
cryptsetup luksOpen   /dev/sdb1 suixingdang_crypt
mkfs.ext4 /dev/mapper/suixingdang_crypt
mount /dev/mapper/suixingdang_crypt /data/suixingdang
```

### 开机自动挂载（生产环境）

```bash
# 生成密钥文件，避免重启时人工输入口令（请用严格权限保护该密钥文件）
dd if=/dev/urandom of=/root/luks-suixingdang.key bs=512 count=4
chmod 600 /root/luks-suixingdang.key
cryptsetup luksAddKey /dev/sdb1 /root/luks-suixingdang.key

# 写入 crypttab（用密钥文件自动解锁）
# /etc/crypttab:
# suixingdang_crypt  /dev/sdb1  /root/luks-suixingdang.key  luks

# 写入 fstab（自动挂载）
# /etc/fstab:
# /dev/mapper/suixingdang_crypt  /data/suixingdang  ext4  defaults  0  2
```

> ⚠️ `luks-suixingdang.key` 与 LUKS 口令同等敏感：拿到它即可解密卷。
> 务必 `chmod 600`，且不要与备份放在同一存储。

### 与 Docker Compose 结合

`docker-compose.yml` 已把主机 `${DATA_DIR}` 挂载到容器 `/data`。
只要主机 `/data/suixingdang` 是上述加密卷的挂载点，容器内数据即自动落盘加密：

```yaml
volumes:
  # 主机 /data/suixingdang 已是 LUKS 加密卷的挂载点
  - ${DATA_DIR:-/data/suixingdang}:/data
```

启动容器前确保加密卷已挂载：

```bash
mount | grep suixingdang_crypt   # 确认已挂载
docker compose up -d --build
```

### 备份

对加密卷做块级备份（如 `dd`、`duplicity --encrypt`）即可保持加密态。
若做文件级备份，务必对备份产物再次加密（如 `gpg -c`、`restic`）。

---

## 三、密钥管理（环境变量）

> 本节是三把密钥的权威说明；[MIGRATION.md](MIGRATION.md) 等其他文档引用此处。

`.env` 中的密钥分三类，建议各自独立、各自轮换：

| 变量 | 用途 | 轮换影响 |
|------|------|----------|
| `JWT_SECRET` | JWT 签名 | 轮换后所有已签发 token 立即失效，用户需重新登录 |
| `DATA_ENCRYPTION_KEY` | Fernet 派生，加密 DB 中的 LLM API Key | 轮换后历史 API Key 密文需重新加密（应用启动时自动迁移） |
| `SECRET_KEY` | 兼容回退；未设上面两项时使用 | 兼容用，生产建议显式设置前两项 |

生成方式：

```bash
openssl rand -hex 32
```

> 不要把 `.env` 提交到仓库（`.gitignore` 已排除）。生产环境优先用 Docker secret /
> 机密管理服务（Vault 等）注入，而非明文 `.env` 文件。

---

## 四、应用层已内置的安全机制

以下机制已在代码中实现，部署时无需额外操作，但应知晓：

1. **认证**：bcrypt 密码哈希、JWT（access/refresh 分离）、TOTP 双因子、可吊销的 opaque 设备令牌、可吊销的浏览器会话令牌。浏览器会话令牌存 HttpOnly + Secure + SameSite=Lax cookie（前端 JS 不可读，防 XSS 偷令牌）；设备令牌仍走 Authorization 头。
2. **多租户隔离**：文件按 `user_id` 分目录，DB 查询带 `owner_id` 过滤，向量库按用户独立 collection。
3. **传输安全**：Caddy 自动 HTTPS + HSTS + `X-Content-Type-Options`/`X-Frame-Options`/`Referrer-Policy`/`Content-Security-Policy` 等安全头（详见 [Caddyfile](../Caddyfile)）。
4. **CORS / CSRF**：前端与 API 同源，CORS 不适用、不启用 credentials；会话 cookie 走 SameSite=Lax（写操作全 POST/PUT/DELETE）防跨站请求伪造。
5. **凭据加密**：LLM API Key 以 Fernet（HKDF-SHA256 派生密钥）加密入库，运行时按需解密。每次启动透明重加密：把任何用历史密钥加密的密文自动重加密为当前密钥，避免密钥轮换导致 API Key 永久不可解。
6. **密保答案**：bcrypt 哈希存储（sha256 预哈希，兼容历史 sha256，重置时自动升级）。
7. **登录限流**：按 `(scope:用户名, IP)` 滑窗失败计数，5 次/15 分钟触发 15 分钟锁定；状态落 SQLite（`login_attempts` 表），**多 worker 共享生效**。客户端 IP 取自受信任代理（见下）。
8. **多套独立限流 scope**：`login`（用户登录）/ `adminlogin`（管理员登录）/ `reset`（密保重置）三套互不连累；`chatrl:{user_id}`（聊天，60 秒 20 次）；`unmaskrl:{user_id}`（PII 揭帖，防暴力破解 mask_id）。
9. **密码策略**：最少 8 位 + 弱密码黑名单 + 不得与用户名相同；首次部署管理员密码弱则拒绝创建（`ALLOW_WEAK_ADMIN_PASSWORD` 调试放行）。
10. **敏感文件 Guard**：同步/上传前扫描文件名与内容（含 PDF/Word/Excel/PPT 提取文本），凭据类硬拦、隐私类告警，方向感知（往公司带 vs 往家带判断标准不同）。
11. **临时下载授权**：浏览器默认禁下载；验证密码后可开启 5/15/30 分钟窗口，或单次下载授权（下载后立即失效）。本次窗口内的下载记录写入审计日志。
12. **PII 服务端脱敏**：AI 回复中的身份证 / 手机号 / 邮箱 / AWS Key / `sk-` API Key / 私钥块 / GitHub·GitLab Token / 数据库连接串 / 银行卡等 PII，一律遮罩为 `[[M:<mask_id>:<display>]]` 令牌，真实值写入 `mask_mappings` 表（校验 user_id 归属）。前端按需调 `POST /api/chat/unmask` 揭帖。传输助手文字便签与文件消息真实路径同步遮罩。
13. **零痕迹**：在线预览 `no-store`（关页即失）；HTML/SVG/XML 等可执行类型禁止浏览器预览（防存储型 XSS，返回 415）；离职吊销令牌即切断访问，公司端无任何需清理的本地文件。
14. **审计日志**：登录/文件操作/管理操作/限流锁定/密保重置失败/下载授权/新设备登录全量记录，含真实客户端 IP 与可选 GeoIP 地域（配置 `GEOIP_DB_PATH` 指向 MaxMind GeoLite2-City.mmdb；留空则不做地域解析）。
15. **令牌生命周期**：设备令牌 / 浏览器会话可单独 / 全部吊销；紧急下线时 `revoke_all_tokens` 同时 bump 密码版本号，旧 access/refresh 立即失效，不留 60 分钟窗口。
16. **会话策略**（运行时调整）：并发上限 `max_concurrent_sessions`（默认 5）、空闲超时 `session_idle_timeout_minutes`（0=不限制）、同设备会话复用去分（`SESSION_REUSE_HOURS` 默认 5h）。
17. **新设备登录告警**：设备指纹（UA sha256）首次登录写审计日志（含 IP / GeoIP / 浏览器·OS 标签），便于被动发现异地盗号。
18. **反枚举**：忘记密码接口对所有用户名返回统一提示；密保重置对不存在用户补一次等量 bcrypt，消除时序差。
19. **路径穿越防护**：存储层 `_safe_path` 校验，所有越界（绝对路径/`..`/符号链接逃逸）视作「文件不存在」，不泄露目录结构。
20. **敏感路径扫描防护**：`/.env`、`/.git/`、`/.aws/` 等扫描器常探路径直接 404，不返回 SPA index.html，避免被当成 200 命中。
21. **错误信息不泄露**：内部异常不返回堆栈给客户端；HTTPException 使用中文友好描述，避免泄露表名 / 路径 / 密钥结构。
22. **容器以非 root 运行**：Dockerfile 内 `useradd appuser` + `gosu` 降权，限制被攻破后的影响半径。
23. **8000 端口仅绑定 `127.0.0.1`**：公网无法直连，公网入口只走 Caddy 的 80/443。

### 反向代理与客户端 IP（TRUSTED_PROXIES）

登录限流按 `(用户名, 客户端 IP)` 计数。为防攻击者伪造 `X-Forwarded-For` 绕过限流，
服务端**仅当 TCP 直连对端在 `TRUSTED_PROXIES` 集合内时**才采用 `X-Forwarded-For` /
`X-Real-IP`，否则用 TCP 对端 IP。集合支持精确 IP 与 CIDR 网段。

- Caddy 反向代理部署：把 Caddy 容器 IP 或其所在网段填入 `TRUSTED_PROXIES`
  （如 `172.18.0.0/16`），这样服务端能拿到真实客户端 IP；用网段可避免容器 IP 重建后变化导致失效。
- ⚠️ **必须填写** `TRUSTED_PROXIES`：若留空，审计日志的 IP 全是 Caddy 容器 IP（看不到谁在操作），且登录限流按 Caddy IP 计数——所有用户共享一个配额，限流失效。
- **切勿把 `8000` 端口直接暴露到公网**（`docker-compose.yml` 已默认 `127.0.0.1:8000:8000`，仅本机可访问，公网无法直连）；
  公网入口只走 Caddy 的 80/443。否则攻击者直连 `:8000` 时，`X-Forwarded-For` 不被信任、
  限流按真实 TCP 对端 IP 计数（仍有效），但加密/安全头等由 Caddy 提供的防护将缺失。

### 前端缓存破坏（cache-busting）

静态资源引用带 `?v=<build>` 查询串（用户端 `index.html` / 管理端 `admin/index.html` 内联引用均已加版本号）。
改静态文件必须升版本号，避免用户浏览器缓存旧版。CI 检查脚本 [`server/scripts/check-cache-busting.mjs`](../server/scripts/check-cache-busting.mjs) 在 PR 时自动运行。

### 运行时可调的管理员能力

管理员可在「管理后台 → 系统设置」运行时调整以下项，无需重启：

| 设置 key | 默认 | 含义 |
|---|---|---|
| `allow_register` | 继承 `.env` | 是否开放用户自助注册 |
| `default_quota_mb` | 继承 `.env` | 新用户默认存储配额（0=无限） |
| `site_name` | 空 | 站点名称 |
| `trash_retention_days` | 7 | 回收站保留天数（1-90，钳制） |
| `max_concurrent_sessions` | 5 | 单用户活跃浏览器会话上限（0=不限制） |
| `session_idle_timeout_minutes` | 0 | 会话空闲超时（0=不限制） |

详见 [DESIGN.md §3.4](../docs/DESIGN.md)。

---

## 五、运维检查清单

- [ ] `ENV=production`（启动时强制强密钥校验）
- [ ] `/data` 挂载点为 LUKS/dm-crypt 加密卷
- [ ] `luks-*.key` 密钥文件权限 600，且不与备份同存储
- [ ] `.env` 中 `JWT_SECRET` / `DATA_ENCRYPTION_KEY` 为独立随机串
- [ ] **`TRUSTED_PROXIES` 已填入 Caddy 容器 IP/CIDR**（否则审计日志 IP 全相同、限流按 Caddy IP 计数）
- [ ] 公网仅走 80/443，不直连 8000
- [ ] `ADMIN_PASSWORD` 为强密码（≥8 位，非默认值，非弱口令）
- [ ] `ALLOW_REGISTER` 按需关闭（或登录管理后台在「系统设置」调整）
- [ ] `ENABLE_API_DOCS=false`（不暴露 /docs /openapi.json）
- [ ] 已配置 SQLite 定时备份（见下），且备份产物已加密
- [ ] 服务器防火墙仅放行 80/443，容器间通信走内部网络
- [ ] （可选）`GEOIP_DB_PATH` 指向 MaxMind GeoLite2-City.mmdb，启用登录地域解析

### SQLite 定时备份

仓库自带 `scripts/backup.sh`，用 `sqlite3 .backup` 在 WAL 模式下生成一致性快照（不阻塞读写），
默认保留最近 30 份。在服务器主机上加 crontab：

```bash
# 每天 03:17 备份
17 3 * * *  DATA_DIR=/data/suixingdang /path/to/suixingdang/scripts/backup.sh >> /var/log/sxd-backup.log 2>&1
```

> 备份产物是明文数据库副本（API Key 为密文、密码为哈希，但仍属敏感），务必落到加密卷
> 或用 `gpg -c` / `restic` 二次加密，切勿明文上传到对象存储。
