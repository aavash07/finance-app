#!/bin/sh
set -e

# Default worker and timeout values (overridable via env)
: "${GUNICORN_WORKERS:=3}"
: "${GUNICORN_TIMEOUT:=120}"
: "${DB_WAIT_MAX_ATTEMPTS:=10}"
: "${DB_WAIT_DELAY:=3}"

echo "[entrypoint] Waiting for database connectivity (max attempts: $DB_WAIT_MAX_ATTEMPTS, delay: $DB_WAIT_DELAY s)"
python - <<'PY'
import os, time
from django.conf import settings
import django
from django.db import connections
from django.db.utils import OperationalError

os.environ.setdefault('DJANGO_SETTINGS_MODULE','capstone_backend.settings')
django.setup()
max_attempts = int(os.getenv('DB_WAIT_MAX_ATTEMPTS','10'))
delay = float(os.getenv('DB_WAIT_DELAY','3'))
for attempt in range(1, max_attempts+1):
    try:
        conn = connections['default']
        conn.cursor()
        print(f"[db] connection OK on attempt {attempt}")
        break
    except OperationalError as e:
        print(f"[db] attempt {attempt} failed: {e}")
        if attempt == max_attempts:
            raise SystemExit(1)
        time.sleep(delay)
PY

echo "[entrypoint] Running migrations"
python manage.py migrate --noinput || {
  echo "[entrypoint] Initial migrate failed; retrying once after $DB_WAIT_DELAY s";
  sleep "$DB_WAIT_DELAY";
  python manage.py migrate --noinput;
}

echo "[entrypoint] Collecting static files"
python manage.py collectstatic --noinput || true

echo "[entrypoint] Django system checks"
python manage.py check || true

echo "[entrypoint] Starting Gunicorn"
exec gunicorn capstone_backend.wsgi:application \
  --bind 0.0.0.0:8000 \
  --workers "$GUNICORN_WORKERS" \
  --timeout "$GUNICORN_TIMEOUT" \
  --log-level info
