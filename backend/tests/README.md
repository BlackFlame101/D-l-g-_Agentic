# Delege E2E Test Harness

A real end-to-end pytest harness that stands up the full Delege stack against
live Supabase + a mocked WhatsApp bridge and asserts every seam works:

```
pytest -> FastAPI (subprocess) -> Redis -> Celery worker (subprocess)
                                              |
                                              +-> Supabase (real test tenant)
                                              +-> Mock Bridge (in-process FastAPI)
                                              +-> Stub LLM / stub embeddings
```

This replaces / subsumes the old ad-hoc `scripts/test_webhook.py` smoke.

## Prerequisites

1. **Python 3.11+** with `backend/requirements.txt` installed (including the
   `# test` section — pytest, pytest-asyncio, pytest-timeout, websockets).
2. **Redis** reachable on `redis://localhost:6379/15` (or override with
   `REDIS_TEST_URL`). We flush DB index 15 between tests so it must be
   dedicated to CI/dev.
3. **Supabase test project** — set
   * `SUPABASE_URL`
   * `SUPABASE_SERVICE_ROLE_KEY`
   * `SUPABASE_ANON_KEY`

   Do **NOT** point this at the production project — the harness creates real
   auth users and rows (with a `pytest-e2e` prefix) and hard-deletes them on
   teardown.
4. **Storage bucket** `knowledge-files` must exist in that project.
5. For `test_frontend_bridge_contract.py` only: Node.js 18+ and a completed
   `npm install` in `whatsapp-bridge/`.

## One-shot run

```powershell
# PowerShell (Windows)
cd backend
docker compose -f ..\docker-compose.yml up -d redis
# Load backend\.env so SUPABASE_* / WHATSAPP_BRIDGE_API_SECRET reach
# subprocesses (the Node bridge only reads from os.environ).
Get-Content .env | ForEach-Object {
    if ($_ -match '^([A-Z_]+)=(.*)$') {
        [Environment]::SetEnvironmentVariable($Matches[1], $Matches[2], 'Process')
    }
}
python -m pytest tests/e2e -v --timeout=180
```

```bash
# Bash (Linux / macOS / WSL)
cd backend
docker compose -f ../docker-compose.yml up -d redis
set -a && . .env && set +a
python -m pytest tests/e2e -v --timeout=180
```

`conftest.py` unconditionally points `CELERY_BROKER_URL` / `CELERY_RESULT_BACKEND` /
`REDIS_URL` at `REDIS_TEST_URL` (default `redis://localhost:6379/15`) so a dev
`.env` pointing at DB 0 can never contaminate a test run.

## Useful environment knobs

| Variable | Default | Purpose |
|---|---|---|
| `TEST_LLM_MODE` | `""` (real Gemini) | `stub` — deterministic `[stub] <msg>` reply, `stub_fallback` — always the fallback branch, `stub_error` — raise to exercise the fallback path |
| `TEST_EMBED_MODE` | `""` (real Gemini) | `stub` — deterministic 768-d unit vectors per input |
| `REDIS_TEST_URL` | `redis://localhost:6379/15` | DB index pytest is allowed to flush |
| `E2E_VERBOSE` | unset | Set to any truthy value to stream subprocess stdout/stderr |
| `E2E_STARTUP_TIMEOUT` | `45` | Seconds to wait for api/celery/bridge subprocesses to come up |
| `E2E_BRIDGE_SECRET` | random per run | Shared secret used for the mock bridge |
| `TEST_PREFIX` | `pytest-e2e` | Prefix applied to names/phones for safe orphan cleanup |

## Running a single scenario

```powershell
pytest tests/e2e/test_inbound_first_message.py::test_first_inbound_message_triggers_greeting -v
```

## Test catalogue

1. `test_inbound_first_message.py` — greeting flow on first contact.
2. `test_inbound_rag_reply.py` — RAG retrieval + stub LLM reply.
3. `test_inbound_fallback.py` — `TEST_LLM_MODE=stub_error` → fallback message.
4. `test_subscription_limit_blocks.py` — over-limit webhook → limit notice.
5. `test_webhook_auth.py` — 401 / 503 / non-text payload edge cases.
6. `test_admin_subscription_activation.py` — admin JWT activation → agent replies.
7. `test_admin_expiry_beat.py` — `check_subscription_expiry.apply()` deactivates agents.
8. `test_expiry_warning_beat.py` — `send_expiry_warnings.apply()` templated notice.
9. `test_knowledge_upload_pipeline.py` — upload → index → chunks with stub embeddings.
10. `test_frontend_bridge_contract.py` — real Node bridge, exactly the HTTP+WS calls the frontend makes (`getWhatsAppQrWsUrl`, `getWhatsAppStatus`, `disconnectWhatsApp`).

## Manual smoke (`scripts/smoke_all.py`)

For an interactive smoke before deploy — same fixtures, but optionally against
the real Gemini + real Node bridge:

```bash
python scripts/smoke_all.py --scenario inbound
python scripts/smoke_all.py --scenario expiry-warning --language fr
```

See `--help` for all scenarios / flags.

## Troubleshooting

* **"E2E fixtures require env vars"** — set `SUPABASE_URL` / `SUPABASE_ANON_KEY` /
  `SUPABASE_SERVICE_ROLE_KEY`.
* **"Redis not reachable at ..."** — `docker-compose up -d redis` or fix
  `REDIS_TEST_URL`.
* **Celery worker did not become ready** — rerun with `E2E_VERBOSE=1` to see
  the worker output; usually a missing env var.
* **Orphan rows after a crash** — all test rows carry `pytest-e2e` in their
  name / company_name / phone; safe to delete manually by that prefix.
