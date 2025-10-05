.PHONY: db-up db-down dev

db-up:
	docker compose up -d db redis

db-down:
	docker compose down

dev:
	python manage.py runserver 0.0.0.0:8000
