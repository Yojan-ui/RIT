"""Deployment artefacts: GitHub Pages copy, Docker/Render config, production stylesheet switch."""

from __future__ import annotations

import re
from pathlib import Path

from jinja2 import Environment, FileSystemLoader

ROOT = Path(__file__).resolve().parent.parent


def test_github_pages_copy_matches_offline_scanner():
    """docs/index.html is what GitHub Pages serves; it must never drift from offline_scanner.html."""
    assert (ROOT / "docs" / "index.html").read_bytes() == (ROOT / "offline_scanner.html").read_bytes(), (
        "run: cp offline_scanner.html docs/index.html"
    )
    assert (ROOT / "docs" / ".nojekyll").exists()


def test_dockerfile_and_template_pin_the_same_tailwind_version():
    docker = re.search(r"ARG TAILWIND_VERSION=v([\d.]+)", (ROOT / "Dockerfile").read_text()).group(1)
    cdn = re.search(r"@tailwindcss/browser@([\d.]+)", (ROOT / "app/templates/base.html").read_text()).group(1)
    assert docker == cdn


def test_dockerfile_runs_unprivileged_on_platform_port():
    text = (ROOT / "Dockerfile").read_text()
    assert "USER appuser" in text
    assert "${PORT:-8000}" in text and "--proxy-headers" in text
    assert "COPY --from=css /src/app/static/css/tailwind.css" in text
    ignored = (ROOT / ".dockerignore").read_text().split()
    for path in ("legacy/", "tests/", ".env", ".git"):
        assert path in ignored


def test_render_blueprint():
    text = (ROOT / "render.yaml").read_text()
    for needle in ("runtime: docker", "dockerfilePath: ./Dockerfile", "healthCheckPath: /api/v1/health"):
        assert needle in text
    # The API key is entered in the Render dashboard, never committed.
    assert re.search(r"key: ANTHROPIC_API_KEY\n\s+sync: false", text)


def test_stylesheet_safelists_dynamic_tone_classes():
    """Templates build bg-/text-<tone> at render time; the CLI build must still emit them."""
    src = (ROOT / "app/static/css/tailwind.src.css").read_text()
    assert '@source inline("{bg,text}-{exposed,partial,mitigated,unknown}")' in src
    assert '@import "./theme.css"' in src and '@source "../../templates"' in src


def _render_base(**globals_) -> str:
    env = Environment(loader=FileSystemLoader(ROOT / "app/templates"))
    env.globals.update(url_for=lambda name, path: f"/static/{path}", **globals_)
    return env.get_template("base.html").render(app_name="SMS", version="0")


def test_base_uses_prebuilt_css_when_available():
    html = _render_base(tailwind_built=True, tailwind_theme="")
    assert "/static/css/tailwind.css" in html and "tailwindcss/browser" not in html


def test_base_falls_back_to_cdn_build_with_theme_in_development():
    html = _render_base(tailwind_built=False, tailwind_theme="@theme inline { --color-ink: var(--ink); }")
    assert "tailwindcss/browser" in html and "--color-ink: var(--ink)" in html
