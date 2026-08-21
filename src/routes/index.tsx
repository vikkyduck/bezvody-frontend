import { createFileRoute } from "@tanstack/react-router";
import { memo, useCallback, useEffect, useRef, useState } from "react";

import { AppShell, PageHead } from "@/components/AppShell";
import { Attachments } from "@/components/Attachments";
import { Markdown } from "@/components/Markdown";
import type { StoredWindow } from "@/lib/conversations";
import { MAX_WINDOW_FILES, type StoredFile } from "@/lib/documents";
import type { StoredProject } from "@/lib/projects";
import { DOCX_MIME, saveFile } from "@/lib/download";
import type { AgentRole } from "@/lib/roles";
import { getAgentRolesServer } from "@/lib/server-agents";
import { downloadAnswerServer } from "@/lib/server-files";
import { useSession } from "@/lib/session";
import { agentById, agents } from "@/lib/shtab-data";
import { useWindows } from "@/lib/windows-store";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Кабинет — платформа «Без Воды»" },
      { name: "description", content: "Выберите агента и работайте над своей задачей." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Workspace,
});

function Workspace() {
  return (
    <AppShell allow={["client"]}>
      <Body />
    </AppShell>
  );
}

/**
 * Три уровня: список задач → задача → разговор с агентом.
 *
 * Раньше уровней было два, и документы лежали в окне. Из-за этого один и тот
 * же отчёт приходилось приносить каждому агенту заново, а результаты работы
 * по одной задаче расползались по несвязанным окнам. Папка задачи убирает и
 * то, и другое.
 */
function Body() {
  const { person } = useSession();
  const { projects, windows, ready, activeProjectId, setActiveProject, activeId, setActive } =
    useWindows();

  const activeWindow = windows.find((w) => w.id === activeId) ?? null;
  const activeProject =
    projects.find((p) => p.id === (activeWindow?.projectId ?? activeProjectId)) ?? null;

  if (!person) return null;
  if (activeWindow && activeProject) {
    return (
      <Conversation
        key={activeWindow.id}
        window={activeWindow}
        project={activeProject}
        onBack={() => setActive(null)}
      />
    );
  }
  if (activeProject) {
    return (
      <Project
        key={activeProject.id}
        project={activeProject}
        windows={windows.filter((w) => w.projectId === activeProject.id)}
        onBack={() => setActiveProject(null)}
      />
    );
  }
  return <Start ready={ready} projects={projects} windows={windows} />;
}

// ── Выбор агента ──────────────────────────────────────────────────────────────

function Start({
  ready,
  projects,
  windows,
}: {
  ready: boolean;
  projects: StoredProject[];
  windows: StoredWindow[];
}) {
  const { createProject, setActiveProject } = useWindows();
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);

  async function create() {
    const name = title.trim();
    if (!name || busy) return;
    setBusy(true);
    try {
      await createProject(name);
      setTitle("");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHead
        n="01"
        eyebrow="Ваш кабинет"
        title="Над чем работаем"
        lead="Задача — это папка. Документы кладутся в неё один раз, и их читает любой агент, к которому вы с этой задачей придёте."
      />

      <section className="card-flat px-5 py-5">
        <h2 className="text-[15px] font-semibold">Новая задача</h2>
        <p className="measure mt-1 text-[12.5px] text-muted-foreground">
          Назовите её так, как называете в жизни: «Тариф M-сегмента», «Пилот в Казани». Внутри вы
          принесёте документы и позовёте тех агентов, которые нужны.
        </p>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void create();
          }}
          className="mt-3.5 flex flex-wrap items-center gap-2.5"
        >
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="Название задачи"
            aria-label="Название задачи"
            className="min-w-[240px] flex-1 rounded-[10px] border border-[color:var(--color-line)] bg-transparent px-3.5 py-2.5 text-[13.5px] outline-none transition-colors focus:border-[color:var(--color-text-primary)]/40"
          />
          <button
            type="submit"
            disabled={!title.trim() || busy}
            className="btn btn-primary text-[13px] disabled:opacity-40"
          >
            {busy ? "Завожу" : "Завести папку"}
          </button>
        </form>
      </section>

      <section className="mt-11">
        <h2 className="mb-1 text-[15px] font-semibold">Ваши задачи</h2>
        <p className="measure mb-4 text-[12.5px] text-muted-foreground">
          Всё по задаче лежит в её папке: документы, разговоры с агентами и то, что они собрали.
        </p>

        {!ready ? (
          <p className="text-[13px] text-muted-foreground">Загружаю…</p>
        ) : projects.length ? (
          <ul className="divide-y divide-[color:var(--color-line)] border-y border-[color:var(--color-line)]">
            {projects.map((p) => {
              const talks = windows.filter((w) => w.projectId === p.id);
              const collected = talks.reduce((n, w) => n + w.docs.length, 0);
              return (
                <li key={p.id}>
                  <button
                    onClick={() => setActiveProject(p.id)}
                    className="flex w-full flex-wrap items-baseline justify-between gap-3 py-3.5 text-left"
                  >
                    <span className="min-w-0">
                      <span className="block text-[14px] font-medium leading-snug">{p.title}</span>
                      <span className="mt-0.5 block text-[12px] text-muted-foreground">
                        {when(p.updatedAt)}
                        {p.files.length
                          ? ` · документов ${p.files.length}`
                          : " · документов пока нет"}
                        {talks.length ? ` · разговоров ${talks.length}` : ""}
                        {collected ? ` · собрано ${collected}` : ""}
                      </span>
                    </span>
                    <span className="flex-none text-[12px] text-muted-foreground">Открыть →</span>
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-[13px] text-muted-foreground">
            Задач пока нет. Заведите первую папку выше — работа начинается с неё.
          </p>
        )}
      </section>
    </>
  );
}

// ── Папка задачи ──────────────────────────────────────────────────────────────

/**
 * Всё по одной задаче: документы, агенты, разговоры и собранное.
 *
 * Документы лежат здесь, а не в разговоре, и это главное отличие от прежнего
 * устройства: принесли отчёт один раз — его прочитает и Архитектор, и каждая
 * роль Стейкхолдеров, и Счетовод.
 */
function Project({
  project,
  windows,
  onBack,
}: {
  project: StoredProject;
  windows: StoredWindow[];
  onBack: () => void;
}) {
  const { person } = useSession();
  const {
    open,
    setActive,
    renameProject,
    removeProject,
    attachToProject,
    detachFromProject,
    download,
  } = useWindows();
  const [title, setTitle] = useState(project.title);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const mine = agents.filter((a) => person?.agentIds.includes(a.id));

  // Имя задачи правится на месте: заводили второпях, уточнили по ходу дела.
  function saveTitle() {
    const next = title.trim();
    if (!next || next === project.title) {
      setTitle(project.title);
      return;
    }
    void renameProject(project.id, next);
  }

  const collected = windows.flatMap((w) =>
    w.docs.map((doc) => ({ doc, window: w, agent: agentById(w.agentId) })),
  );

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <button onClick={onBack} className="btn btn-ghost text-[12.5px]">
          ← Все задачи
        </button>
        {confirmDelete ? (
          <>
            <button
              onClick={() => void removeProject(project.id)}
              className="btn btn-ghost ml-auto text-[12px] text-[color:var(--color-error)]"
            >
              Точно удалить задачу со всем содержимым
            </button>
            <button onClick={() => setConfirmDelete(false)} className="btn btn-ghost text-[12px]">
              Отмена
            </button>
          </>
        ) : (
          <button
            onClick={() => setConfirmDelete(true)}
            className="btn btn-ghost ml-auto text-[12px]"
          >
            Удалить задачу
          </button>
        )}
      </div>

      <input
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onBlur={saveTitle}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") setTitle(project.title);
        }}
        aria-label="Название задачи"
        className="w-full rounded-[10px] border border-transparent bg-transparent px-1 py-1 text-[24px] font-semibold leading-tight outline-none transition-colors hover:border-[color:var(--color-line)] focus:border-[color:var(--color-text-primary)]/40"
      />

      <section className="mt-7">
        <h2 className="mb-1 text-[15px] font-semibold">Документы задачи</h2>
        <p className="measure mb-4 text-[12.5px] text-muted-foreground">
          Отчёты, выгрузки, договоры. Их читает любой агент этой задачи — приносить каждому отдельно
          не нужно. Имя файла — ссылка на скачивание. Ссылку можно просто прислать в разговоре:
          платформа откроет её и положит документ сюда. Закрытый документ откройте «всем, у кого
          есть ссылка», иначе платформа увидит только окно входа.
        </p>
        <Attachments
          files={project.files}
          max={MAX_WINDOW_FILES}
          onUpload={(file) => attachToProject(project.id, file)}
          onRemove={(fileId) => detachFromProject(project.id, fileId)}
          onDownload={download}
          empty="Пока ничего не принесли. Документы можно перетащить прямо сюда."
        />
      </section>

      <section className="mt-11">
        <h2 className="mb-1 text-[15px] font-semibold">С кем поработаем</h2>
        <p className="measure mb-4 text-[12.5px] text-muted-foreground">
          Выберите агента — откроется разговор внутри этой задачи. Документы он уже видит.
        </p>
        {mine.length ? (
          <div className="grid gap-3 md:grid-cols-3">
            {mine.map((a) => (
              <button
                key={a.id}
                onClick={() => void open(a.id, project.id)}
                className="card-flat flex h-full flex-col px-5 py-5 text-left transition-transform hover:-translate-y-[2px]"
              >
                <div className="text-[16px] font-semibold leading-snug">{a.name}</div>
                <p className="mt-2 flex-1 text-[13px] text-muted-foreground">{a.result}</p>
                <p className="mt-3 text-[11.5px] text-muted-foreground/80">{a.method}</p>
                <span className="mt-4 text-[12.5px] font-medium">Открыть разговор →</span>
              </button>
            ))}
          </div>
        ) : (
          <p className="text-[13px] text-muted-foreground">
            Агентов пока не открыли — напишите вашему проджект-менеджеру.
          </p>
        )}
      </section>

      {windows.length ? (
        <section className="mt-11">
          <h2 className="mb-1 text-[15px] font-semibold">Разговоры</h2>
          <p className="measure mb-4 text-[12.5px] text-muted-foreground">
            С кем вы уже говорили по этой задаче. Разговор можно продолжить с любого места.
          </p>
          <ul className="divide-y divide-[color:var(--color-line)] border-y border-[color:var(--color-line)]">
            {windows.map((w) => {
              const agent = agentById(w.agentId);
              return (
                <li key={w.id}>
                  <button
                    onClick={() => setActive(w.id)}
                    className="flex w-full flex-wrap items-baseline justify-between gap-3 py-3.5 text-left"
                  >
                    <span className="min-w-0">
                      <span className="block text-[14px] font-medium leading-snug">
                        {agent?.name ?? "агент недоступен"}
                      </span>
                      <span className="mt-0.5 block text-[12px] text-muted-foreground">
                        {when(w.updatedAt)}
                        {w.docs.length ? ` · собрано ${w.docs.length}` : ""}
                        {w.files.length ? ` · взято из задачи ${w.files.length}` : ""}
                      </span>
                    </span>
                    <span className="flex-none text-[12px] text-muted-foreground">
                      {w.messages.length ? `${w.messages.length} сообщ.` : "пусто"}
                    </span>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>
      ) : null}

      <section className="mt-11">
        <h2 className="mb-1 text-[15px] font-semibold">Собрано по задаче</h2>
        <p className="measure mb-4 text-[12.5px] text-muted-foreground">
          Всё, что агенты сделали в этой папке. Ищите здесь, а не в почте.
        </p>
        {collected.length ? (
          <ul className="divide-y divide-[color:var(--color-line)] border-y border-[color:var(--color-line)]">
            {collected.map(({ doc, window: w, agent }) => (
              <li key={doc.id} className="flex flex-wrap items-baseline justify-between gap-3 py-3">
                <span className="min-w-0">
                  <span className="block text-[14px] leading-snug">{doc.title}</span>
                  <span className="mt-0.5 block text-[12px] text-muted-foreground">
                    {agent?.name ?? "агент"} · {doc.kind} · {when(doc.at)}
                  </span>
                </span>
                <button onClick={() => setActive(w.id)} className="btn btn-glass text-[11.5px]">
                  Открыть разговор
                </button>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[13px] text-muted-foreground">
            Пока пусто: агенты по этой задаче ещё ничего не собрали.
          </p>
        )}
      </section>
    </>
  );
}

// ── Разговор ──────────────────────────────────────────────────────────────────

function Conversation({
  window: w,
  project,
  onBack,
}: {
  window: StoredWindow;
  project: StoredProject;
  onBack: () => void;
}) {
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
  const [draft, setDraft] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const agent = agentById(w.agentId);
  const thinking = thinkingId === w.id;

  // Роли агента. Имена приезжают с сервера — методолог правит их в админке,
  // и клиент должен видеть его список, а не тот, что зашит в код.
  const [roles, setRoles] = useState<RoleChip[]>([]);
  // Какая роль сейчас говорит. При возврате в окно продолжаем последнюю.
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

  // Агент видит документы задачи и то, что принесли лично ему.
  const seen = [...project.files, ...w.files];
  const hasRoles = roles.length > 0;
  const role = roles.find((r) => r.id === roleId) ?? null;
  // Разговор с ролью — свой, отдельный от других ролей этого же окна.
  const shown = hasRoles
    ? w.messages.filter((m) => m.roleId === roleId)
    : w.messages.filter((m) => !m.roleId);
  const speaker = hasRoles ? (role?.name ?? null) : (agent?.name ?? null);

  // Прокручиваем сам список, а не страницу: разговор живёт в своём окне,
  // и уводить человека вниз всей страницей незачем.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [shown.length, roleId, thinking]);

  /**
   * Выбрали роль. Если она документ ещё не видела, а документ в окне есть —
   * сразу отдаём ей материалы: человек нажал на роль, чтобы услышать её,
   * а не чтобы нажать ещё одну кнопку.
   */
  function pickRole(id: string) {
    setRoleId(id);
    if (thinking) return;
    const started = w.messages.some((m) => m.roleId === id);
    if (!started && seen.length) void send(w.id, "", { roleId: id, kind: "open" });
  }

  // Ссылка стабильная: иначе memo на репликах перестанет работать и разговор
  // снова начнёт перерисовываться на каждую букву.
  const saveAnswer = useCallback(
    async (messageId: string) => {
      if (!code) return;
      const res = await downloadAnswerServer({ data: { code, windowId: w.id, messageId } });
      if (res.ok) saveFile(res.name, res.base64, DOCX_MIME);
    },
    [code, w.id],
  );

  function submit() {
    const text = draft.trim();
    if (!text || thinking) return;
    // У агента с ролями реплика всегда адресована конкретной роли: без неё
    // непонятно, кто отвечает, и история разговора смешалась бы.
    if (hasRoles && !role) return;
    setDraft("");
    void send(w.id, text, hasRoles ? { roleId: role!.id } : undefined);
  }

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <button onClick={onBack} className="btn btn-ghost text-[12.5px]">
          ← К задаче
        </button>
        {confirmDelete ? (
          <>
            <button
              onClick={() => void remove(w.id)}
              className="btn btn-ghost text-[12px] text-[color:var(--color-error)]"
            >
              Точно удалить окно
            </button>
            <button onClick={() => setConfirmDelete(false)} className="btn btn-ghost text-[12px]">
              Отмена
            </button>
          </>
        ) : (
          <button
            onClick={() => setConfirmDelete(true)}
            className="btn btn-ghost ml-auto text-[12px]"
          >
            Удалить окно
          </button>
        )}
      </div>

      {hasRoles ? (
        <RoleBar
          roles={roles}
          activeId={roleId}
          spokeWith={(id) => w.messages.some((m) => m.roleId === id)}
          disabled={thinking}
          onPick={pickRole}
        />
      ) : null}

      {/* talk-pane: высота окна ограничена экраном. Без этого карточка растёт
          вместе с разговором — на шести ответах агента это шестьдесят тысяч
          пикселей стекла, которые браузер перерисовывает на каждый кадр. */}
      <div className="card-flat talk-pane flex flex-col">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-[color:var(--color-line)] px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[11.5px] text-muted-foreground">{project.title}</div>
            <div className="truncate text-[15px] font-semibold leading-snug">{w.title}</div>
            <div className="mt-1 flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <span
                aria-hidden
                className="h-[5px] w-[5px] flex-none rounded-full bg-[color:var(--color-accent)]"
              />
              {hasRoles
                ? role
                  ? `${agent?.name ?? "Роли"} · говорит ${role.name}`
                  : `${agent?.name ?? "Роли"} · роль не выбрана`
                : (agent?.name ?? "агент недоступен")}
            </div>
          </div>
        </div>

        <div ref={listRef} className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
          {shown.length === 0 && !thinking ? (
            <div className="flex h-full min-h-[280px] flex-col items-center justify-center gap-3 text-center">
              {hasRoles ? (
                role ? (
                  <>
                    <p className="measure text-[13.5px] text-muted-foreground">
                      {seen.length
                        ? `«${role.name}» ещё не читал ваш документ.`
                        : `«${role.name}» читает документ. Принесите файл в задачу или пришлите ссылку — и роль начнёт разговор.`}
                    </p>
                    <button
                      onClick={() => void send(w.id, "", { roleId: role.id, kind: "open" })}
                      disabled={!seen.length || thinking}
                      className="btn btn-primary text-[12.5px] disabled:opacity-40"
                    >
                      Показать документ роли
                    </button>
                  </>
                ) : (
                  <p className="measure text-[13.5px] text-muted-foreground">
                    Выберите роль выше — она прочитает документы задачи и начнёт разговор. По одной
                    роли за раз: отработали возражения — идёте к следующей.
                  </p>
                )
              ) : (
                <p className="measure text-[13.5px] text-muted-foreground">
                  {agent
                    ? `${agent.result}. Опишите задачу своими словами.`
                    : "Опишите задачу своими словами."}
                </p>
              )}
            </div>
          ) : null}

          {shown.map((m) => (
            <Message key={m.id} id={m.id} from={m.from} text={m.text} onSave={saveAnswer} />
          ))}

          {thinking ? <Waiting name={speaker ?? "Агент"} /> : null}
        </div>

        {note ? (
          <div className="flex items-start gap-3 border-t border-[color:var(--color-line)] px-5 py-3 text-[12.5px] text-[color:var(--color-accent)]">
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

        {/* Документы задачи — на виду у поля ввода: агент читает их при каждом
            вопросе. Принесённое здесь попадает в папку, а не в один разговор:
            следующему агенту не придётся нести то же самое. */}
        <div className="border-t border-[color:var(--color-line)] px-5 py-3">
          <Attachments
            files={seen}
            max={MAX_WINDOW_FILES}
            compact
            onUpload={(file) => attachToProject(project.id, file)}
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
            submit();
          }}
          className="flex items-end gap-2.5 border-t border-[color:var(--color-line)] px-5 py-4"
        >
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // Enter отправляет, Shift+Enter — перенос строки: так быстрее пишется.
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
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
            className="min-h-[52px] flex-1 resize-none rounded-[12px] border border-[color:var(--color-line)] bg-transparent px-3.5 py-2.5 text-[13.5px] outline-none transition-colors focus:border-[color:var(--color-text-primary)]/40"
          />
          {/* Роль заканчивает вердиктом — иначе разговор обрывается на полуслове,
              а участнику нужно понять, с чем он идёт на следующую ступень. */}
          {hasRoles && role && shown.length >= 2 ? (
            <button
              type="button"
              onClick={() => void send(w.id, "", { roleId: role.id, kind: "verdict" })}
              disabled={thinking}
              className="btn btn-glass text-[12.5px] disabled:opacity-40"
            >
              Подвести итог
            </button>
          ) : null}
          <button
            type="submit"
            disabled={!draft.trim() || thinking || (hasRoles && !role)}
            className="btn btn-primary text-[13px] disabled:opacity-40"
          >
            Отправить
          </button>
        </form>
      </div>

      {/* Разбор соседнего агента — сюда же, но только по решению человека */}
      <FromProject
        window={w}
        neighbours={windows.filter((x) => x.projectId === project.id && x.id !== w.id)}
        taken={w.files}
        onTake={takeIntoWindow}
        onDrop={(fileId) => detach(w.id, fileId)}
        onDownload={download}
      />

      <section className="mt-8">
        <h2 className="mb-1 text-[15px] font-semibold">Собрано агентом</h2>
        <p className="measure mb-4 text-[12.5px] text-muted-foreground">
          Разборы и решения, которые агент сделал в этом окне. Они остаются здесь — искать их в
          почте не придётся.
        </p>
        {w.docs.length ? (
          <ul className="divide-y divide-[color:var(--color-line)] border-y border-[color:var(--color-line)]">
            {w.docs.map((doc, i) => {
              // У разборов, собранных до появления выгрузки, ссылки на реплику
              // нет — берём ответ по порядку, он тот же самый.
              const messageId =
                doc.messageId ?? w.messages.filter((m) => m.from === "agent")[i]?.id;
              return (
                <li
                  key={doc.id}
                  className="flex flex-wrap items-baseline justify-between gap-3 py-3"
                >
                  <span className="text-[14px]">{doc.title}</span>
                  <span className="flex items-baseline gap-3 text-[12px] text-muted-foreground">
                    <span>
                      {doc.kind} · {when(doc.at)}
                    </span>
                    {messageId ? (
                      <button
                        onClick={() => void saveAnswer(messageId)}
                        className="btn btn-glass text-[11.5px]"
                      >
                        Скачать в Word
                      </button>
                    ) : null}
                  </span>
                </li>
              );
            })}
          </ul>
        ) : (
          <p className="text-[13px] text-muted-foreground">
            Пока пусто: агент ещё ничего не собрал в этом окне.
          </p>
        )}
      </section>
    </>
  );
}

/**
 * «Взять из задачи» — чужой разбор в этот разговор.
 *
 * Само оно не переносится, и это осознанно: шестистраничник Архитектора не
 * должен подмешиваться в разговор с ролью только потому, что лежит в одной
 * папке. Человек решает, кому что показать, — и видит здесь же, что показал.
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

  // Что вообще можно взять: собранное соседями по этой же задаче.
  const offers = neighbours.flatMap((n) =>
    n.docs.filter((d) => d.messageId).map((d) => ({ doc: d, agent: agentById(n.agentId) })),
  );
  // Взятое второй раз — второй экземпляр того же документа в запросе к модели:
  // агент прочитает его дважды и вдвое дороже. Показываем, что оно уже здесь.
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
    <section className="mt-8">
      <h2 className="mb-1 text-[15px] font-semibold">Взять из задачи</h2>
      <p className="measure mb-4 text-[12.5px] text-muted-foreground">
        Разборы, собранные другими агентами этой же задачи. Возьмёте — этот агент прочитает документ
        целиком, а не с ваших слов. Остальные разговоры от этого не меняются.
      </p>

      {offers.length ? (
        <ul className="divide-y divide-[color:var(--color-line)] border-y border-[color:var(--color-line)]">
          {offers.map(({ doc, agent }) => (
            <li key={doc.id} className="flex flex-wrap items-baseline justify-between gap-3 py-3">
              <span className="min-w-0">
                <span className="block text-[14px] leading-snug">{doc.title}</span>
                <span className="mt-0.5 block text-[12px] text-muted-foreground">
                  {agent?.name ?? "агент"} · {when(doc.at)}
                </span>
              </span>
              {here.has(`${doc.title}.md`) ? (
                <span className="text-[11.5px] text-muted-foreground">уже здесь</span>
              ) : (
                <button
                  onClick={() => void take(doc.messageId!)}
                  disabled={Boolean(busy)}
                  className="btn btn-glass text-[11.5px] disabled:opacity-40"
                >
                  {busy === doc.messageId ? "Несу" : "Взять сюда"}
                </button>
              )}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-muted-foreground">
          Другие агенты по этой задаче пока ничего не собрали.
        </p>
      )}

      {error ? <p className="mt-2 text-[12px] text-[color:var(--color-error)]">{error}</p> : null}

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
 * Названия групп на экран не выводим: человек и так знает, кто над кем,
 * а подписи только загромождают полосу.
 */
function RoleBar({
  roles,
  activeId,
  spokeWith,
  disabled,
  onPick,
}: {
  roles: RoleChip[];
  activeId: string | null;
  spokeWith: (id: string) => boolean;
  disabled: boolean;
  onPick: (id: string) => void;
}) {
  return (
    <section className="card-flat mb-4 px-5 py-4">
      <h2 className="text-[14px] font-semibold">Чью реакцию слушаем</h2>

      <div className="mt-3.5 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {roles.map((r) => {
          const active = r.id === activeId;
          return (
            <button
              key={r.id}
              onClick={() => onPick(r.id)}
              disabled={disabled}
              className={`rounded-[12px] border px-3.5 py-2.5 text-left transition-colors disabled:opacity-50 ${
                active
                  ? "border-[color:var(--color-accent)] bg-[color:var(--color-accent-soft)]"
                  : "border-[color:var(--color-line)] hover:border-[color:var(--color-text-primary)]/35"
              }`}
            >
              <span className="flex items-baseline gap-1.5">
                {spokeWith(r.id) ? (
                  <span
                    aria-hidden
                    className="mt-[1px] h-[5px] w-[5px] flex-none rounded-full bg-[color:var(--color-accent)]"
                  />
                ) : null}
                <span className="text-[13px] font-medium leading-snug">{r.name}</span>
              </span>
              {r.hint ? (
                <span className="mt-1 block text-[11.5px] leading-snug text-muted-foreground">
                  {r.hint}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </section>
  );
}

/**
 * Пока агент пишет, видно, сколько он уже пишет.
 *
 * Разбор на шесть страниц идёт минутами, и без счётчика это неотличимо от
 * зависшей страницы: человек жмёт заново или уходит. Секунды на экране —
 * самый дешёвый способ сказать «идёт работа, не сломалось».
 */
function Waiting({ name }: { name: string }) {
  const [sec, setSec] = useState(0);

  useEffect(() => {
    const id = setInterval(() => setSec((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="flex items-center gap-2.5 text-[12.5px] text-muted-foreground">
      <span className="h-[5px] w-[5px] animate-pulse rounded-full bg-[color:var(--color-accent)]" />
      <span>
        {name} работает · {sec} с
        {sec > 45 ? " — подробный разбор пишется минутами, это нормально" : ""}
      </span>
    </div>
  );
}

const Message = memo(function Message({
  id,
  from,
  text,
  onSave,
}: {
  id: string;
  from: "user" | "agent";
  text: string;
  onSave: (messageId: string) => Promise<void>;
}) {
  const mine = from === "user";
  const [saving, setSaving] = useState(false);
  const [copied, setCopied] = useState("");
  const body = useRef<HTMLDivElement>(null);

  async function save() {
    setSaving(true);
    try {
      await onSave(id);
    } finally {
      setSaving(false);
    }
  }

  /**
   * Скопировать ответ.
   *
   * Кладём в буфер две версии сразу: размеченную и простым текстом. Тогда в
   * письмо, Word или Телеграм вставится готовый документ с заголовками и
   * таблицами, а в поле, которое разметку не понимает, — чистый текст.
   * Берём то, что нарисовано на экране, а не исходную разметку: решётки и
   * звёздочки человеку в письме не нужны.
   */
  async function copy() {
    const el = body.current;
    if (!el) return;
    const text = plainOf(el);
    try {
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
        await navigator.clipboard.write([
          new ClipboardItem({
            "text/html": new Blob([el.innerHTML], { type: "text/html" }),
            "text/plain": new Blob([text], { type: "text/plain" }),
          }),
        ]);
      } else {
        await navigator.clipboard.writeText(text);
      }
      setCopied("Скопировано");
    } catch {
      // Буфер закрыт настройками браузера — молчать нельзя, человек будет
      // думать, что скопировалось.
      setCopied("Браузер не дал доступ к буферу");
    }
    setTimeout(() => setCopied(""), 2500);
  }

  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      {/* Ответ агента — документ: ему нужна вся ширина, реплике человека — нет */}
      <div className={`${mine ? "max-w-[86%] text-right" : "w-full"}`}>
        <div
          className={`rounded-[14px] px-4 py-3 ${
            mine
              ? "whitespace-pre-line bg-primary text-[13.5px] leading-relaxed text-primary-foreground"
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

          {/* Разбор нужен на руках: переслать, распечатать, принести на защиту */}
          {mine ? null : (
            <div className="mt-3 flex flex-wrap items-center justify-end gap-2.5 border-t border-[color:var(--color-line)] pt-2.5">
              {copied ? (
                <span className="mr-auto text-[11.5px] text-muted-foreground">{copied}</span>
              ) : null}
              <button onClick={() => void copy()} className="btn btn-glass text-[11.5px]">
                Скопировать текст
              </button>
              <button
                onClick={() => void save()}
                disabled={saving}
                className="btn btn-glass text-[11.5px] disabled:opacity-50"
              >
                {saving ? "Собираю документ" : "Скачать в Word"}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
});

/**
 * Ответ простым текстом — так, как он выглядит на экране.
 *
 * Одна поправка: сокращённым ссылкам возвращаем полный адрес. На экране
 * «docs.google.com/spreadsheets/d/1AbC…» читается лучше полотна, но в письме
 * это уже не ссылка, а обрубок, по которому никто никуда не попадёт.
 *
 * Копию кладём в страницу за левый край: innerText считает переносы строк по
 * тому, как элемент нарисован, и у оторванного от страницы узла абзацы
 * слиплись бы в одну строку.
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

/** Дата человеческим языком: сегодня, вчера или число. */
function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days <= 0) return "сегодня";
  if (days === 1) return "вчера";
  return d.toLocaleDateString("ru-RU");
}
