from datetime import datetime, timezone
from typing import List, Optional

import psycopg
from fastapi import APIRouter, HTTPException, Query

from app.core.database import get_pool
from app.schemas.bom import PartDetail, PartSearchResult
from app.services.bom_service import BomService

router = APIRouter()
_bom = BomService()


def _now() -> datetime:
    return datetime.now(timezone.utc)


# /parts/search must be defined before /parts/{part_number} to avoid FastAPI
# treating the literal "search" as a path parameter value.
@router.get("/parts/search", response_model=List[PartSearchResult])
def search_parts(
    q: str = Query(..., min_length=2, description="Search string (ILIKE match on identity)"),
    check_time: Optional[datetime] = Query(None),
    limit: int = Query(50, ge=1, le=500),
) -> List[PartSearchResult]:
    try:
        with get_pool().connection() as conn:
            return _bom.search_parts(conn, q, check_time or _now(), limit)
    except psycopg.OperationalError as exc:
        raise HTTPException(status_code=503, detail=f"Database unavailable: {exc}")


@router.get("/parts/{part_number}", response_model=PartDetail)
def get_part_detail(
    part_number: str,
    check_time: Optional[datetime] = Query(None),
) -> PartDetail:
    try:
        with get_pool().connection() as conn:
            result = _bom.get_part_detail(conn, part_number, check_time or _now())
    except psycopg.OperationalError as exc:
        raise HTTPException(status_code=503, detail=f"Database unavailable: {exc}")
    if result is None:
        raise HTTPException(status_code=404, detail="Part not found")
    return result
