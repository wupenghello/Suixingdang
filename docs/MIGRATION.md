# 随行档 服务器迁移指南

换服务器、换 VPS、搬迁机房时，把账户资料、用户文件、向量索引完整无损地迁到新机器的操作手册。

目标读者：已经按 [README](../README.md) 部署过一次随行档、需要把它整体搬到另一台服务器的运维管理员。

---

## 一、核心结论

随行档的**全部持久化数据都落在主机 `${DATA_DIR}`（默认 `/data/suixingdang`）这一棵目录树下**——`docker-compose.yml` 把它整个挂载进容器的 `/data`。因此迁移本质就是两件事：

1. 把**整棵 `DATA_DIR` 目录**搬到新服务器的相同路径；
2. 把**原样的 `.env`**（尤其三把密钥）一并搬过去。

不需要导出/导入数据库，不需要重建向量索引。

---

## 二、数据都在哪（迁移前必读）

`DATA_DIR` 这棵树包含三类数据，迁移时**会一起跟着走**，无需单独处理：

| 内容 | 容器内路径 | 主机路径（`DATA_DIR=/data/suixingdang` 时） | 作用 |
|------|------|------|------|
| SQLite 数据库 | `/data/db.sqlite` | `/data/suixingdang/db.sqlite` | **账户资料全在这**：用户名、bcrypt 密码哈希、TOTP 双因子密钥、设备令牌、文件元数据、聊天记录、审计日志、存储配额、加密后的 LLM API Key |
| 用户文件本体 | `/data/files/<user_id>/` | `/data/suixingdang/files/<user_id>/` | 上传的所有文件，按用户分目录隔离 |
| Chroma 向量库 | `/data/chroma/` | `/data/suixingdang/chroma/` | 语义搜索的向量索引，按用户分集合 |

> 容器内 `/data` 即主机 `${DATA_DIR}` 的挂载点（见 `docker-compose.yml`）。**只要整棵 `DATA_DIR` 一起搬，这三类数据自动全部覆盖**，无需关心内部路径。

---

## 三、关键前提：三把密钥必须原样迁移

`.env` 里这三把钥匙，迁移时**必须原样复制到新服务器**（[配置说明](../.env.example)）：

| 变量 | 丢失的后果 |
|------|------|
| **`DATA_ENCRYPTION_KEY`** | ⚠️ **致命**。数据库里 LLM 的 API Key 用 Fernet 加密存储（HKDF 派生自这把钥匙），丢了之后已存入的 API Key **永远解不开**，只能在管理后台逐个重新填写。 |
| `JWT_SECRET` | 所有用户/管理员的登录 token 立即失效，需要全员重新登录（数据不丢，只是麻烦）。 |
| `SECRET_KEY` | 兼容回退用。代码对历史密文有多种兼容解密路径，**把整个 `.env` 原样搬过去能覆盖所有历史加密版本**，最保险。 |

密码哈希、TOTP 密钥、设备令牌都是不可逆或独立存储的，**与上述密钥无关，账户资料本身不会因换机器而丢失**。

> 三把密钥的完整说明（用途、生成方式、轮换影响）以 [DEPLOY_SECURITY.md](DEPLOY_SECURITY.md) 第三节为权威源。

---

## 四、迁移步骤

### 1. 旧服务器：停服

避免拷贝到正在写入的数据库：

```bash
cd /path/to/Suixingdang
docker compose down
```

### 2. 打包整棵数据目录（加密）

数据目录里有你的全部文件和 API Key，传输与备份过程务必加密：

```bash
# 方式 A：tar + 对称加密（简单，会交互式问一个口令）
sudo tar czf - -C /data suixingdang | gpg -c > suixingdang-data.tar.gz.gpg

# 方式 B（推荐长期备份用）：restic / duplicity 做加密增量备份
```

### 3. 传到新服务器

连同原样 `.env` 一起传：

```bash
scp suixingdang-data.tar.gz.gpg  .env  newuser@新服务器IP:~/
```

### 4. 新服务器：还原数据

```bash
# 前置：装好 Docker 与 Docker Compose
sudo mkdir -p /data
gpg -d ~/suixingdang-data.tar.gz.gpg | sudo tar xzf - -C /data

# 确认数据还原到位（应能看到 db.sqlite / files / chroma 等）
sudo ls -la /data/suixingdang/
```

> 镜像默认以 root 运行（见 [Dockerfile](../server/Dockerfile)），数据目录属主即 root，通常无需额外调整。

### 5. 新服务器：拉代码、放 `.env`、起服务

```bash
git clone https://github.com/wupenghello/Suixingdang.git && cd Suixingdang

# 用从旧服务器搬来的、含原始密钥的 .env（切勿用 .env.example 重新生成密钥！）
cp ~/.env .env
chmod 600 .env

docker compose up -d --build
```

### 6. DNS 切换

把域名的 A 记录指向新服务器 IP。DNS 生效后，Caddy 会自动在新机器上签发 HTTPS 证书。

---

## 五、迁移后验证清单

- [ ] 访问 `https://你的域名` 能正常加载登录页
- [ ] 用**原有账户密码**能登录（验证 SQLite + 密码哈希迁移成功）
- [ ] 管理后台 `/admin` 能看到原有用户列表、用量统计（验证账户资料完整）
- [ ] 能下载一个迁移前就存在的文件（验证文件本体迁移成功）
- [ ] 管理后台「大模型配置」里 API Key 仍能正常发起对话（验证 `DATA_ENCRYPTION_KEY` 一致、密文可解）
- [ ] 语义搜索能命中旧文件（验证 Chroma 向量库迁移成功）
- [ ] 审计日志连续（迁移前的记录仍在）

---

## 六、注意事项

- **SQLite 一致性**：务必先 `docker compose down` 再拷贝，不要在运行中拷（可能拷到半写的库）。若无法停服，改用热备份：`sqlite3 db.sqlite ".backup /tmp/backup.db"`，再传这个备份库。
- **Caddy 证书不用迁**：`caddy_data` / `caddy_config` 是 Docker named volume，跟业务数据分离。新服务器上 Caddy 会自动重新签发证书，丢了也只是重签一次。
- **家里守护进程（daemon）**：它只是客户端，核心数据都在服务器。迁移后若**域名不变**，守护进程无需改动、设备令牌继续有效；若**换了域名**，家里那台改一下 `SERVER_URL` 环境变量再重启即可。
- **`ADMIN_PASSWORD`**：仅在首次启动、库里还没有 admin 时用来播种；迁移后数据库已有 admin 账户，此值不再生效，不用管。
- **存储配额**：随账户存在 SQLite 里，会自动迁移，无需重设。

---

## 七、附录：换域名的额外操作

如果迁移同时**更换了域名**（不只是换 IP）：

1. 修改新服务器 `.env` 中的 `DOMAIN`（[Caddyfile](../Caddyfile) 用 `{$DOMAIN}` 变量，改 `.env` 即可，无需动 Caddyfile）。
2. 视需要修改 `CORS_ORIGINS`（为空时按 `DOMAIN` 自动派生，通常可留空）。
3. 家里守护进程的 `SERVER_URL` 改成新域名。
4. 在各用户设备的浏览器里重新登录（域名变了，旧域名下的 cookie/token 不可用）。

> 若同时启用 TOTP 双因子，用户手机上的验证器 App 不受域名更换影响（TOTP 种子存在数据库、随账户迁移）。

---

## 八、附录：回滚

迁移出问题时，只要**旧服务器的 `DATA_DIR` 和 `.env` 没删**，回滚就是：

```bash
# 旧服务器
docker compose up -d
# DNS 切回旧服务器 IP
```

> 建议：在新服务器验证全部通过、运行观察几天之前，**保留旧服务器的数据目录不要销毁**，作为回滚保险。
