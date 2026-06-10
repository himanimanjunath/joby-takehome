import psycopg
from fastapi import APIRouter, HTTPException

from app.core.database import get_pool
from app.schemas.bom import FiltersResponse

router = APIRouter()


@router.get("/filters/options", response_model=FiltersResponse)
def get_filter_options() -> FiltersResponse:
    try:
        with get_pool().connection() as conn:
            with conn.cursor() as cur:
                cur.execute(
                    "SELECT DISTINCT depth FROM bom_forest WHERE depth IS NOT NULL ORDER BY 1"
                )
                bom_levels = [row[0] for row in cur.fetchall()]
    except psycopg.OperationalError as exc:
        raise HTTPException(status_code=503, detail=f"Database unavailable: {exc}")

    return FiltersResponse(
        bom_levels=bom_levels,
    )
