.PHONY: db-up db-down dev venv install migrate superuser run test makemigrations shell

db-up:
	docker compose up -d db redis

db-down:
	docker compose down

venv:
	python3 -m venv .venv
	. .venv/bin/activate && pip install --upgrade pip

install: venv
	. .venv/bin/activate && pip install -r requirements.txt

migrate:
	. .venv/bin/activate && python manage.py migrate

superuser:
	. .venv/bin/activate && python manage.py createsuperuser

run:
	. .venv/bin/activate && python manage.py runserver 0.0.0.0:8000

dev: run

test:
	. .venv/bin/activate && python manage.py test -v 2

makemigrations:
	. .venv/bin/activate && python manage.py makemigrations

shell:
	. .venv/bin/activate && python manage.py shell
