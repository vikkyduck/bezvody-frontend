import { createFileRoute } from "@tanstack/react-router";
import { memo, useEffect, useRef, useState } from "react";

import { AppShell, PageHead } from "@/components/AppShell";
import { Attachments } from "@/components/Attachments";
import { Markdown } from "@/components/Markdown";
import type { StoredWindow } from "@/lib/conversations";
import { MAX_WINDOW_FILES } from "@/lib/documents";
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

function Body() {
  const { person } = useSession();
  const { windows, ready, activeId, setActive } = useWindows();
  const active = windows.find((w) => w.id === activeId) ?? null;

  if (!person) return null;
  // Работа начинается с выбора агента — окно без него не открыть.
  if (active) return <Conversation window={active} onBack={() => setActive(null)} />;
  return <Start ready={ready} windows={windows} />;
}

// ── Выбор агента ──────────────────────────────────────────────────────────────

function Start({ ready, windows }: { ready: boolean; windows: StoredWindow[] }) {
  const { person } = useSession();
  const { open, setActive } = useWindows();
  const mine = agents.filter((a) => person?.agentIds.includes(a.id));

  return (
    <>
      <PageHead
        n="01"
        eyebrow="Ваш кабинет"
        title="С кем поработаем"
        lead="Выберите агента — откроется окно, и дальше вы просто описываете свою задачу словами."
      />

      {mine.length ? (
        <section className="grid gap-3 md:grid-cols-3">
          {mine.map((a) => (
            <button
              key={a.id}
              onClick={() => open(a.id)}
              className="card-flat flex h-full flex-col px-5 py-5 text-left transition-transform hover:-translate-y-[2px]"
            >
              <div className="text-[16px] font-semibold leading-snug">{a.name}</div>
              <p className="mt-2 flex-1 text-[13px] text-muted-foreground">{a.result}</p>
              <p className="mt-3 text-[11.5px] text-muted-foreground/80">{a.method}</p>
              <span className="mt-4 text-[12.5px] font-medium">Открыть окно →</span>
            </button>
          ))}
        </section>
      ) : (
        <div className="card-flat px-6 py-10 text-center">
          <h2 className="text-[16px] font-semibold">Агентов пока не открыли</h2>
          <p className="measure mx-auto mt-2.5 text-[13.5px] text-muted-foreground">
            Напишите вашему проджект-менеджеру — он откроет тех, кто нужен под ваши задачи,
            и они появятся здесь.
          </p>
        </div>
      )}

      <section className="mt-11">
        <h2 className="mb-1 text-[15px] font-semibold">Ваши окна</h2>
        <p className="measure mb-4 text-[12.5px] text-muted-foreground">
          Каждое окно — отдельная задача и отдельный агент. Всё, что он в нём собрал, остаётся здесь же.
        </p>

        {!ready ? (
          <p className="text-[13px] text-muted-foreground">Загружаю…</p>
        ) : windows.length ? (
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
                      <span className="block text-[14px] font-medium leading-snug">{w.title}</span>
                      <span className="mt-0.5 block text-[12px] text-muted-foreground">
                        {agent?.name ?? "агент недоступен"} · {when(w.updatedAt)}
                        {w.docs.length ? ` · материалов ${w.docs.length}` : ""}
                        {w.files.length ? ` · документов ${w.files.length}` : ""}
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
        ) : (
          <p className="text-[13px] text-muted-foreground">
            Окон пока нет. Выберите агента выше — первое откроется само.
          </p>
        )}
      </section>
    </>
  );
}

// ── Разговор ──────────────────────────────────────────────────────────────────

function Conversation({ window: w, onBack }: { window: StoredWindow; onBack: () => void }) {
  const { send, remove, attach, detach, download, thinkingId } = useWindows();
  const [draft, setDraft] = useState("");
  const [confirmDelete, setConfirmDelete] = useState(false);
  const listRef = useRef<HTMLDivElement>(null);

  const agent = agentById(w.agentId);
  const thinking = thinkingId === w.id;

  // Прокручиваем сам список, а не страницу: разговор живёт в своём окне,
  // и уводить человека вниз всей страницей незачем.
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [w.messages.length, thinking]);

  function submit() {
    const text = draft.trim();
    if (!text || thinking) return;
    setDraft("");
    void send(w.id, text);
  }

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <button onClick={onBack} className="btn btn-ghost text-[12.5px]">
          ← Все окна
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
          <button onClick={() => setConfirmDelete(true)} className="btn btn-ghost ml-auto text-[12px]">
            Удалить окно
          </button>
        )}
      </div>

      {/* talk-pane: высота окна ограничена экраном. Без этого карточка растёт
          вместе с разговором — на шести ответах агента это шестьдесят тысяч
          пикселей стекла, которые браузер перерисовывает на каждый кадр. */}
      <div className="card-flat talk-pane flex flex-col">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 border-b border-[color:var(--color-line)] px-5 py-4">
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-semibold leading-snug">{w.title}</div>
            <div className="mt-1 flex items-center gap-1.5 text-[12px] text-muted-foreground">
              <span aria-hidden className="h-[5px] w-[5px] flex-none rounded-full bg-[color:var(--color-accent)]" />
              {agent?.name ?? "агент недоступен"}
            </div>
          </div>
        </div>

        <div ref={listRef} className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
          {w.messages.length === 0 && !thinking ? (
            <div className="flex h-full min-h-[280px] flex-col items-center justify-center text-center">
              <p className="measure text-[13.5px] text-muted-foreground">
                {agent ? `${agent.result}. Опишите задачу своими словами.` : "Опишите задачу своими словами."}
              </p>
            </div>
          ) : null}

          {w.messages.map((m) => (
            <Message key={m.id} from={m.from} text={m.text} />
          ))}

          {thinking ? <Waiting name={agent?.name ?? "Агент"} /> : null}
        </div>

        {/* Документы окна — на виду у поля ввода: агент читает их при каждом вопросе */}
        <div className="border-t border-[color:var(--color-line)] px-5 py-3">
          <Attachments
            files={w.files}
            max={MAX_WINDOW_FILES}
            compact
            onUpload={(file) => attach(w.id, file)}
            onRemove={(fileId) => detach(w.id, fileId)}
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
            placeholder="Опишите задачу своими словами"
            aria-label={`Сообщение агенту ${agent?.name ?? ""}`}
            className="min-h-[52px] flex-1 resize-none rounded-[12px] border border-[color:var(--color-line)] bg-transparent px-3.5 py-2.5 text-[13.5px] outline-none transition-colors focus:border-[color:var(--color-text-primary)]/40"
          />
          <button
            type="submit"
            disabled={!draft.trim() || thinking}
            className="btn btn-primary text-[13px] disabled:opacity-40"
          >
            Отправить
          </button>
        </form>
      </div>

      {/* Материалы окна: и принесённое человеком, и собранное агентом */}
      <section className="mt-8">
        <h2 className="mb-1 text-[15px] font-semibold">Ваши документы</h2>
        <p className="measure mb-4 text-[12.5px] text-muted-foreground">
          Всё, что вы принесли в это окно: отчёты, выгрузки, договоры. Агент читает их при каждом
          вопросе — пересказывать содержимое словами не нужно. Имя файла — ссылка на скачивание.
        </p>
        <Attachments
          files={w.files}
          max={MAX_WINDOW_FILES}
          onUpload={(file) => attach(w.id, file)}
          onRemove={(fileId) => detach(w.id, fileId)}
          onDownload={download}
          empty="Пока ничего не принесли. Документы можно перетащить прямо сюда."
        />
      </section>

      <section className="mt-8">
        <h2 className="mb-1 text-[15px] font-semibold">Собрано агентом</h2>
        <p className="measure mb-4 text-[12.5px] text-muted-foreground">
          Разборы и решения, которые агент сделал в этом окне. Они остаются здесь — искать их в почте не придётся.
        </p>
        {w.docs.length ? (
          <ul className="divide-y divide-[color:var(--color-line)] border-y border-[color:var(--color-line)]">
            {w.docs.map((doc) => (
              <li key={doc.id} className="flex flex-wrap items-baseline justify-between gap-3 py-3">
                <span className="text-[14px]">{doc.title}</span>
                <span className="text-[12px] text-muted-foreground">
                  {doc.kind} · {when(doc.at)}
                </span>
              </li>
            ))}
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

const Message = memo(function Message({ from, text }: { from: "user" | "agent"; text: string }) {
  const mine = from === "user";
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
          {mine ? text : <Markdown>{text}</Markdown>}
        </div>
      </div>
    </div>
  );
});

/** Дата человеческим языком: сегодня, вчера или число. */
function when(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const days = Math.floor((Date.now() - d.getTime()) / 86400000);
  if (days <= 0) return "сегодня";
  if (days === 1) return "вчера";
  return d.toLocaleDateString("ru-RU");
}
