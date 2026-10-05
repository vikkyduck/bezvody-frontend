/** PostgreSQL on Timeweb. Secrets and binary attachments stay in the private data directory. */
import { Pool } from "pg";
import { resolve, relative } from "node:path";

let pool: Pool | undefined;
export const databaseEnabled = () => Boolean(process.env["BV_DATABASE_URL"]?.trim());
export function database() {
  if (!databaseEnabled()) throw new Error("BV_DATABASE_URL is not configured");
  return (pool ??= new Pool({
    connectionString: process.env["BV_DATABASE_URL"],
    max: 8,
    connectionTimeoutMillis: 5000,
    idleTimeoutMillis: 30000,
  }));
}

export function documentKey(file: string): string | null {
  if (!databaseEnabled()) return null;
  const root = resolve(process.env["BV_DATA_DIR"]?.trim() || ".data");
  const key = relative(root, resolve(file));
  if (!key || key.startsWith("..") || !key.endsWith(".json") || key === "secrets.json") return null;
  return key;
}

export async function readDocument<T>(key: string): Promise<T | undefined> {
  const result = await database().query("SELECT value FROM platform_documents WHERE key = $1", [
    key,
  ]);
  return result.rows[0]?.value as T | undefined;
}

export async function writeDocument(key: string, value: unknown): Promise<void> {
  await database().query(
    `INSERT INTO platform_documents(key, value) VALUES ($1, $2::jsonb)
     ON CONFLICT(key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
    [key, JSON.stringify(value)],
  );
}
