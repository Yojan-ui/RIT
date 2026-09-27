# syntax=docker/dockerfile:1

# -- Stage 1: build the React app ---------------------------------------------------------------
FROM node:24-slim AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci --no-audit --no-fund
COPY frontend/ ./
RUN npm run build

# -- Stage 2: runtime ---------------------------------------------------------------------------
FROM python:3.12-slim AS runtime
ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1
WORKDIR /app

COPY requirements.txt .
RUN pip install -r requirements.txt

COPY app ./app
COPY --from=web /web/dist ./frontend/dist

# Run as an unprivileged user; the scan cache is the only thing written to disk.
RUN useradd --create-home --uid 10001 appuser \
 && mkdir -p /app/data && chown appuser:appuser /app/data
USER appuser

ENV SMS_ENV=production \
    SMS_CACHE_PATH=/app/data/cache.sqlite3 \
    SMS_FRONTEND_DIST=/app/frontend/dist \
    PORT=8000
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import os, urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\", \"8000\")}/api/v1/health', timeout=4)"

# Hosts such as Render inject $PORT. --proxy-headers so client IPs and https are seen correctly
# behind the platform's load balancer.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*' --workers ${WEB_CONCURRENCY:-1}"]
