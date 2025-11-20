"""Example Postgres settings (not imported).
Copy relevant parts into settings.py and set DB_ENGINE=postgresql to enable.
"""
from pathlib import Path
import os
BASE_DIR = Path(__file__).resolve().parent.parent

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.getenv("DB_NAME","capstone"),
        "USER": os.getenv("DB_USER","capstone"),
        "PASSWORD": os.getenv("DB_PASSWORD","capstone"),
        "HOST": os.getenv("DB_HOST","localhost"),
        "PORT": os.getenv("DB_PORT","5432"),
        "OPTIONS": {"sslmode": os.getenv("DB_SSLMODE", "require")},
    }
}
