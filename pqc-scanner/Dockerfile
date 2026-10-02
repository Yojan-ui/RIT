FROM python:3.12-slim
RUN apt-get update && apt-get install -y --no-install-recommends build-essential libssl-dev curl && rm -rf /var/lib/apt/lists/*
WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt
COPY . .
ENV PORT=8002
EXPOSE 8002
CMD uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8002}
