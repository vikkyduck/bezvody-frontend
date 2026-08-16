import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { AppShell, PageHead } from "@/components/AppShell";
import {
  clientsOf,
  creditsLeft,
  creditsPct,
  nf,
  silentDays,
  usageOf,
  type Client,
} from "@/lib/platform-data";
import { useSession } from "@/lib/session";
import { agents, domains } from "@/lib/shtab-data";

export const Route = createFileRoute("/pm")({
  head: () => ({
    meta: [
      { title: "Мои клиенты — платформа «Без Воды»" },
      { name: "description", content: "Кабинет проджекта: агенты клиентов и расход кредитов." },
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

  const spent = mine.reduce((s, c) => s + c.creditsUsed, 0);
  const silent = mine.filter((c) => silentDays(c) > 14);

  return (
    <>
      <PageHead
        n="01"
        eyebrow="Кабинет проджекта"
        title={`${mine.length} ${declension(mine.length, "клиент", "клиента", "клиентов")} на вас`}
        lead="Вы решаете, какие агенты открыты каждому клиенту, и видите, во что обходится их работа."
      />

      {/* Две цифры, которые проджект должен знать без отчёта */}
      <section className="grid gap-4 border-y border-[color:var(--color-line)] py-5 sm:grid-cols-2">
        <div>
          <div className="label-caps">Израсходовано за месяц</div>
          <div className="t-number mt-1.5 text-[26px] leading-none tabular-nums">{nf(spent)}</div>
          <p className="mt-1.5 text-[11.5px] text-muted-foreground">кредитов по всем вашим клиентам</p>
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
          <ClientCard key={c.id} client={c} open={open === c.id} onToggle={() => setOpen(open === c.id ? null : c.id)} />
        ))}
      </section>
    </>
  );
}

function ClientCard({ client: c, open, onToggle }: { client: Client; open: boolean; onToggle: () => void }) {
  const rows = usageOf(c.id);
  const idle = c.agentIds.filter((id) => !rows.find((r) => r.agentId === id && r.runs > 0));
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
            {idle.length ? ` · без единого запуска ${idle.length}` : ""}
          </p>
        </div>

        <div className="text-right">
          <div className="t-number text-[15px] tabular-nums">{nf(creditsLeft(c))}</div>
          <div className="text-[10.5px] text-muted-foreground">кредитов осталось</div>
        </div>

        <button onClick={onToggle} className="btn btn-glass text-[12.5px]">
          {open ? "Свернуть" : "Агенты и расход"}
        </button>
      </div>

      <div className="mt-4 h-[3px] w-full overflow-hidden rounded-full bg-[color:var(--color-line)]">
        <div className="h-full rounded-full bg-[color:var(--color-accent)]" style={{ width: `${creditsPct(c)}%` }} />
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

/** Панель назначения: что открыто клиенту и сколько это стоило. */
function AgentBoard({ client: c }: { client: Client }) {
  const rows = usageOf(c.id);
  const [assigned, setAssigned] = useState<string[]>(c.agentIds);
  const [domain, setDomain] = useState<string>("all");

  const list = domain === "all" ? agents : agents.filter((a) => a.domain === domain);

  return (
    <div className="mt-5 border-t border-[color:var(--color-line)] pt-5">
      <div className="label-caps">Расход по агентам за месяц</div>
      <ul className="mt-2.5 divide-y divide-[color:var(--color-line)] border-y border-[color:var(--color-line)]">
        {rows.map((r) => {
          const a = agents.find((x) => x.id === r.agentId);
          return (
            <li key={r.agentId} className="flex items-baseline justify-between gap-4 py-2.5">
              <span className="min-w-0 truncate text-[13px]">{a?.name ?? r.agentId}</span>
              <span className="flex flex-none items-baseline gap-4 text-[12px] text-muted-foreground">
                <span className="tabular-nums">
                  {r.runs} {declension(r.runs, "запуск", "запуска", "запусков")}
                </span>
                <span className="t-number w-[76px] text-right text-[12.5px] tabular-nums text-foreground">{nf(r.credits)}</span>
              </span>
            </li>
          );
        })}
      </ul>

      <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
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
