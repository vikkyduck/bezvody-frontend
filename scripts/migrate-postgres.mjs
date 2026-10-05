// Run with the app stopped: node --env-file=/etc/nowater/database.env scripts/migrate-postgres.mjs import|verify|export
import pg from "pg";
import { readFile, readdir, mkdir, writeFile, rename } from "node:fs/promises";
import { join, dirname, resolve } from "node:path";
import { isDeepStrictEqual } from "node:util";
const mode = process.argv[2];
if (
  !["import", "verify", "export"].includes(mode) ||
  !process.env.BV_DATABASE_URL ||
  !process.env.BV_DATA_DIR
)
  throw new Error("Mode, BV_DATABASE_URL and BV_DATA_DIR required");
const root = resolve(process.env.BV_DATA_DIR);
const pool = new pg.Pool({ connectionString: process.env.BV_DATABASE_URL });
async function scan(dir) {
  const paths = [];
  for (const f of await readdir(dir, { withFileTypes: true })) {
    const key = join(dir, f.name);
    if (f.isDirectory() && f.name !== "files") paths.push(...(await scan(key)));
    else if (f.isFile() && f.name.endsWith(".json") && f.name !== "secrets.json") paths.push(key);
  }
  return paths;
}
const client = await pool.connect();
try {
  if (mode === "import") {
    const docs = await Promise.all(
      (await scan(root)).map(async (file) => [
        file.slice(root.length + 1),
        JSON.parse(await readFile(file, "utf8")),
      ]),
    );
    if (!docs.some(([key, value]) => key === "directory.json" && Array.isArray(value)))
      throw new Error("Valid participant directory required");
    await client.query("BEGIN");
    await client.query(await readFile(new URL("../deploy/postgres.sql", import.meta.url), "utf8"));
    for (const [key, value] of docs)
      await client.query(
        "INSERT INTO platform_documents(key,value) VALUES($1,$2::jsonb) ON CONFLICT(key) DO NOTHING",
        [key, JSON.stringify(value)],
      );
    let events = 0;
    for (const file of await readdir(join(root, "usage")).catch((e) => {
      if (e.code === "ENOENT") return [];
      throw e;
    })) {
      if (!/^\d{4}-\d{2}\.jsonl$/.test(file)) continue;
      const lines = (await readFile(join(root, "usage", file), "utf8")).split("\n");
      for (const [index, line] of lines.entries()) {
        if (!line.trim()) continue;
        await client.query(
          "INSERT INTO platform_usage(month,event,import_key) VALUES($1,$2::jsonb,$3) ON CONFLICT(import_key) DO NOTHING",
          [file.slice(0, 7), JSON.stringify(JSON.parse(line)), `${file}:${index}`],
        );
        events++;
      }
    }
    await client.query("COMMIT");
    console.log(JSON.stringify({ importedDocuments: docs.length, importedEvents: events }));
  } else if (mode === "verify") {
    let verified = 0;
    for (const file of await scan(root)) {
      const key = file.slice(root.length + 1);
      const result = await client.query("SELECT value FROM platform_documents WHERE key=$1", [key]);
      if (!isDeepStrictEqual(JSON.parse(await readFile(file, "utf8")), result.rows[0]?.value))
        throw new Error(`Mismatch: ${key}`);
      verified++;
    }
    console.log(JSON.stringify({ verifiedDocuments: verified }));
  } else {
    const docs = await client.query("SELECT key,value FROM platform_documents");
    for (const { key, value } of docs.rows) {
      if (key.includes("..") || key === "secrets.json" || !key.endsWith(".json"))
        throw new Error("Invalid export key");
      const path = join(root, key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(`${path}.export-tmp`, JSON.stringify(value, null, 2));
      await rename(`${path}.export-tmp`, path);
    }
    const months = await client.query("SELECT DISTINCT month FROM platform_usage");
    await mkdir(join(root, "usage"), { recursive: true });
    for (const { month } of months.rows) {
      if (!/^\d{4}-\d{2}$/.test(month)) throw new Error("Invalid month");
      const events = await client.query(
        "SELECT event FROM platform_usage WHERE month=$1 ORDER BY id",
        [month],
      );
      await writeFile(
        join(root, "usage", `${month}.jsonl`),
        events.rows.map((r) => JSON.stringify(r.event)).join("\n") + "\n",
      );
    }
    console.log(JSON.stringify({ exportedDocuments: docs.rowCount }));
  }
} catch (err) {
  await client.query("ROLLBACK").catch(() => {});
  throw err;
} finally {
  client.release();
  await pool.end();
}
