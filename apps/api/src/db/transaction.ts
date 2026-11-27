import type { Pool, PoolConnection } from 'mysql2/promise';

/**
 * Runs `work` in a transaction: commits when it resolves, rolls back when it throws, and always
 * returns the connection to the pool.
 */
export async function withTransaction<T>(
  pool: Pool,
  work: (connection: PoolConnection) => Promise<T>,
): Promise<T> {
  const connection = await pool.getConnection();
  try {
    await connection.beginTransaction();
    const result = await work(connection);
    await connection.commit();
    return result;
  } catch (error) {
    await connection.rollback();
    throw error;
  } finally {
    connection.release();
  }
}
