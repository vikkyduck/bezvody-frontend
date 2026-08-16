import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useRef, useState } from "react";

import { AppShell } from "@/components/AppShell";
import { creditsLeft, creditsPct, nf } from "@/lib/platform-data";
import { useSession } from "@/lib/session";
import { agents } from "@/lib/shtab-data";
import { useShtab, type WorkWindow } from "@/lib/shtab-store";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Рабочее окно — платформа «Без Воды»" },
      {
        name: "description",
        content: "Одно окно на один вопрос: подключаете агента и работаете. Расход виден сразу.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Workspace,
});

function Workspace() {
  return (
    <AppShell allow={["client"]}>
      <WorkspaceBody />
    </AppShell>
  );
}

function WorkspaceBody() {
  const { client } = useSession();
  const { windows, activeId, setActive, createWindow } = useShtab();
  const active = windows.find((w) => w.id === activeId) ?? windows[0];

  if (!client || !active) return null;

  return (
    <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
      {/* Список окон: слева, чтобы разговор не терялся при переключении */}
      <aside className="lg:sticky lg:top-[92px] lg:self-start">
        <div className="mb-3 flex items-center justify-between gap-3">
          <h1 className="text-[15px] font-semibold">Ваши окна</h1>
          <button onClick={() => createWindow()} className="btn btn-glass text-[12px]">
            Новое
          </button>
        </div>

        <ul className="space-y-1.5">
          {windows.map((w) => (
            <li key={w.id}>
              <WindowTab window={w} active={w.id === active.id} onClick={() => setActive(w.id)} />
            </li>
          ))}
        </ul>

        <div className="mt-6 border-t border-[color:var(--color-line)] pt-4">
          <div className="label-caps">Кредиты</div>
          <div className="mt-2 flex items-baseline gap-2">
            <span className="t-number text-[22px] leading-none tabular-nums">{nf(creditsLeft(client))}</span>
            <span className="text-[11.5px] text-muted-foreground">из {nf(client.creditsGranted)}</span>
          </div>
          <div className="mt-2.5 h-[3px] w-full overflow-hidden rounded-full bg-[color:var(--color-line)]">
            <div
              className="h-full rounded-full bg-[color:var(--color-accent)]"
              style={{ width: `${creditsPct(client)}%` }}
            />
          </div>
          <p className="mt-2.5 text-[11.5px] leading-relaxed text-muted-foreground">
            Кредит — тысяча слов работы модели. Когда останется мало, проджект откроет следующий пакет по счёту.
          </p>
        </div>
      </aside>

      <section className="min-w-0">
        <Window key={active.id} window={active} />
      </section>
    </div>
  );
}

function WindowTab({ window: w, active, onClick }: { window: WorkWindow; active: boolean; onClick: () => void }) {
  const agent = agents.find((a) => a.id === w.agentId);
  return (
    <button
      onClick={onClick}
      aria-current={active ? "true" : undefined}
      className={`w-full rounded-[12px] border px-3.5 py-3 text-left transition-colors ${
        active
          ? "border-[color:var(--color-text-primary)]/25 bg-[color:var(--color-bg-secondary,transparent)]"
          : "border-[color:var(--color-line)] hover:border-[color:var(--color-text-primary)]/20"
      }`}
    >
      <div className="truncate text-[13.5px] font-medium leading-snug">{w.title}</div>
      <div className="mt-1 flex items-center gap-1.5 text-[11px] text-muted-foreground">
        <span
          aria-hidden
          className={`h-[5px] w-[5px] flex-none rounded-full ${
            agent ? "bg-[color:var(--color-accent)]" : "bg-[color:var(--color-line)]"
          }`}
        />
        <span className="truncate">{agent ? agent.name : "агент не подключён"}</span>
      </div>
    </button>
  );
}

function Window({ window: w }: { window: WorkWindow }) {
  const { client } = useSession();
  const { connectAgent, send, thinkingId } = useShtab();
  const [draft, setDraft] = useState("");
  const [picking, setPicking] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  const agent = agents.find((a) => a.id === w.agentId);
  const mine = agents.filter((a) => client?.agentIds.includes(a.id));
  const thinking = thinkingId === w.id;

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [w.messages.length, thinking]);

  return (
    <div className="card-flat flex min-h-[600px] flex-col">
      {/* Шапка окна: кто в нём работает и во что обошёлся разговор */}
      <div className="flex flex-wrap items-center gap-3 border-b border-[color:var(--color-line)] px-5 py-4">
        <div className="min-w-0 flex-1">
          <div className="truncate text-[15px] font-semibold leading-snug">{w.title}</div>
          <button
            onClick={() => setPicking((v) => !v)}
            className="mt-1 flex items-center gap-1.5 text-[12px] text-muted-foreground transition-colors hover:text-foreground"
          >
            <span
              aria-hidden
              className={`h-[5px] w-[5px] flex-none rounded-full ${
                agent ? "bg-[color:var(--color-accent)]" : "bg-[color:var(--color-line)]"
              }`}
            />
            {agent ? agent.name : "Подключить агента"}
            <span aria-hidden className="text-[10px]">
              ▾
            </span>
          </button>
        </div>
        <div className="text-right">
          <div className="t-number text-[13px] tabular-nums">{nf(w.credits)}</div>
          <div className="text-[10.5px] text-muted-foreground">кредитов в окне</div>
        </div>
      </div>

      {picking ? (
        <div className="border-b border-[color:var(--color-line)] px-5 py-4">
          <div className="label-caps">Агенты, открытые вашей компании</div>
          <div className="mt-2.5 flex flex-wrap gap-2">
            {mine.map((a) => (
              <button
                key={a.id}
                onClick={() => {
                  connectAgent(w.id, a.id);
                  setPicking(false);
                }}
                className={`btn text-[12px] ${a.id === w.agentId ? "btn-primary" : "btn-glass"}`}
              >
                {a.name}
              </button>
            ))}
          </div>
          <p className="mt-3 text-[11.5px] text-muted-foreground">
            Нужен другой агент — <Link to="/agents" className="underline underline-offset-2">запросите его</Link>,
            подключит ваш проджект.
          </p>
        </div>
      ) : null}

      <div className="flex-1 space-y-4 overflow-y-auto px-5 py-5">
        {w.messages.length === 0 && !thinking ? (
          <div className="flex h-full min-h-[280px] flex-col items-center justify-center text-center">
            <div className="measure text-[13.5px] text-muted-foreground">
              {agent
                ? `Спросите то, что вам решать. ${agent.result}.`
                : "Подключите агента к окну — и задайте вопрос своими словами."}
            </div>
          </div>
        ) : null}

        {w.messages.map((m) => (
          <Message key={m.id} from={m.from} text={m.text} credits={m.credits} />
        ))}

        {thinking ? (
          <div className="flex items-center gap-2.5 text-[12.5px] text-muted-foreground">
            <span className="h-[5px] w-[5px] animate-pulse rounded-full bg-[color:var(--color-accent)]" />
            Агент собирает разбор
          </div>
        ) : null}
        <div ref={endRef} />
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(w.id, draft);
          setDraft("");
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
              send(w.id, draft);
              setDraft("");
            }
          }}
          rows={2}
          placeholder={agent ? "Опишите вопрос своими словами" : "Сначала подключите агента"}
          aria-label="Сообщение агенту"
          className="min-h-[52px] flex-1 resize-none rounded-[12px] border border-[color:var(--color-line)] bg-transparent px-3.5 py-2.5 text-[13.5px] outline-none transition-colors focus:border-[color:var(--color-text-primary)]/40"
        />
        <button type="submit" disabled={!draft.trim() || thinking} className="btn btn-primary text-[13px] disabled:opacity-40">
          Отправить
        </button>
      </form>
    </div>
  );
}

function Message({ from, text, credits }: { from: "user" | "agent"; text: string; credits?: number | undefined }) {
  const mine = from === "user";
  return (
    <div className={`flex ${mine ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[86%] ${mine ? "text-right" : ""}`}>
        <div
          className={`whitespace-pre-line rounded-[14px] px-4 py-3 text-[13.5px] leading-relaxed ${
            mine
              ? "bg-primary text-primary-foreground"
              : "border border-[color:var(--color-line)] text-foreground"
          }`}
        >
          {text}
        </div>
        {credits ? (
          <div className="mt-1.5 text-[10.5px] text-muted-foreground">{nf(credits)} кредитов</div>
        ) : null}
      </div>
    </div>
  );
}
