import React, { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { formatDateTime, formatNumber, toLabel } from "../lib/dataChartHelpers";

export type TableColumn = { key: string; label: string };
export type TableRow = Record<string, unknown>;

const PAGE_SIZE = 100;

export const DataTable = ({
  rows,
  columns,
  cellRenderers = {},
  excludeKeys = [],
  emptyMessage = "No data available.",
  stickyColumns = 0,
  columnLabels = {},
  columnMinWidths = {},
  onSearchChange,
  onHiddenColumnsChange,
}: {
  rows: TableRow[];
  columns?: TableColumn[];
  cellRenderers?: Record<string, (value: unknown, row: TableRow) => ReactNode>;
  excludeKeys?: string[];
  emptyMessage?: string;
  stickyColumns?: number;
  columnLabels?: Record<string, string>;
  columnMinWidths?: Record<string, number>;
  onSearchChange?: (term: string) => void;
  onHiddenColumnsChange?: (hidden: Set<string>) => void;
}) => {
  const [page, setPage] = useState(0);
  const [search, setSearch] = useState("");
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [hiddenColumns, setHiddenColumns] = useState<Set<string>>(new Set());
  const [columnPickerOpen, setColumnPickerOpen] = useState(false);
  const theadRef = useRef<HTMLTableSectionElement>(null);
  const tbodyRef = useRef<HTMLTableSectionElement>(null);
  const colPickerRef = useRef<HTMLDivElement>(null);
  const [stickyOffsets, setStickyOffsets] = useState<number[]>([]);
  const [colWidths, setColWidths] = useState<number[]>([]);
  const resizeRef = useRef<{
    colIndex: number;
    startX: number;
    startWidth: number;
    initialWidths: number[];
    onMove: (e: MouseEvent) => void;
    onUp: () => void;
  } | null>(null);

  // Cleanup resize listeners on unmount
  useEffect(() => {
    return () => {
      if (resizeRef.current) {
        window.removeEventListener("mousemove", resizeRef.current.onMove);
        window.removeEventListener("mouseup", resizeRef.current.onUp);
        document.body.style.cursor = "";
        document.body.style.userSelect = "";
      }
    };
  }, []);

  const startResize = (e: React.MouseEvent<HTMLDivElement>, colIndex: number) => {
    e.preventDefault();
    const ths = theadRef.current?.querySelectorAll("th");
    const initialWidths = ths
      ? Array.from(ths).map((t) => (t as HTMLElement).offsetWidth)
      : colWidths;
    const startWidth = initialWidths[colIndex] ?? 100;

    const colKey = visibleColumns[colIndex]?.key;
    const floor = colKey ? columnMinWidths[colKey] ?? 60 : 60;
    const onMove = (ev: MouseEvent) => {
      if (!resizeRef.current) return;
      const delta = ev.clientX - resizeRef.current.startX;
      const newWidth = Math.max(floor, resizeRef.current.startWidth + delta);
      setColWidths((prev) => {
        const base = prev.length > 0 ? prev : resizeRef.current!.initialWidths;
        const next = [...base];
        next[colIndex] = newWidth;
        return next;
      });
    };

    const onUp = () => {
      resizeRef.current = null;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    };

    resizeRef.current = { colIndex, startX: e.clientX, startWidth, initialWidths, onMove, onUp };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  };

  const derivedColumns: TableColumn[] = columns ?? (() => {
    if (rows.length === 0) return [];
    const keys = Object.keys(rows[0]).filter((k) => !excludeKeys.includes(k));
    // Keep all keys — collapsing the tree shouldn't drop columns that are
    // only temporarily all-null for the visible row subset. The backend
    // shouldn't emit [null, null] compare pairs across every row, so the
    // original empty-column filter is unnecessary.
    // const isEmpty = (v: unknown): boolean =>
    //   v == null ||
    //   v === "" ||
    //   (Array.isArray(v) && v.every((x) => x == null || x === ""));
    // const nonEmptyKeys = keys.filter((k) => rows.some((r) => !isEmpty(r[k])));
    return keys.map((key) => ({ key, label: columnLabels[key] ?? toLabel(key) }));
  })();

  // Columns the user has chosen to show.
  const visibleColumns = useMemo(
    () => derivedColumns.filter((c) => !hiddenColumns.has(c.key)),
    [derivedColumns, hiddenColumns],
  );

  // Reset column widths when the visible column set changes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { setColWidths([]); }, [visibleColumns.length]);

  // Notify parent when the user-hidden column set changes so external
  // consumers (e.g. CSV export) can honour the same selection.
  useEffect(() => {
    onHiddenColumnsChange?.(hiddenColumns);
  }, [hiddenColumns, onHiddenColumnsChange]);

  // Close the column picker on outside click.
  useEffect(() => {
    if (!columnPickerOpen) return;
    const onDown = (e: MouseEvent) => {
      if (colPickerRef.current && !colPickerRef.current.contains(e.target as Node)) {
        setColumnPickerOpen(false);
      }
    };
    window.addEventListener("mousedown", onDown);
    return () => window.removeEventListener("mousedown", onDown);
  }, [columnPickerOpen]);

  const toggleColumnVisibility = (key: string) => {
    setHiddenColumns((prev) => {
      const next = new Set(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        // Don't allow hiding the last visible column.
        if (derivedColumns.length - next.size <= 1) return prev;
        next.add(key);
      }
      return next;
    });
  };

  // Rows that match the current search term. `null` means search is inactive
  // and no highlighting should be applied. Search no longer filters rows —
  // unmatched rows stay visible so users can see context around matches.
  // Only visible columns are searched.
  const matched = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return null;
    const set = new Set<TableRow>();
    for (const row of rows) {
      for (const col of visibleColumns) {
        const v = row[col.key];
        if (v != null && String(v).toLowerCase().includes(q)) {
          set.add(row);
          break;
        }
      }
    }
    return set;
  }, [rows, search, visibleColumns]);

  // Apply sort. Nulls always sink to the bottom. Compare-pair arrays sort by
  // the source value (first element).
  const displayRows = useMemo(() => {
    if (!sortKey) return rows;
    const unwrap = (v: unknown): unknown =>
      Array.isArray(v) && v.length === 2 ? v[0] : v;
    const mult = sortDir === "asc" ? 1 : -1;
    const copy = [...rows];
    copy.sort((a, b) => {
      const av = unwrap(a[sortKey]);
      const bv = unwrap(b[sortKey]);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") return (av - bv) * mult;
      return String(av).localeCompare(String(bv), undefined, { numeric: true }) * mult;
    });
    return copy;
  }, [rows, sortKey, sortDir]);

  // Reset pagination on data/search change; jump to first page that contains
  // a match when searching so highlighted rows are visible.
  useEffect(() => {
    if (matched && matched.size > 0) {
      for (let i = 0; i < displayRows.length; i++) {
        if (matched.has(displayRows[i])) {
          setPage(Math.floor(i / PAGE_SIZE));
          return;
        }
      }
    }
    setPage(0);
  }, [displayRows, matched]);

  // Cycle: unsorted → asc → desc → unsorted.
  const toggleSort = (key: string) => {
    if (sortKey !== key) {
      setSortKey(key);
      setSortDir("asc");
      return;
    }
    if (sortDir === "asc") {
      setSortDir("desc");
      return;
    }
    setSortKey(null);
  };

  // After the page jump, scroll the first highlighted row into view.
  useEffect(() => {
    if (!matched || matched.size === 0) return;
    const el = tbodyRef.current?.querySelector<HTMLElement>("tr.row-highlight");
    if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
  }, [matched, page]);

  const handleSearchInput = (val: string) => {
    setSearch(val);
    onSearchChange?.(val);
  };

  // Measure actual th widths after render to compute sticky left offsets.
  // Must re-run whenever the visible columns or row set change — a filter
  // refetch can shrink/grow cell content (and therefore th widths) without
  // changing stickyColumns, leaving cached offsets stale and causing the
  // sticky columns to overlap each other or push later columns off-screen.
  // Guard the setState with a shallow-equal check so a fresh array reference
  // with the same values doesn't re-trigger this effect.
  const visibleColKeys = visibleColumns.map((c) => c.key).join("|");
  useEffect(() => {
    if (!stickyColumns || !theadRef.current) return;
    const ths = theadRef.current.querySelectorAll("th");
    const offsets: number[] = [];
    let left = 0;
    for (let i = 0; i < stickyColumns && i < ths.length; i++) {
      offsets.push(left);
      left += (ths[i] as HTMLElement).offsetWidth;
    }
    setStickyOffsets((prev) =>
      prev.length === offsets.length && prev.every((v, i) => v === offsets[i])
        ? prev
        : offsets,
    );
  }, [stickyColumns, visibleColKeys, rows, colWidths]);

  const isMassField = (key: string) => key.includes("mass") || key.includes("weight");
  const isCostField = (key: string) => key.includes("cost");
  const isTimeField = (key: string) => key.includes("timestamp") || key.includes("check_time");
  const COST_TOOLTIP = "Ask finance department for further information";

  const renderCell = (key: string, value: unknown, row: TableRow): ReactNode => {
    const renderer = cellRenderers[key];
    if (renderer) return renderer(value, row);
    if (value == null) return "-";
    if (Array.isArray(value) && value.length === 2) {
      const [src, tgt] = value;
      const fmt = (v: unknown) => {
        if (v == null) return "—";
        if (typeof v === "number") return isMassField(key) ? `${formatNumber(v)} g` : formatNumber(v);
        if (typeof v === "string" && isTimeField(key)) return formatDateTime(v);
        return String(v);
      };
      if (src === tgt) return <span>{fmt(src)}</span>;
      return (
        <span style={{ display: "inline-flex", gap: "2px" }}>
          <span className="cmp-pill-src">{fmt(src)}</span>
          <span className="cmp-pill-tgt">{fmt(tgt)}</span>
        </span>
      );
    }
    if (Array.isArray(value)) return value.length > 0 ? value.length : "-";
    if (typeof value === "number")
      return isMassField(key) ? `${formatNumber(value)} g` : formatNumber(value);
    if (typeof value === "string" && isTimeField(key)) return formatDateTime(value);
    return String(value);
  };

  const paginate = displayRows.length > PAGE_SIZE;
  const totalPages = Math.ceil(displayRows.length / PAGE_SIZE);
  const visibleRows = paginate ? displayRows.slice(page * PAGE_SIZE, (page + 1) * PAGE_SIZE) : displayRows;

  const stickyStyle = (colIndex: number): React.CSSProperties =>
    colIndex < stickyColumns ? { left: stickyOffsets[colIndex] ?? 0 } : {};

  return (
    <div className="table-wrapper">
      <div className="table-search">
        <input
          type="search"
          placeholder="Search..."
          value={search}
          onChange={(e) => handleSearchInput(e.target.value)}
        />
        {search && (
          <span className="table-search-count">
            {matched?.size ?? 0} {(matched?.size ?? 0) === 1 ? "match" : "matches"} / {rows.length}
          </span>
        )}
        <div className="col-picker" ref={colPickerRef}>
          <button
            type="button"
            className="col-picker-btn"
            onClick={() => setColumnPickerOpen((o) => !o)}
            aria-expanded={columnPickerOpen}
          >
            Select Columns ({visibleColumns.length}/{derivedColumns.length})
          </button>
          {columnPickerOpen && (
            <div className="col-picker-menu" role="menu">
              <div className="col-picker-actions">
                <button
                  type="button"
                  onClick={() => setHiddenColumns(new Set())}
                  disabled={hiddenColumns.size === 0}
                >
                  Show all
                </button>
              </div>
              <div className="col-picker-list">
                {derivedColumns.map((col) => {
                  const checked = !hiddenColumns.has(col.key);
                  const isLastVisible = checked && visibleColumns.length === 1;
                  return (
                    <label key={col.key} className="col-picker-item">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={isLastVisible}
                        onChange={() => toggleColumnVisibility(col.key)}
                      />
                      <span>{col.label}</span>
                    </label>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
      <div className="table-scroll">
        <table style={colWidths.length > 0 ? { tableLayout: "fixed" } : undefined}>
          <colgroup>
            {visibleColumns.map((col, i) => {
              const minWidth = columnMinWidths[col.key];
              const style: React.CSSProperties = {};
              if (colWidths[i]) style.width = colWidths[i];
              if (minWidth) style.minWidth = minWidth;
              return <col key={col.key} style={Object.keys(style).length ? style : undefined} />;
            })}
          </colgroup>
          <thead ref={theadRef}>
            <tr>
              {visibleColumns.map((column, colIndex) => {
                const isSorted = sortKey === column.key;
                const ariaSort = isSorted
                  ? (sortDir === "asc" ? "ascending" : "descending")
                  : "none";
                const minWidth = columnMinWidths[column.key];
                const thStyle: React.CSSProperties = { ...stickyStyle(colIndex) };
                if (minWidth) thStyle.minWidth = minWidth;
                return (
                  <th
                    key={column.key}
                    className={colIndex < stickyColumns ? "sticky-col" : undefined}
                    style={thStyle}
                    aria-sort={ariaSort}
                  >
                    <button
                      type="button"
                      className="col-sort-btn"
                      onClick={() => toggleSort(column.key)}
                    >
                      <span>{column.label}</span>
                      <span className="col-sort-indicator">
                        {isSorted ? (sortDir === "asc" ? "▲" : "▼") : "↕"}
                      </span>
                    </button>
                    <div className="col-resize-handle" onMouseDown={(e) => startResize(e, colIndex)} />
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody ref={tbodyRef}>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={visibleColumns.length}>{emptyMessage}</td>
              </tr>
            ) : (
              visibleRows.map((row, index) => (
                <tr
                  key={`${String(row.part_number ?? row.parent_part_number ?? "row")}-${index}`}
                  className={matched?.has(row) ? "row-highlight" : undefined}
                >
                  {visibleColumns.map((column, colIndex) => (
                    <td
                      key={column.key}
                      className={colIndex < stickyColumns ? "sticky-col" : undefined}
                      style={stickyStyle(colIndex)}
                      data-tooltip={isCostField(column.key) ? COST_TOOLTIP : undefined}
                    >
                      {renderCell(column.key, row[column.key], row)}
                    </td>
                  ))}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
      {paginate && (
        <div className="pagination">
          <button type="button" onClick={() => setPage((p) => p - 1)} disabled={page === 0}>
            ‹ Prev
          </button>
          <span>
            {page * PAGE_SIZE + 1}–{Math.min((page + 1) * PAGE_SIZE, rows.length)} of {rows.length}
          </span>
          <button type="button" onClick={() => setPage((p) => p + 1)} disabled={page >= totalPages - 1}>
            Next ›
          </button>
        </div>
      )}
    </div>
  );
};
