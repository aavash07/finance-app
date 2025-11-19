FROM python:3.12-slim AS base

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

# System deps: Tesseract + minimal libs for opencv headless
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl libgl1 libglib2.0-0 libtesseract-dev tesseract-ocr \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./
RUN pip install --upgrade pip && pip install -r requirements.txt --no-cache-dir

# Copy source (keep separate so dependency layer is cached)
COPY . .

# Entry script added early and permissions set while still root
COPY entrypoint.sh /app/entrypoint.sh

# Non-root user for runtime safety (set ownership + exec bit in one layer)
RUN useradd --create-home appuser \
    && chown -R appuser:appuser /app \
    && chmod 755 /app/entrypoint.sh

USER appuser

# Expose port
EXPOSE 8000

CMD ["/app/entrypoint.sh"]

# Container healthcheck (lightweight). Uses curl to hit /health endpoint.
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD curl -fsS http://localhost:8000/health || exit 1

# Notes:
# - For dev with live reload, mount the source and run `python manage.py runserver` instead.
# - Set appropriate SECRET_KEY and DB_* env vars at runtime or bake an .env file.