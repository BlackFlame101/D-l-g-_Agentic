"""
Delege Backend - FastAPI Application
Agentic WhatsApp Platform for Moroccan/MENA businesses
"""

from __future__ import annotations

import time
import uuid
from contextlib import asynccontextmanager

from fastapi import FastAPI, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

from core.config import settings
from core.logging import configure_logging, get_logger
from routers import agents as agents_router
from routers import conversations as conversations_router
from routers import knowledge as knowledge_router
from routers import webhook as webhook_router

configure_logging()
logger = get_logger("delege.api")


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application lifespan events."""
    logger.info(
        "Starting Delege Backend",
        extra={"debug": settings.debug, "app_name": settings.app_name},
    )
    if not settings.is_configured:
        logger.warning("Supabase is not fully configured; expect runtime errors.")
    yield
    logger.info("Shutting down Delege Backend")


app = FastAPI(
    title="Delege API",
    description="Agentic WhatsApp Platform for Moroccan/MENA businesses",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.middleware("http")
async def request_context_middleware(request: Request, call_next):
    """Attach a request id + log timings for every HTTP request."""
    request_id = request.headers.get("X-Request-ID") or uuid.uuid4().hex
    request.state.request_id = request_id
    start = time.perf_counter()
    try:
        response = await call_next(request)
    except Exception:
        duration_ms = (time.perf_counter() - start) * 1000
        logger.exception(
            "Unhandled exception",
            extra={
                "request_id": request_id,
                "method": request.method,
                "path": request.url.path,
                "duration_ms": round(duration_ms, 2),
            },
        )
        raise
    duration_ms = (time.perf_counter() - start) * 1000
    response.headers["X-Request-ID"] = request_id
    logger.info(
        "request.completed",
        extra={
            "request_id": request_id,
            "method": request.method,
            "path": request.url.path,
            "status_code": response.status_code,
            "duration_ms": round(duration_ms, 2),
        },
    )
    return response


@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException) -> JSONResponse:
    return JSONResponse(
        status_code=exc.status_code,
        content={
            "error": {
                "status": exc.status_code,
                "message": exc.detail,
                "request_id": getattr(request.state, "request_id", None),
            }
        },
        headers=exc.headers,
    )


@app.exception_handler(Exception)
async def unhandled_exception_handler(request: Request, exc: Exception) -> JSONResponse:
    logger.exception("Unhandled exception", extra={"path": request.url.path})
    return JSONResponse(
        status_code=500,
        content={
            "error": {
                "status": 500,
                "message": "Internal server error.",
                "request_id": getattr(request.state, "request_id", None),
            }
        },
    )


app.include_router(webhook_router.router)
app.include_router(agents_router.router)
app.include_router(knowledge_router.router)
app.include_router(conversations_router.router)


@app.get("/")
async def root():
    """Health check endpoint."""
    return {"status": "ok", "service": "delege-api", "version": "0.1.0"}


@app.get("/health")
async def health_check():
    """Detailed health check."""
    return {
        "status": "healthy",
        "configured": settings.is_configured,
        "app": settings.app_name,
    }
