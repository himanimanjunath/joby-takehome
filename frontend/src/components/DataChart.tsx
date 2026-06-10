import { useCallback, useEffect, useMemo, useState, useRef } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { EMPTY_DIMENSION_FILTERS, type DimensionFilters, type MaturityIntentPair } from "../lib/apiClient.ts";
import { useBomTree } from "../lib/hooks/useBomTree.ts";
import { useBomStatistics, type BomStatsPart } from "../lib/hooks/useBomStatistics.ts";
import { usePartSearch } from "../lib/hooks/usePartSearch.ts";
import { usePartDetail } from "../lib/hooks/usePartDetail.ts";
import { useFilterOptions } from "../lib/hooks/useFilterOptions.ts";
import { useDebounce } from "../lib/hooks/useDebounce.ts";
import {
  formatDateTime,
  formatNumber,
  getHeatmapKey,
  intendAncestors,
  nowPT,
  timeRangeError,
  toDatetimeLocal,
} from "../lib/dataChartHelpers.ts";
import { DataTable, type TableRow } from "./DataTable.tsx";
import { StatCard } from "./StatCard.tsx";

const isAdditiveClick = (e: { metaKey?: boolean; ctrlKey?: boolean } | undefined) =>
  Boolean(e?.metaKey || e?.ctrlKey);

export default function DataChart() {
  const [assemblyInput, setAssemblyInput] = useState("");
  const [assemblyId, setAssemblyId] = useState("");
  const [checkTime, setCheckTime] = useState<string | null>(null);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(true);
  const [bomLevel, setBomLevel] = useState<number | null>(null);
  const [srcValidFrom, setSrcValidFrom] = useState<string | null>(null);
  const [srcValidTo, setSrcValidTo] = useState<string | null>(null);
  const [collapsedIntends, setCollapsedIntends] = useState<Set<string>>(new Set());
  const [appliedId, setAppliedId] = useState("");
  const [appliedCheckTime, setAppliedCheckTime] = useState<string | null>(null);
  const [appliedBomLevel, setAppliedBomLevel] = useState<number | null>(null);
  const [dimensionFilters, setDimensionFilters] = useState<DimensionFilters>(EMPTY_DIMENSION_FILTERS);
  const [, setHierHiddenColumns] = useState<Set<string>>(new Set());
  const hideTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Clean up any pending blur timer on unmount
  useEffect(() => () => {
    if (hideTimerRef.current !== null) clearTimeout(hideTimerRef.current);
  }, []);

  const debouncedAssemblyInput = useDebounce(assemblyInput, 300);
  const searchQuery = usePartSearch(debouncedAssemblyInput, null, 10);
  const filterOptionsQuery = useFilterOptions();

  const partDetailQuery = usePartDetail(appliedId || null, appliedCheckTime);
  const previewDetailQuery = usePartDetail(assemblyId || null, checkTime);
  const maxDepth = previewDetailQuery.data?.max_depth ?? partDetailQuery.data?.max_depth ?? null;

  useEffect(() => {
    if (maxDepth !== null && bomLevel !== null && bomLevel > maxDepth) {
      setBomLevel(maxDepth);
    }
  }, [maxDepth, bomLevel]);

  const statsQuery = useBomStatistics(appliedId || null, appliedCheckTime);
  const parts: BomStatsPart[] = statsQuery.data?.parts ?? [];

  const bomTreeQuery = useBomTree(appliedId || null, appliedCheckTime, appliedBomLevel, dimensionFilters);
  const treeRows = useMemo(() => bomTreeQuery.data ?? [], [bomTreeQuery.data]);

  const { sourceChartData } = useMemo(() => {
    const sourceCounts = new Map<string, number>();
    for (const p of parts) {
      const srcKey = p.source ?? "(none)";
      sourceCounts.set(srcKey, (sourceCounts.get(srcKey) ?? 0) + 1);
    }
    return {
      sourceChartData: Array.from(sourceCounts, ([label, count]) => ({ label, count })),
    };
  }, [parts]);

  const { mfgClassChartData } = useMemo(() => {
   const mfgClassCounts = new Map<string, number>();
   for (const p of parts){
     const mfgClassKey = p.mfgclass ?? "(none)";
     mfgClassCounts.set(mfgClassKey, (mfgClassCounts.get(mfgClassKey) ?? 0) + 1);
   }
   return {
     mfgClassChartData: Array.from(mfgClassCounts, ([label, count]) => ({ label, count })),
   }
 }, [parts]);

  const totals = useMemo(() => {
    const totalWeight = statsQuery.data?.root_mass_g ?? null;
    return { partsCount: parts.length, totalWeight };
  }, [parts.length, statsQuery.data?.root_mass_g]);

  // Build heatmap in a single pass: collect sets + matrix + max together
  const heatmapData = useMemo(() => {
    const NONE = "(none)";
    const designIntentSet = new Set<string>();
    const maturitySet = new Set<string>();
    const matrix = new Map<string, number>();
    let max = 1;
    for (const p of parts) {
      const intent = p.design_intent || NONE;
      const maturity = p.maturity_level || NONE;
      designIntentSet.add(intent);
      maturitySet.add(maturity);
      const key = getHeatmapKey(intent, maturity);
      const count = (matrix.get(key) ?? 0) + 1;
      matrix.set(key, count);
      if (count > max) max = count;
    }
    return {
      designIntents: Array.from(designIntentSet),
      maturities: Array.from(maturitySet),
      matrix,
      max,
    };
  }, [parts]);

  // Use isLoading (no data yet) instead of isFetching so background refetches
  // — e.g. when toggling dimension filters — leave the charts/tables in place
  // and only swap rows when the new data arrives.
  const loading = statsQuery.isLoading || bomTreeQuery.isLoading;
  const error = statsQuery.isError || bomTreeQuery.isError;

  // Intends that have at least one child row (used to decide whether to render a toggle).
  // Excludes virtual prefix-only parents so they can't collapse descendants that have no toggle.
  const intendsWithChildren = useMemo(() => {
    const rowIntends = new Set(treeRows.map((r) => r.intend).filter(Boolean) as string[]);
    const set = new Set<string>();
    for (const { intend } of treeRows) {
      if (!intend) continue;
      for (const ancestor of intendAncestors(intend)) {
        if (rowIntends.has(ancestor)) set.add(ancestor);
      }
    }
    return set;
  }, [treeRows]);

  // Reset the collapsed set only on an explicit Apply (new assembly / time /
  // level). Filter-driven refetches preserve the user's expand/collapse
  // choices and just prune intends that no longer exist in the new tree. Done
  // during render rather than in an effect to avoid the cascading-render
  // warning — React folds the conditional setState into the same commit.
  const pendingResetCollapseRef = useRef(true);
  const [prevIntendsWithChildren, setPrevIntendsWithChildren] = useState(intendsWithChildren);
  if (prevIntendsWithChildren !== intendsWithChildren) {
    setPrevIntendsWithChildren(intendsWithChildren);
    if (pendingResetCollapseRef.current) {
      setCollapsedIntends(new Set(intendsWithChildren));
      pendingResetCollapseRef.current = false;
    } else {
      setCollapsedIntends((prev) => {
        const next = new Set<string>();
        for (const intend of prev) {
          if (intendsWithChildren.has(intend)) next.add(intend);
        }
        return next.size === prev.size ? prev : next;
      });
    }
  }

  const visibleTreeTableRows = useMemo(
    () => treeRows.filter(({ intend }) =>
      !intend || intendAncestors(intend).every((a) => !collapsedIntends.has(a))
    ) as unknown as TableRow[],
    [treeRows, collapsedIntends],
  );

  // When the user types in the hierarchical BOM table search, expand any
  // collapsed ancestor intends that hide a matching row so the highlight
  // remains visible.
  const handleHierSearchChange = useCallback((term: string) => {
    const q = term.trim().toLowerCase();
    if (!q) return;
    const toOpen = new Set<string>();
    for (const row of treeRows) {
      const intend = row.intend;
      if (!intend) continue;
      const ancestors = intendAncestors(intend);
      if (ancestors.length === 0) continue;
      const matches = Object.values(row).some(
        (v) => v != null && String(v).toLowerCase().includes(q),
      );
      if (!matches) continue;
      for (const a of ancestors) toOpen.add(a);
    }
    if (toOpen.size === 0) return;
    setCollapsedIntends((prev) => {
      let changed = false;
      const next = new Set(prev);
      for (const a of toOpen) {
        if (next.delete(a)) changed = true;
      }
      return changed ? next : prev;
    });
  }, [treeRows]);

  const applyFilters = (
    id = assemblyId,
    time = checkTime,
    overrides?: { bomLevel?: number | null },
  ) => {
    const effectiveBomLevel = overrides !== undefined && "bomLevel" in overrides ? overrides.bomLevel ?? null : bomLevel;
    setAppliedId(id);
    setAppliedCheckTime(time);
    setAppliedBomLevel(effectiveBomLevel);
    setDimensionFilters(EMPTY_DIMENSION_FILTERS);
    pendingResetCollapseRef.current = true;
  };

  type StringDim = "mfgclass" | "source";

  const toggleDimensionValue = (dim: StringDim, value: string, additive: boolean) => {
    setDimensionFilters((prev) => {
      const cur = prev[dim];
      if (additive) {
        return {
          ...prev,
          [dim]: cur.includes(value) ? cur.filter((v) => v !== value) : [...cur, value],
        };
      }
      const onlySelected = cur.length === 1 && cur[0] === value;
      return { ...prev, [dim]: onlySelected ? [] : [value] };
    });
  };

  const toggleHeatmapPair = (maturity: string, intent: string, additive: boolean) => {
    setDimensionFilters((prev) => {
      const pairs = prev.maturity_intent_pairs;
      const idx = pairs.findIndex(
        (p) => p.maturity_level === maturity && p.design_intent === intent,
      );
      if (additive) {
        const next = idx === -1
          ? [...pairs, { maturity_level: maturity, design_intent: intent }]
          : pairs.filter((_, i) => i !== idx);
        return { ...prev, maturity_intent_pairs: next };
      }
      const onlyThis = pairs.length === 1 && idx === 0;
      return {
        ...prev,
        maturity_intent_pairs: onlyThis
          ? []
          : [{ maturity_level: maturity, design_intent: intent }],
      };
    });
  };

  const removeFilterValue = (dim: StringDim, value: string) => {
    setDimensionFilters((prev) => ({
      ...prev,
      [dim]: prev[dim].filter((v) => v !== value),
    }));
  };

  const removePair = (pair: MaturityIntentPair) => {
    setDimensionFilters((prev) => ({
      ...prev,
      maturity_intent_pairs: prev.maturity_intent_pairs.filter(
        (p) => !(p.maturity_level === pair.maturity_level && p.design_intent === pair.design_intent),
      ),
    }));
  };

  const clearAllFilters = () => setDimensionFilters(EMPTY_DIMENSION_FILTERS);

  type ChipGroup =
    | { kind: "dim"; dim: StringDim; label: string; values: string[] }
    | { kind: "pair"; label: string; pairs: MaturityIntentPair[] };

  const activeFilterGroups = useMemo<ChipGroup[]>(() => {
    const out: ChipGroup[] = [];
    if (dimensionFilters.mfgclass.length)
      out.push({ kind: "dim", dim: "mfgclass", label: "Mfg", values: dimensionFilters.mfgclass });
    if (dimensionFilters.source.length)
      out.push({ kind: "dim", dim: "source", label: "Source", values: dimensionFilters.source });
    if (dimensionFilters.maturity_intent_pairs.length)
      out.push({ kind: "pair", label: "Maturity × Intent", pairs: dimensionFilters.maturity_intent_pairs });
    return out;
  }, [dimensionFilters]);

  const totalActiveFilters = activeFilterGroups.reduce(
    (acc, g) => acc + (g.kind === "dim" ? g.values.length : g.pairs.length),
    0,
  );

  const handleAssemblySelect = (identity: string, validFrom: string | null, validTo: string | null) => {
    if (hideTimerRef.current !== null) clearTimeout(hideTimerRef.current);
    setAssemblyId(identity);
    setAssemblyInput(identity);
    setCheckTime((prev) => prev ?? nowPT());
    setSrcValidFrom(validFrom);
    setSrcValidTo(validTo);
    setShowSuggestions(false);
  };

  const handleSearchBlur = () => {
    hideTimerRef.current = setTimeout(() => setShowSuggestions(false), 150);
  };

  const srcTimeError = timeRangeError(checkTime, srcValidFrom, srcValidTo);

  const handleApply = () => {
    const resolvedTime = checkTime ?? nowPT();
    applyFilters(assemblyId, resolvedTime);
  };

  // Deep-link: `#<title>%20<revision>` (e.g. `#2077770001%20A.1`) opens that
  // part with checkTime=now. Runs once after this component mounts; when SSO
  // is expired, the welcome screen renders instead and DataChart only mounts
  // after the login popup completes — at which point this effect fires.
  const deepLinkApplied = useRef(false);
  useEffect(() => {
    if (deepLinkApplied.current) return;
    const raw = window.location.hash.replace(/^#\/?/, "");
    if (!raw) return;
    let parsed: string;
    try { parsed = decodeURIComponent(raw).trim(); } catch { return; }
    if (!parsed) return;
    deepLinkApplied.current = true;
    const t = nowPT();
    setAssemblyInput(parsed);
    setAssemblyId(parsed);
    setCheckTime(t);
    applyFilters(parsed, t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Sync committed search back into the URL hash so the address bar reflects
  // the current part and is shareable. Uses replaceState to avoid back-stack
  // churn (each Apply would otherwise add a history entry).
  useEffect(() => {
    const desiredHash = appliedId ? `#${encodeURIComponent(appliedId)}` : "";
    const target = `${window.location.pathname}${window.location.search}${desiredHash}`;
    if (window.location.href === new URL(target, window.location.origin).href) return;
    window.history.replaceState(null, "", target);
  }, [appliedId]);

  return (
    <div className={`dashboard-layout ${filtersOpen ? "filters-open" : "filters-collapsed"}`}>
      <aside className={`filters-panel ${filtersOpen ? "open" : "collapsed"}`}>
        <div className="filters-section">
          <div className="filters-header">
            <h3>Global Filters</h3>
            <button
              type="button"
              className="filters-toggle"
              onClick={() => setFiltersOpen((v) => !v)}
              aria-label={filtersOpen ? "Collapse filters" : "Expand filters"}
            >
              {filtersOpen ? "‹" : "›"}
            </button>
          </div>
          {filtersOpen && (
            <div className="filters-body">
              <label className="filters-field">
                <span>Part Number</span>
              <div className="search-wrapper">
                <input
                  type="text"
                  placeholder="Search part number..."
                  value={assemblyInput}
                  onChange={(e) => {
                    setAssemblyInput(e.target.value);
                    setShowSuggestions(true);
                  }}
                  onFocus={() => setShowSuggestions(true)}
                  onBlur={handleSearchBlur}
                />
                {showSuggestions && (searchQuery.data?.length ?? 0) > 0 && (
                  <ul className="search-suggestions">
                    {searchQuery.data?.map((result) => (
                      <li
                        key={result.identity}
                        className="search-suggestion-item"
                        onMouseDown={() => handleAssemblySelect(result.identity, result.valid_from, result.valid_to)}
                      >
                        {result.identity}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </label>

            <label className="filters-field">
              <span>BOM Level</span>
              <select
                value={bomLevel ?? ""}
                onChange={(e) =>
                  setBomLevel(e.target.value === "" ? null : Number(e.target.value))
                }
              >
                <option value="">All levels</option>
                {(maxDepth !== null
                  ? Array.from({ length: maxDepth }, (_, i) => i + 1)
                  : filterOptionsQuery.data?.bom_levels ?? []
                ).map((level) => (
                  <option key={level} value={level}>
                    Level {level}
                  </option>
                ))}
              </select>
            </label>

            <label className="filters-field">
              <span>Check Time</span>
              <input
                type="datetime-local"
                value={toDatetimeLocal(checkTime)}
                onChange={(e) => setCheckTime(e.target.value || null)}
              />
              {srcTimeError && <span className="time-error">{srcTimeError}</span>}
            </label>

            <button
              type="button"
              className="compare-run-btn"
              disabled={!assemblyId || !!srcTimeError}
              onClick={handleApply}
            >
              Apply
            </button>
          </div>
        )}
        </div>
      </aside>

      <section className="dashboard">
        <div className="dashboard-header">
          <div className="dashboard-header-text">
            <h2>eBOM Explorer</h2>
            <p className="chart-subtitle">
              {appliedId ? (
                <>
                  <span>{appliedId}</span>
                  <span style={{ color: "var(--text-subtle)" }}>
                    {appliedCheckTime ? ` · ${formatDateTime(appliedCheckTime)}` : " · current"}
                  </span>
                </>
              ) : "Search for a part number to load BOM data."}
            </p>
            {appliedId && partDetailQuery.data?.part_description && (
              <p className="part-description">{partDetailQuery.data.part_description}</p>
            )}
          </div>
        </div>

        <div className="stat-grid">
          <StatCard
            label="Parts"
            singleValue={formatNumber(totals.partsCount)}
          />
          <StatCard
            label="Root Mass"
            singleValue={totals.totalWeight != null ? `${formatNumber(totals.totalWeight)} g` : "—"}
          />
        </div>

        {!appliedId ? (
          <div className="dashboard-card">Enter a part number in the filters panel to load BOM data.</div>
        ) : loading ? (
          <div className="dashboard-card">Loading dashboard data...</div>
        ) : error ? (
          <div className="dashboard-card error">Unable to load dashboard data.</div>
        ) : (
          <div className="dashboard-grid">
            <div className="dashboard-card">
              <div className="card-header">
                <h3>Source</h3>
                <span>{`${parts.length} parts`}</span>
              </div>
              <ResponsiveContainer width="100%" height={240}>
                <BarChart data={sourceChartData as unknown[]}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                  <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                  <YAxis tick={{ fontSize: 12 }} />
                  <Tooltip />
                  <Bar
                    dataKey="count"
                    fill="#0ea5e9"
                    radius={[6, 6, 0, 0]}
                    onClick={(d, _i, e) => toggleDimensionValue("source", String((d as unknown as { label: string }).label), isAdditiveClick(e as unknown as MouseEvent | undefined))}
                    cursor="pointer"
                    activeBar={false}
                  >
                    {sourceChartData.map((d) => (
                      <Cell
                        key={`src-${d.label}`}
                        fill={dimensionFilters.source.includes(d.label) ? "#0c4a6e" : "#0ea5e9"}
                      />
                    ))}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </div>

            <div className="dashboard-card">
             <div className="card-header">
               <h3>MFG Class Distribution</h3>
               <span>{`${parts.length} parts`}</span>
             </div>
             <ResponsiveContainer width="100%" height={240}>
               <BarChart data={mfgClassChartData as unknown[]}>
                 <CartesianGrid strokeDasharray="3 3" stroke="#e2e8f0" />
                 <XAxis dataKey="label" tick={{ fontSize: 12 }} />
                 <YAxis tick={{ fontSize: 12 }} />
                 <Tooltip />
                 <Bar
                   dataKey="count"
                   fill="#0ea5e9"
                   radius={[6, 6, 0, 0]}
                   onClick={(d, _i, e) => toggleDimensionValue("mfgclass", String((d as unknown as { label: string }).label), isAdditiveClick(e as unknown as MouseEvent | undefined))}
                   cursor="pointer"
                   activeBar={false}
                 >
                   {mfgClassChartData.map((d) => (
                     <Cell
                       key={`mfg-${d.label}`}
                       fill={dimensionFilters.mfgclass.includes(d.label) ? "#0c4a6e" : "#0ea5e9"}
                     />
                   ))}
                 </Bar>
               </BarChart>
             </ResponsiveContainer>
           </div>

            <div className="dashboard-card heatmap-card">
              <div className="card-header">
                <h3>Maturity Status x Design Intent</h3>
              </div>
              <div className="heatmap">
                {heatmapData.maturities.map((maturity) => (
                  <div key={maturity} className="heatmap-row">
                    <span className="heatmap-label">{maturity}</span>
                    <div className="heatmap-cells">
                      {heatmapData.designIntents.map((intent) => {
                        const key = getHeatmapKey(intent, maturity);
                        const srcVal = heatmapData.matrix.get(key) ?? 0;
                        const intensity = srcVal / heatmapData.max;
                        const pairs = dimensionFilters.maturity_intent_pairs;
                        const isSelected = pairs.length > 0 && pairs.some(
                          (p) => p.maturity_level === maturity && p.design_intent === intent,
                        );
                        return (
                          <span
                            key={key}
                            className={`heatmap-cell${isSelected ? " heatmap-cell-selected" : ""}`}
                            style={{ background: `rgba(99, 102, 241, ${0.12 + intensity * 0.68})` }}
                            title={`${intent} · ${maturity}: ${srcVal}`}
                            onClick={(e) => toggleHeatmapPair(maturity, intent, isAdditiveClick(e))}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => {
                              if (e.key === "Enter" || e.key === " ") {
                                e.preventDefault();
                                toggleHeatmapPair(maturity, intent, isAdditiveClick(e));
                              }
                            }}
                          >
                            {srcVal}
                          </span>
                        );
                      })}
                    </div>
                  </div>
                ))}
                <div className="heatmap-row heatmap-row-header">
                  <span className="heatmap-label" />
                  <div className="heatmap-cells">
                    {heatmapData.designIntents.map((intent) => (
                      <span key={intent} className="heatmap-header">
                        {intent}
                      </span>
                    ))}
                  </div>
                </div>
              </div>
            </div>

            {activeFilterGroups.length > 0 && (
              <div className="filter-chip-strip">
                Active filters:
                {activeFilterGroups.map((group) => (
                  <div key={group.kind === "dim" ? group.dim : "pair"} className="filter-chip-group">
                    <span className="filter-chip-group-label">{group.label}</span>
                    {group.kind === "dim"
                      ? group.values.map((value) => (
                          <button
                            key={value}
                            type="button"
                            className="filter-chip-value"
                            onClick={() => removeFilterValue(group.dim, value)}
                            title="Remove"
                          >
                            {value}
                            <span className="filter-chip-x" aria-hidden>×</span>
                          </button>
                        ))
                      : group.pairs.map((pair) => (
                          <button
                            key={`${pair.maturity_level}|${pair.design_intent}`}
                            type="button"
                            className="filter-chip-value"
                            onClick={() => removePair(pair)}
                            title="Remove"
                          >
                            {pair.maturity_level} × {pair.design_intent}
                            <span className="filter-chip-x" aria-hidden>×</span>
                          </button>
                        ))}
                  </div>
                ))}
                {totalActiveFilters > 1 && (
                  <button
                    type="button"
                    className="filter-chip-clear"
                    onClick={clearAllFilters}
                    title="Clear all filters"
                  >
                    Clear all
                  </button>
                )}
              </div>
            )}

            <div className="dashboard-card table-card">
              <div className="card-header">
                <h3>Hierarchical BOM</h3>
                <span>{appliedId}</span>
              </div>
              <DataTable
                rows={visibleTreeTableRows}
                excludeKeys={["bom_level", "parent_part_number", "part_number"]}
                stickyColumns={4}
                onSearchChange={handleHierSearchChange}
                onHiddenColumnsChange={setHierHiddenColumns}
                columnLabels={{ intend: "BOM Intend", title: "Part Number", per_unit_mass: "Est. Per Unit Mass (g)", group_key: "Part Root Number", parent_group_key: "Parent Group Number" }}
                columnMinWidths={{ intend: 95, title: 139, part_description: 268, revision: 66 }}
                cellRenderers={{
                  title: (val, row) => {
                    const identity = row.part_number;
                    return val != null && identity != null ? (
                      <button type="button" className="table-cell-link" onClick={() => handleAssemblySelect(String(identity), appliedCheckTime, null)}>{String(val)}</button>
                    ) : (
                      <em style={{ color: "var(--text-subtle)" }}>—</em>
                    );
                  },
                  intend: (val) => {
                    if (val == null) return "—";
                    if (typeof val !== "string") return String(val);
                    const hasChildren = intendsWithChildren.has(val);
                    const isCollapsed = collapsedIntends.has(val);
                    return (
                      <span style={{ display: "inline-flex", alignItems: "center" }}>
                        {hasChildren ? (
                          <button
                            type="button"
                            className="tree-toggle-btn"
                            onClick={() =>
                              setCollapsedIntends((prev) => {
                                const next = new Set(prev);
                                if (next.has(val)) next.delete(val); else next.add(val);
                                return next;
                              })
                            }
                          >
                            {isCollapsed ? "+" : "−"}
                          </button>
                        ) : (
                          <span className="tree-toggle-spacer" />
                        )}
                        {val}
                      </span>
                    );
                  },
                }}
                emptyMessage="No tree data available."
              />
            </div>
          </div>
        )}

      </section>
    </div>
  );
}
