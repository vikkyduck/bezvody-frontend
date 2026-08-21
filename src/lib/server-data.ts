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
import { DEFAULT_PROJECT_TITLE, type StoredProject } from "./projects";

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
export async function whoIs(
  code: string,
): Promise<{ list: Participant[]; me: Participant | null }> {
  const list = await readParticipants();
  const wanted = String(code ?? "")
    .trim()
    .toUpperCase();
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

// ── Папки проектов ────────────────────────────────────────────────────────────
// Тоже по человеку: папка принадлежит тому, кто в ней работает.

const projectsFile = (personId: string) => `${dataDir()}/projects/${personId}.json`;

export async function readProjects(personId: string): Promise<StoredProject[]> {
  const raw = await readJson<StoredProject[]>(projectsFile(personId), []);
  return raw.map((p) => ({ ...p, files: p.files ?? [] }));
}

export const writeProjects = (personId: string, list: StoredProject[]) =>
  writeJson(projectsFile(personId), list);

/**
 * Папки и окна вместе — с переносом старых окон в папки.
 *
 * Окна, открытые до появления папок, папки не знают. Заводим каждому свою —
 * по заголовку окна — и переносим туда его документы. Сами файлы на диске
 * лежат в папке человека и никуда не переезжают: у окна и так был только
 * список, его и передаём папке.
 *
 * Слить несколько старых окон в одну задачу мы не можем: по названиям это
 * догадка, а догадка тут — чужие документы не в той папке. Пусть человек
 * соберёт их сам, если захочет.
 */
export async function readWorkspace(
  personId: string,
): Promise<{ projects: StoredProject[]; windows: StoredWindow[] }> {
  const windows = await readWindows(personId);
  const projects = await readProjects(personId);
  const known = new Set(projects.map((p) => p.id));
  const orphans = windows.filter((w) => !w.projectId || !known.has(w.projectId));
  if (!orphans.length) return { projects, windows };

  const nextProjects = [...projects];
  const nextWindows = windows.map((w) => {
    if (w.projectId && known.has(w.projectId)) return w;
    const born = w.createdAt || new Date().toISOString();
    const project: StoredProject = {
      id: `p-${Math.random().toString(36).slice(2, 9)}`,
      title: w.title?.trim() || DEFAULT_PROJECT_TITLE,
      files: w.files ?? [],
      createdAt: born,
      updatedAt: w.updatedAt || born,
    };
    nextProjects.unshift(project);
    return { ...w, projectId: project.id, files: [] };
  });

  await writeProjects(personId, nextProjects);
  await writeWindows(personId, nextWindows);
  return { projects: nextProjects, windows: nextWindows };
}

export const today = () => new Date().toLocaleDateString("ru-RU");

// ── Ключи моделей ─────────────────────────────────────────────────────────────
// Лежат отдельным файлом с правами 600 и наружу не отдаются никогда.
// Ключ на каждого провайдера свой: так видно расход по каждому отдельно,
// и отзыв одного не роняет остальных.

const secretsFile = () => `${dataDir()}/secrets.json`;

type Secrets = {
  anthropicKey?: string;
  openaiKey?: string;
  geminiKey?: string;
  /** Ключ служебного аккаунта Google — целиком, как его отдаёт консоль */
  googleAccount?: { client_email: string; private_key: string };
  /** Доступ от имени живого аккаунта: файлы должны кому-то принадлежать */
  googleOAuth?: { client_id: string; client_secret: string; refresh_token: string };
  /** Папка на Диске, куда складывать выгруженное */
  googleFolderId?: string;
  /** Ключ провайдера конкретного агента: override глобального ключа */
  agentProviderKeys?: Record<string, Partial<Record<string, string>>>;
  /** Ключ для HTTP-сервиса агента */
  agentAuth?: Record<string, string>;
};

/** Поле в secrets.json и запасной путь через переменную окружения. */
const KEY_FIELD = {
  anthropic: { field: "anthropicKey", env: "ANTHROPIC_API_KEY" },
  openai: { field: "openaiKey", env: "OPENAI_API_KEY" },
  gemini: { field: "geminiKey", env: "GEMINI_API_KEY" },
} as const;

export type KeyProvider = keyof typeof KEY_FIELD;

const readSecrets = () => readJson<Secrets>(secretsFile(), {});

async function writeSecrets(next: Secrets): Promise<void> {
  const { chmod } = await import("node:fs/promises");
  await writeJson(secretsFile(), next);
  await chmod(secretsFile(), 0o600);
}

export async function readApiKey(
  provider: KeyProvider = "anthropic",
  agentId?: string,
): Promise<string> {
  // Сначала проверяем ключ агента (per-agent override).
  if (agentId) {
    const raw = await readSecrets();
    const agentKey = raw.agentProviderKeys?.[agentId]?.[provider]?.trim();
    if (agentKey) return agentKey;
  }
  // Потом глобальный ключ провайдера.
  const { field, env } = KEY_FIELD[provider] ?? KEY_FIELD.anthropic;
  const raw = await readSecrets();
  return raw[field]?.trim() || process.env[env]?.trim() || "";
}

export async function writeApiKey(
  provider: KeyProvider,
  key: string,
  agentId?: string,
): Promise<void> {
  const cur = await readSecrets();
  if (agentId) {
    // Per-agent ключ.
    const agentProviderKeys = { ...(cur.agentProviderKeys ?? {}) };
    if (!agentProviderKeys[agentId]) agentProviderKeys[agentId] = {};
    if (key) agentProviderKeys[agentId][provider] = key;
    else delete agentProviderKeys[agentId][provider];
    if (!Object.keys(agentProviderKeys[agentId]).length) delete agentProviderKeys[agentId];
    await writeSecrets({ ...cur, agentProviderKeys });
  } else {
    // Глобальный ключ.
    const { field } = KEY_FIELD[provider] ?? KEY_FIELD.anthropic;
    await writeSecrets({ ...cur, [field]: key });
  }
}

/**
 * Доступ к Google Диску: ключ служебного аккаунта и папка.
 *
 * Ключ — такой же секрет, как ключ модели: лежит в том же файле с правами
 * 600 и в браузер не возвращается никогда.
 */
export async function readGoogle(): Promise<{
  account: { client_email: string; private_key: string } | null;
  oauth: { client_id: string; client_secret: string; refresh_token: string } | null;
  folderId: string;
}> {
  const raw = await readSecrets();
  const a = raw.googleAccount;
  const o = raw.googleOAuth;
  return {
    account: a?.client_email && a?.private_key ? a : null,
    oauth: o?.client_id && o?.client_secret && o?.refresh_token ? o : null,
    folderId: raw.googleFolderId?.trim() ?? "",
  };
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
