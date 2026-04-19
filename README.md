# Delege - Agentic WhatsApp Platform

Delege is a SaaS platform targeting Moroccan and MENA businesses. Customers sign up, connect their WhatsApp via QR code, configure an AI agent (system prompt + knowledge base), and the agent handles customer conversations 24/7 in Arabic, French, and English.

## Project Structure

```
delege/
├── backend/          # FastAPI Python backend + Agno agent
├── frontend/         # Next.js dashboard + landing page
├── whatsapp-bridge/  # Node.js Baileys WhatsApp connector
├── docs/             # Documentation
└── docker-compose.yml
```

## Tech Stack

| Layer | Technology |
|-------|------------|
| WhatsApp | Baileys (TypeScript) |
| Agent Framework | Agno (Python) |
| LLM | Google Gemini |
| Backend API | FastAPI (Python) |
| Task Queue | Celery + Redis |
| Database | Supabase (PostgreSQL + Auth + Storage) |
| Vector Store | pgvector (via Supabase) |
| Frontend | Next.js + Tailwind + shadcn/ui |

## Prerequisites

- **Node.js** 18+ (for frontend and WhatsApp bridge)
- **Python** 3.11+ (for backend)
- **Docker Desktop** (for Redis)

## Quick Start

### 1. Start Redis (required for backend)

```bash
# Make sure Docker Desktop is running, then:
docker-compose up -d
```

This starts Redis on `localhost:6379`.

### 2. Install Dependencies

```bash
# Install frontend and bridge dependencies
npm run install:all

# Install backend dependencies (requires Python in PATH)
cd backend
python -m venv venv
# Windows:
venv\Scripts\activate
# macOS/Linux:
source venv/bin/activate

pip install -r requirements.txt
```

### 3. Configure Environment Variables

The `.env` files are already created with your Supabase credentials. You need to add:

1. **Backend** (`backend/.env`):
   - `SUPABASE_SERVICE_ROLE_KEY` - Get from Supabase Dashboard > Settings > API
   - `GOOGLE_API_KEY` - Get from Google AI Studio

2. **WhatsApp Bridge** (`whatsapp-bridge/.env`):
   - `SUPABASE_SERVICE_ROLE_KEY` - Same as above

### 4. Run Development Servers

Open 4 terminals:

```bash
# Terminal 1: Redis (if not using docker-compose up -d)
docker-compose up

# Terminal 2: Backend API
cd backend
# Activate venv first
uvicorn main:app --reload --host 0.0.0.0 --port 8000

# Terminal 3: Celery Worker
cd backend
# Activate venv first
celery -A celery_app worker --loglevel=info

# Terminal 4: Celery Beat (Phase 6 — daily subscription expiry / warning jobs)
cd backend
# Activate venv first
celery -A celery_app beat --loglevel=info

# Terminal 5: Frontend
cd frontend
npm run dev

# Terminal 6: WhatsApp Bridge
cd whatsapp-bridge
npm run dev
```

> The Celery beat process is what fires the daily `check_subscription_expiry`
> and `send_expiry_warnings` tasks. Without it, expired subscriptions never
> flip state and renewal warnings never get sent. You can also run the beat
> via Docker Compose with `docker-compose --profile beat up celery-beat`.

### 5. Access the App

- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:8000
- **API Docs**: http://localhost:8000/docs
- **WhatsApp Bridge**: http://localhost:3001

## Development Scripts

From the root directory:

```bash
npm run docker:up      # Start Redis in background
npm run docker:down    # Stop Redis
npm run docker:logs    # View Redis logs

npm run dev:frontend   # Start Next.js dev server
npm run dev:bridge     # Start WhatsApp bridge dev server
npm run dev:backend    # Start FastAPI dev server
npm run dev:celery     # Start Celery worker
```

### Celery Beat (Phase 6)

Run the periodic scheduler in its own process — it dispatches daily
`check_subscription_expiry` (marks expired subs, pauses agents) and
`send_expiry_warnings` (queues WhatsApp notices 3 days before expiry).

```bash
# Native (recommended for development):
cd backend
celery -A celery_app beat --loglevel=info

# Docker Compose (opt-in profile):
docker-compose --profile beat up celery-beat
```

In production deploy this as its own Railway service with the same env
vars as the backend / worker, and run a single replica.

## Supabase Project

This project uses **DelegeDb** Supabase project:
- **URL**: https://orckrnildvhujcaafdud.supabase.co
- **Region**: eu-west-1

Database schema will be set up in Phase 1.

## Project Phases

- [x] **Phase 0**: Project Setup
- [ ] **Phase 1**: Supabase Database and Auth
- [ ] **Phase 2**: WhatsApp Bridge
- [ ] **Phase 3**: Backend Core
- [ ] **Phase 4**: Frontend Landing Page
- [ ] **Phase 5**: Frontend Dashboard
- [ ] **Phase 6**: Manual Payments and Admin Panel
- [ ] **Phase 7**: Testing and Hardening
- [ ] **Phase 8**: Deployment
- [ ] **Phase 9**: Launch

## License

ISC
