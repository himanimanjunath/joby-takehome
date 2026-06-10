from datetime import datetime
from typing import List, Optional

from pydantic import BaseModel

# ---------------------------------------------------------------------------
# BOM tree (/bom/tree)
# ---------------------------------------------------------------------------


class BomTreeRow(BaseModel):
    """One row in the hierarchical BOM tree view.

    intend: pipe-separated path string (e.g. "0|1|2") used for ordering.
    bom_level: depth relative to the queried root (root = 0).
    child_quantity: quantity of this part under its immediate parent.
    total_mass: per_unit_mass * child_quantity.

    title is the root-stem ("215514-003") shown in the "Part Number"
    column; revision is the full rev including any minor (e.g. "A.1").
    part_number is the full identity ("215514-003 A.1") and remains the
    click-through / drill-in key.
    """
    intend: Optional[str] = None
    bom_level: int
    title: Optional[str] = None
    revision: Optional[str] = None
    part_number: Optional[str] = None
    part_description: Optional[str] = None
    parent_part_number: Optional[str] = None
    maturity_level: Optional[str] = None
    design_intent: Optional[str] = None
    source: Optional[str] = None
    mfgclass: Optional[str] = None
    product_type: Optional[str] = None
    child_quantity: Optional[int] = None
    per_unit_mass: Optional[float] = None
    total_mass: Optional[float] = None
    modified_timestamp: Optional[str] = None


# ---------------------------------------------------------------------------
# BOM statistics (/bom/statistics)
# ---------------------------------------------------------------------------


class BomStatsPart(BaseModel):
    """Flattened part entry in the statistics rollup.

    flatten_quantity: sum of all occurrences across the full BOM (not just
    direct children), so the same physicalid may be counted multiple times.
    bom_level: shallowest level at which this part appears.

    title / revision split the part_number identity into display columns;
    see BomTreeRow for the contract.
    """
    physicalid: Optional[str] = None
    title: Optional[str] = None
    revision: Optional[str] = None
    part_number: Optional[str] = None
    part_description: Optional[str] = None
    source: Optional[str] = None
    mfgclass: Optional[str] = None
    maturity_level: Optional[str] = None
    design_intent: Optional[str] = None
    product_type: Optional[str] = None
    bom_level: Optional[int] = None
    child_quantity: Optional[int] = None
    flatten_quantity: Optional[float] = None
    per_unit_mass: Optional[float] = None
    total_mass: Optional[float] = None
    modified_timestamp: Optional[str] = None


class BomStatisticsResponse(BaseModel):
    root_mass_g: Optional[float] = None
    parts: List[BomStatsPart] = []


class WhereUsedRow(BaseModel):
    """One row in the where-used view.

    part_number: the part number of the parent assembly.
    part_description: the description of the parent assembly.
    child_quantity: the quantity of this part in the parent assembly.
    """
    part_number: Optional[str] = None
    part_description: Optional[str] = None
    child_quantity: Optional[int] = None


# ---------------------------------------------------------------------------
# Part detail & search (/parts/*)
# ---------------------------------------------------------------------------


class PartSearchResult(BaseModel):
    identity: str
    valid_from: Optional[datetime] = None
    valid_to: Optional[datetime] = None


class PartDetail(BaseModel):
    """Full attribute snapshot for a single part at the queried timestamp.

    computed_mass: rolled-up mass from 3DX (kg → g conversion applied).
    declared_mass: manually entered mass (kg → g conversion applied).
    per_unit_mass: from part_mass_rollup, which prefers computed over declared.
    max_depth: maximum BOM level reachable when this part is the root (0 = leaf).
    """
    physicalid: Optional[str] = None
    part_number: Optional[str] = None
    part_description: Optional[str] = None
    source: Optional[str] = None
    mfgclass: Optional[str] = None
    maturity_level: Optional[str] = None
    design_intent: Optional[str] = None
    per_unit_mass: Optional[float] = None
    computed_mass: Optional[float] = None
    declared_mass: Optional[float] = None
    max_depth: Optional[int] = None


class FiltersResponse(BaseModel):
    bom_levels: List[int] = []
