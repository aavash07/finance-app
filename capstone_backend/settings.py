from pathlib import Path
import os
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent

# Multi-environment support: load env files by precedence
# DJANGO_ENV (or ENV) selects the environment name, e.g. "development", "production".
# Precedence: .env.<env>.local > .env.<env> > .env.local > .env
ENV_NAME = os.getenv("DJANGO_ENV", os.getenv("ENV", "development")).lower()
IS_PROD = ENV_NAME in ("prod", "production")
for name in (f".env.{ENV_NAME}.local", f".env.{ENV_NAME}", ".env.local", ".env"):
    try:
        load_dotenv(BASE_DIR / name, override=False)
    except Exception:
        # Non-fatal if file is absent or unreadable
        pass

SECRET_KEY = os.getenv("SECRET_KEY", "dev")
DEFAULT_DEBUG = "0" if IS_PROD else "1"
DEBUG = bool(int(os.getenv("DEBUG", DEFAULT_DEBUG)))
ALLOWED_HOSTS = os.getenv("ALLOWED_HOSTS", "*").split(",")

INSTALLED_APPS = [
    "django.contrib.admin","django.contrib.auth","django.contrib.contenttypes",
    "django.contrib.sessions","django.contrib.messages","django.contrib.staticfiles",
    "rest_framework",
    "financekit",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
    "financekit.middleware.RequestIDMiddleware",
]

ROOT_URLCONF = "capstone_backend.urls"

TEMPLATES = [{
    "BACKEND": "django.template.backends.django.DjangoTemplates",
    "DIRS": [],
    "APP_DIRS": True,
    "OPTIONS": {"context_processors": [
        "django.template.context_processors.debug",
        "django.template.context_processors.request",
        "django.contrib.auth.context_processors.auth",
        "django.contrib.messages.context_processors.messages",
    ]},
}]

WSGI_APPLICATION = "capstone_backend.wsgi.application"

# Database config:
# - In production: default to Postgres
# - In development: default to SQLite (easy local setup)
DB_ENGINE = os.getenv("DB_ENGINE", "postgresql" if IS_PROD else "sqlite").lower()
if DB_ENGINE == "sqlite":
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            # Default to local file for dev; allow override to a writable path on Azure (e.g. /home/site/db.sqlite3)
            "NAME": os.getenv("SQLITE_PATH", os.path.join(BASE_DIR, "db.sqlite3")),
        }
    }
else:
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": os.getenv("DB_NAME","capstone"),
            "USER": os.getenv("DB_USER","capstone"),
            "PASSWORD": os.getenv("DB_PASSWORD","capstone"),
            "HOST": os.getenv("DB_HOST","localhost"),
            "PORT": os.getenv("DB_PORT","5432"),
            # SSL defaults: require in production, disable in dev; can be overridden via DB_SSLMODE
            "OPTIONS": {"sslmode": os.getenv("DB_SSLMODE", "require" if IS_PROD else "disable")},
        }
    }

AUTH_PASSWORD_VALIDATORS = []
LANGUAGE_CODE = "en-us"
TIME_ZONE = "UTC"
USE_I18N = True
USE_TZ = True

STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

# Use WhiteNoise for static files in production builds
STORAGES = {
    "staticfiles": {"BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage"},
    "default": {"BACKEND": "django.core.files.storage.FileSystemStorage"},
}

# Trust proxy headers for HTTPS redirects behind Azure App Service
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

# Optional: CSRF trusted origins (comma-separated URLs)
CSRF_TRUSTED_ORIGINS = [o for o in os.getenv("CSRF_TRUSTED_ORIGINS", "").split(",") if o]

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

from datetime import timedelta

# DRF auth for dev (BasicAuth + Session + JWT)
REST_FRAMEWORK = {
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework_simplejwt.authentication.JWTAuthentication",
        "rest_framework.authentication.BasicAuthentication",
        "rest_framework.authentication.SessionAuthentication",
    ],
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],
    "EXCEPTION_HANDLER": "financekit.exceptions.exception_handler",
    "DEFAULT_PAGINATION_CLASS": "rest_framework.pagination.PageNumberPagination",
    "PAGE_SIZE": int(os.getenv("PAGE_SIZE", "20")),
    "DEFAULT_THROTTLE_CLASSES": [
        "rest_framework.throttling.UserRateThrottle",
    ],
    # Baseline; per-view can override via throttle_classes
    "DEFAULT_THROTTLE_RATES": {
        "user": os.getenv("THROTTLE_RATE_USER", "100/min"),
        # Named scopes for clarity if we add custom classes later
        "ingest": os.getenv("THROTTLE_RATE_INGEST", "10/min"),
        "decrypt": os.getenv("THROTTLE_RATE_DECRYPT", "20/min"),
    },
}

# Simple JWT configuration
SIMPLE_JWT = {
    'ACCESS_TOKEN_LIFETIME': timedelta(minutes=int(os.getenv('JWT_ACCESS_MINUTES', '15'))),
    'REFRESH_TOKEN_LIFETIME': timedelta(days=int(os.getenv('JWT_REFRESH_DAYS', '7'))),
    'ROTATE_REFRESH_TOKENS': True,
    'BLACKLIST_AFTER_ROTATION': False,
    'ALGORITHM': 'HS256',
    'SIGNING_KEY': os.getenv('SECRET_KEY', SECRET_KEY),
}

# RSA key paths
SERVER_RSA_PRIV_PATH = os.getenv("SERVER_RSA_PRIV_PATH")
SERVER_RSA_PUB_PATH  = os.getenv("SERVER_RSA_PUB_PATH")

# Redis URL (optional for JTI single-use check)
REDIS_URL = os.getenv("REDIS_URL")

# Dev endpoints toggle
ALLOW_DEV_ENDPOINTS = bool(int(os.getenv("ALLOW_DEV_ENDPOINTS", "1" if DEBUG else "0")))
