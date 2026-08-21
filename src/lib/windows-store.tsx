/**
 * Папки и окна на стороне браузера — тонкая обёртка над сервером.
 *
 * Ничего не живёт в памяти вкладки: закрыл ноутбук, открыл с телефона — всё
 * на месте. Хранится у участника, и это то, что видит администратор.
 *
 * Папки и окна держим вместе одним состоянием: почти каждое действие меняет
 * и то, и другое (открыли окно — папка обновилась, удалили папку — окна
 * исчезли), и разъезжаться им нельзя.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import type { StoredWindow } from "./conversations";
import type { StoredFile } from "./documents";
import type { StoredProject } from "./projects";
import {
  deleteProjectFileServer,
  deleteWindowFileServer,
  downloadFileServer,
  uploadProjectFileServer,
} from "./server-files";
import {
  createProjectServer,
  deleteProjectServer,
  listWorkspaceServer,
  renameProjectServer,
  takeIntoWindowServer,
} from "./server-projects";
import { deleteWindowServer, openWindowServer, sendMessageServer } from "./server-windows";
import { useSession } from "./session";

type Store = {
  projects: StoredProject[];
  windows: StoredWindow[];
  ready: boolean;
  /** Какая папка открыта; null — список папок */
  activeProjectId: string | null;
  setActiveProject: (id: string | null) => void;
  /** Какое окно открыто; null — экран папки */
  activeId: string | null;
  setActive: (id: string | null) => void;

  createProject: (title: string) => Promise<void>;
  renameProject: (projectId: string, title: string) => Promise<void>;
  removeProject: (projectId: string) => Promise<void>;
  /** Принести документ в папку — его увидят все агенты этой задачи */
  attachToProject: (projectId: string, file: File) => Promise<string>;
  detachFromProject: (projectId: string, fileId: string) => Promise<void>;

  open: (agentId: string, projectId: string, title?: string) => Promise<void>;
  send: (windowId: string, text: string, opts?: SendOpts) => Promise<void>;
  remove: (windowId: string) => Promise<void>;
  /** Взять разбор другого агента этой же папки в своё окно */
  takeIntoWindow: (windowId: string, messageId: string) => Promise<string>;
  detach: (windowId: string, fileId: string) => Promise<void>;
  download: (
    file: StoredFile,
  ) => Promise<{ ok: boolean; name: string; mime: string; base64: string }>;
  /** Окно, где агент сейчас отвечает */
  thinkingId: string | null;
  /** Сообщение платформы человеку: очередь, повтор вопроса и подобное */
  note: string;
  clearNote: () => void;
};

/** С какой ролью говорим и что это за реплика — у агента с ролями. */
export type SendOpts = { roleId?: string; kind?: "chat" | "open" | "verdict" };

const Ctx = createContext<Store | null>(null);

export function WindowsProvider({ children }: { children: ReactNode }) {
  const { code, role, person } = useSession();
  const [projects, setProjects] = useState<StoredProject[]>([]);
  const [windows, setWindows] = useState<StoredWindow[]>([]);
  const [ready, setReady] = useState(false);
  const [activeProjectId, setActiveProject] = useState<string | null>(null);
  const [activeId, setActive] = useState<string | null>(null);
  const [thinkingId, setThinking] = useState<string | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    // Папки есть только у того, кто работает в них сам.
    if (!code || role !== "client") {
      setProjects([]);
      setWindows([]);
      setReady(true);
      return;
    }
    listWorkspaceServer({ data: { code } })
      .then((res) => {
        setProjects(res.projects);
        setWindows(res.windows);
      })
      .catch(() => {
        /* молча: экран покажет пустоту словами */
      })
      .finally(() => setReady(true));
  }, [code, role]);

  const createProject = useCallback(
    async (title: string) => {
      if (!code) return;
      const res = await createProjectServer({ data: { code, title } });
      setProjects(res.projects);
      setWindows(res.windows);
      if (res.opened) setActiveProject(res.opened);
    },
    [code],
  );

  const renameProject = useCallback(
    async (projectId: string, title: string) => {
      if (!code) return;
      const res = await renameProjectServer({ data: { code, projectId, title } });
      setProjects(res.projects);
      setWindows(res.windows);
    },
    [code],
  );

  const removeProject = useCallback(
    async (projectId: string) => {
      if (!code) return;
      const res = await deleteProjectServer({ data: { code, projectId } });
      setProjects(res.projects);
      setWindows(res.windows);
      setActiveProject((cur) => (cur === projectId ? null : cur));
      setActive(null);
    },
    [code],
  );

  const open = useCallback(
    async (agentId: string, projectId: string, title = "") => {
      if (!code) return;
      const res = await openWindowServer({ data: { code, agentId, projectId, title } });
      setWindows(res.windows);
      if (res.opened) setActive(res.opened.id);
    },
    [code],
  );

  const send = useCallback(
    async (windowId: string, text: string, opts: SendOpts = {}) => {
      // Открытие разговора с ролью и просьба подвести итог текста не несут:
      // их пишет сервер, чтобы формулировка была одна и та же у всех.
      const composed = opts.kind === "open" || opts.kind === "verdict";
      if (!code || (!text.trim() && !composed)) return;
      setThinking(windowId);
      setNote("");
      try {
        const res = await sendMessageServer({
          data: {
            code,
            windowId,
            text,
            kind: opts.kind ?? "chat",
            ...(opts.roleId ? { roleId: opts.roleId } : {}),
          },
        });
        setWindows(res.windows);
        setNote(res.note ?? "");
      } catch {
        // Связь оборвалась, а ответ на сервере пишется дальше и сохранится:
        // человеку честнее сказать «вернитесь», чем показать пустоту.
        setNote(
          "Связь прервалась. Ответ дописывается на сервере — обновите страницу через минуту.",
        );
      } finally {
        setThinking(null);
      }
    },
    [code],
  );

  const remove = useCallback(
    async (windowId: string) => {
      if (!code) return;
      const res = await deleteWindowServer({ data: { code, windowId } });
      setWindows(res.windows);
      setActive((cur) => (cur === windowId ? null : cur));
    },
    [code],
  );

  const attachToProject = useCallback(
    async (projectId: string, file: File) => {
      if (!code) return "нет доступа";
      const form = new FormData();
      form.set("code", code);
      form.set("projectId", projectId);
      form.set("file", file);
      const res = await uploadProjectFileServer({ data: form });
      // Файл мог загрузиться, но не прочитаться — папки тогда всё равно новые.
      if (res.projects.length) setProjects(res.projects);
      return res.error;
    },
    [code],
  );

  const detachFromProject = useCallback(
    async (projectId: string, fileId: string) => {
      if (!code) return;
      const res = await deleteProjectFileServer({ data: { code, projectId, fileId } });
      if (res.projects.length) setProjects(res.projects);
    },
    [code],
  );

  const takeIntoWindow = useCallback(
    async (windowId: string, messageId: string) => {
      if (!code) return "нет доступа";
      const res = await takeIntoWindowServer({ data: { code, windowId, messageId } });
      if (res.windows.length) setWindows(res.windows);
      if (res.projects.length) setProjects(res.projects);
      return res.error;
    },
    [code],
  );

  const detach = useCallback(
    async (windowId: string, fileId: string) => {
      if (!code) return;
      const res = await deleteWindowFileServer({ data: { code, windowId, fileId } });
      if (res.windows.length) setWindows(res.windows);
    },
    [code],
  );

  const download = useCallback(
    async (file: StoredFile) => {
      if (!code || !person) return { ok: false, name: "", mime: "", base64: "" };
      return downloadFileServer({
        data: { code, scope: "window", ownerId: person.id, fileId: file.id },
      });
    },
    [code, person],
  );

  const value = useMemo<Store>(
    () => ({
      projects,
      windows,
      ready,
      activeProjectId,
      setActiveProject,
      activeId,
      setActive,
      createProject,
      renameProject,
      removeProject,
      attachToProject,
      detachFromProject,
      open,
      send,
      remove,
      takeIntoWindow,
      detach,
      download,
      thinkingId,
      note,
      clearNote: () => setNote(""),
    }),
    [
      projects,
      windows,
      ready,
      activeProjectId,
      activeId,
      createProject,
      renameProject,
      removeProject,
      attachToProject,
      detachFromProject,
      open,
      send,
      remove,
      takeIntoWindow,
      detach,
      download,
      thinkingId,
      note,
    ],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWindows() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWindows — только внутри WindowsProvider");
  return ctx;
}
