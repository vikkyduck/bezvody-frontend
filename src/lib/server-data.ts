/**
 * Работа с файлами данных. Только сервер: импортировать динамически изнутри
 * обработчиков серверных функций, иначе node:fs поедет в браузерный бандл.
 *
 * Всё лежит в BV_DATA_DIR — папке ВНЕ приложения: деплой перезаписывает
 * /opt/bezvody-front целиком с --delete, и данные внутри неё не пережили бы
 * ни одной выкатки.
 */
import type { StoredWindow } from "./conversations";
import { normalize, seedParticipants, type Participant } from "./participants";

export const dataDir = () => process.env["BV_DATA_DIR"]?.trim() || ".data";

export async function readJson<T>(file: string, fallback: T): Promise<T> {
  const { readFile } = await import("node:fs/promises");
  try {
    return JSON.parse(await readFile(file, "utf8")) as T;
  } catch {
    return fallback;
  }
}

export async function writeJson(file: string, value: unknown): Promise<void> {
  const { mkdir, writeFile, rename } = await import("node:fs/promises");
  const { dirname } = await import("node:path");
  await mkdir(dirname(file), { recursive: true });
  // Пишем через временный файл: обрыв на середине не оставит битые данные.
  const tmp = `${file}.tmp`;
  await writeFile(tmp, JSON.stringify(value, null, 2), "utf8");
  await rename(tmp, file);
}

const participantsFile = () => `${dataDir()}/directory.json`;

export async function readParticipants(): Promise<Participant[]> {
  const raw = await readJson<Participant[]>(participantsFile(), []);
  return Array.isArray(raw) && raw.length ? raw.map(normalize) : seedParticipants;
}

export const writeParticipants = (list: Participant[]) => writeJson(participantsFile(), list);

/** Кто звонит. Отозванный код не пускает никуда. */
export async function whoIs(code: string): Promise<{ list: Participant[]; me: Participant | null }> {
  const list = await readParticipants();
  const wanted = String(code ?? "").trim().toUpperCase();
  const me = list.find((p) => p.code && p.code === wanted && p.active) ?? null;
  return { list, me };
}

// ── Окна разговоров ───────────────────────────────────────────────────────────
// Лежат по человеку: файл на каждого. Читают их и разговоры, и документы,
// поэтому доступ к файлу — один на всех, здесь.

const windowsFile = (personId: string) => `${dataDir()}/windows/${personId}.json`;

/** Запись со старой выкатки могла быть без новых полей — добиваем пустыми. */
export async function readWindows(personId: string): Promise<StoredWindow[]> {
  const raw = await readJson<StoredWindow[]>(windowsFile(personId), []);
  return raw.map((w) => ({ ...w, docs: w.docs ?? [], files: w.files ?? [] }));
}

export const writeWindows = (personId: string, list: StoredWindow[]) =>
  writeJson(windowsFile(personId), list);

export const today = () => new Date().toLocaleDateString("ru-RU");

// ── Ключ модели ───────────────────────────────────────────────────────────────
// Лежит отдельным файлом с правами 600 и наружу не отдаётся никогда.

const secretsFile = () => `${dataDir()}/secrets.json`;

type Secrets = { anthropicKey?: string; agentAuth?: Record<string, string> };

const readSecrets = () => readJson<Secrets>(secretsFile(), {});

async function writeSecrets(next: Secrets): Promise<void> {
  const { chmod } = await import("node:fs/promises");
  await writeJson(secretsFile(), next);
  await chmod(secretsFile(), 0o600);
}

export async function readApiKey(): Promise<string> {
  const raw = await readSecrets();
  return raw.anthropicKey?.trim() || process.env["ANTHROPIC_API_KEY"]?.trim() || "";
}

export async function writeApiKey(key: string): Promise<void> {
  const cur = await readSecrets();
  await writeSecrets({ ...cur, anthropicKey: key });
}

/** Секрет доступа к чужому API — свой на каждого агента. */
export async function readAgentAuth(agentId: string): Promise<string> {
  const raw = await readSecrets();
  return raw.agentAuth?.[agentId]?.trim() ?? "";
}

export async function writeAgentAuth(agentId: string, value: string): Promise<void> {
  const cur = await readSecrets();
  const agentAuth = { ...(cur.agentAuth ?? {}) };
  if (value) agentAuth[agentId] = value;
  else delete agentAuth[agentId];
  await writeSecrets({ ...cur, agentAuth });
}
