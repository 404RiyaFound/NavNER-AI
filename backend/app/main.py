"""FastAPI application entry point."""

import os
from contextlib import asynccontextmanager

from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.database import async_session, engine
from app.models import Base
from app.routers import incidents, map_state, telemetry
from app.seed import seed_demo_data
from app.websocket import manager


@asynccontextmanager
async def lifespan(app: FastAPI):
    """Create database tables and seed demo data on startup."""
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    print("✅ Database tables created.")

    async with async_session() as session:
        await seed_demo_data(session)

    yield

    await engine.dispose()


app = FastAPI(
    title="NavNER-AI Backend",
    description="AI-powered logistics intelligence platform for NER — Stage 1 API",
    version="0.1.0",
    lifespan=lifespan,
)

# ── CORS ───────────────────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ── Static file serving for uploads ────────────────────────────────────────────
os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
app.mount("/uploads", StaticFiles(directory=settings.UPLOAD_DIR), name="uploads")

# ── Routers ────────────────────────────────────────────────────────────────────
app.include_router(telemetry.router)
app.include_router(incidents.router)
app.include_router(map_state.router)


# ── WebSocket endpoint ─────────────────────────────────────────────────────────
@app.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    """WebSocket endpoint for live dashboard updates."""
    await manager.connect(websocket)
    try:
        while True:
            # Keep the connection alive; we only broadcast server→client
            await websocket.receive_text()
    except WebSocketDisconnect:
        manager.disconnect(websocket)


# ── Health check ───────────────────────────────────────────────────────────────
@app.get("/health", tags=["system"])
async def health_check():
    return {"status": "ok", "service": "navner-ai-backend"}
