from datetime import datetime, timezone
from typing import List, Optional

import psycopg
from fastapi import APIRouter, HTTPException, Query

from app.core.database import get_pool
from app.schemas.bom import (
    BomStatisticsResponse,
    BomTreeRow,
    WhereUsedRow,
)
from app.services.bom_service import BomFilters, BomService


# Attribute filters are optional repeatable query params (?mfgclass=A&mfgclass=B).
# Filters apply only to descendants — the queried root part is always included.
# The (maturity, design_intent) filter is sent as repeated "maturity|intent"
# strings via the `maturity_intent_pair` param; each pair matches rows whose
# (maturity_level, design_intent) tuple equals it, with all pairs OR'd together.
# design_intent is the API-level enum ("Production" / "Prototype"), translated
# to raw DB values inside the service layer; see _design_intent and
# _build_attr_filter_clause in bom_service.py.

router = APIRouter()
_bom = BomService()


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _parse_pair_filter(
    values: Optional[List[str]],
) -> Optional[List[tuple[str, str]]]:
    """Parse `?maturity_intent_pair=mat|intent` (repeatable) into tuples.

    intent must be "Production" or "Prototype". Returns None when empty so
    BomFilters treats it as "no filter".
    """
    if not values:
        return None
    out: list[tuple[str, str]] = []
    for v in values:
        if "|" not in v:
            raise HTTPException(
                status_code=400,
                detail=f"Invalid maturity_intent_pair (expected 'maturity|intent'): {v!r}",
            )
        mat, _, intent = v.partition("|")
        if not mat or intent not in ("Production", "Prototype"):
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Invalid maturity_intent_pair {v!r}: "
                    "intent must be 'Production' or 'Prototype'"
                ),
            )
        out.append((mat, intent))
    return out


@router.get("/bom/tree", response_model=List[BomTreeRow])
def get_bom_tree(
    part_number: str = Query(..., description="Root part identity"),
    check_time: Optional[datetime] = Query(None),
    bom_level: Optional[int] = Query(None, ge=1),
    mfgclass: Optional[List[str]] = Query(None, description="Filter descendants by MFG class (repeatable)"),
    source: Optional[List[str]] = Query(None, description="Filter descendants by source, e.g. Buy / Make (repeatable)"),
    maturity_intent_pair: Optional[List[str]] = Query(
        None,
        description=(
            "Filter descendants by (maturity, design_intent) pair, encoded "
            "'maturity|intent' (repeatable). intent ∈ {Production, Prototype}."
        ),
    ),
) -> List[BomTreeRow]:
    filters = BomFilters(
        mfgclass=mfgclass,
        source=source,
        maturity_intent_pairs=_parse_pair_filter(maturity_intent_pair),
    )
    try:
        with get_pool().connection() as conn:
            return _bom.get_bom_tree(
                conn,
                part_number,
                check_time or _now(),
                bom_level,
                filters,
            )
    except psycopg.OperationalError as exc:
        raise HTTPException(status_code=503, detail=f"Database unavailable: {exc}")


@router.get("/bom/statistics", response_model=BomStatisticsResponse)
def get_bom_statistics(
    part_number: str = Query(..., description="Root part identity"),
    check_time: Optional[datetime] = Query(None),
    mfgclass: Optional[List[str]] = Query(None, description="Filter descendants by MFG class (repeatable)"),
    source: Optional[List[str]] = Query(None, description="Filter descendants by source, e.g. Buy / Make (repeatable)"),
    maturity_intent_pair: Optional[List[str]] = Query(
        None,
        description=(
            "Filter descendants by (maturity, design_intent) pair, encoded "
            "'maturity|intent' (repeatable). intent ∈ {Production, Prototype}."
        ),
    ),
) -> BomStatisticsResponse:
    filters = BomFilters(
        mfgclass=mfgclass,
        source=source,
        maturity_intent_pairs=_parse_pair_filter(maturity_intent_pair),
    )
    try:
        with get_pool().connection() as conn:
            return _bom.get_bom_statistics(
                conn,
                part_number,
                check_time or _now(),
                filters,
            )
    except psycopg.OperationalError as exc:
        raise HTTPException(status_code=503, detail=f"Database unavailable: {exc}")


@router.get("/bom/where-used", response_model=List[WhereUsedRow])
def get_where_used(
    part_number: str = Query(..., description="Child part identity"),
    check_time: Optional[datetime] = Query(None),
) -> List[WhereUsedRow]:
    try:
        with get_pool().connection() as conn:
            return _bom.get_where_used(
                conn,
                part_number,
                check_time or _now(),
            )
    except psycopg.OperationalError as exc:
        raise HTTPException(status_code=503, detail=f"Database unavailable: {exc}")