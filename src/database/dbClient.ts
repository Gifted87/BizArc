import pg from "pg";
import dotenv from "dotenv";

dotenv.config();

const { Pool } = pg;

export class DbClient {
  private static pool: pg.Pool | null = null;

  public static getPool(): pg.Pool {
    if (!DbClient.pool) {
      const connectionString =
        process.env.DATABASE_URL ||
        "postgresql://bizarc:bizarc_secure_2026@127.0.0.1:5432/bizarc";

      DbClient.pool = new Pool({
        connectionString,
        max: 20,
        idleTimeoutMillis: 30000,
        connectionTimeoutMillis: 5000,
      });

      DbClient.pool.on("error", (err) => {
        console.error("Unexpected error on idle PostgreSQL client", err);
      });
    }
    return DbClient.pool;
  }

  public static async query<R extends pg.QueryResultRow = any>(
    text: string,
    params?: any[]
  ): Promise<pg.QueryResult<R>> {
    const pool = DbClient.getPool();
    return pool.query<R>(text, params);
  }

  public static async withTransaction<T>(
    fn: (client: pg.PoolClient) => Promise<T>
  ): Promise<T> {
    const pool = DbClient.getPool();
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(client);
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  public static async checkConnection(): Promise<boolean> {
    try {
      const res = await DbClient.query("SELECT 1 as connected;");
      return res.rows.length > 0 && res.rows[0].connected === 1;
    } catch (err) {
      console.error("Database connection check failed:", err);
      return false;
    }
  }

  public static async closePool(): Promise<void> {
    if (DbClient.pool) {
      await DbClient.pool.end();
      DbClient.pool = null;
    }
  }
}
