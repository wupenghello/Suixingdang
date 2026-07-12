# 日常更新流程

本文档说明项目上线后,改代码 / 改配置 / 回滚 / 迁移新服务器的标准操作。

## 整体链路

```
本地 Mac 改代码 -> push 到 GitHub -> CI 自动构建镜像推到 GHCR -> 服务器 pull 新镜像 -> 重启容器
```

数据(文件 + SQLite + 向量库)都在服务器的 `/data` 卷上,**镜像更新不碰数据**。

---

## 场景 A:改了代码(最常见)

### 1. 本地改代码并验证

```bash
# 跑单元测试(最快)
cd server && .venv/bin/python -m pytest -q

# 或起本地服务手动点一点(Ctrl+C 退出)
./start.sh   # 用户端 http://localhost:8899 ,管理端 http://localhost:8900
```

### 2. 提交并推送

```bash
git add -A
git commit -m "fix: 简述改了什么"
git push origin main
```

推送后 GitHub 自动触发两个 workflow:
- **测试**:跑 pytest
- **构建并发布镜像**:构建镜像推到 `ghcr.io/wupenghello/suixingdang:latest`

### 3. 等 CI 完成

打开 https://github.com/wupenghello/Suixingdang/actions ,两个 workflow 都变绿 ✓(镜像构建约 5-10 分钟)。

### 4. 服务器拉新镜像并重启

```bash
ssh root@<服务器IP>
cd ~                          # 部署目录(有 docker-compose.yml 那个)
docker compose pull && docker compose up -d
```

> 大版本升级或改了数据库结构前,可选先备份数据库:
> ```bash
> docker compose exec -T server python3 -c "import sqlite3;sqlite3.connect('/data/db.sqlite').execute('PRAGMA wal_checkpoint(TRUNCATE)').close()"
> cp /data/suixingdang/db.sqlite "/data/suixingdang/db-backup-$(date +%Y%m%d-%H%M%S).sqlite"
> ```

### 5. 验证

```bash
docker compose ps                              # 两个容器都 Up (healthy)
curl -s https://<你的域名>/api/health           # 返回 {"status":"ok"...}
```

浏览器打开站点点几个功能确认正常。完成。

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
- 换 `DATA_ENCRYPTION_KEY` -> 后台存的 LLM API Key 解不开,需重新配置
- 三个都换 -> 上述两条同时发生

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
3. 验证好了后,**修好新版本之前别 `docker compose pull`**(否则又拉回有问题的 latest)
4. 本地修好代码、push、CI 构建出新镜像后,把 `:<旧sha>` 改回 `:latest`,再 `pull && up -d` 恢复正常更新

---

## 场景 D:部署到一台新服务器

```bash
curl -fsSL https://raw.githubusercontent.com/wupenghello/Suixingdang/main/install.sh | bash
```

脚本问域名和管理员密码,自动下载 compose、生成 `.env`、拉镜像启动。详见 [README](../README.md)。

---

## 要点

- **服务器上别 clone 源码**:`curl|bash` 部署的服务器只有 `docker-compose.yml` / `Caddyfile` / `.env`,没有源码。改代码在本地 Mac 改。
- **数据安全**:`/data` 卷独立于容器,`docker compose down` / `up -d` / `pull` 都不碰它。只有 `docker compose down -v` 会删卷(**千万别加 -v**)。
- **看日志**:`docker compose logs -f server`(后端)、`docker compose logs caddy`(访问/证书)。
- **CI 没跑完就 pull**:拉到的是旧镜像,白跑一趟。先看 Actions 绿了再 pull。
