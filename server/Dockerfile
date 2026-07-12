FROM python:3.12-slim

WORKDIR /app

# 系统依赖：libmagic（python-magic）、gosu（容器内降权执行）
RUN apt-get update && apt-get install -y --no-install-recommends \
    libmagic1 gosu \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY . .

# 非 root 运行：应用代码归 appuser，entrypoint 启动时再降权执行主进程
RUN useradd -r -u 1000 appuser && chown -R appuser:appuser /app

COPY entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

EXPOSE 8000

ENTRYPOINT ["/entrypoint.sh"]
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
