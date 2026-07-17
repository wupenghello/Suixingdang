# 日常更新流程

本文档说明项目上线后,改代码 / 改配置 / 回滚 / 迁移新服务器的标准操作。

## 整体链路

```
本地 Mac 改代码 -> push 到 GitHub -> CI 自动构建镜像推到 GHCR -> CI 自动 SSH 部署到服务器
```

数据(文件 + SQLite + 向量库)都在服务器的 `/data` 卷上,**镜像更新不碰数据**。

---

## 场景 A:改了代码(最常见)

### 1. 本地改代码并验证

```bash
# 跑后端测试(最快)
cd server && .venv/bin/python -m pytest -q

# 跑前端单测(改前端工具函数时必须)
cd server && npm test

# 或起本地服务手动点一点(Ctrl+C 退出)
./start.sh   # 用户端 http://localhost:8899 ,管理端 http://localhost:8900
```

### 2. 提交并推送

```bash
git add -A
git commit -m "fix: 简述改了什么"
git push origin main
```

推送后 GitHub 自动触发两个 workflow（详见 `.github/workflows/`）:
- **test（[.github/workflows/test.yml](../.github/workflows/test.yml)）**：PR 时跑 pytest + 前端 vitest + pip-audit 依赖漏洞扫描 + 前端 cache-busting 检查
- **docker（[.github/workflows/docker.yml](../.github/workflows/docker.yml)）**：push 到 main 时构建镜像推到 `ghcr.io/wupenghello/suixingdang:latest`（标签 `latest` / 短 sha / semver）

### 3. 等 CI 完成

打开 https://github.com/wupenghello/SuixingdangActions ，两个 workflow 都变绿 ✓(镜像构建约 5-10 分钟)。

### 4. CI 自动部署到服务器(无需手动操作)

镜像构建成功后,CI 会自动 SSH 登录服务器执行 `docker compose pull && docker compose up -d`。构建+部署约 5-10 分钟,Actions 页面看到 deploy job 变绿 ✓ 即部署完成。

> 一次性配置:仓库 Secrets 存了 `SSH_HOST` / `SSH_USER` / `SSH_KEY`(专用 deploy key,公钥在服务器 `~/.ssh/authorized_keys`) / `SSH_PORT`(可选) / `DEPLOY_DIR`(可选)。换服务器或换密钥时更新这些 Secret。

> 大版本升级或改了数据库结构前,可选先 SSH 上去备份数据库:
> ```bash
> docker compose exec -T server python3 -c "import sqlite3;sqlite3.connect('/data/db.sqlite').execute('PRAGMA wal_checkpoint(TRUNCATE)').close()"
> cp /data/suixingdang/db.sqlite "/data/suixingdang/db-backup-$(date +%Y%m%d-%H%M%S).sqlite"
> ```

### 5. 验证

deploy job 日志里有 `docker compose ps` 输出可看容器状态。浏览器打开站点点几个功能确认,也可 curl 健康检查:

```bash
curl -s https://你的域名/api/health    # 返回 {"status":"ok"...}
```

整个流程只需本地改代码 + `git push`,后续全自动。

### 改了静态资源注意

前端用缓存破坏(`?v=<build>`),改 `server/app/web/assets/` 下的静态文件后,必须同步升级 `server/app/web/index.html` 与 `server/app/web/admin/index.html` 中对应 `<script>` / `<link>` 的 `?v=` 值,否则用户浏览器会缓存旧版。CI 的 cache-busting 检查会校验此项。

---

## 场景 B:只改 .env 配置(不改代码)

比如开关注册、改配额、改域名。**不用 push、不用等 CI、不用 pull**:

```bash
ssh root@<服务器IP>
cd ~
nano .env                   # 改你想改的项,如 ALLOW_REGISTER=true
docker compose up -d        # 重读 .env,重启容器(不拉镜像)
```

⚠️ **不要随便改这三个**:`SECRET_KEY` / `JWT_SECRET` / `DATA_ENCRYPTION_KEY`
- 换 `JWT_SECRET` -> 所有已登录用户立即掉线,需重新登录
- 换 `DATA_ENCRYPTION_KEY` -> 后台存的 LLM API Key 解不开,需重新配置(应用启动时会尝试用历史密钥透明重加密,但建议避免无谓轮换)
- 三个都换 -> 上述两条同时发生

### 运行时调整(无需改 .env / 无需重启)

管理员可在「管理后台 → 系统设置」运行时调整以下项,立即生效、无需重启:

| 设置 | 说明 |
|---|---|
| 开放注册 | 是否开放用户自助注册 |
| 默认配额 | 新用户默认存储配额(MB, 0=无限) |
| 站点名称 | 站点显示名 |
| 回收站保留天数 | 1-90 天,钳制 |
| 会话并发上限 | 单用户活跃浏览器会话上限(默认 5, 0=不限制) |
| 会话空闲超时 | 会话空闲超时(分钟, 0=不限制) |

详见 [DESIGN.md §3.4](../docs/DESIGN.md) 与 [DEPLOY_SECURITY.md](../docs/DEPLOY_SECURITY.md)。

---

## 场景 C:更新后出问题,回滚

GHCR 上每次构建都留了 `:短sha` 标签(如 `:e3a8ca3`),可回退到任意旧版本。

1. 打开 https://github.com/wupenghello/Suixingdang/pkgs/container/suixingdang ,在 tags 里找到**上一个正常版本**的 sha
2. 服务器上:
   ```bash
   cd ~
   docker compose down
   nano docker-compose.yml     # image: ...:latest 改成 image: ...:<旧sha>
   docker compose up -d
   ```
3. **回滚期间不要 `git push` 到 main**——否则 CI 自动部署会拉回有问题的 latest,覆盖回滚
4. 本地修好代码、push、CI 构建出新镜像并自动部署后,SSH 上去把 `docker-compose.yml` 里的 `:<旧sha>` 改回 `:latest`,再 `docker compose up -d` 恢复正常更新

---

## 场景 D:部署到一台新服务器

```bash
curl -fsSL https://raw.githubusercontent.com/wupenghello/Suixingdang/main/install.sh | bash
```

脚本交互式收集域名与密码,自动生成三把独立密钥、写 `.env`(权限 600)、拉镜像启动。详见 [README](../README.md)。

---

## 要点

- **服务器上别 clone 源码**:`curl|bash` 部署的服务器只有 `docker-compose.yml` / `Caddyfile` / `.env`,没有源码。改代码在本地 Mac 改。
- **数据安全**:`/data` 卷独立于容器,`docker compose down` / `up -d` / `pull` 都不碰它。只有 `docker compose down -v` 会删卷(**千万别加 -v**)。
- **看日志**:`docker compose logs -f server`(后端)、`docker compose logs caddy`(访问/证书)。
- **CI 没跑完别手动干预**:自动部署用的是 `latest` 镜像,构建没完成就触发部署会拉到旧镜像。看 Actions 的 build 和 deploy 都变绿才算上线。
