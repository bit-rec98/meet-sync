import type { Pool, PoolConnection } from 'mysql2/promise';

/** Anything that can run a query: the pool, or a single connection inside a transaction. */
export type Executor = Pool | PoolConnection;
