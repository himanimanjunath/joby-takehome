from dataclasses import dataclass
from datetime import datetime, timezone
from typing import List, Optional, Tuple

from psycopg.rows import dict_row

from app.schemas.bom import (
    BomStatsPart,
    BomStatisticsResponse,
    BomTreeRow,
    PartDetail,
    PartSearchResult,
)


def _now() -> datetime:
    return datetime.now(timezone.utc)


def _design_intent(raw: Optional[str]) -> Optional[str]:
    if raw is None:
        return None
    if raw in ("Production", "Formal"):
        return "Production"
    return "Prototype"


@dataclass(frozen=True)
class BomFilters:
    """Optional attribute filters applied to descendants in BOM queries.

    mfgclass and source: list of values OR'd within field. maturity_intent_pairs:
    list of (maturity_level, design_intent) tuples OR'd together; each pair's two
    fields are AND'd. design_intent uses the API enum ("Production" / "Prototype");
    _build_attr_filter_clause translates each pair's intent to the raw DB column
    (designintent in ('Production','Formal') for Production, else not-in-those).
    Cross-field semantics (mfgclass × source × pairs) is AND.
    """
    mfgclass: Optional[List[str]] = None
    source: Optional[List[str]] = None
    maturity_intent_pairs: Optional[List[Tuple[str, str]]] = None

    def is_empty(self) -> bool:
        return not (self.mfgclass or self.source or self.maturity_intent_pairs)


def _build_attr_filter_clause(
    filters: Optional[BomFilters],
    params: dict,
    alias: str = "a",
) -> str:
    """Build a `AND ...` SQL fragment that filters part_attributes columns.

    Returns "" when filters is None or fully empty. Mutates `params` to bind
    the filter values under reserved keys (f_mfgclass, f_source, f_pair_mat_<i>).
    Callers must not reuse those keys. The fragment assumes at least one WHERE
    predicate already exists above it (since every line starts with `AND`).

    Each maturity/intent pair becomes (current = mat AND <designintent-clause>),
    with all pairs OR'd together. The designintent clause translates the API
    enum back to raw DB values:
      "Production" -> designintent IN ('Production', 'Formal')
      "Prototype"  -> designintent IS NOT NULL AND NOT IN ('Production','Formal')
    """
    if filters is None or filters.is_empty():
        return ""

    fragments: list[str] = []
    if filters.mfgclass:
        fragments.append(f"AND {alias}.mfgclass = ANY(%(f_mfgclass)s)")
        params["f_mfgclass"] = list(filters.mfgclass)
    if filters.source:
        fragments.append(f"AND {alias}.source = ANY(%(f_source)s)")
        params["f_source"] = list(filters.source)
    if filters.maturity_intent_pairs:
        pair_clauses: list[str] = []
        for i, (mat, intent) in enumerate(filters.maturity_intent_pairs):
            mat_key = f"f_pair_mat_{i}"
            params[mat_key] = mat
            if intent == "Production":
                di_clause = f"{alias}.designintent IN ('Production', 'Formal')"
            elif intent == "Prototype":
                di_clause = (
                    f"({alias}.designintent IS NOT NULL "
                    f"AND {alias}.designintent NOT IN ('Production', 'Formal'))"
                )
            else:
                di_clause = "FALSE"  # unknown intent literal — match nothing
            pair_clauses.append(
                f"({alias}.current = %({mat_key})s AND {di_clause})"
            )
        fragments.append("AND (" + " OR ".join(pair_clauses) + ")")
    return "\n              ".join(fragments)


class BomService:

    # ------------------------------------------------------------------
    # BOM Tree
    # ------------------------------------------------------------------

    def get_bom_tree(
        self,
        conn,
        part_number: str,
        check_time: Optional[datetime] = None,
        bom_level: Optional[int] = None,
        filters: Optional[BomFilters] = None,
    ) -> List[BomTreeRow]:
        if check_time is None:
            check_time = _now()

        part_physicalid = self._resolve_physicalid(conn, part_number, check_time)
        if part_physicalid is None:
            return []

        # Use bom_assembly_index to find the root and depth for this assembly
        index_row = self._resolve_index(conn, part_physicalid, check_time)
        if index_row:
            root_physicalid = index_row["root_physicalid"]
            depth_offset = index_row["assembly_depth"]
            is_subtree = root_physicalid != part_physicalid
        else:
            root_physicalid = part_physicalid
            depth_offset = 0
            is_subtree = False

        params: dict = {
            "root_physicalid": root_physicalid,
            "check_time": check_time,
            "depth_offset": depth_offset,
            "part_physicalid": part_physicalid,
        }

        subtree_filter = ""
        if is_subtree:
            subtree_filter = (
                "AND f.intend LIKE %(assembly_intend)s || '|%%'\n"
                "  AND %(part_physicalid)s = ANY(f.path_ids)"
            )
            params["assembly_intend"] = index_row["assembly_intend"]

        if is_subtree:
            intend_expr = "'0' || SUBSTRING(f.intend FROM LENGTH(%(assembly_intend)s) + 1)"
        else:
            intend_expr = "f.intend"

        depth_filter = ""
        if bom_level is not None:
            # bom_level is relative to the queried assembly, so compare against normalised depth
            depth_filter = "AND (f.depth - %(depth_offset)s) <= %(bom_level)s"
            params["bom_level"] = bom_level

        # Attribute filters apply only to descendants — the named root is always
        # returned at bom_level=0 regardless. Bound params land in `params` under
        # f_mfgclass / f_source / f_pair_mat_<i> (see _build_attr_filter_clause).
        attr_filter = _build_attr_filter_clause(filters, params, alias="a")

        sql = f"""
        WITH bom AS (
            SELECT
                0                         AS bom_level,
                '0'                       AS intend,
                %(part_physicalid)s       AS child_physicalid,
                NULL::text                AS parent_physicalid,
                NULL::integer             AS child_quantity,
                a.identity                AS part_number,
                a.revision                AS revision,
                a.description             AS part_description,
                a.source,
                a.mfgclass,
                a.current                 AS maturity_level,
                a.designintent,
                a.producttype             AS product_type,
                m.mass_g                  AS per_unit_mass,
                a.title,
                TO_CHAR(a.event_time, 'YYYY/MM/DD') AS modified_timestamp,
                NULL::text                AS parent_part_number
            FROM part_attributes a
            LEFT JOIN part_mass_rollup m
                ON a.physicalid = m.physicalid
               AND %(check_time)s >= m.mass_valid_from
               AND %(check_time)s < m.mass_valid_to
            WHERE a.physicalid = %(part_physicalid)s
              AND %(check_time)s >= a.valid_from
              AND %(check_time)s < COALESCE(a.valid_to, '9999-12-31'::timestamptz)

            UNION ALL

            SELECT
                (f.depth - %(depth_offset)s)  AS bom_level,
                {intend_expr}                 AS intend,
                f.child_physicalid,
                f.parent_physicalid,
                f.child_quantity,
                a.identity                AS part_number,
                a.revision                AS revision,
                a.description             AS part_description,
                a.source,
                a.mfgclass,
                a.current                 AS maturity_level,
                a.designintent,
                a.producttype             AS product_type,
                m.mass_g                  AS per_unit_mass,
                a.title,
                TO_CHAR(a.event_time, 'YYYY/MM/DD') AS modified_timestamp,
                pa.identity               AS parent_part_number
            FROM bom_forest f
            LEFT JOIN part_attributes a
                ON f.child_physicalid = a.physicalid
               AND %(check_time)s >= a.valid_from
               AND %(check_time)s < COALESCE(a.valid_to, '9999-12-31'::timestamptz)
            LEFT JOIN part_attributes pa
                ON f.parent_physicalid = pa.physicalid
               AND %(check_time)s >= pa.valid_from
               AND %(check_time)s < COALESCE(pa.valid_to, '9999-12-31'::timestamptz)
            LEFT JOIN part_mass_rollup m
                ON f.child_physicalid = m.physicalid
               AND %(check_time)s >= m.mass_valid_from
               AND %(check_time)s < m.mass_valid_to
            WHERE f.root_physicalid = %(root_physicalid)s
              AND f.child_physicalid != %(part_physicalid)s
              AND %(check_time)s >= f.path_valid_from
              AND %(check_time)s < f.path_valid_to
              {subtree_filter}
              {depth_filter}
              {attr_filter}
        )
        SELECT DISTINCT
            intend,
            bom_level,
            part_number,
            revision,
            part_description,
            parent_part_number,
            maturity_level,
            designintent,
            source,
            mfgclass,
            product_type,
            child_quantity,
            per_unit_mass,
            per_unit_mass * child_quantity   AS total_mass,
            modified_timestamp,
            title,
            child_physicalid
        FROM bom
        WHERE LOWER(COALESCE(product_type, '')) != 'collector'
        ORDER BY intend
        """

        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(sql, params)
            rows = cur.fetchall()

        if not rows:
            return []

        results = []
        for r in rows:
            results.append(BomTreeRow(
                intend=r.get("intend"),
                bom_level=r["bom_level"],
                title=r.get("title"),
                revision=r.get("revision"),
                part_number=r.get("part_number"),
                part_description=r.get("part_description"),
                parent_part_number=r.get("parent_part_number"),
                maturity_level=r.get("maturity_level"),
                design_intent=_design_intent(r.get("designintent")),
                source=r.get("source"),
                mfgclass=r.get("mfgclass"),
                product_type=r.get("product_type"),
                child_quantity=r.get("child_quantity"),
                per_unit_mass=r.get("per_unit_mass"),
                total_mass=r.get("total_mass"),
                modified_timestamp=r.get("modified_timestamp"),
            ))
        return results

    # ------------------------------------------------------------------
    # BOM Statistics
    # ------------------------------------------------------------------

    def get_bom_statistics(
        self,
        conn,
        part_number: str,
        check_time: Optional[datetime] = None,
        filters: Optional[BomFilters] = None,
    ) -> BomStatisticsResponse:
        if check_time is None:
            check_time = _now()

        part_physicalid = self._resolve_physicalid(conn, part_number, check_time)
        if part_physicalid is None:
            return BomStatisticsResponse()

        # Use bom_assembly_index to find the root and depth for this assembly
        index_row = self._resolve_index(conn, part_physicalid, check_time)
        if index_row:
            root_physicalid = index_row["root_physicalid"]
            depth_offset = index_row["assembly_depth"]
            is_subtree = root_physicalid != part_physicalid
        else:
            root_physicalid = part_physicalid
            depth_offset = 0
            is_subtree = False

        root_mass_g = self._fetch_root_mass(conn, part_physicalid, check_time)

        subtree_filter = ""
        params: dict = {
            "root_physicalid": root_physicalid,
            "check_time": check_time,
            "depth_offset": depth_offset,
            "part_physicalid": part_physicalid,
        }
        if is_subtree:
            subtree_filter = (
                "AND f.intend LIKE %(assembly_intend)s || '|%%'\n"
                "  AND %(part_physicalid)s = ANY(f.path_ids)"
            )
            params["assembly_intend"] = index_row["assembly_intend"]

        # Attribute filters apply to descendants only; the root row is built
        # from a direct part_attributes lookup and is always included so the
        # parts[] list always contains context for the queried assembly.
        # root_mass_g is also not affected by filters since it describes the
        # root part itself, not the descendant set.
        attr_filter = _build_attr_filter_clause(filters, params, alias="a")

        sql = f"""
        WITH bom AS (
            SELECT
                0                         AS bom_level,
                %(part_physicalid)s       AS child_physicalid,
                1                         AS child_quantity,
                a.identity                AS part_number,
                a.revision                AS revision,
                a.description             AS part_description,
                a.source,
                a.mfgclass,
                a.current                 AS maturity_level,
                a.designintent,
                a.producttype             AS product_type,
                m.mass_g                  AS per_unit_mass,
                a.title,
                TO_CHAR(a.event_time, 'YYYY/MM/DD') AS modified_timestamp
            FROM part_attributes a
            LEFT JOIN part_mass_rollup m
                ON a.physicalid = m.physicalid
               AND %(check_time)s >= m.mass_valid_from
               AND %(check_time)s < m.mass_valid_to
            WHERE a.physicalid = %(part_physicalid)s
              AND %(check_time)s >= a.valid_from
              AND %(check_time)s < COALESCE(a.valid_to, '9999-12-31'::timestamptz)

            UNION ALL

            SELECT
                (f.depth - %(depth_offset)s)  AS bom_level,
                f.child_physicalid,
                f.child_quantity,
                a.identity                AS part_number,
                a.revision                AS revision,
                a.description             AS part_description,
                a.source,
                a.mfgclass,
                a.current                 AS maturity_level,
                a.designintent,
                a.producttype             AS product_type,
                m.mass_g                  AS per_unit_mass,
                a.title,
                TO_CHAR(a.event_time, 'YYYY/MM/DD') AS modified_timestamp
            FROM bom_forest f
            LEFT JOIN part_attributes a
                ON f.child_physicalid = a.physicalid
               AND %(check_time)s >= a.valid_from
               AND %(check_time)s < COALESCE(a.valid_to, '9999-12-31'::timestamptz)
            LEFT JOIN part_mass_rollup m
                ON f.child_physicalid = m.physicalid
               AND %(check_time)s >= m.mass_valid_from
               AND %(check_time)s < m.mass_valid_to
            WHERE f.root_physicalid = %(root_physicalid)s
              AND f.child_physicalid != %(part_physicalid)s
              AND %(check_time)s >= f.path_valid_from
              AND %(check_time)s < f.path_valid_to
              {subtree_filter}
              {attr_filter}
        )
        SELECT
            child_physicalid                         AS physicalid,
            MAX(part_number)                         AS part_number,
            MAX(title)                               AS title,
            MAX(revision)                            AS revision,
            MAX(part_description)                    AS part_description,
            MAX(source)                              AS source,
            MAX(mfgclass)                            AS mfgclass,
            MAX(maturity_level)                      AS maturity_level,
            MAX(designintent)                        AS design_intent,
            MAX(product_type)                        AS product_type,
            MIN(bom_level)                           AS bom_level,
            MAX(child_quantity)                      AS child_quantity,
            SUM(child_quantity)                      AS flatten_quantity,
            MAX(per_unit_mass)                       AS per_unit_mass,
            SUM(per_unit_mass * child_quantity)      AS total_mass,
            MAX(modified_timestamp)                  AS modified_timestamp
        FROM bom
        WHERE LOWER(COALESCE(product_type, '')) != 'collector'
        GROUP BY child_physicalid
        ORDER BY MAX(part_number)
        """

        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(sql, params)
            rows = cur.fetchall()

        parts = [
            BomStatsPart(
                physicalid=r["physicalid"],
                title=r.get("title"),
                revision=r.get("revision"),
                part_number=r.get("part_number"),
                part_description=r.get("part_description"),
                source=r.get("source"),
                mfgclass=r.get("mfgclass"),
                maturity_level=r.get("maturity_level"),
                design_intent=_design_intent(r.get("design_intent")),
                product_type=r.get("product_type"),
                bom_level=r.get("bom_level"),
                child_quantity=r.get("child_quantity"),
                flatten_quantity=r.get("flatten_quantity"),
                per_unit_mass=r.get("per_unit_mass"),
                total_mass=r.get("total_mass"),
                modified_timestamp=r.get("modified_timestamp"),
            )
            for r in rows
        ]
        return BomStatisticsResponse(
            root_mass_g=root_mass_g,
            parts=parts,
        )

    # ------------------------------------------------------------------
    # Part Search
    # ------------------------------------------------------------------

    def search_parts(
        self,
        conn,
        query: str,
        check_time: Optional[datetime] = None,
        limit: int = 50,
    ) -> List[PartSearchResult]:
        if check_time is None:
            check_time = _now()

        sql = """
        SELECT
            identity,
            MIN(valid_from) AS valid_from,
            MAX(valid_to)   AS valid_to
        FROM part_attributes
        WHERE identity ILIKE %(pattern)s
          AND valid_from <= %(check_time)s
          AND (valid_to IS NULL OR valid_to > %(check_time)s)
        GROUP BY identity
        ORDER BY identity
        LIMIT %(limit)s
        """
        params = {"pattern": f"%{query}%", "check_time": check_time, "limit": limit}
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(sql, params)
            rows = cur.fetchall()

        return [
            PartSearchResult(
                identity=r["identity"],
                valid_from=r.get("valid_from"),
                valid_to=r.get("valid_to"),
            )
            for r in rows
        ]

    # ------------------------------------------------------------------
    # Part Detail
    # ------------------------------------------------------------------

    def get_part_detail(
        self,
        conn,
        part_number: str,
        check_time: Optional[datetime] = None,
    ) -> Optional[PartDetail]:
        if check_time is None:
            check_time = _now()

        sql = """
        SELECT
            a.physicalid,
            a.identity                                        AS part_number,
            a.description                                     AS part_description,
            a.source,
            a.mfgclass,
            a.current                                         AS maturity_level,
            a.designintent,
            m.mass_g                                          AS per_unit_mass,
            a.computedmass * 1000                             AS computed_mass,
            a.declaredmass * 1000                             AS declared_mass
        FROM part_attributes a
        LEFT JOIN part_mass_rollup m
            ON a.physicalid = m.physicalid
           AND %(check_time)s >= m.mass_valid_from
           AND %(check_time)s < m.mass_valid_to
        WHERE a.identity = %(part_number)s
          AND a.valid_from <= %(check_time)s
          AND %(check_time)s < COALESCE(a.valid_to, '9999-12-31'::timestamptz)
        LIMIT 1
        """
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(sql, {"part_number": part_number, "check_time": check_time})
            row = cur.fetchone()

        if row is None:
            return None

        physicalid = row.get("physicalid")
        max_depth = self._fetch_max_depth(conn, physicalid, check_time) if physicalid else None

        return PartDetail(
            physicalid=physicalid,
            part_number=row.get("part_number"),
            part_description=row.get("part_description"),
            source=row.get("source"),
            mfgclass=row.get("mfgclass"),
            maturity_level=row.get("maturity_level"),
            design_intent=_design_intent(row.get("designintent")),
            per_unit_mass=row.get("per_unit_mass"),
            computed_mass=row.get("computed_mass"),
            declared_mass=row.get("declared_mass"),
            max_depth=max_depth,
        )

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _resolve_index(
        self, conn, physicalid: str, check_time: datetime
    ) -> Optional[dict]:
        """
        Query bom_assembly_index to find the root_physicalid, assembly_depth,
        and assembly_intend for a given assembly physicalid.
        Returns None if not found.
        """
        sql = """
        SELECT root_physicalid, assembly_depth, assembly_intend
        FROM bom_assembly_index
        WHERE assembly_physicalid = %(physicalid)s
          AND %(check_time)s >= path_valid_from
          AND %(check_time)s < path_valid_to
        ORDER BY assembly_depth
        LIMIT 1
        """
        with conn.cursor(row_factory=dict_row) as cur:
            cur.execute(sql, {"physicalid": physicalid, "check_time": check_time})
            return cur.fetchone()

    def _resolve_physicalid(self, conn, part_number: str, check_time: datetime) -> Optional[str]:
        sql = """
        SELECT physicalid FROM part_attributes
        WHERE identity = %(part_number)s
          AND valid_from <= %(check_time)s
          AND %(check_time)s < COALESCE(valid_to, '9999-12-31'::timestamptz)
        LIMIT 1
        """
        with conn.cursor() as cur:
            cur.execute(sql, {"part_number": part_number, "check_time": check_time})
            row = cur.fetchone()
        return row[0] if row else None

    def _fetch_max_depth(self, conn, part_physicalid: str, check_time: datetime) -> int:
        """Max BOM depth when this part is the root (0 = leaf or not in bom_forest).

        bom_forest stores paths with depth=1 for direct children, so MAX(depth)
        equals the deepest BOM level reachable from this assembly.

        Parts that are only used as sub-assemblies (not stored as bom_forest roots)
        fall back to bom_assembly_index to find their actual root, then compute
        depth relative to their own position in that tree.
        """
        sql = """
        SELECT MAX(depth)
        FROM bom_forest
        WHERE root_physicalid = %(physicalid)s
          AND %(check_time)s >= path_valid_from
          AND %(check_time)s < path_valid_to
        """
        with conn.cursor() as cur:
            cur.execute(sql, {"physicalid": part_physicalid, "check_time": check_time})
            row = cur.fetchone()
        if row and row[0] is not None:
            return int(row[0])

        # Part is not a bom_forest root; look it up via bom_assembly_index
        index_row = self._resolve_index(conn, part_physicalid, check_time)
        if not index_row:
            return 0

        sql2 = """
        SELECT MAX(depth) - %(depth_offset)s
        FROM bom_forest
        WHERE root_physicalid = %(root_physicalid)s
          AND intend LIKE %(assembly_intend)s || '|%%'
          AND %(check_time)s >= path_valid_from
          AND %(check_time)s < path_valid_to
        """
        with conn.cursor() as cur:
            cur.execute(sql2, {
                "root_physicalid": index_row["root_physicalid"],
                "depth_offset": index_row["assembly_depth"],
                "assembly_intend": index_row["assembly_intend"],
                "check_time": check_time,
            })
            row = cur.fetchone()
        return int(row[0]) if row and row[0] is not None else 0

    def _fetch_root_mass(self, conn, root_physicalid: str, check_time: datetime) -> Optional[float]:
        sql = """
        SELECT mass_g
        FROM part_mass_rollup
        WHERE physicalid = %(physicalid)s
          AND %(check_time)s >= mass_valid_from
          AND %(check_time)s < mass_valid_to
        LIMIT 1
        """
        with conn.cursor() as cur:
            cur.execute(sql, {"physicalid": root_physicalid, "check_time": check_time})
            row = cur.fetchone()
        return row[0] if row else None
