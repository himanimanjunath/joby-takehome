# Backend image for the eBOM Explorer take-home.
# Build context is interview/backend (self-contained — no AWS, no Lakebase).
FROM python:3.14-slim

WORKDIR /app

# gcc for any source builds; postgresql-client for psql/libpq; uv for deps.
RUN apt-get update && apt-get install -y --no-install-recommends \
        gcc \
        postgresql-client \
    && rm -rf /var/lib/apt/lists/* \
    && pip install --no-cache-dir uv

COPY pyproject.toml uv.lock ./
RUN uv sync --frozen --no-dev

COPY app/ app/

EXPOSE 8000

# Use stdlib urllib (system python has no project deps; requests lives in the uv venv).
HEALTHCHECK --interval=30s --timeout=10s --start-period=10s --retries=3 \
  CMD python -c "import sys,urllib.request; sys.exit(0 if urllib.request.urlopen('http://127.0.0.1:8000/api/health').status==200 else 1)"

CMD ["uv", "run", "uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8000"]
