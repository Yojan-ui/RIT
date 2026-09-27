# SecureMailScope: FastAPI backend + static frontend, served by Uvicorn on :80

# ---- Stage 1: compile the React app -----------------------------------------
# Vite's outDir is ../backend/static, so the build lands in /build/backend/static
FROM node:22-slim AS frontend
WORKDIR /build/frontend
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- Stage 2: API + static files -------------------------------------------
FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    STATIC_DIR=/app/static

WORKDIR /app

COPY backend/requirements.txt ./requirements.txt
RUN pip install -r requirements.txt

COPY backend/app ./app
# Compiled frontend into the backend's static folder; FastAPI serves it at "/"
COPY --from=frontend /build/backend/static ./static

EXPOSE 80

# Listens on $PORT if set, otherwise 80.
HEALTHCHECK --interval=30s --timeout=3s --start-period=5s \
    CMD python -c "import os, urllib.request; urllib.request.urlopen(f'http://127.0.0.1:{os.environ.get(\"PORT\", \"80\")}/api/health', timeout=2)"

CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-80} --proxy-headers --forwarded-allow-ips '*'"]
