from psycopg_pool import ConnectionPool

from app.core.config import settings

_pool: ConnectionPool | None = None


def get_pool() -> ConnectionPool:
    global _pool
    if _pool is None:
        conninfo = (
            f"dbname={settings.PGDATABASE} user={settings.PGUSER} "
            f"host={settings.PGHOST} port={settings.PGPORT} "
            f"password={settings.PGPASSWORD} sslmode={settings.PGSSLMODE}"
        )
        _pool = ConnectionPool(conninfo=conninfo, min_size=1, max_size=10, open=True)
    return _pool
