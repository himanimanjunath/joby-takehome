-- eBOM Explorer — take-home database schema (local PostgreSQL 17).
--
-- Columns and types match the contract the backend in interview/backend/app
-- queries (the "physicalid" schema). The backend issues UNQUALIFIED table
-- names, so everything lives in the default `public` schema.
--
-- Time-travel: every fact carries a [valid_from, valid_to) SCD2 interval.
-- A row with valid_to NOT NULL is a "closed" (superseded) record; the open
-- (current) row has valid_to = NULL.

-- Parts (SCD2). One physicalid = one physical part; identity = "<title> <revision>".
CREATE TABLE part_attributes (
    physicalid   text,
    identity     text,
    title        text,
    description  text,
    revision     text,
    source       text,         -- Make / Buy / ...
    producttype  text,         -- Part / Collector / ...
    current      text,         -- maturity level (IN_WORK / RELEASED / ...)
    designintent text,         -- Production / Formal / Prototype / Other
    mfgclass     text,         -- Mechanical / Electrical / ...
    computedmass double precision,   -- kg
    declaredmass double precision,   -- kg
    event_time   timestamp,
    valid_from   timestamp,
    valid_to     timestamp
);

-- Materialized recursive BOM closure (one row per path edge under a root).
CREATE TABLE bom_forest (
    root_physicalid       text,
    parent_physicalid     text,
    child_physicalid      text,
    child_quantity        integer,
    depth                 integer,      -- 1 = direct child, 2 = grandchild, ...
    intend                text,         -- pipe-encoded sibling-ordering path
    path_ids              text[],       -- physicalids from root → this node
    path_valid_from       timestamp,
    path_valid_to         timestamp,
    all_children_released integer       -- 1 if the whole subtree is released
);

-- Maps every assembly (incl. sub-assemblies) to the root of its tree.
CREATE TABLE bom_assembly_index (
    assembly_physicalid text,
    root_physicalid     text,
    assembly_depth      integer,
    assembly_intend     text,
    path_valid_from     timestamp,
    path_valid_to       timestamp
);

-- Raw parent→child edges (SCD2). Used by where-used / collector roll-up.
CREATE TABLE bom_relationships (
    parent_physicalid text,
    child_physicalid  text,
    child_quantity    integer,
    valid_from        timestamp,
    valid_to          timestamp
);

-- Rolled-up per-part mass (SCD2), grams.
CREATE TABLE part_mass_rollup (
    physicalid      text,
    mass_g          double precision,
    mass_valid_from timestamp,
    mass_valid_to   timestamp
);

-- Synced drawing/3D document pointers (PDF / STP object keys).
CREATE TABLE part_documents_synced (
    object_key text,
    identity   text,
    physicalid text,
    title      text,
    revision   text
);

-- Single-row "data last loaded at" marker, shown in the UI health badge.
CREATE TABLE last_refresh (
    t timestamptz NOT NULL
);

-- Indexes that mirror the join/filter paths the backend exercises.
CREATE INDEX ix_pa_identity     ON part_attributes (identity);
CREATE INDEX ix_pa_physicalid   ON part_attributes (physicalid);
CREATE INDEX ix_bf_root         ON bom_forest (root_physicalid);
CREATE INDEX ix_bf_child        ON bom_forest (child_physicalid);
CREATE INDEX ix_bf_parent       ON bom_forest (parent_physicalid);
CREATE INDEX ix_bai_assembly    ON bom_assembly_index (assembly_physicalid);
CREATE INDEX ix_br_parent       ON bom_relationships (parent_physicalid);
CREATE INDEX ix_br_child        ON bom_relationships (child_physicalid);
CREATE INDEX ix_pmr_physicalid  ON part_mass_rollup (physicalid);
