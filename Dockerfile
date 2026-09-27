# syntax=docker/dockerfile:1

# -- Stage 1: compile the dashboard stylesheet with Tailwind's standalone CLI --------------
FROM debian:bookworm-slim AS css
ARG TAILWIND_VERSION=v4.3.3
ARG TARGETARCH
RUN apt-get update \
 && apt-get install -y --no-install-recommends curl ca-certificates \
 && rm -rf /var/lib/apt/lists/*
RUN case "${TARGETARCH:-amd64}" in \
      amd64) arch=x64 ;; \
      arm64) arch=arm64 ;; \
      *) echo "unsupported architecture: ${TARGETARCH}" >&2; exit 1 ;; \
    esac \
 && curl -fsSL --retry 4 --retry-all-errors -o /usr/local/bin/tailwindcss \
      "https://github.com/tailwindlabs/tailwindcss/releases/download/${TAILWIND_VERSION}/tailwindcss-linux-${arch}" \
 && chmod +x /usr/local/bin/tailwindcss
WORKDIR /src
COPY app/templates app/templates
COPY app/static/css app/static/css
RUN tailwindcss -i app/static/css/tailwind.src.css -o app/static/css/tailwind.css --minify

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
COPY --from=css /src/app/static/css/tailwind.css ./app/static/css/tailwind.css

# Run as an unprivileged user; the scan cache is the only thing written to disk.
RUN useradd --create-home --uid 10001 appuser \
 && mkdir -p /app/data && chown appuser:appuser /app/data
USER appuser

ENV SMS_ENV=production \
    SMS_CACHE_PATH=/app/data/cache.sqlite3 \
    PORT=8000
EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import os, urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\", \"8000\")}/api/v1/health', timeout=4)"

# Hosts such as Render inject $PORT. --proxy-headers so client IPs and https are seen correctly
# behind the platform's load balancer.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000} --proxy-headers --forwarded-allow-ips='*' --workers ${WEB_CONCURRENCY:-1}"]
