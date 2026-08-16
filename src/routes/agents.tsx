import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell, PageHead } from "@/components/AppShell";
import { RunPanel } from "@/components/RunPanel";
import { agents, domains, type DomainKey } from "@/lib/shtab-data";
import { useShtab } from "@/lib/shtab-store";

export const Route = createFileRoute("/agents")({
  head: () => ({
    meta: [
      { title: "Агенты команды — каталог по десяти рабочим блокам | Штаб" },
      {
        name: "description",
        content:
          "Каталог агентов «Штаба»: результаты и причины, деньги, клиенты, продукт, операции, рынок, инициативы, риски, организация, стратегия и горизонтальные помощники.",
      },
      { property: "og:title", content: "Агенты команды — каталог по десяти блокам" },
      {
        property: "og:description",
        content: "Каждый агент отвечает за один рабочий вопрос: собирает данные и приносит готовый разбор.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Catalog,
});

function Catalog() {
  const { installed, install, uninstall, startRun } = useShtab();
  const [open, setOpen] = useState<string | null>(null);
  const [domain, setDomain] = useState<DomainKey | "all">("all");

  const visible = domain === "all" ? agents : agents.filter((a) => a.domain === domain);
  const current = domains.find((d) => d.key === domain);
  const count = (key: DomainKey) => agents.filter((a) => a.domain === key).length;

  return (
    <AppShell>
      <PageHead
        n="03"
        eyebrow="Агенты"
        title="Кто из агентов работает на вашу команду"
        lead="Агент — это один рабочий вопрос: он сам собирает данные и приносит готовый разбор. Подключённых запускайте сразу, остальных можно запросить — подключит администратор."
      />

      {/* Десять предметных блоков плюс горизонтальные агенты для всех */}
      <div className="-mx-1 overflow-x-auto pb-1">
        <div
          role="tablist"
          aria-label="Блоки каталога"
          className="flex min-w-max items-center gap-1 rounded-[var(--radius-pill)] border border-[color:var(--color-line)] p-1"
        >
          <Tab active={domain === "all"} onClick={() => setDomain("all")} label="Все" meta={String(agents.length)} />
          {domains.map((d) => (
            <Tab
              key={d.key}
              active={domain === d.key}
              onClick={() => setDomain(d.key)}
              label={d.name}
              meta={String(count(d.key))}
            />
          ))}
        </div>
      </div>

      <p className="measure mt-3.5 mb-6 text-[12.5px] text-muted-foreground">
        {current
          ? current.note
          : "Десять блоков по темам работы плюс горизонтальные агенты — те, что нужны всем: слайды, «6-pager», протокол решения, проверка источников."}
      </p>

      <div className="space-y-3">
        {visible.map((a) => {
          const on = installed.includes(a.id);
          const expanded = open === a.id;
          const block = domains.find((d) => d.key === a.domain);
          return (
            <div key={a.id} className="card-flat px-5 py-5">
              <div className="flex flex-col gap-5 sm:flex-row sm:items-start">
                <div className="min-w-[240px] flex-1">
                  {block ? <div className="label-caps mb-2.5">{block.name}</div> : null}
                  {/* Что человек получит — крупно; метод — почти незаметно */}
                  <h2 className="measure text-[17px] font-semibold leading-snug">{a.result}</h2>
                  <div className="mt-2 text-[12.5px] text-muted-foreground">{a.name}</div>
                  <div className="mt-1 text-[11px] text-muted-foreground/70">
                    {a.method} · {a.cadence}
                  </div>
                  {on ? (
                    <div className="mt-2.5 text-[11px] uppercase tracking-[0.12em] text-muted-foreground">
                      подключён вашей команде
                    </div>
                  ) : null}
                </div>

                <div className="flex flex-none flex-col items-start gap-2 sm:items-end">
                  {on ? (
                    <button
                      onClick={() => startRun(a.id)}
                      aria-label={`Запустить агента: ${a.name}`}
                      className="btn btn-primary text-[12.5px]"
                    >
                      Запустить
                    </button>
                  ) : (
                    <button
                      onClick={() => install(a.id)}
                      aria-label={`Запросить подключение: ${a.name}`}
                      className="btn btn-glass text-[12.5px]"
                    >
                      Запросить подключение
                    </button>
                  )}
                  {a.steps?.length ? (
                    <button
                      onClick={() => setOpen(expanded ? null : a.id)}
                      aria-expanded={expanded}
                      className="btn btn-ghost text-[12px]"
                    >
                      {expanded ? "Скрыть, как работает" : "Как работает"}
                    </button>
                  ) : null}
                </div>
              </div>

              {expanded && a.steps?.length ? (
                <div className="mt-5 border-t border-[color:var(--color-line)] pt-4">
                  <ol className="grid gap-1.5 sm:grid-cols-2 lg:grid-cols-5">
                    {a.steps.map((s, i) => (
                      <li key={s} className="text-[12px] text-muted-foreground">
                        <span className="t-number mr-1.5 text-[10.5px] text-muted-foreground/70">
                          {String(i + 1).padStart(2, "0")}
                        </span>
                        {s}
                      </li>
                    ))}
                  </ol>
                  {on ? (
                    <button onClick={() => uninstall(a.id)} className="btn btn-ghost mt-3 text-[12px]">
                      Отключить агента
                    </button>
                  ) : null}
                </div>
              ) : null}
            </div>
          );
        })}
      </div>

      <RunPanel />
    </AppShell>
  );
}

/** Сегмент выбора блока: движение только как обратная связь. */
function Tab({
  active,
  onClick,
  label,
  meta,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
  meta: string;
}) {
  return (
    <button
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={`inline-flex items-center gap-2 rounded-[var(--radius-pill)] px-3.5 py-1.5 text-[12.5px] transition-colors duration-300 ${
        active
          ? "bg-[color:var(--color-text-primary)]/[0.08] text-foreground"
          : "text-muted-foreground hover:text-foreground"
      }`}
    >
      {label}
      <span className="t-number text-[10.5px] tabular-nums text-muted-foreground/70">{meta}</span>
    </button>
  );
}
