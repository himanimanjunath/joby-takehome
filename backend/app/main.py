from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.routes.health import router as health_router
from app.api.routes.bom import router as bom_router
from app.api.routes.parts import router as parts_router
from app.api.routes.filters import router as filters_router
from app.core.config import settings


def create_app() -> FastAPI:
    app = FastAPI(
        title="eBOM Explorer API",
        version="0.1.0",
        openapi_url=f"{settings.API_PREFIX}/openapi.json",
        docs_url=f"{settings.API_PREFIX}/docs",
        redoc_url=f"{settings.API_PREFIX}/redoc",
    )

    # ---------------------------------------------------------------------------
    # CORS — REPLACE origins BEFORE DEPLOYING
    #
    # Add your production frontend URL(s) here. For local dev the frontend runs
    # on localhost:3000; for production replace with your actual domain.
    # ---------------------------------------------------------------------------
    app.add_middleware(
        CORSMiddleware,
        allow_origins=[
            "http://localhost:3000",
            "http://127.0.0.1:3000",
            "http://localhost:8000",
            "http://localhost:5174",
            "http://127.0.0.1:5174",
        ],
        allow_credentials=True,
        allow_methods=["*"],
        allow_headers=["*"],
    )

    app.include_router(health_router,     prefix=settings.API_PREFIX, tags=["health"])
    app.include_router(bom_router,        prefix=settings.API_PREFIX, tags=["bom"])
    app.include_router(parts_router,      prefix=settings.API_PREFIX, tags=["parts"])
    app.include_router(filters_router,    prefix=settings.API_PREFIX, tags=["filters"])

    return app


app = create_app()
