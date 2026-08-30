import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { AppShell, PageHead, type Crumb } from "@/components/AppShell";
import { Landing } from "@/components/Landing";
import { Attachments } from "@/components/Attachments";
import { Build } from "@/components/Build";
import { Checklist } from "@/components/Checklist";
import { Markdown } from "@/components/Markdown";
import { Chevron } from "@/components/bv/Reveal";
import { Delivery } from "@/components/Delivery";
import type { StoredWindow } from "@/lib/conversations";
import { MAX_WINDOW_FILES, type StoredFile } from "@/lib/documents";
import { isProjectOpen, type StoredProject } from "@/lib/projects";
import { DOCX_MIME, XLSX_MIME, saveFile } from "@/lib/download";
import type { AgentRole } from "@/lib/roles";
import { getAgentRolesServer } from "@/lib/server-agents";
import { panelStateServer, type PanelState } from "@/lib/server-windows";
import { assembleServer } from "@/lib/server-assemble";
import { downloadAnswerServer, downloadModelServer, toGoogleServer } from "@/lib/server-files";
import { useSession } from "@/lib/session";
import { type Agent, agentById, agents } from "@/lib/shtab-data";
import {
  roleOutcome,
  roleStamp,
  visaLine,
  visaOf,
  type RoleStamp,
  type VisaStage,
} from "@/lib/visa";
import { useWindows } from "@/lib/windows-store";

/**
 * Уровень кабинета живёт в адресе, а не в памяти вкладки.
 *
 * Пока он был в useState, «Назад» браузера выходила из кабинета вместо шага
 * вверх, обновление страницы теряло место, а ссылку на задачу нельзя было
 * переслать заму. Search-параметры дают всё это без дробления на маршруты:
 *   /              — список задач
 *   /?z=<задача>   — задача
 *   /?z=..&d=<id>  — разговор
 */
type Level = { z?: string | undefined; d?: string | undefined };

export const Route = createFileRoute("/")({
  validateSearch: (search: Record<string, unknown>): Level => ({
    z: typeof search["z"] === "string" && search["z"] ? search["z"] : undefined,
    d: typeof search["d"] === "string" && search["d"] ? search["d"] : undefined,
  }),
  head: () => ({
    meta: [
      { title: "NOWATER.TECH — управленческие решения на ИИ-агентах" },
      {
        name: "description",
        content:
          "Агенты собирают данные, проверяют источники и спорят с выводами, готовя документ к защите. Первая выдача на пятый день.",
      },
      { property: "og:title", content: "NOWATER.TECH — управленческие решения на ИИ-агентах" },
      {
        property: "og:description",
        content:
          "Платформа подготовки управленческих решений: агенты, методолог, руководитель. Первая выдача на пятый день.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Home,
});

/**
 * Корень сайта — витрина для гостя и кабинет для вошедшего. Раньше «/» сразу
 * выбрасывал на форму входа, и о платформе снаружи узнать было неоткуда.
 */
function Home() {
  const { role, ready } = useSession();
  // До чтения сессии показываем лендинг: он одинаково уместен и как первый
  // кадр для гостя, и как заставка на те доли секунды для своего.
  if (!ready || !role) return <Landing />;
  return <Workspace />;
}

function Workspace() {
  const { projects, windows } = useWindows();
  const { z, d } = Route.useSearch();

  /**
   * Дорожка для липкой шапки. Считается здесь, а не в Body: Body — это уже
   * содержимое, а шапка живёт снаружи и должна отвечать «где я» на любой
   * глубине прокрутки, в том числе внизу длинного разговора.
   */
  const talk = d ? windows.find((w) => w.id === d) : undefined;
  const project = projects.find((p) => p.id === (talk?.projectId ?? z));
  const crumbs: Crumb[] = [{ label: "Задачи", to: "/" }];
  if (project) crumbs.push({ label: project.title, to: "/", search: { z: project.id } });
  if (talk) crumbs.push({ label: talk.title });

  return (
    <AppShell allow={["client", "admin"]} crumbs={crumbs}>
      <Body />
    </AppShell>
  );
}

function Body() {
  const { person } = useSession();
  const { projects, windows, ready, loadError, reload } = useWindows();
  const { z, d } = Route.useSearch();
  const navigate = useNavigate();

  /**
   * Исправляющий переход заменяет запись в истории, а не добавляет новую.
   *
   * Иначе «Назад» возвращала бы на мёртвый адрес (удалённая задача, чужая
   * закладка), эффект снова уводил бы человека вперёд — и кнопка «Назад»
   * переставала бы работать вовсе. Ровно ради неё уровень и выносили в адрес.
   */
  const go = useCallback(
    (next: Level) => void navigate({ to: "/", search: next, replace: true }),
    [navigate],
  );

  const activeWindow = d ? (windows.find((w) => w.id === d) ?? null) : null;
  const activeProject = projects.find((p) => p.id === (activeWindow?.projectId ?? z)) ?? null;

  // Адрес пережил удаление задачи или пришёл из чужой закладки. Тихо
  // поднимаемся на уровень, который существует, вместо пустого экрана.
  useEffect(() => {
    if (!ready || loadError) return;
    if (!d && !z) return;
    if (d && !activeWindow) {
      go(z && projects.some((p) => p.id === z) ? { z } : {});
      return;
    }
    if (!activeProject) go({});
  }, [ready, loadError, d, z, activeWindow, activeProject, projects, go]);

  if (!person) return null;

  if (loadError) {
    return (
      <div className="card-plain mx-auto mt-10 max-w-[520px] px-6 py-8 text-center">
        <h1 className="ui-h2">Не удалось загрузить ваши задачи</h1>
        <button onClick={reload} className="btn btn-primary ui-body mt-5">
          Попробовать снова
        </button>
      </div>
    );
  }

  if (activeWindow && activeProject) {
    return <Conversation key={activeWindow.id} window={activeWindow} project={activeProject} />;
  }
  if (activeProject) {
    return (
      <Project
        key={activeProject.id}
        project={activeProject}
        projects={projects}
        windows={windows.filter((w) => w.projectId === activeProject.id)}
      />
    );
  }
  return <Start ready={ready} projects={projects} windows={windows} />;
}

// ── Команда ───────────────────────────────────────────────────────────────────

/**
 * Кто разберёт задачу. На первом экране это главное: человек должен понять
 * состав команды и что унесёт, до того как его просят придумать название.
 * Внутри задачи те же карточки становятся кнопками.
 */
/** Порядок работы: собрать → отчелленджить → посчитать. Остальные — по надобности. */
const STEP_ORDER = ["architect", "stakeholders", "accountant"];

function Team({
  mine,
  onPick,
  started,
  compact = false,
  path,
}: {
  mine: Agent[];
  onPick?: (agentId: string) => void;
  /** С кем разговор уже идёт: карточка обещает продолжить, а не открыть заново */
  started?: Set<string>;
  /** Плотная раскладка внутри задачи: четыре карточки в ряд */
  compact?: boolean;
  /** Пройденные шаги и текущее место в дорожке */
  path?: { order: string[]; done: Set<string> };
}) {
  if (!mine.length) {
    return (
      <div className="card-plain px-5 py-5">
        <div className="ui-title">Агентов вам ещё не открыли</div>
      </div>
    );
  }

  // Дорожка одинакова везде: и на первом экране, и внутри задачи. Человек
  // видит один и тот же порядок, поэтому не гадает, с кого начинать.
  const order = path?.order ?? STEP_ORDER;
  const done = path?.done ?? new Set<string>();
  const ordered = [...mine].sort((a, b) => {
    const ai = order.indexOf(a.id);
    const bi = order.indexOf(b.id);
    return (ai < 0 ? 99 : ai) - (bi < 0 ? 99 : bi);
  });
  const hereId = order.find((id) => ordered.some((a) => a.id === id) && !done.has(id));

  return (
    <ol
      className={`stagger grid gap-3 sm:grid-cols-2 ${
        compact ? "lg:grid-cols-4" : "lg:grid-cols-3"
      }`}
    >
      {ordered.map((a) => {
        const stepAt = order.indexOf(a.id);
        const isStep = stepAt >= 0;
        const state = !isStep
          ? "по надобности"
          : done.has(a.id)
            ? "готово"
            : a.id === hereId
              ? "вы здесь"
              : "дальше";
        const here = state === "вы здесь";
        const going = Boolean(started?.has(a.id));

        const inner = (
          <>
            <span className="flex items-center justify-between gap-3">
              <span
                className={`text-[11px] font-bold tabular-nums tracking-[0.18em] ${
                  here ? "text-foreground" : "text-muted-foreground"
                }`}
              >
                {isStep ? `0${stepAt + 1}` : "—"}
              </span>
              <span
                className={`text-[10px] font-bold uppercase tracking-[0.16em] ${
                  state === "готово"
                    ? "text-[color:var(--color-success)]"
                    : here
                      ? "text-foreground"
                      : "text-muted-foreground"
                }`}
              >
                {state}
              </span>
            </span>

            <span className="mt-6 block text-[1.35rem] font-normal leading-tight tracking-[-0.01em]">
              {a.name}
            </span>
            <span className="mt-1.5 block flex-1 text-[13px] leading-snug text-muted-foreground">
              {a.role}
            </span>
          </>
        );

        const base = `relative flex h-full flex-col border border-[color:var(--color-line)] px-6 py-7 text-left ${
          here ? "shadow-[inset_2px_0_0_0_var(--color-text-primary)]" : ""
        }`;

        return (
          <li key={a.id} className="contents">
            {onPick ? (
              <button
                onClick={() => onPick(a.id)}
                className={`${base} card-link transition-colors hover:bg-[color:color-mix(in_oklab,var(--color-text-primary)_5%,transparent)]`}
              >
                {inner}
                <span className="mt-6 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-[0.2em]">
                  {going ? "Продолжить" : "Начать"}
                  <span data-arrow aria-hidden>
                    →
                  </span>
                </span>
              </button>
            ) : (
              <div className={base}>{inner}</div>
            )}
          </li>
        );
      })}
    </ol>
  );
}

// ── Список задач ──────────────────────────────────────────────────────────────

function Start({
  ready,
  projects,
  windows,
}: {
  ready: boolean;
  projects: StoredProject[];
  windows: StoredWindow[];
}) {
  const { person } = useSession();
  const { createProject, attachToProject, mergeProject, open } = useWindows();
  const navigate = useNavigate();
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [query, setQuery] = useState("");
  const demoPicker = useRef<HTMLInputElement>(null);
  /** Задача, взятая мышью, и задача под курсором — прямо в списке задач:
      человек тащит строку на строку, как файл на папку. */
  const [picked, setPicked] = useState("");
  const [over, setOver] = useState("");
  const [merged, setMerged] = useState("");

  async function fold(fromId: string, toId: string) {
    if (fromId === toId) return;
    const from = projects.find((p) => p.id === fromId);
    const to = projects.find((p) => p.id === toId);
    setPicked("");
    setOver("");
    if (!from || !to) return;
    const res = await mergeProject(fromId, toId);
    setMerged(
      res.ok
        ? `«${from.title}» сложена в «${to.title}»`
        : "Сложить не получилось. Попробуйте ещё раз.",
    );
  }

  const mine = agents.filter((a) => person?.agentIds.includes(a.id));
  // Пустой кабинет и кабинет с работой — разные экраны. Новому человеку
  // сначала показываем, что он унесёт; вернувшемуся — его собственные задачи.
  const firstTime = ready && projects.length === 0;

  async function create() {
    const name = title.trim();
    if (!name || busy) return;
    setBusy(true);
    setError("");
    try {
      const { id, note } = await createProject(name);
      if (!id) {
        // Сервер объясняет отказ словами (например, упор в предел числа задач).
        // Своя формулировка — только когда объяснения не пришло.
        setError(note || "Задача не завелась. Проверьте связь и попробуйте ещё раз.");
        return;
      }
      setTitle("");
      void navigate({ to: "/", search: { z: id } });
    } catch {
      setError("Задача не завелась. Проверьте связь и попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  /**
   * Первый запуск — демонстрация, а не анкета.
   *
   * Раньше новый человек упирался в поле «назовите задачу»: его просили
   * что-то придумать до того, как показали, что он получит. Теперь первый
   * шаг — принести любой рабочий документ: задача заведётся сама, по имени
   * файла, и человек сразу окажется на пути решения.
   */
  async function startWithFile(file: File | null) {
    if (!file || busy) return;
    setBusy(true);
    setError("");
    try {
      const name =
        file.name
          .replace(/\.[a-z0-9]+$/i, "")
          .replace(/[_-]+/g, " ")
          .trim()
          .slice(0, 90) || "Первая задача";
      const made = await createProject(name);
      if (!made.id) {
        setError(made.note || "Задача не завелась. Проверьте связь и попробуйте ещё раз.");
        return;
      }
      const err = await attachToProject(made.id, file);
      if (err) setError(err);
      // Демонстрация не должна обрываться на пороге: документ принесён —
      // сразу открываем разговор с Архитектором, а не экран-прихожую.
      if (mine.some((a) => a.id === "architect")) {
        const talk = await open("architect", made.id, {});
        if (talk.id) {
          void navigate({ to: "/", search: { z: made.id, d: talk.id } });
          return;
        }
      }
      void navigate({ to: "/", search: { z: made.id } });
    } catch {
      setError("Не получилось. Проверьте связь и попробуйте ещё раз.");
    } finally {
      setBusy(false);
      if (demoPicker.current) demoPicker.current.value = "";
    }
  }

  const form = (
    <form
      onSubmit={(e) => {
        e.preventDefault();
        void create();
      }}
      className="flex flex-wrap items-end gap-5"
    >
      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        placeholder="Например: тариф M-сегмента"
        aria-label="Над чем работаем"
        className="min-w-[240px] flex-1 border-0 border-b border-[color:var(--color-line)] bg-transparent pb-3 text-lg outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-[color:var(--color-text-primary)]"
      />
      <button
        type="submit"
        disabled={!title.trim() || busy}
        className="bg-foreground px-7 py-3.5 text-[10px] font-bold uppercase tracking-[0.2em] text-background transition-opacity hover:opacity-80 disabled:opacity-30"
      >
        {busy ? "Завожу" : "Завести задачу"}
      </button>
    </form>
  );

  /**
   * Поиск идёт и по названиям задач, и по именам принесённых документов:
   * задачу через месяц вспоминают не по имени папки, а по тому, что в ней
   * лежало — «та, где был бюджет». Поле появляется, только когда список
   * перестал охватываться взглядом: на трёх задачах это лишний элемент.
   */
  const needle = query.trim().toLowerCase();
  const matches = (p: StoredProject) =>
    !needle ||
    p.title.toLowerCase().includes(needle) ||
    p.files.some((f) => f.name.toLowerCase().includes(needle));

  // Законченные не удалены и не спрятаны — просто не мешаются в ленте.
  const found = projects.filter((p) => isProjectOpen(p) && matches(p));
  const closed = projects.filter((p) => !isProjectOpen(p) && matches(p));

  const tasks = (
    <section>
      <div className="mb-7 flex flex-wrap items-baseline justify-between gap-3 border-b border-[color:var(--color-line)] pb-4">
        <h2 className="text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground">
          Ваши задачи
        </h2>
        <span className="text-[12px] font-medium tabular-nums text-muted-foreground">
          {projects.filter(isProjectOpen).length}
          {closed.length ? ` · законченных ${closed.length}` : ""}
        </span>
      </div>

      {projects.length >= 6 ? (
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          type="search"
          placeholder="Найти задачу или документ"
          aria-label="Найти задачу или документ"
          className="ui-body mb-4 w-full max-w-[380px] rounded-[10px] border border-[color:var(--color-line)] bg-transparent px-3.5 py-2.5 outline-none transition-colors focus:border-[color:var(--color-text-primary)]/40"
        />
      ) : null}

      {!ready ? (
        <p className="ui-body text-muted-foreground">Загружаю ваши задачи…</p>
      ) : !found.length ? (
        <p className="ui-body text-muted-foreground">
          {needle ? `По запросу «${query.trim()}» ничего не нашлось` : "Задач пока нет"}
        </p>
      ) : (
        <ul className="divide-y divide-[color:var(--color-line)] border-y border-[color:var(--color-line)]">
          {found.map((p) => {
            const talks = windows.filter((w) => w.projectId === p.id);
            const { stage } = visaOf(p, talks);
            const last = [...talks].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
            return (
              <li
                key={p.id}
                // Задачи складываются друг в друга перетаскиванием — как файл
                // в папку. Строка и берётся, и принимает: у списка нет отдельных
                // «папок», любая задача может стать папкой для другой.
                draggable
                data-taken={picked === p.id ? "true" : "false"}
                data-over={over === p.id && picked && picked !== p.id ? "true" : "false"}
                onDragStart={(e) => {
                  e.dataTransfer.setData("text/plain", p.id);
                  e.dataTransfer.effectAllowed = "move";
                  setPicked(p.id);
                  setMerged("");
                }}
                onDragEnd={() => {
                  setPicked("");
                  setOver("");
                }}
                onDragOver={(e) => {
                  if (!picked || picked === p.id) return;
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  setOver(p.id);
                }}
                onDragLeave={() => setOver((c) => (c === p.id ? "" : c))}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = e.dataTransfer.getData("text/plain") || picked;
                  if (id && id !== p.id) void fold(id, p.id);
                }}
                className="task-row"
              >
                <Link
                  to="/"
                  search={{ z: p.id }}
                  // Ссылку браузер тащит сам и унёс бы адрес вместо строки.
                  draggable={false}
                  className="flex w-full flex-wrap items-baseline justify-between gap-3 py-7 text-left"
                >
                  <span className="min-w-0">
                    <span className="block text-2xl font-normal leading-tight tracking-[-0.01em] sm:text-[1.75rem]">
                      {p.title}
                    </span>
                    <span className="mt-2 block text-[12px] uppercase tracking-[0.14em] text-muted-foreground">
                      {last
                        ? `${agentById(last.agentId)?.name ?? "агент"} · ${when(last.updatedAt)}`
                        : p.files.length
                          ? `документов ${p.files.length} · разговор ещё не начат`
                          : "пока пустая"}
                    </span>
                  </span>
                  <span className="ui-meta flex-none">
                    {/* Состояние дела, а не счётчик хранилища: человеку важно
                        «готов к защите», а не «файлов три». */}
                    {stage === "прогнано и доработано" ? (
                      <span className="font-semibold text-[color:var(--color-success)]">
                        готов к защите
                      </span>
                    ) : stage === "прогнано" ? (
                      <span className="font-semibold">есть документ</span>
                    ) : (
                      <span className="text-muted-foreground">Открыть →</span>
                    )}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {merged ? <p className="ui-support mt-3 text-muted-foreground">{merged}</p> : null}

      {closed.length ? (
        <details className="mt-6">
          <summary className="ui-support cursor-pointer text-muted-foreground">
            Законченные задачи · {closed.length}
          </summary>
          <ul className="mt-2 divide-y divide-[color:var(--color-line)] border-y border-[color:var(--color-line)]">
            {closed.map((p) => (
              <li key={p.id}>
                <Link
                  to="/"
                  search={{ z: p.id }}
                  className="flex w-full flex-wrap items-baseline justify-between gap-3 py-3 text-left"
                >
                  <span className="ui-body min-w-0 text-muted-foreground">{p.title}</span>
                  <span className="ui-meta flex-none text-muted-foreground">
                    закончена {when(p.closedAt ?? p.updatedAt)}
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </details>
      ) : null}
    </section>
  );

  const team = (
    <section>
      <div className="mb-6 flex flex-wrap items-baseline justify-between gap-3 border-b border-[color:var(--color-line)] pb-4">
        <h2 className="text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground">
          Как идёт работа
        </h2>
      </div>
      <Team mine={mine} />
    </section>
  );

  // Новому человеку: сначала команда и что он унесёт, потом одно поле.
  if (firstTime) {
    return (
      <>
        <PageHead eyebrow="Кабинет заказчика" title="С чего начнём" />
        <section className="grid gap-10 border-b border-[color:var(--color-line)] pb-16 md:grid-cols-[minmax(0,1fr)_auto] md:items-end">
          <div>
            <h2
              className="max-w-[14ch] font-normal leading-[1.02] tracking-[-0.01em]"
              style={{ fontSize: "clamp(1.75rem, 3.2vw, 2.75rem)" }}
            >
              Принесите любой рабочий документ
            </h2>
          </div>
          <input
            ref={demoPicker}
            type="file"
            hidden
            onChange={(e) => void startWithFile(e.target.files?.[0] ?? null)}
          />
          <button
            onClick={() => demoPicker.current?.click()}
            disabled={busy}
            className="justify-self-start bg-foreground px-9 py-4 text-[10px] font-bold uppercase tracking-[0.2em] text-background transition-opacity hover:opacity-80 disabled:opacity-30"
          >
            {busy ? "Завожу задачу" : "Принести документ"}
          </button>
          {error ? (
            <p className="text-[13px] text-[color:var(--color-error)] md:col-span-2">{error}</p>
          ) : null}
        </section>

        <div className="mt-20">{team}</div>

        <section className="mt-20 border-t border-[color:var(--color-line)] pt-10">
          <h2 className="mb-6 text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground">
            Или начните с названия
          </h2>
          {form}
        </section>
      </>
    );
  }

  // Вернувшемуся: сверху его работа, заведение — одной строкой.
  return (
    <>
      <PageHead eyebrow="Кабинет заказчика" title="Над чем работаем" />
      <section className="mb-16">
        {form}
        {error ? <p className="mt-3 text-[13px] text-[color:var(--color-error)]">{error}</p> : null}
      </section>
      {tasks}
      <div className="mt-20">{team}</div>
      <div className="mt-20">
        <Delivery />
      </div>
    </>
  );
}

// ── Задача ────────────────────────────────────────────────────────────────────

function Project({
  project,
  projects,
  windows,
}: {
  project: StoredProject;
  /** Все задачи человека — нужны как папки, в которые можно переложить разговор */
  projects: StoredProject[];
  windows: StoredWindow[];
}) {
  const { person } = useSession();
  const {
    open,
    renameProject,
    closeProject,
    removeProject,
    attachToProject,
    detachFromProject,
    download,
    toDrive,
  } = useWindows();
  const navigate = useNavigate();
  const [title, setTitle] = useState(project.title);
  const [renaming, setRenaming] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [opening, setOpening] = useState("");
  const [openError, setOpenError] = useState("");
  const [assembling, setAssembling] = useState(false);
  const mine = agents.filter((a) => person?.agentIds.includes(a.id));

  function saveTitle() {
    const next = title.trim();
    setRenaming(false);
    if (!next || next === project.title) {
      setTitle(project.title);
      return;
    }
    void renameProject(project.id, next);
  }

  async function openAgent(agentId: string, fresh = false) {
    if (opening) return;
    setOpening(agentId);
    setOpenError("");
    try {
      const { id, note } = await open(agentId, project.id, fresh ? { fresh: true } : {});
      if (id) {
        void navigate({ to: "/", search: { z: project.id, d: id } });
        return;
      }
      // Молчаливый отказ читался как «кнопка не работает».
      setOpenError(note || "Разговор не открылся. Попробуйте ещё раз.");
    } catch {
      setOpenError("Связь прервалась. Попробуйте ещё раз.");
    } finally {
      setOpening("");
    }
  }

  /**
   * Готовые документы — это разборы, а не каждая реплика агента.
   *
   * Сервер заводит запись на КАЖДЫЙ успешный ответ, включая односложные
   * уточнения вроде «а какой у вас горизонт?». Собрать их под заголовком
   * «Готовые документы» — значит пообещать человеку десять документов и
   * отдать восемь реплик. Отбираем по тому же признаку, по которому под
   * ответом появляется кнопка «Забрать документ».
   */
  const collected = windows.flatMap((w) =>
    w.docs
      .filter((doc) => {
        const source = doc.messageId ? w.messages.find((m) => m.id === doc.messageId) : undefined;
        // Реплику не нашли — не прячем: лучше лишняя строка, чем потерянный разбор.
        return source ? looksLikeDocument(source.text) : true;
      })
      .map((doc) => ({ doc, window: w, agent: agentById(w.agentId) })),
  );

  /**
   * Документ — герой экрана, а не строка в списке.
   *
   * Человек покупает не разговоры с агентами, а бумагу, с которой не стыдно
   * зайти на совет. Поэтому свежий документ показан крупно, как вещь: что это,
   * кто собрал, когда, и одна тёмная кнопка — забрать. Документы разные —
   * решение, вердикт, расчёт, позиции — и обложка называет вид, а не общее
   * слово «разбор». Остальные лежат полкой ниже.
   */
  const visa = visaOf(project, windows);

  const hero = collected.length
    ? [...collected].sort((a, b) => b.doc.at.localeCompare(a.doc.at))[0]!
    : null;
  const shelf = hero ? collected.filter((c) => c.doc.id !== hero.doc.id) : [];

  const results = hero ? (
    <section className="mb-11">
      {/* Единственная стеклянная пластина кабинета: материал достаётся тому,
          ради чего сюда пришли. Остальное — плоская бумага, см. .card-plain. */}
      <div className="card-flat px-6 py-6">
        <div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          {/* Не min-w-0: с ним колонка ужимается до нуля, и вместо переноса
              метки на новую строку заголовок рассыпается по одному слову в
              строку, а метка наезжает на подпись. Нижняя граница в 15rem
              заставляет ряд перенестись; min(…,100%) страхует узкие экраны. */}
          <div className="min-w-[min(15rem,100%)] flex-1">
            <div className="label-caps text-[color:var(--color-accent)]">
              {docKind(hero.window)}
            </div>
            <h2 className="ui-h2 mt-1.5 leading-snug">{hero.doc.title}</h2>
            <p className="ui-meta mt-1.5 text-muted-foreground">
              {hero.agent?.name ?? "агент"} · {when(hero.doc.at)}
              {/* Толщина: документ — вещь, и у вещи есть объём. По нему
                  человек понимает, читать сейчас или отложить до вечера. */}
              {thickness(hero.window, hero.doc.messageId)}
            </p>
          </div>
          <StageMark stage={visa.stage} />
        </div>
        <div className="mt-5 flex flex-wrap items-center gap-3">
          {hero.doc.messageId ? (
            <SaveWord
              windowId={hero.window.id}
              messageId={hero.doc.messageId}
              primary={!assembling}
            />
          ) : null}
          <Link
            to="/"
            search={{ z: project.id, d: hero.window.id }}
            className="btn btn-ghost ui-meta"
          >
            Открыть разговор
          </Link>
          {collected.length > 1 ? (
            <button onClick={() => setAssembling((v) => !v)} className="btn btn-ghost ui-meta">
              {assembling ? "Отмена" : `Собрать решение из ${collected.length}`}
            </button>
          ) : null}
        </div>
      </div>

      {assembling ? (
        <div className="mt-4">
          <Assemble project={project} parts={collected} onDone={() => setAssembling(false)} />
        </div>
      ) : null}

      {shelf.length ? (
        <ul className="mt-4 divide-y divide-[color:var(--color-line)] border-y border-[color:var(--color-line)]">
          {shelf.map(({ doc, window: w, agent }) => (
            <li key={doc.id} className="flex flex-wrap items-center justify-between gap-3 py-3">
              <span className="min-w-0">
                <span className="ui-body block leading-snug">{doc.title}</span>
                <span className="ui-meta mt-0.5 block text-muted-foreground">
                  {docKind(w)} · {agent?.name ?? "агент"} · {when(doc.at)}
                </span>
              </span>
              <span className="flex flex-none flex-wrap gap-2">
                <Link to="/" search={{ z: project.id, d: w.id }} className="btn btn-ghost ui-meta">
                  Открыть разговор
                </Link>
                {doc.messageId ? <SaveWord windowId={w.id} messageId={doc.messageId} /> : null}
              </span>
            </li>
          ))}
        </ul>
      ) : null}
    </section>
  ) : null;

  /**
   * Та же отметка, что видит руководитель в своей панели, — но здесь она для
   * автора. Раньше он про собственный документ этого не видел нигде и судил
   * по ощущению: работа закончена или нет. Строка отвечает без чтения.
   */

  return (
    <>
      {renaming ? (
        <div className="flex flex-wrap items-center gap-2.5">
          <input
            value={title}
            autoFocus
            onChange={(e) => setTitle(e.target.value)}
            onBlur={saveTitle}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
              if (e.key === "Escape") {
                setTitle(project.title);
                setRenaming(false);
              }
            }}
            aria-label="Название задачи"
            className="t-h1 min-w-[240px] flex-1 rounded-[10px] border border-[color:var(--color-line)] bg-transparent px-2 py-1 outline-none focus:border-[color:var(--color-text-primary)]/40"
          />
        </div>
      ) : (
        <div className="flex flex-wrap items-baseline gap-3">
          <h1 className="t-h1">{project.title}</h1>
          {/* Не .btn: у кнопки внутренние поля 28 px, и на телефоне, съехав
              под заголовок, она читалась случайным словом с отступом. */}
          <button
            onClick={() => setRenaming(true)}
            className="ui-meta tap-44 justify-start text-muted-foreground underline decoration-[color:var(--color-line)] underline-offset-4 hover:text-foreground"
          >
            Переименовать
          </button>
        </div>
      )}

      {/* Когда герой на экране, ступень стоит на нём — вторая капсула рядом
          с заголовком читалась заиканием. Строка остаётся словесной. */}
      {windows.length ? (
        <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
          {hero ? null : <StageMark stage={visa.stage} />}
          <span className="ui-support text-muted-foreground">{visaLine(visa)}</span>
        </div>
      ) : null}

      {/* Документ — первым: человек покупает бумагу, с которой идут на защиту,
          и, открыв задачу, должен увидеть её, а не меню. Путь решения — ниже:
          он обслуга вокруг документа, пока документа нет — он и есть экран. */}
      {results}

      <div className="mt-7">
        <section className="mb-11">
          <div className="mb-4 flex flex-wrap items-baseline justify-between gap-3 border-b border-[color:var(--color-line)] pb-4">
            <h2 className="text-[10px] font-bold uppercase tracking-[0.22em] text-muted-foreground">
              Путь решения
            </h2>
          </div>

          <Team
            mine={mine}
            onPick={(id) => void openAgent(id)}
            started={new Set(windows.map((w) => w.agentId))}
            compact
            path={{
              order: ["architect", "stakeholders", "accountant"],
              done: new Set(
                mine
                  .filter((a) =>
                    windows.some(
                      (w) =>
                        w.agentId === a.id &&
                        w.messages.some((m) => m.from === "agent" && looksLikeDocument(m.text)),
                    ),
                  )
                  .map((a) => a.id),
              ),
            }}
          />
          {opening ? (
            <p className="ui-meta mt-3 text-muted-foreground">Открываю разговор…</p>
          ) : null}
          {openError ? (
            <p className="ui-support mt-3 text-[color:var(--color-error)]">{openError}</p>
          ) : null}
        </section>
      </div>

      {windows.length ? (
        <section className="mb-11">
          <h2 className="ui-h2 mb-4">Разговоры</h2>
          <Talks project={project} projects={projects} windows={windows} />
        </section>
      ) : null}

      {/* Документы ниже команды осознанно: на первом экране задачи должно быть
          видно, кого можно позвать. Раньше здесь лежал длинный список файлов,
          и агенты уезжали под него — человек их просто не находил. */}
      <section className="mb-11">
        <h2 className="ui-h2 mb-1">Документы задачи</h2>
        <Attachments
          files={project.files}
          max={MAX_WINDOW_FILES}
          onUpload={(file) => attachToProject(project.id, file)}
          onRemove={(fileId) => detachFromProject(project.id, fileId)}
          onDownload={download}
          onGoogle={toDrive}
          empty="Пока пусто"
        />
      </section>

      {/* «Закончить» — обычное рабочее действие и стоит отдельно от удаления:
          одно убирает задачу из ленты, второе стирает работу насовсем, и
          путать их нельзя. */}
      <section className="mt-12 flex flex-wrap items-center gap-3">
        <button
          onClick={() => void closeProject(project.id, isProjectOpen(project))}
          className="btn btn-glass ui-meta"
        >
          {isProjectOpen(project) ? "Закончить задачу" : "Вернуть в работу"}
        </button>
      </section>

      {/* Разрушительное — внизу экрана и в стороне от рабочих кнопок */}
      <section className="mt-8 border-t border-[color:var(--color-line)] pt-5">
        {confirmDelete ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="ui-support measure text-muted-foreground">
              Сотрётся вся задача: {countLine(project, windows)}
            </span>
            <button
              onClick={() => {
                void removeProject(project.id);
                // Адрес удалённой задачи в истории уже мёртв — заменяем его,
                // чтобы «Назад» не приводила на пустоту.
                void navigate({ to: "/", search: {}, replace: true });
              }}
              className="btn btn-glass ui-meta text-[color:var(--color-error)]"
            >
              Да, удалить задачу
            </button>
            <button onClick={() => setConfirmDelete(false)} className="btn btn-ghost ui-meta">
              Отмена
            </button>
          </div>
        ) : (
          <button onClick={() => setConfirmDelete(true)} className="btn btn-ghost ui-meta">
            Удалить задачу
          </button>
        )}
      </section>
    </>
  );
}

/**
 * Разговоры задачи и папки, в которые их можно переложить.
 *
 * Раньше папки жили на одном экране, а разговоры на другом, и разложить работу
 * по местам было нечем: задача заводится второпях, а через неделю оказывается,
 * что разговор относился к соседней. Теперь папки видны здесь же, под строками.
 *
 * Переносить можно двумя путями, и это не прихоть: события перетаскивания
 * в браузере телефона не срабатывают вовсе, а половина заходов — с телефона.
 * Мышью — перетащить строку на папку; пальцем и с клавиатуры — нажать
 * «Перенести» и выбрать папку. Оба пути ведут в одно и то же действие.
 */
function Talks({
  project,
  projects,
  windows,
}: {
  project: StoredProject;
  projects: StoredProject[];
  windows: StoredWindow[];
}) {
  const { moveWindow } = useWindows();
  /** Разговор, который сейчас переносят: взят мышью или выбран кнопкой */
  const [picked, setPicked] = useState("");
  /** Папка под курсором — чтобы было видно, куда именно уронишь */
  const [over, setOver] = useState("");
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState("");

  const folders = projects.filter((p) => p.id !== project.id);

  async function move(windowId: string, to: StoredProject) {
    if (busy) return;
    setBusy(true);
    setOver("");
    try {
      const res = await moveWindow(windowId, to.id);
      setPicked("");
      setSaid(
        res.ok
          ? `Разговор перенесён в «${to.title}»`
          : "Перенести не удалось. Проверьте связь и попробуйте ещё раз.",
      );
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <ul className="divide-y divide-[color:var(--color-line)] border-y border-[color:var(--color-line)]">
        {windows.map((w) => {
          const agent = agentById(w.agentId);
          const taken = picked === w.id;
          return (
            <li
              key={w.id}
              draggable={folders.length > 0}
              data-taken={taken ? "true" : "false"}
              onDragStart={(e) => {
                e.dataTransfer.setData("text/plain", w.id);
                e.dataTransfer.effectAllowed = "move";
                setPicked(w.id);
                setSaid("");
              }}
              onDragEnd={() => {
                setPicked("");
                setOver("");
              }}
              className="talk-row flex flex-wrap items-center gap-3 py-3.5"
            >
              <Link
                to="/"
                search={{ z: project.id, d: w.id }}
                // Ссылка перетаскивается браузером сама и утащила бы адрес
                // вместо строки — перетаскивание отдаём строке целиком.
                draggable={false}
                className="min-w-0 flex-1"
              >
                <span className="ui-body block font-medium leading-snug">{w.title}</span>
                <span className="ui-meta mt-0.5 block text-muted-foreground">
                  {agent?.name ?? "агент недоступен"} · {when(w.updatedAt)}
                  {/* Состояние дела, а не опись хранилища: сколько там
                      сообщений — забота системы, а не человека. */}
                  {talkState(w)}
                </span>
              </Link>
              {folders.length ? (
                <button
                  onClick={() => {
                    setSaid("");
                    setPicked(taken ? "" : w.id);
                  }}
                  aria-expanded={taken}
                  className="btn btn-ghost ui-meta flex-none"
                >
                  {taken ? "Отмена" : "Перенести"}
                </button>
              ) : null}
            </li>
          );
        })}
      </ul>

      {folders.length ? (
        <div className="mt-4">
          <div className="label-caps mb-2">{picked ? "Куда переложить" : "Другие задачи"}</div>
          <div className="flex flex-wrap gap-2">
            {folders.map((p) => (
              <button
                key={p.id}
                disabled={busy}
                data-armed={picked ? "true" : "false"}
                data-over={over === p.id ? "true" : "false"}
                onDragOver={(e) => {
                  // Без preventDefault браузер не считает это местом, куда можно уронить.
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  setOver(p.id);
                }}
                onDragLeave={() => setOver((c) => (c === p.id ? "" : c))}
                onDrop={(e) => {
                  e.preventDefault();
                  const id = e.dataTransfer.getData("text/plain") || picked;
                  if (id) void move(id, p);
                }}
                onClick={() => {
                  if (picked) void move(picked, p);
                }}
                className="drop-folder ui-support max-w-[260px] truncate rounded-[10px] border px-3.5 py-2"
              >
                {p.title}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {said ? <p className="ui-support mt-3 text-muted-foreground">{said}</p> : null}
    </>
  );
}

/**
 * Собрать решение: один документ из отмеченных разборов.
 *
 * Порядок отметок — порядок в документе: человек сам решает, что идёт первым,
 * а что приложением. По умолчанию отмечено всё, потому что чаще всего именно
 * это и нужно — сшить накопленное.
 */
function Assemble({
  project,
  parts,
  onDone,
}: {
  project: StoredProject;
  parts: { doc: { id: string; title: string; messageId?: string }; window: StoredWindow }[];
  onDone: () => void;
}) {
  const { code } = useSession();
  const usable = parts.filter((p) => p.doc.messageId);
  const [picked, setPicked] = useState<string[]>(usable.map((p) => p.doc.id));
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState("");

  async function build() {
    if (!code || busy || !picked.length) return;
    setBusy(true);
    setSaid("");
    try {
      const chosen = usable
        .filter((p) => picked.includes(p.doc.id))
        .map((p) => ({ windowId: p.window.id, messageId: p.doc.messageId! }));
      const res = await assembleServer({ data: { code, projectId: project.id, parts: chosen } });
      if (res.ok) {
        saveFile(res.name, res.base64, DOCX_MIME);
        setSaid(res.note || "Готово — документ скачан");
        onDone();
      } else {
        setSaid(res.note || "Собрать не удалось. Попробуйте ещё раз.");
      }
    } catch {
      setSaid("Связь прервалась. Попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card-plain mb-4 px-5 py-5">
      <div className="ui-title">Что войдёт в документ</div>
      <ul className="space-y-1.5">
        {usable.map((p) => {
          const on = picked.includes(p.doc.id);
          return (
            <li key={p.doc.id}>
              <label className="flex cursor-pointer items-start gap-2.5">
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(e) =>
                    setPicked((list) =>
                      e.target.checked ? [...list, p.doc.id] : list.filter((x) => x !== p.doc.id),
                    )
                  }
                  className="mt-1 flex-none"
                />
                <span className="ui-body min-w-0">{p.doc.title}</span>
              </label>
            </li>
          );
        })}
      </ul>
      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          onClick={() => void build()}
          disabled={busy || !picked.length}
          className="btn btn-primary ui-body disabled:opacity-40"
        >
          {busy ? "Собираю" : `Собрать документ · ${picked.length}`}
        </button>
        <button onClick={onDone} className="btn btn-ghost ui-meta">
          Отмена
        </button>
      </div>
      {said ? <p className="ui-support mt-3 text-muted-foreground">{said}</p> : null}
    </div>
  );
}

/**
 * Ступень задачи одним словом. Цветом отмечена только доведённая работа:
 * если подсветить все состояния, ни одно не будет значить ничего.
 */
function StageMark({ stage }: { stage: VisaStage }) {
  const done = stage === "прогнано и доработано";
  return (
    <span
      className={`label-caps flex-none rounded-[var(--radius-pill)] border px-2.5 py-[3px] ${
        done
          ? "border-[color:var(--color-success)] text-[color:var(--color-success)]"
          : "border-[color:var(--color-line)]"
      }`}
    >
      {stage}
    </span>
  );
}

/** Что именно пропадёт — числами, а не словом «со всем содержимым». */
function countLine(project: StoredProject, windows: StoredWindow[]): string {
  const docs = windows.reduce((n, w) => n + w.docs.length, 0);
  const parts = [
    `${project.files.length} ${word(project.files.length, "документ", "документа", "документов")}`,
    `${windows.length} ${word(windows.length, "разговор", "разговора", "разговоров")}`,
  ];
  if (docs)
    parts.push(
      `${docs} ${word(docs, "готовый документ", "готовых документа", "готовых документов")}`,
    );
  return parts.join(", ");
}

/** Скачать разбор в Word прямо из списка готовых документов. */
function SaveWord({
  windowId,
  messageId,
  primary = false,
}: {
  windowId: string;
  messageId: string;
  /** Тёмной кнопкой — у документа-героя: это главное действие экрана */
  primary?: boolean;
}) {
  const { code } = useSession();
  const [busy, setBusy] = useState(false);

  async function save() {
    if (!code || busy) return;
    setBusy(true);
    try {
      const res = await downloadAnswerServer({ data: { code, windowId, messageId } });
      if (res.ok) saveFile(res.name, res.base64, DOCX_MIME);
    } finally {
      setBusy(false);
    }
  }

  return (
    <button
      onClick={() => void save()}
      disabled={busy}
      className={`btn ${primary ? "btn-primary ui-body" : "btn-glass ui-meta"} disabled:opacity-50`}
    >
      {busy ? "Собираю" : "Скачать в Word"}
    </button>
  );
}

// ── Разговор ──────────────────────────────────────────────────────────────────

function Conversation({ window: w, project }: { window: StoredWindow; project: StoredProject }) {
  const {
    windows,
    send,
    remove,
    attachToProject,
    detachFromProject,
    detach,
    takeIntoWindow,
    download,
    thinkingId,
    note,
    clearNote,
  } = useWindows();
  const { code } = useSession();
  const navigate = useNavigate();
  const [draft, setDraft] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [uploading, setUploading] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const agent = agentById(w.agentId);
  const thinking = thinkingId === w.id;

  const [roles, setRoles] = useState<RoleChip[]>([]);
  const [roleId, setRoleId] = useState<string | null>(
    () => [...w.messages].reverse().find((m) => m.roleId)?.roleId ?? null,
  );

  useEffect(() => {
    if (!code) return;
    let alive = true;
    getAgentRolesServer({ data: { code, agentId: w.agentId } })
      .then((r) => alive && setRoles(r.roles))
      .catch(() => alive && setRoles([]));
    return () => {
      alive = false;
    };
  }, [code, w.agentId]);

  const seen = useMemo(() => [...project.files, ...w.files], [project.files, w.files]);
  const hasRoles = roles.length > 0;
  const role = roles.find((r) => r.id === roleId) ?? null;
  const shown = hasRoles
    ? w.messages.filter((m) => m.roleId === roleId)
    : w.messages.filter((m) => !m.roleId);
  const speaker = hasRoles ? (role?.name ?? null) : (agent?.name ?? null);

  /**
   * Догоняем разговор до последней реплики.
   *
   * На широком экране лента — своё окно прокрутки, и достаточно scrollTop.
   * На телефоне она развёрнута в страницу (см. мобильные правила .talk-pane),
   * своей прокрутки у неё нет, и присваивание scrollTop не делает ничего:
   * человек открывал разговор и видел первое сообщение месячной давности,
   * а поле ввода оказывалось на два экрана ниже.
   */
  useEffect(() => {
    const list = listRef.current;
    if (!list) return;
    const scrolls = list.scrollHeight > list.clientHeight + 1;
    if (scrolls) {
      list.scrollTop = list.scrollHeight;
      return;
    }
    list.lastElementChild?.scrollIntoView({ block: "end" });
  }, [shown.length, roleId, thinking]);

  /**
   * Выбор роли только выбирает.
   *
   * Раньше клик сразу запускал многоминутный прогон по документу: человек
   * тыкал в незнакомое имя, чтобы посмотреть, кто это, и оказывался в
   * необратимом ожидании. Прогон запускает отдельная кнопка ниже.
   */
  function pickRole(id: string) {
    setRoleId(id);
  }

  const saveAnswer = useCallback(
    async (messageId: string) => {
      if (!code) return;
      const res = await downloadAnswerServer({ data: { code, windowId: w.id, messageId } });
      if (res.ok) saveFile(res.name, res.base64, DOCX_MIME);
    },
    [code, w.id],
  );

  const saveModel = useCallback(
    async (messageId: string) => {
      if (!code) return "";
      const res = await downloadModelServer({ data: { code, windowId: w.id, messageId } });
      if (res.ok) saveFile(res.name, res.base64, XLSX_MIME);
      return res.ok ? res.note : res.note || "шаблон заполнить не удалось";
    },
    [code, w.id],
  );

  const toGoogle = useCallback(
    async (messageId: string, kind: "answer" | "model") => {
      if (!code) return "";
      const res = await toGoogleServer({ data: { code, kind, windowId: w.id, messageId } });
      if (res.ok && res.url) window.open(res.url, "_blank", "noopener,noreferrer");
      return res.ok ? res.note : res.note || "на Диск не уехало";
    },
    [code, w.id],
  );

  async function submit() {
    const text = draft.trim();
    if (!text || thinking || uploading) return;
    if (hasRoles && !role) return;
    setDraft("");
    const res = await send(w.id, text, hasRoles ? { roleId: role!.id } : undefined);
    // Вопрос не должен пропасть вместе со связью: возвращаем его в поле.
    if (!res.ok) setDraft(text);
  }

  /**
   * Что сейчас главное на экране разговора: собрать состав и прогнать
   * документ — или отвечать роли. Пока ни одна роль не высказалась, поле
   * ввода бессмысленно: отвечать некому.
   */
  const spoke = w.messages.some((m) => m.from === "agent" && m.roleId);
  /* Роль выбрана, но разговора ещё нет: единственное действие экрана —
     показать ей документ. Панель в этот момент уступает, иначе на экране
     стояли бы две тёмные кнопки и спорили, с чего начинать. */
  const roleOpenFirst = hasRoles && Boolean(role) && !spoke;
  const panelFirst = hasRoles && !spoke && !roleOpenFirst;

  // Роль не выбрана — об этом уже говорят и панель, и плейсхолдер поля:
  // третье напоминание под кнопкой было бы перебором.
  const blocked = uploading ? "Агент ещё не получил документ — дождитесь загрузки" : "";

  return (
    <>
      {hasRoles ? (
        <Panel
          window={w}
          roles={roles}
          activeId={roleId}
          disabled={thinking}
          hasDocs={seen.length > 0}
          onPick={pickRole}
          /* Тёмная кнопка на экране одна. Пока состав не набран и не прогнан,
             главное действие — здесь; как только роли высказались, главным
             становится ответ в поле ввода. */
          primary={panelFirst}
        />
      ) : null}

      {/* talk-pane: высота ограничена экраном, иначе стеклянная пластина растёт
          вместе с перепиской и браузер перерисовывает её на каждом кадре.
          На узких экранах ограничение снимается — там прокрутка одна. */}
      <div className="card-plain talk-pane flex flex-col">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-[color:var(--color-line)] px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="ui-title truncate leading-snug">{w.title}</div>
            <div className="ui-meta mt-1 flex items-center gap-1.5 text-muted-foreground">
              <span
                aria-hidden
                className="h-[5px] w-[5px] flex-none rounded-full bg-[color:var(--color-accent)]"
              />
              {hasRoles
                ? role
                  ? `${agent?.name ?? "Роли"} · говорит ${role.name}`
                  : `${agent?.name ?? "Роли"} · роль не выбрана`
                : `${agent?.name ?? "агент недоступен"}${agent ? ` · ${agent.role}` : ""}`}
            </div>
          </div>
        </div>

        {/* data-talk-list: по нему стили разворачивают ленту на телефоне и
            в печати — иначе разбор читался бы через щель во весь лист. */}
        <div ref={listRef} data-talk-list className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
          {shown.length === 0 && !thinking ? (
            <div className="flex h-full min-h-[140px] flex-col items-center justify-center gap-3 text-center sm:min-h-[240px]">
              {hasRoles ? (
                role ? (
                  <>
                    <p className="ui-body measure text-muted-foreground">
                      {seen.length ? `«${role.name}» ещё не читал документ` : `Принесите документ`}
                    </p>
                    <button
                      onClick={() => void send(w.id, "", { roleId: role.id, kind: "open" })}
                      disabled={!seen.length || thinking}
                      className="btn btn-primary ui-body disabled:opacity-40"
                    >
                      Показать документ роли
                    </button>
                  </>
                ) : (
                  <p className="ui-body measure text-muted-foreground">Выберите роль</p>
                )
              ) : (
                <p className="ui-body measure text-muted-foreground">
                  {agent ? agent.result : "Опишите задачу своими словами"}
                </p>
              )}
            </div>
          ) : null}

          {shown.map((m) => (
            <Message
              key={m.id}
              id={m.id}
              from={m.from}
              text={m.text}
              note={m.note}
              pending={m.id.startsWith("local-")}
              onSave={saveAnswer}
              onModel={saveModel}
              onGoogle={toGoogle}
            />
          ))}

          {thinking ? <Waiting name={speaker ?? "Агент"} files={seen.map((f) => f.name)} /> : null}
        </div>

        {note ? (
          <div className="sys-note ui-support flex items-start gap-3 px-5 py-3">
            <span className="flex-1">{note}</span>
            <button
              onClick={clearNote}
              aria-label="Скрыть сообщение"
              className="text-muted-foreground"
            >
              ✕
            </button>
          </div>
        ) : null}

        <div className="border-t border-[color:var(--color-line)] px-5 py-3">
          <Attachments
            files={seen}
            max={MAX_WINDOW_FILES}
            compact
            onUpload={async (file) => {
              // Пока документ едет, отправлять вопрос нельзя: агент его ещё
              // не получил, а разбор без главного файла выглядит правдоподобно
              // и потому опаснее пустого ответа.
              setUploading(true);
              try {
                return await attachToProject(project.id, file);
              } finally {
                setUploading(false);
              }
            }}
            onRemove={(fileId) =>
              w.files.some((f) => f.id === fileId)
                ? detach(w.id, fileId)
                : detachFromProject(project.id, fileId)
            }
            onDownload={download}
          />
        </div>

        <form
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
          className="flex flex-wrap items-end gap-2.5 border-t border-[color:var(--color-line)] px-5 py-4"
        >
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
            rows={2}
            disabled={hasRoles && !role}
            placeholder={
              hasRoles
                ? role
                  ? `Ответьте роли «${role.name}»`
                  : "Сначала выберите роль выше"
                : "Опишите задачу своими словами"
            }
            aria-label={`Сообщение агенту ${speaker ?? ""}`}
            className="ui-body min-h-[52px] w-full min-w-0 flex-1 resize-none rounded-[12px] border border-[color:var(--color-line)] bg-transparent px-3.5 py-2.5 outline-none transition-colors focus:border-[color:var(--color-text-primary)]/40 sm:w-auto"
          />
          <div className="flex flex-none flex-wrap items-center gap-2.5">
            {hasRoles && role && shown.length >= 2 ? (
              <button
                type="button"
                onClick={() => void send(w.id, "", { roleId: role.id, kind: "verdict" })}
                disabled={thinking}
                className="btn btn-glass ui-meta disabled:opacity-40"
              >
                Подвести итог
              </button>
            ) : null}
            <button
              type="submit"
              disabled={!draft.trim() || thinking || Boolean(blocked)}
              className={`btn ${hasRoles && !spoke ? "btn-glass" : "btn-primary"} ui-body disabled:opacity-40`}
            >
              Отправить
            </button>
          </div>
          {blocked ? <p className="ui-meta w-full text-muted-foreground">{blocked}</p> : null}
        </form>
      </div>

      {/* Сборка документа и шпаргалка методики — только там, где они про дело */}
      {w.agentId === "architect" ? (
        <>
          <Build windowId={w.id} />
          <Checklist />
        </>
      ) : null}

      <FromProject
        window={w}
        neighbours={windows.filter((x) => x.projectId === project.id && x.id !== w.id)}
        taken={w.files}
        onTake={takeIntoWindow}
        onDrop={(fileId) => detach(w.id, fileId)}
        onDownload={download}
      />

      <section className="mt-10">
        {/* Здесь список полный, включая короткие ответы: внутри разговора это
            история работы. «Готовыми документами» на экране задачи называется
            только то, что действительно тянет на разбор. */}
        <h2 className="ui-h2 mb-4">Что собрал агент</h2>
        {w.docs.length ? (
          <ul className="divide-y divide-[color:var(--color-line)] border-y border-[color:var(--color-line)]">
            {w.docs.map((doc, i) => {
              const messageId =
                doc.messageId ?? w.messages.filter((m) => m.from === "agent")[i]?.id;
              return (
                <li
                  key={doc.id}
                  className="flex flex-wrap items-center justify-between gap-3 py-3.5"
                >
                  <span className="min-w-0">
                    <span className="ui-body block font-medium">{doc.title}</span>
                    <span className="ui-meta mt-0.5 block text-muted-foreground">
                      {when(doc.at)}
                    </span>
                  </span>
                  {messageId ? <SaveWord windowId={w.id} messageId={messageId} /> : null}
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="ui-body text-muted-foreground">Пока пусто</p>
        )}
      </section>

      <section className="mt-14 border-t border-[color:var(--color-line)] pt-5">
        {confirmDelete ? (
          <div className="flex flex-wrap items-center gap-3">
            <span className="ui-support measure text-muted-foreground">
              Сотрётся весь разговор:{" "}
              {`${w.messages.length} ${word(w.messages.length, "сообщение", "сообщения", "сообщений")}`}
              {w.docs.length
                ? `, ${w.docs.length} ${word(w.docs.length, "готовый документ", "готовых документа", "готовых документов")}`
                : ""}
            </span>
            <button
              onClick={() => {
                void remove(w.id);
                void navigate({ to: "/", search: { z: project.id }, replace: true });
              }}
              className="btn btn-glass ui-meta text-[color:var(--color-error)]"
            >
              Да, удалить разговор
            </button>
            <button onClick={() => setConfirmDelete(false)} className="btn btn-ghost ui-meta">
              Отмена
            </button>
          </div>
        ) : (
          <button onClick={() => setConfirmDelete(true)} className="btn btn-ghost ui-meta">
            Удалить разговор
          </button>
        )}
      </section>
    </>
  );
}

/**
 * «Взять из задачи» — чужой разбор в этот разговор.
 *
 * Само оно не переносится, и это осознанно: решение Архитектора не должно
 * подмешиваться в разговор с ролью только потому, что лежит в одной задаче.
 * Человек решает, кому что показать, — и видит здесь же, что показал.
 */
function FromProject({
  window: w,
  neighbours,
  taken,
  onTake,
  onDrop,
  onDownload,
}: {
  window: StoredWindow;
  neighbours: StoredWindow[];
  taken: StoredFile[];
  onTake: (windowId: string, messageId: string) => Promise<string>;
  onDrop: (fileId: string) => Promise<void>;
  onDownload: (
    file: StoredFile,
  ) => Promise<{ ok: boolean; name: string; mime: string; base64: string }>;
}) {
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  const offers = neighbours.flatMap((n) =>
    n.docs.filter((d) => d.messageId).map((d) => ({ doc: d, agent: agentById(n.agentId) })),
  );
  const here = new Set(taken.map((f) => f.name));

  async function take(messageId: string) {
    setBusy(messageId);
    setError("");
    try {
      setError(await onTake(w.id, messageId));
    } finally {
      setBusy("");
    }
  }

  if (!offers.length && !taken.length) return null;

  return (
    <section className="mt-10">
      <h2 className="ui-h2 mb-1">Взять из задачи</h2>

      {offers.length ? (
        <ul className="divide-y divide-[color:var(--color-line)] border-y border-[color:var(--color-line)]">
          {offers.map(({ doc, agent }) => (
            <li key={doc.id} className="flex flex-wrap items-center justify-between gap-3 py-3.5">
              <span className="min-w-0">
                <span className="ui-body block leading-snug">{doc.title}</span>
                <span className="ui-meta mt-0.5 block text-muted-foreground">
                  {agent?.name ?? "агент"} · {when(doc.at)}
                </span>
              </span>
              {here.has(`${doc.title}.md`) ? (
                <span className="ui-meta text-muted-foreground">уже здесь</span>
              ) : (
                <button
                  onClick={() => void take(doc.messageId!)}
                  disabled={Boolean(busy)}
                  className="btn btn-glass ui-meta disabled:opacity-40"
                >
                  {busy === doc.messageId ? "Несу" : "Взять сюда"}
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="ui-body text-muted-foreground">Пока пусто</p>
      )}

      {error ? <p className="ui-support mt-2 text-[color:var(--color-error)]">{error}</p> : null}

      {taken.length ? (
        <div className="mt-5">
          <div className="label-caps mb-2">Уже взято в этот разговор</div>
          <Attachments
            files={taken}
            max={MAX_WINDOW_FILES}
            onRemove={onDrop}
            onDownload={onDownload}
          />
        </div>
      ) : null}
    </section>
  );
}

/** Роль на кнопке: инструкции ролей в браузер не уезжают, только имена. */
type RoleChip = Omit<AgentRole, "prompt">;

/**
 * Кнопки ролей.
 *
 * Порядок неслучаен: сначала те, у кого есть право вернуть решение на
 * доработку, — снизу вверх по лестнице, — потом те, с кем договариваются.
 */
/**
 * Состав согласующих.
 *
 * Раньше здесь висели семь одинаковых плашек, и человек был обязан ходить
 * к каждой роли поодиночке: нажал → она читает документ → разговор → следующая.
 * На семь ролей это полдня кликов, и по плашкам не было видно, кто уже
 * высказался, а кто вернул на доработку.
 *
 * Теперь человек сам набирает состав под свой документ — перед разными
 * людьми защищают разное — и прогоняет документ по всему составу разом.
 * Прогон идёт на сервере: со страницы можно уйти, состояние подхватится.
 */
function Panel({
  window: w,
  roles,
  activeId,
  disabled,
  hasDocs,
  onPick,
  primary = true,
}: {
  window: StoredWindow;
  roles: RoleChip[];
  activeId: string | null;
  disabled: boolean;
  /** Прогонять нечего, если в задаче нет документов */
  hasDocs: boolean;
  onPick: (id: string) => void;
  /** Главное ли это действие экрана сейчас — от этого зависит тёмная кнопка */
  primary?: boolean;
}) {
  const { code } = useSession();
  const { setPanel, runPanel, reload } = useWindows();
  const chosen = w.panel ?? [];
  const [editing, setEditing] = useState(chosen.length === 0);
  const [draft, setDraft] = useState<string[]>(chosen);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState("");
  const [run, setRun] = useState<PanelState | null>(null);

  // Состав мог измениться в другой вкладке — держим черновик в согласии с ним.
  useEffect(() => {
    setDraft(w.panel ?? []);
  }, [w.panel]);

  /**
   * Пока прогон идёт, спрашиваем сервер, где он. Раз в семь секунд: ответ
   * одной роли — это минуты, чаще незачем, а реже человек решит, что застряло.
   */
  /**
   * Ответы ролей пишутся на сервере в фоне, а окна на клиенте грузятся один
   * раз за загрузку страницы. Без reload() человек видел счёт «прошли 2 из 3»,
   * но сами разборы и штампы появлялись только после F5 — то есть «не появлялись».
   * Поэтому: закончила роль — перечитываем разговоры, закончился прогон — тоже.
   */
  const seenDone = useRef(0);
  useEffect(() => {
    if (!code) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const tick = async () => {
      try {
        const st = await panelStateServer({ data: { code, windowId: w.id } });
        if (!alive) return;
        const finished = !st.running && seenDone.current > 0;
        const roleDone = st.doneRoleIds.length + st.failedRoleIds.length;
        if (roleDone > seenDone.current || finished) reload();
        seenDone.current = st.running ? roleDone : 0;
        setRun(st);
        if (st.running) timer = setTimeout(() => void tick(), 7000);
      } catch {
        /* связь моргнула — попробуем на следующем заходе */
        if (alive) timer = setTimeout(() => void tick(), 15000);
      }
    };
    void tick();
    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [code, w.id, w.messages.length, reload]);

  const inPanel = roles.filter((r) => chosen.includes(r.id));
  const running = Boolean(run?.running);

  async function save() {
    if (!draft.length || busy) return;
    setBusy(true);
    setSaid("");
    try {
      const res = await setPanel(w.id, draft);
      if (res.ok) setEditing(false);
      else setSaid("Состав не сохранился. Проверьте связь и попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  async function start() {
    if (busy) return;
    setBusy(true);
    setSaid("");
    try {
      const res = await runPanel(w.id);
      setSaid(res.note || (res.ok ? "Прогон пошёл" : ""));
      if (res.ok)
        setRun({
          running: true,
          total: chosen.length,
          doneRoleIds: [],
          currentRoleId: null,
          failedRoleIds: [],
        });
    } finally {
      setBusy(false);
    }
  }

  // ── Набор состава ──────────────────────────────────────────────────────────
  if (editing) {
    return (
      <section className="card-plain mb-4 px-5 py-5">
        <h2 className="ui-title">Кто будет согласовывать</h2>
        <div className="grid gap-2 sm:grid-cols-2">
          {roles.map((r) => {
            const on = draft.includes(r.id);
            return (
              <label
                key={r.id}
                className={`pick flex cursor-pointer items-start gap-2.5 rounded-[12px] border px-3.5 py-2.5 ${
                  on
                    ? "border-[color:var(--color-accent)] bg-[color:var(--color-accent-soft)]"
                    : "border-[color:var(--color-line)]"
                }`}
              >
                <input
                  type="checkbox"
                  checked={on}
                  onChange={(e) =>
                    setDraft((list) =>
                      e.target.checked ? [...list, r.id] : list.filter((x) => x !== r.id),
                    )
                  }
                  className="mt-1 flex-none"
                />
                <span className="min-w-0">
                  <span className="ui-body block font-medium leading-snug">{r.name}</span>
                  {r.hint ? (
                    <span className="ui-meta mt-0.5 block leading-snug text-muted-foreground">
                      {r.hint}
                    </span>
                  ) : null}
                </span>
              </label>
            );
          })}
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            onClick={() => void save()}
            disabled={!draft.length || busy}
            className={`btn ${primary ? "btn-primary" : "btn-glass"} ui-body disabled:opacity-40`}
          >
            {busy ? "Сохраняю" : `Собрать состав${draft.length ? ` · ${draft.length}` : ""}`}
          </button>
          {chosen.length ? (
            <button
              onClick={() => {
                setDraft(chosen);
                setEditing(false);
              }}
              className="btn btn-ghost ui-meta"
            >
              Отмена
            </button>
          ) : null}
        </div>
        {said ? <p className="ui-support mt-3 text-[color:var(--color-error)]">{said}</p> : null}
      </section>
    );
  }

  // ── Состав набран ──────────────────────────────────────────────────────────
  const done = run?.doneRoleIds ?? [];
  const failed = run?.failedRoleIds ?? [];

  return (
    <section className="card-plain mb-4 px-5 py-5">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="ui-title">Состав согласующих</h2>
        <button
          onClick={() => setEditing(true)}
          disabled={running}
          className="btn btn-ghost ui-meta disabled:opacity-40"
        >
          Изменить состав
        </button>
      </div>

      <ul className="mt-3.5 divide-y divide-[color:var(--color-line)] border-y border-[color:var(--color-line)]">
        {inPanel.map((r) => {
          const outcome = roleOutcome(w, r.id);
          const stamp = roleStamp(w, r.id);
          const now = run?.currentRoleId === r.id;
          const failedHere = failed.includes(r.id);
          const state = now
            ? "читает сейчас"
            : failedHere
              ? "не получилось — попробуйте ещё раз"
              : outcome === "молчит"
                ? done.includes(r.id)
                  ? "прочитал"
                  : "ждёт"
                : outcome;
          const strong = outcome === "вернул на доработку";
          return (
            <li key={r.id}>
              <button
                onClick={() => onPick(r.id)}
                disabled={disabled}
                aria-pressed={r.id === activeId}
                className={`block w-full py-3 text-left disabled:opacity-50 ${
                  r.id === activeId ? "font-semibold" : ""
                }`}
              >
                <span className="flex flex-wrap items-baseline justify-between gap-3">
                  <span className="min-w-0">
                    <span className="ui-body block leading-snug">{r.name}</span>
                    {r.hint ? (
                      <span className="ui-meta mt-0.5 block text-muted-foreground">{r.hint}</span>
                    ) : null}
                  </span>
                  {/* Когда под строкой стоит штамп, он уже сказал то же самое —
                      громче и словами. Повтор справа читался заиканием:
                      «вернул на доработку», а следом «ВЕРНУЛ НА ДОРАБОТКУ».
                      Пока роль работает («читает сейчас», «ждёт», ошибка) —
                      строка нужна: штампа ещё нет. */}
                  {stamp && !now && !failedHere ? null : (
                    <span
                      className={`ui-meta flex-none ${
                        strong ? "text-[color:var(--color-error)]" : "text-muted-foreground"
                      }`}
                    >
                      {now ? <span className="mr-1.5 inline-block animate-pulse">•</span> : null}
                      {state}
                    </span>
                  )}
                </span>
                {/* Вердикт — событие, а не строка списка: штамп называет, кто,
                    когда и какими словами закрыл или вернул документ. */}
                {stamp ? <Stamp who={r.name} stamp={stamp} /> : null}
              </button>
            </li>
          );
        })}
      </ul>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {running ? (
          <span className="ui-support text-muted-foreground">
            Прошли {done.length} из {run?.total ?? inPanel.length}
          </span>
        ) : (
          <>
            <button
              onClick={() => void start()}
              disabled={busy || !hasDocs}
              className={`btn ${primary ? "btn-primary" : "btn-glass"} ui-body disabled:opacity-40`}
            >
              {busy ? "Запускаю" : "Прогнать документ по составу"}
            </button>
            {hasDocs ? null : (
              <span className="ui-support text-muted-foreground">Нужен документ</span>
            )}
          </>
        )}
      </div>

      {said ? <p className="ui-support mt-3 text-muted-foreground">{said}</p> : null}
    </section>
  );
}

/**
 * Пока агент пишет, видно, сколько он уже пишет.
 *
 * Разбор на шесть страниц идёт минутами, и без счётчика это неотличимо от
 * зависшей страницы: человек жмёт заново или уходит.
 */
function Waiting({ name, files }: { name: string; files: string[] }) {
  const [sec, setSec] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setSec((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);

  /**
   * В эти минуты происходит самое дорогое — документы человека читают.
   * Секундомер говорил «подождите»; фазы говорят «работаю над вашим».
   * Врать нельзя: имена берём из настоящих документов разговора, и порядок
   * фаз соответствует настоящему порядку работы — сначала чтение, потом текст.
   */
  const quote = (n: string) => `«${n}»`;
  const first = files.slice(0, 2).map(quote).join(", ");
  const restOf = files.slice(2);
  // Средняя фаза не выдумана: у модели включено размышление (adaptive thinking),
  // и до первой буквы ответа она действительно думает. Если документов больше
  // двух, вместо этого называем оставшиеся — это и точнее, и человеку виднее,
  // что читают именно его материалы, а не «что-то там».
  const middle = restOf.length
    ? `читает ${restOf.slice(0, 2).map(quote).join(", ")}${
        restOf.length > 2 ? ` и ещё ${restOf.length - 2}` : ""
      }`
    : "обдумывает прочитанное";
  const phase = !first
    ? sec < 30
      ? "обдумывает вопрос"
      : "пишет разбор"
    : sec < 20
      ? `читает ${first}`
      : sec < 50
        ? middle
        : "пишет разбор";

  return (
    <div className="ui-support flex items-center gap-2.5 text-muted-foreground">
      <span className="h-[5px] w-[5px] animate-pulse rounded-full bg-[color:var(--color-accent)]" />
      <span>
        {name} {phase}
      </span>
    </div>
  );
}

const Message = memo(function Message({
  id,
  from,
  text,
  note,
  pending,
  onSave,
  onModel,
  onGoogle,
}: {
  id: string;
  from: "user" | "agent";
  text: string;
  /** Приписка платформы: «агент прочитал не всё» — живёт на сообщении навсегда */
  note?: string | undefined;
  pending: boolean;
  onSave: (messageId: string) => Promise<void>;
  onModel: (messageId: string) => Promise<string>;
  onGoogle: (messageId: string, kind: "answer" | "model") => Promise<string>;
}) {
  const mine = from === "user";
  const body = useRef<HTMLDivElement>(null);
  const [copied, setCopied] = useState("");

  const hasCells = /\|[^|\n]+\|\s*\$?[A-Z]{1,3}\d{1,4}\s*\|/.test(text);
  const isDocument = looksLikeDocument(text);

  async function copy() {
    const el = body.current;
    if (!el) return;
    const plain = plainOf(el);
    try {
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([el.innerHTML], { type: "text/html" }),
            "text/plain": new Blob([plain], { type: "text/plain" }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(plain);
      }
      setCopied("Скопировано");
    } catch {
      setCopied("Браузер не дал доступ к буферу");
    }
    setTimeout(() => setCopied(""), 2500);
  }

  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className={`${mine ? "max-w-[86%] text-right" : "w-full"}`}>
        <div
          className={`rounded-[14px] px-4 py-3 ${
            mine
              ? `ui-body whitespace-pre-line bg-primary leading-relaxed text-primary-foreground ${pending ? "opacity-70" : ""}`
              : "border border-[color:var(--color-line)] text-foreground"
          }`}
        >
          {mine ? (
            text
          ) : (
            <div ref={body}>
              <Markdown>{text}</Markdown>
            </div>
          )}

          {/* Разбор по половине документа — не то же, что разбор: приписка
              стоит на ответе всегда, в том числе назавтра и после прогона
              по составу, где летучей полосы разговора нет. */}
          {!mine && note ? (
            <p className="ui-meta mt-3 border-t border-[color:var(--color-line)] pt-2.5 text-[color:var(--color-error)]">
              {note}
            </p>
          ) : null}

          {mine ? null : (
            <TakeAway
              id={id}
              isDocument={isDocument}
              hasCells={hasCells}
              copied={copied}
              onCopy={copy}
              onSave={onSave}
              onModel={onModel}
              onGoogle={onGoogle}
            />
          )}
        </div>
      </div>
    </div>
  );
});

/**
 * Забрать документ.
 *
 * Раньше здесь стояли пять кнопок одного веса — «Скачать модель в Excel»,
 * «Модель в Google Таблицы», «В Google Документы», «Скопировать текст»,
 * «Скачать в Word», — и то единственное, ради чего человек пришёл, терялось
 * среди них. Теперь одно заметное действие, а форматы — внутри него.
 */
function TakeAway({
  id,
  isDocument,
  hasCells,
  copied,
  onCopy,
  onSave,
  onModel,
  onGoogle,
}: {
  id: string;
  isDocument: boolean;
  hasCells: boolean;
  copied: string;
  onCopy: () => Promise<void>;
  onSave: (messageId: string) => Promise<void>;
  onModel: (messageId: string) => Promise<string>;
  onGoogle: (messageId: string, kind: "answer" | "model") => Promise<string>;
}) {
  const [open, setOpen] = useState(false);
  const [status, setStatus] = useState("");
  const toggle = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);

  // Раскрытый ряд форматов у нижнего ответа оказывается ниже видимой части
  // ленты — человек нажимает и не понимает, что что-то произошло.
  useEffect(() => {
    if (open) panel.current?.scrollIntoView({ block: "nearest" });
  }, [open]);

  async function run(what: string, job: () => Promise<string | void>) {
    // Ряд сворачивается вместе с нажатой кнопкой, поэтому фокус возвращаем
    // на переключатель — иначе он падает в body и таб начинается заново.
    toggle.current?.focus();
    setOpen(false);
    setStatus(what);
    try {
      const note = await job();
      setStatus(typeof note === "string" && note ? note : "Готово");
    } catch {
      setStatus("Не получилось — попробуйте ещё раз");
    }
    setTimeout(() => setStatus(""), 7000);
  }

  const formats: { label: string; run: () => void }[] = [
    { label: "Текст в Word", run: () => void run("Собираю документ", () => onSave(id)) },
    ...(hasCells
      ? [
          {
            label: "Расчёт в Excel",
            run: () => void run("Собираю таблицу", () => onModel(id)),
          },
        ]
      : []),
    {
      label: "В Google Документы",
      run: () => void run("Отправляю в Google", () => onGoogle(id, "answer")),
    },
    ...(hasCells
      ? [
          {
            label: "В Google Таблицы",
            run: () => void run("Отправляю в Google", () => onGoogle(id, "model")),
          },
        ]
      : []),
  ];

  /**
   * Форматы раскрываются в потоке, а не всплывающим меню.
   *
   * Лента разговора прокручивается внутри пластины (overflow-y: auto), и
   * абсолютное меню у нижнего ответа просто обрезалось бы её краем: человек
   * нажимал бы «Забрать документ» и не видел ничего. Раскрытие строкой ниже
   * обрезать нечем, оно работает пальцем и проходится табом без своей
   * клавиатурной навигации.
   */
  return (
    <div data-take-away className="mt-3 border-t border-[color:var(--color-line)] pt-3">
      <div className="flex flex-wrap items-center justify-end gap-2.5">
        {copied || status ? (
          <span className="ui-meta mr-auto text-muted-foreground">{copied || status}</span>
        ) : null}

        <button onClick={() => void onCopy()} className="btn btn-ghost ui-meta">
          Скопировать
        </button>

        {isDocument ? (
          <button
            ref={toggle}
            onClick={() => setOpen((v) => !v)}
            aria-expanded={open}
            className="btn btn-glass ui-meta gap-1.5"
          >
            {open ? "Скрыть форматы" : "Забрать документ"}
            <Chevron />
          </button>
        ) : (
          <button
            onClick={() => void run("Собираю документ", () => onSave(id))}
            className="btn btn-glass ui-meta"
          >
            Скачать в Word
          </button>
        )}
      </div>

      {isDocument && open ? (
        <div ref={panel} className="mt-3 flex flex-wrap items-center justify-end gap-2">
          <span className="label-caps mr-auto">В каком виде</span>
          {formats.map((f) => (
            <button key={f.label} onClick={f.run} className="btn btn-glass ui-meta">
              {f.label}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/**
 * Ответ простым текстом — так, как он выглядит на экране.
 *
 * Одна поправка: сокращённым ссылкам возвращаем полный адрес. На экране
 * «docs.google.com/spreadsheets/d/1AbC…» читается лучше полотна, но в письме
 * это уже не ссылка, а обрубок.
 */
function plainOf(el: HTMLElement): string {
  const copy = el.cloneNode(true) as HTMLElement;
  copy.querySelectorAll("a[data-short]").forEach((a) => {
    a.textContent = a.getAttribute("href") ?? a.textContent;
  });
  copy.style.cssText = `position:absolute;left:-99999px;top:0;width:${el.clientWidth || 720}px`;
  document.body.appendChild(copy);
  const text = copy.innerText.trim();
  copy.remove();
  return text;
}

/**
 * Толщина документа: страницы и время чтения.
 *
 * Документ — предмет, и первое, что о предмете хочется знать, — насколько он
 * велик. Считаем по знакам ответа: около 1800 знаков на страницу и примерно
 * 1300 знаков в минуту вдумчивого чтения — цифры грубые, поэтому и говорим
 * «около», а не точное число.
 */
function thickness(w: StoredWindow, messageId?: string): string {
  const text = messageId ? (w.messages.find((m) => m.id === messageId)?.text ?? "") : "";
  const chars = text.trim().length;
  if (!chars) return "";
  const pages = Math.max(1, Math.round(chars / 1800));
  const minutes = Math.max(1, Math.round(chars / 1300));
  return ` · ${pages} ${word(pages, "страница", "страницы", "страниц")}, около ${minutes} ${word(minutes, "минуты", "минут", "минут")} чтения`;
}

/**
 * Чем закончился разговор — словами дела.
 *
 * Раньше здесь стояло «готовых документов 2 · 14 сообщений»: счётчики
 * хранилища, по которым не понять, надо ли сюда возвращаться.
 */
function talkState(w: StoredWindow): string {
  const back = (w.panel ?? []).some((id) => roleOutcome(w, id) === "вернул на доработку");
  if (back) return " · есть возражения";
  if (w.messages.some((m) => m.from === "agent" && looksLikeDocument(m.text))) {
    return " · документ собран";
  }
  if (w.messages.length) return " · идёт разговор";
  return " · ещё не начат";
}

/**
 * Штамп вердикта.
 *
 * «Вернул на доработку» от финдиректора — это событие: оно решает, пойдёт
 * документ дальше или нет. Строкой в списке оно читалось как пометка о
 * состоянии; штампом — как приговор, у которого есть автор, дата и
 * формулировка. Ритуал, в который верят, стоит дороже аккуратной строки.
 */
function Stamp({ who, stamp }: { who: string; stamp: RoleStamp }) {
  const back = stamp.outcome === "вернул на доработку";
  return (
    <span
      className={`mt-2.5 block rounded-[10px] border px-3.5 py-2.5 ${
        back
          ? "border-[color:var(--color-error)]/45 bg-[color:var(--color-error-soft)]"
          : "border-[color:var(--color-success)]/45 bg-[color:var(--color-success-soft)]"
      }`}
    >
      <span className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <span
          className={`label-caps ${
            back ? "text-[color:var(--color-error)]" : "text-[color:var(--color-success)]"
          }`}
        >
          {back ? "Вернул на доработку" : "Пропустил дальше"}
        </span>
        <span className="ui-meta text-muted-foreground">
          {who} · {when(stamp.at)}
        </span>
      </span>
      {stamp.words ? (
        <span className="ui-support mt-1.5 block leading-snug">{stamp.words}</span>
      ) : null}
    </span>
  );
}

/**
 * Вид документа — по тому, кто его собрал.
 *
 * Агенты выполняют разные задачи управленца, и их документы — разные вещи:
 * решение несут на защиту, вердикт закрывает возражение, расчёт сверяют
 * с финансами. Обложка обязана называть вид, а не общее слово «разбор».
 */
function docKind(w: StoredWindow): string {
  switch (w.agentId) {
    case "architect":
      return "Решение";
    case "stakeholders":
      return "Вердикт согласующего";
    case "accountant":
      return "Расчёт и записка";
    case "neurocouncil":
      return "Позиции совета";
    default:
      return "Документ";
  }
}

/**
 * Ответ тянет на документ, а не на реплику в разговоре.
 *
 * Признак берём из самого текста, а не из имени агента: уточняющий вопрос
 * может задать любой, и шестистраничный разбор — тоже любой.
 */
function looksLikeDocument(text: string): boolean {
  return text.trim().length >= 600 || /^#{1,3}\s/m.test(text);
}

/** Дата человеческим языком: сегодня, вчера или число. */
function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days <= 0) return "сегодня";
  if (days === 1) return "вчера";
  return d.toLocaleDateString("ru-RU");
}

/** «1 документ», «2 документа», «7 документов» — иначе счётчик режет глаз. */
function word(n: number, one: string, few: string, many: string): string {
  const last = n % 10;
  const two = n % 100;
  if (two >= 11 && two <= 14) return many;
  if (last === 1) return one;
  if (last >= 2 && last <= 4) return few;
  return many;
}
