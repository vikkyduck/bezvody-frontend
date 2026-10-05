// Adds exactly the two requested agents. Uses existing global keys; does not import Replit integrations.
import { readFile } from "node:fs/promises";
import pg from "pg";
const pool = new pg.Pool({ connectionString: process.env.BV_DATABASE_URL });
if (!process.env.BV_DATABASE_URL) throw new Error("BV_DATABASE_URL required");
const readPrompt = (name) =>
  readFile(new URL(`../deploy/bos-prompts/${name}`, import.meta.url), "utf8");
const client = await pool.connect();
try {
  await client.query("BEGIN");
  const res = await client.query(
    "SELECT value FROM platform_documents WHERE key='agents.json' FOR UPDATE",
  );
  const agents = res.rows[0]?.value ?? {};
  // The architect's OpenAI connection was verified with an actual web_search call.
  const reference = agents.architect;
  if (!reference?.provider || !reference?.model)
    throw new Error("Existing provider/model configuration required");
  const now = new Date().toISOString();
  for (const id of ["kat", "stirlitz"]) {
    if (agents[id]) throw new Error(`${id} already exists; review before replacing prompts`);
    agents[id] = {
      prompt: await readPrompt(`${id}-main.txt`),
      provider: reference.provider,
      model: reference.model,
      enabled: true,
      updatedAt: now,
      transport: "model",
      endpoint: "",
      authHeader: "Authorization",
      format: "openai",
      authSet: false,
      finishRule: "",
      mentorRule: "",
      roles: [],
      passes: [],
      ...(id === "kat"
        ? {
            bosModes: Object.fromEntries(
              await Promise.all(
                ["1", "2", "3"].map(async (m) => [m, await readPrompt(`kat-mode-${m}.txt`)]),
              ),
            ),
          }
        : {}),
    };
  }
  await client.query(
    "UPDATE platform_documents SET value=$1::jsonb,updated_at=now() WHERE key='agents.json'",
    [JSON.stringify(agents)],
  );
  const directory = await client.query(
    "SELECT value FROM platform_documents WHERE key='directory.json' FOR UPDATE",
  );
  if (!Array.isArray(directory.rows[0]?.value)) throw new Error("Participant directory required");
  const people = directory.rows[0].value.map((p) =>
    p.role === "admin" ? { ...p, agentIds: [...new Set([...p.agentIds, "kat", "stirlitz"])] } : p,
  );
  await client.query(
    "UPDATE platform_documents SET value=$1::jsonb,updated_at=now() WHERE key='directory.json'",
    [JSON.stringify(people)],
  );
  await client.query("COMMIT");
  console.log(
    JSON.stringify({
      installed: ["kat", "stirlitz"],
      provider: reference.provider,
      model: reference.model,
      access: "existing admins",
    }),
  );
} catch (e) {
  await client.query("ROLLBACK");
  throw e;
} finally {
  client.release();
  await pool.end();
}
