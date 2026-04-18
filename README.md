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

# Terminal 4: Frontend
cd frontend
npm run dev

# Terminal 5: WhatsApp Bridge
cd whatsapp-bridge
npm run dev
```

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


## License

ISC
