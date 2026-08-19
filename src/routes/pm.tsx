import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { AppShell, PageHead } from "@/components/AppShell";
import { clientsOf, silentDays, type Client } from "@/lib/platform-data";
import { useSession } from "@/lib/session";
import { agents, domains } from "@/lib/shtab-data";

export const Route = createFileRoute("/pm")({
  head: () => ({
    meta: [
      { title: "Мои клиенты — платформа «Без Воды»" },
      { name: "description", content: "Кабинет проджекта: клиенты и их агенты." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ProjectCabinet,
});

function ProjectCabinet() {
  return (
    <AppShell allow={["project", "admin"]}>
      <Body />
    </AppShell>
  );
}

function Body() {
  const { person } = useSession();
  const mine = person ? clientsOf(person.id) : [];
  const [open, setOpen] = useState<string | null>(mine[0]?.id ?? null);

  const silent = mine.filter((c) => silentDays(c) > 14);

  return (
    <>
      <PageHead
        n="01"
        eyebrow="Кабинет проджекта"
        title={
          mine.length
            ? `${mine.length} ${declension(mine.length, "клиент", "клиента", "клиентов")} на вас`
            : "Клиентов пока нет"
        }
        lead="Вы решаете, какие агенты открыты каждому клиенту, и видите, как идёт их работа."
      />

      {mine.length ? (
        <>
          <section className="grid gap-4 border-y border-[color:var(--color-line)] py-5 sm:grid-cols-2">
            <div>
              <div className="label-caps">Клиентов на вас</div>
              <div className="t-number mt-1.5 text-[26px] leading-none tabular-nums">{mine.length}</div>
              <p className="mt-1.5 text-[11.5px] text-muted-foreground">
                агентов открыто {mine.reduce((s, c) => s + c.agentIds.length, 0)}
              </p>
            </div>
            <div>
              <div className="label-caps">Молчат дольше двух недель</div>
              <div className="t-number mt-1.5 text-[26px] leading-none tabular-nums">{silent.length}</div>
              <p className="mt-1.5 text-[11.5px] text-muted-foreground">
                {silent.length ? silent.map((c) => c.company).join(", ") : "все заходили на этой неделе"}
              </p>
            </div>
          </section>

          <section className="mt-8 space-y-3">
            {mine.map((c) => (
              <ClientCard
                key={c.id}
                client={c}
                open={open === c.id}
                onToggle={() => setOpen(open === c.id ? null : c.id)}
              />
            ))}
          </section>
        </>
      ) : (
        <div className="card-flat px-6 py-10 text-center">
          <p className="measure mx-auto text-[13.5px] text-muted-foreground">
            Как только администратор закрепит за вами компанию, она появится здесь вместе со своим
            набором агентов.
          </p>
        </div>
      )}
    </>
  );
}

function ClientCard({ client: c, open, onToggle }: { client: Client; open: boolean; onToggle: () => void }) {
  const silence = silentDays(c);

  return (
    <div className="card-flat px-5 py-5">
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2.5">
            <span className="text-[15px] font-semibold leading-snug">{c.company}</span>
            <span className="rounded-[var(--radius-pill)] border border-[color:var(--color-line)] px-2 py-[2px] text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
              {c.state}
            </span>
          </div>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            {c.unit} · доступ до {c.paidUntil} · агентов открыто {c.agentIds.length}
          </p>
        </div>

        <button onClick={onToggle} className="btn btn-glass text-[12.5px]">
          {open ? "Свернуть" : "Агенты клиента"}
        </button>
      </div>

      {silence > 14 ? (
        <p className="mt-3 text-[12px] text-[color:var(--color-accent)]">
          Не заходили {silence} {declension(silence, "день", "дня", "дней")} — стоит написать.
        </p>
      ) : null}

      {open ? <AgentBoard client={c} /> : null}
    </div>
  );
}

/** Панель назначения: что открыто клиенту. */
function AgentBoard({ client: c }: { client: Client }) {
  const [assigned, setAssigned] = useState<string[]>(c.agentIds);
  const [domain, setDomain] = useState<string>("all");

  const list = domain === "all" ? agents : agents.filter((a) => a.domain === domain);

  if (agents.length === 0) {
    return (
      <div className="mt-5 border-t border-[color:var(--color-line)] pt-5">
        <p className="text-[12.5px] text-muted-foreground">
          Каталог пуст: агентов ещё не завели. Как только они появятся, вы сможете открывать их клиенту
          прямо отсюда.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-5 border-t border-[color:var(--color-line)] pt-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="label-caps">Какие агенты открыты клиенту</div>
        <select
          value={domain}
          onChange={(e) => setDomain(e.target.value)}
          aria-label="Блок каталога"
          className="rounded-[var(--radius-pill)] border border-[color:var(--color-line)] bg-transparent px-3 py-1.5 text-[12px] outline-none"
        >
          <option value="all">Все блоки</option>
          {domains.map((d) => (
            <option key={d.key} value={d.key}>
              {d.name}
            </option>
          ))}
        </select>
      </div>

      <div className="mt-3 flex flex-wrap gap-2">
        {list.map((a) => {
          const on = assigned.includes(a.id);
          return (
            <button
              key={a.id}
              onClick={() => setAssigned((p) => (on ? p.filter((x) => x !== a.id) : [...p, a.id]))}
              aria-pressed={on}
              className={`btn text-[12px] ${on ? "btn-primary" : "btn-glass"}`}
              title={a.result}
            >
              {a.name}
            </button>
          );
        })}
      </div>

      <p className="mt-3.5 text-[11.5px] text-muted-foreground">
        Открытый агент сразу появляется у клиента в окне. Закрытый исчезает из списка, но уже готовые
        разборы остаются — работа не пропадает.
      </p>
    </div>
  );
}

const declension = (n: number, one: string, few: string, many: string) => {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
};
