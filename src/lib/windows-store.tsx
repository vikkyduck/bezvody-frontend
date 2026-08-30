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
  useRef,
  useState,
  type ReactNode,
} from "react";

import type { StoredMessage, StoredWindow } from "./conversations";
import type { StoredFile } from "./documents";
import type { StoredProject } from "./projects";
import {
  deleteProjectFileServer,
  deleteWindowFileServer,
  downloadFileServer,
  toGoogleServer,
  uploadProjectFileServer,
} from "./server-files";
import {
  closeProjectServer,
  createProjectServer,
  deleteProjectServer,
  listWorkspaceServer,
  mergeProjectServer,
  renameProjectServer,
  takeIntoWindowServer,
} from "./server-projects";
import {
  deleteWindowServer,
  moveWindowServer,
  openWindowServer,
  runPanelServer,
  sendMessageServer,
  setPanelServer,
} from "./server-windows";
import { useSession } from "./session";

type Store = {
  projects: StoredProject[];
  windows: StoredWindow[];
  ready: boolean;
  /**
   * Список не загрузился. Отдельно от «пусто»: человеку с двенадцатью задачами
   * нельзя показывать «задач пока нет» из-за моргнувшей сети — он решит, что
   * платформа потеряла его документы, и это удар не по удобству, а по доверию.
   */
  loadError: boolean;
  /** Повторить загрузку после сбоя связи */
  reload: () => void;

  /**
   * Заводит задачу. Возвращает id — по нему вызывающий уходит в адрес — и
   * причину отказа словами, если задача не завелась: упор в предел числа задач
   * человеку раньше объясняли как обрыв связи, а это неправда.
   */
  createProject: (title: string) => Promise<Attempt>;
  renameProject: (projectId: string, title: string) => Promise<void>;
  /**
   * Закончить задачу или вернуть её в работу. Не удаление: работа остаётся
   * целиком, просто уходит из ленты активных. Удаление здесь необратимо и
   * страшно, а «закончил» — обычное рабочее действие, и стоить оно должно дёшево.
   */
  closeProject: (projectId: string, closed: boolean) => Promise<{ ok: boolean }>;
  removeProject: (projectId: string) => Promise<void>;
  /** Принести документ в задачу — его увидят все агенты этой задачи */
  attachToProject: (projectId: string, file: File) => Promise<string>;
  detachFromProject: (projectId: string, fileId: string) => Promise<void>;

  /**
   * Открыть разговор с агентом и вернуть его id.
   * По умолчанию продолжает последний разговор с этим агентом в этой задаче:
   * карточка агента — самый заметный путь «вернуться к вчерашнему», и пустое
   * окно на этом месте читается как «переписка пропала». Новый заводится
   * только по явной просьбе — fresh.
   */
  open: (agentId: string, projectId: string, opts?: OpenOpts) => Promise<Attempt>;
  send: (windowId: string, text: string, opts?: SendOpts) => Promise<{ ok: boolean }>;
  remove: (windowId: string) => Promise<void>;
  /** Переложить разговор в другую задачу — папки редко угадываются с первого раза */
  moveWindow: (windowId: string, projectId: string) => Promise<{ ok: boolean }>;
  /** Сложить задачу в другую: разговоры и документы переезжают, оболочка исчезает */
  mergeProject: (fromId: string, toId: string) => Promise<{ ok: boolean }>;
  /** Набрать состав согласующих под этот документ */
  setPanel: (windowId: string, roleIds: string[]) => Promise<{ ok: boolean }>;
  /** Прогнать документ по всему составу разом. Уходит в фон, возвращается сразу */
  runPanel: (windowId: string) => Promise<{ ok: boolean; note: string }>;
  /** Собрать документ конвейером прогонов. Тоже уходит в фон */
  runBuild: (windowId: string) => Promise<{ ok: boolean; note: string }>;
  /** Взять разбор другого агента этой же папки в своё окно */
  takeIntoWindow: (windowId: string, messageId: string) => Promise<string>;
  detach: (windowId: string, fileId: string) => Promise<void>;
  download: (
    file: StoredFile,
  ) => Promise<{ ok: boolean; name: string; mime: string; base64: string }>;
  /** Тот же документ — на Google Диск. Возвращает, что сказать человеку */
  toDrive: (fileId: string) => Promise<string>;
  /** Окно, где агент сейчас отвечает */
  thinkingId: string | null;
  /** Сообщение платформы человеку: очередь, повтор вопроса и подобное */
  note: string;
  clearNote: () => void;
};

/** С какой ролью говорим и что это за реплика — у агента с ролями. */
export type SendOpts = { roleId?: string; kind?: "chat" | "open" | "verdict" };

/**
 * Итог попытки: что открылось и что сказать человеку, если не открылось.
 * Молчаливый null раньше означал сразу три разные причины, и ни одну из них
 * человек не видел — карточка агента просто не срабатывала.
 */
export type Attempt = { id: string | null; note: string };

/** Заголовок нового разговора и просьба завести именно новый, а не продолжить. */
export type OpenOpts = { title?: string; fresh?: boolean };

const Ctx = createContext<Store | null>(null);

export function WindowsProvider({ children }: { children: ReactNode }) {
  const { code, role, person } = useSession();
  const [projects, setProjects] = useState<StoredProject[]>([]);
  const [windows, setWindows] = useState<StoredWindow[]>([]);
  const [ready, setReady] = useState(false);
  const [loadError, setLoadError] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [thinkingId, setThinking] = useState<string | null>(null);
  const [note, setNote] = useState("");

  /**
   * Зеркало разговоров для send(): сам send пересоздаётся только по коду и
   * свежего состояния в замыкании не видит, а ему нужно сравнить переписку
   * до и после отправки — иначе не отличить «принято» от «отказано».
   */
  const windowsRef = useRef<StoredWindow[]>([]);
  useEffect(() => {
    windowsRef.current = windows;
  }, [windows]);

  useEffect(() => {
    // Задачи есть только у того, кто работает в них сам.
    if (!code || role !== "client") {
      setProjects([]);
      setWindows([]);
      setLoadError(false);
      setReady(true);
      return;
    }
    let alive = true;
    setLoadError(false);
    listWorkspaceServer({ data: { code } })
      .then((res) => {
        if (!alive) return;
        setProjects(res.projects);
        setWindows(res.windows);
      })
      .catch(() => {
        // Раньше сбой проглатывался, и человек видел «задач пока нет» —
        // то есть платформа сообщала ему, что его работа исчезла.
        if (alive) setLoadError(true);
      })
      .finally(() => {
        if (alive) setReady(true);
      });
    return () => {
      alive = false;
    };
  }, [code, role, attempt]);

  const reload = useCallback(() => {
    setReady(false);
    setAttempt((n) => n + 1);
  }, []);

  const createProject = useCallback(
    async (title: string) => {
      if (!code) return { id: null, note: "Кабинет вас не узнал — войдите по коду ещё раз" };
      const res = await createProjectServer({ data: { code, title } });
      setProjects(res.projects);
      setWindows(res.windows);
      return { id: res.opened ?? null, note: res.note ?? "" };
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

  const closeProject = useCallback(
    async (projectId: string, closed: boolean) => {
      if (!code) return { ok: false };
      const res = await closeProjectServer({ data: { code, projectId, closed } });
      if (res.projects.length) setProjects(res.projects);
      if (res.windows.length) setWindows(res.windows);
      if (res.note) setNote(res.note);
      return { ok: res.ok };
    },
    [code],
  );

  const removeProject = useCallback(
    async (projectId: string) => {
      if (!code) return;
      const res = await deleteProjectServer({ data: { code, projectId } });
      setProjects(res.projects);
      setWindows(res.windows);
    },
    [code],
  );

  const open = useCallback(
    async (agentId: string, projectId: string, opts: OpenOpts = {}) => {
      if (!code) return { id: null, note: "Кабинет вас не узнал — войдите по коду ещё раз" };
      const res = await openWindowServer({
        data: { code, agentId, projectId, title: opts.title ?? "", fresh: Boolean(opts.fresh) },
      });
      setWindows(res.windows);
      return { id: res.opened?.id ?? null, note: res.note ?? "" };
    },
    [code],
  );

  const send = useCallback(
    async (windowId: string, text: string, opts: SendOpts = {}) => {
      // Открытие разговора с ролью и просьба подвести итог текста не несут:
      // их пишет сервер, чтобы формулировка была одна и та же у всех.
      const composed = opts.kind === "open" || opts.kind === "verdict";
      if (!code || (!text.trim() && !composed)) return { ok: false };

      /**
       * Реплику человека кладём в ленту сразу, не дожидаясь ответа.
       *
       * Ответ пишется минутами, и всё это время вопрос не было видно нигде:
       * поле уже очистилось, а в переписке пусто. Человек не мог проверить,
       * отправилось ли и в той ли формулировке, — и писал второй раз.
       * Временная реплика живёт до ответа сервера, который пришлёт настоящую.
       */
      const temp: StoredMessage | null = text.trim()
        ? {
            id: `local-${Date.now()}`,
            from: "user",
            text,
            at: new Date().toISOString(),
            ...(opts.roleId ? { roleId: opts.roleId } : {}),
          }
        : null;
      const dropTemp = (list: StoredWindow[]) =>
        temp
          ? list.map((w) =>
              w.id === windowId
                ? { ...w, messages: w.messages.filter((m) => m.id !== temp.id) }
                : w,
            )
          : list;

      // Сколько реплик было до отправки — по этому числу поймём, приняли ли вопрос.
      const before = windowsRef.current.find((w) => w.id === windowId)?.messages.length ?? 0;

      if (temp) {
        setWindows((list) =>
          list.map((w) => (w.id === windowId ? { ...w, messages: [...w.messages, temp] } : w)),
        );
      }
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
        /**
         * Сервер отвечает успехом и на отказ: «вопрос уже в работе», «очередь
         * занята» приходят обычным ответом с прежней перепиской и пояснением
         * в note. Раньше клиент считал это принятым, чистил поле — и человек
         * терял напечатанный вопрос вместе с объяснением, почему его не взяли.
         * Отличаем по тому, выросла ли переписка.
         */
        const after = res.windows.find((w) => w.id === windowId)?.messages.length ?? 0;
        return { ok: after > before };
      } catch {
        // Связь оборвалась, а ответ на сервере пишется дальше и сохранится.
        // Временную реплику убираем: вызывающий вернёт текст в поле, чтобы
        // человек не потерял вопрос, который печатал.
        setWindows(dropTemp);
        setNote("Связь прервалась");
        return { ok: false };
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
    },
    [code],
  );

  const moveWindow = useCallback(
    async (windowId: string, projectId: string) => {
      if (!code) return { ok: false };
      const res = await moveWindowServer({ data: { code, windowId, projectId } });
      if (res.windows.length) setWindows(res.windows);
      if (res.note) setNote(res.note);
      return { ok: res.ok };
    },
    [code],
  );

  const mergeProject = useCallback(
    async (fromId: string, toId: string) => {
      if (!code) return { ok: false };
      const res = await mergeProjectServer({ data: { code, fromId, toId } });
      if (res.projects.length) setProjects(res.projects);
      if (res.windows.length) setWindows(res.windows);
      if (res.note) setNote(res.note);
      return { ok: res.ok };
    },
    [code],
  );

  const setPanel = useCallback(
    async (windowId: string, roleIds: string[]) => {
      if (!code) return { ok: false };
      const res = await setPanelServer({ data: { code, windowId, roleIds } });
      if (res.windows.length) setWindows(res.windows);
      if (res.note) setNote(res.note);
      return { ok: res.ok };
    },
    [code],
  );

  const runBuild = useCallback(
    async (windowId: string) => {
      if (!code) return { ok: false, note: "" };
      const { runBuildServer } = await import("./server-pipeline");
      const res = await runBuildServer({ data: { code, windowId } });
      setNote(res.note);
      return res;
    },
    [code],
  );

  const runPanel = useCallback(
    async (windowId: string) => {
      if (!code) return { ok: false, note: "" };
      const res = await runPanelServer({ data: { code, windowId } });
      if (res.note) setNote(res.note);
      return { ok: res.ok, note: res.note };
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

  /** Тот же документ, но на Google Диск: возвращаем, что сказать человеку. */
  const toDrive = useCallback(
    async (fileId: string) => {
      if (!code) return "нет доступа";
      const res = await toGoogleServer({ data: { code, kind: "file", fileId } });
      if (res.ok && res.url) window.open(res.url, "_blank", "noopener,noreferrer");
      return res.ok ? res.note : res.note || "на Диск не уехало";
    },
    [code],
  );

  const value = useMemo<Store>(
    () => ({
      projects,
      windows,
      ready,
      loadError,
      reload,
      createProject,
      renameProject,
      closeProject,
      removeProject,
      attachToProject,
      detachFromProject,
      open,
      send,
      remove,
      moveWindow,
      mergeProject,
      setPanel,
      runPanel,
      runBuild,
      takeIntoWindow,
      detach,
      download,
      toDrive,
      thinkingId,
      note,
      clearNote: () => setNote(""),
    }),
    [
      projects,
      windows,
      ready,
      loadError,
      reload,
      createProject,
      renameProject,
      closeProject,
      removeProject,
      attachToProject,
      detachFromProject,
      open,
      send,
      remove,
      moveWindow,
      mergeProject,
      setPanel,
      runPanel,
      runBuild,
      takeIntoWindow,
      detach,
      download,
      toDrive,
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
