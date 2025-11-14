"""
WSGI config for capstone_backend project.

It exposes the WSGI callable as a module-level variable named ``application``.

For more information on this file, see
https://docs.djangoproject.com/en/5.2/howto/deployment/wsgi/
"""

import os, threading
from django.core.wsgi import get_wsgi_application

os.environ.setdefault('DJANGO_SETTINGS_MODULE', 'capstone_backend.settings')

_init_lock = threading.Lock()
_initialized = False

def _initialize_side_effects():
	global _initialized
	if _initialized:
		return
	with _init_lock:
		if _initialized:
			return
		try:
			from django.conf import settings
			# 1. Auto-migrate (one-time) if MIGRATE_ON_START=1
			if os.getenv("MIGRATE_ON_START", "0") == "1":
				lock_path = "/home/site/migrated.flag"
				if not os.path.exists(lock_path):
					try:
						from django.core.management import call_command
						call_command("migrate", interactive=False, verbosity=0)
						with open(lock_path, "w", encoding="utf-8") as f:
							f.write("migrated\n")
					except Exception:
						pass  # never break startup
			# 2. Ensure RSA keypair if paths provided and private missing
			priv_path = getattr(settings, "SERVER_RSA_PRIV_PATH", None)
			pub_path = getattr(settings, "SERVER_RSA_PUB_PATH", None)
			if priv_path and pub_path and not os.path.isfile(priv_path):
				try:
					from cryptography.hazmat.primitives import serialization
					from cryptography.hazmat.primitives.asymmetric import rsa
					key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
					pem_priv = key.private_bytes(
						encoding=serialization.Encoding.PEM,
						format=serialization.PrivateFormat.TraditionalOpenSSL,
						encryption_algorithm=serialization.NoEncryption(),
					)
					pem_pub = key.public_key().public_bytes(
						encoding=serialization.Encoding.PEM,
						format=serialization.PublicFormat.SubjectPublicKeyInfo,
					)
					os.makedirs(os.path.dirname(priv_path), exist_ok=True)
					with open(priv_path, "wb") as f:
						f.write(pem_priv)
					with open(pub_path, "wb") as f:
						f.write(pem_pub)
				except Exception:
					pass
		finally:
			_initialized = True

application = get_wsgi_application()
_initialize_side_effects()
