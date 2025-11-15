FROM python:3.12-slim

ENV PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1

# System deps: Tesseract + minimal libs for opencv headless
RUN apt-get update && apt-get install -y --no-install-recommends \
    libgl1 libglib2.0-0 libtesseract-dev tesseract-ocr \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt ./
RUN pip install --upgrade pip && pip install -r requirements.txt

# Copy source (keep separate so dependency layer is cached)
COPY . .

# Expose port
EXPOSE 8000

# Health probe-friendly command; override via docker run CMD if needed
CMD ["gunicorn", "capstone_backend.wsgi:application", "--bind", "0.0.0.0:8000", "--workers", "3", "--timeout", "120"]

# Notes:
# - For dev with live reload, mount the source and run `python manage.py runserver` instead.
# - Set appropriate SECRET_KEY and DB_* env vars at runtime or bake an .env file.