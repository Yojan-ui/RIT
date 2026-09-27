"""Deployment artefacts: Docker image and Render blueprint."""

from __future__ import annotations

import re
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent




def test_dockerfile_runs_unprivileged_on_platform_port():
    text = (ROOT / "Dockerfile").read_text()
    assert "USER appuser" in text
    assert "${PORT:-8000}" in text and "--proxy-headers" in text
    # The React app is built from the lockfile in its own stage and served by FastAPI.
    assert "npm ci" in text and "RUN npm run build" in text
    assert "COPY --from=web /web/dist ./frontend/dist" in text and "SMS_FRONTEND_DIST=/app/frontend/dist" in text
    ignored = (ROOT / ".dockerignore").read_text().split()
    for path in ("legacy/", "tests/", ".env", ".git", "frontend/node_modules", "frontend/dist"):
        assert path in ignored
    assert "frontend/" not in ignored  # the sources must reach the build stage


def test_render_blueprint():
    text = (ROOT / "render.yaml").read_text()
    for needle in ("runtime: docker", "dockerfilePath: ./Dockerfile", "healthCheckPath: /api/v1/health"):
        assert needle in text
    # The API key is entered in the Render dashboard, never committed.
    assert re.search(r"key: ANTHROPIC_API_KEY\n\s+sync: false", text)







