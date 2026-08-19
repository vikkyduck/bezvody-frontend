/**
 * Работа с файлами данных. Только сервер: импортировать динамически изнутри
 * обработчиков серверных функций, иначе node:fs поедет в браузерный бандл.
 *
 * Всё лежит в BV_DATA_DIR — папке ВНЕ приложения: деплой перезаписывает
 * /opt/bezvody-front целиком с --delete, и данные внутри неё не пережили бы
 * ни одной выкатки.
 */
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

export const today = () => new Date().toLocaleDateString("ru-RU");
