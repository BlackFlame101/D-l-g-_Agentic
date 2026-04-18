# Delege Makefile
# Common commands for development

.PHONY: help install dev docker clean

help:
	@echo "Delege Development Commands"
	@echo ""
	@echo "  make install      - Install all dependencies"
	@echo "  make docker-up    - Start Redis in background"
	@echo "  make docker-down  - Stop Redis"
	@echo "  make dev-frontend - Start Next.js dev server"
	@echo "  make dev-backend  - Start FastAPI dev server"
	@echo "  make dev-bridge   - Start WhatsApp bridge dev server"
	@echo "  make dev-celery   - Start Celery worker"
	@echo "  make clean        - Remove generated files"

# Docker
docker-up:
	docker-compose up -d

docker-down:
	docker-compose down

docker-logs:
	docker-compose logs -f

# Install
install-frontend:
	cd frontend && npm install

install-bridge:
	cd whatsapp-bridge && npm install

install-backend:
	cd backend && pip install -r requirements.txt

install: install-frontend install-bridge
	@echo "Node.js dependencies installed. Run 'make install-backend' after setting up Python venv."

# Development servers
dev-frontend:
	cd frontend && npm run dev

dev-bridge:
	cd whatsapp-bridge && npm run dev

dev-backend:
	cd backend && uvicorn main:app --reload --host 0.0.0.0 --port 8000

dev-celery:
	cd backend && celery -A celery_app worker --loglevel=info

# Cleanup
clean:
	find . -type d -name "__pycache__" -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name "node_modules" -exec rm -rf {} + 2>/dev/null || true
	find . -type d -name ".next" -exec rm -rf {} + 2>/dev/null || true
	find . -type f -name "*.pyc" -delete 2>/dev/null || true
