import asyncio
import contextlib
import logging
from collections.abc import AsyncIterator

from fastapi import FastAPI

from app.api import auth, categories, health, movements, products, reports, stock_counts
from app.api.documents import receipts_router, reversals_router, write_offs_router
from app.cleanup import cleanup_loop
from app.config import get_settings
from app.errors import install_error_handlers


def create_app(*, run_cleanup: bool = True) -> FastAPI:
    settings = get_settings()
    logging.basicConfig(level=settings.log_level.upper())
    docs = settings.is_development

    @contextlib.asynccontextmanager
    async def lifespan(_: FastAPI) -> AsyncIterator[None]:
        task = asyncio.create_task(cleanup_loop()) if run_cleanup else None
        yield
        if task:
            task.cancel()
            with contextlib.suppress(asyncio.CancelledError):
                await task

    app = FastAPI(
        title="Inventory Manager API",
        version="1.0.0",
        docs_url="/api/docs" if docs else None,
        redoc_url=None,
        openapi_url="/api/openapi.json" if docs else None,
        lifespan=lifespan,
    )
    install_error_handlers(app)
    for r in (
        health.router,
        auth.router,
        categories.router,
        products.router,
        receipts_router,
        write_offs_router,
        reversals_router,
        stock_counts.router,
        movements.router,
        reports.router,
    ):
        app.include_router(r)
    return app


app = create_app()
