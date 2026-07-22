FROM python:3.12-slim

# 强制 UTF-8：中文内容的文件读取（configparser/alembic.ini 等）不依赖镜像 locale
ENV PYTHONUTF8=1

WORKDIR /app

# 系统依赖：libmagic（python-magic）、gosu（容器内降权执行）
RUN apt-get update && apt-get install -y --no-install-recommends \
    libmagic1 gosu \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# 新前端构建产物（CI / install.sh 源码构建时先把 web/dist 拷入 server/web-dist）。
# 占位 .gitkeep 恒在，无 web 构建时 COPY 也不报错；运行时 main.py 检测不到
# index.html 自动跳过 /next/* 挂载，旧前端不受影响。
COPY web-dist/ /web/dist/

# 非 root 运行：应用代码归 appuser，entrypoint 启动时再降权执行主进程
RUN useradd -r -u 1000 appuser && chown -R appuser:appuser /app /web/dist

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8000

ENTRYPOINT ["/entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
