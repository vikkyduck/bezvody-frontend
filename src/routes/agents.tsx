import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useState } from "react";
import { AppShell, PageHead } from "@/components/AppShell";
import { useSession } from "@/lib/session";
import { agents, domains, type DomainKey } from "@/lib/shtab-data";
import { useShtab } from "@/lib/shtab-store";

export const Route = createFileRoute("/agents")({
  head: () => ({
    meta: [
      { title: "Агенты — платформа «Без Воды»" },
      {
        name: "description",
        content: "Каждый агент отвечает за один рабочий вопрос: собирает данные и приносит готовый разбор.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Catalog,
});

function Catalog() {
  return (
    <AppShell allow={["client"]}>
      <CatalogBody />
    </AppShell>
  );
}

function CatalogBody() {
  const { client } = useSession();
  const { createWindow } = useShtab();
  const navigate = useNavigate();
  const [open, setOpen] = useState<string | null>(null);
  const [domain, setDomain] = useState<DomainKey | "all">("all");
  const [asked, setAsked] = useState<string[]>([]);
  const opened = client?.agentIds ?? [];

  const visible = domain === "all" ? agents : agents.filter((a) => a.domain === domain);
  const current = domains.find((d) => d.key === domain);
  const count = (key: DomainKey) => agents.filter((a) => a.domain === key).length;

  return (
    <>
      <PageHead
        n="03"
        eyebrow="Агенты"
        title="Кто из агентов работает на вашу компанию"
        lead="Агент — это один рабочий вопрос: он сам собирает данные и приносит готовый разбор. Открытые запускайте сразу, остальные — по запросу вашему проджект-менеджеру."
      />

      {agents.length === 0 ? (
        <div className="card-flat px-6 py-10 text-center">
          <h2 className="text-[16px] font-semibold">Каталог пока пуст</h2>
          <p className="measure mx-auto mt-2.5 text-[13.5px] text-muted-foreground">
            Агентов ещё не завели. Как только администратор добавит их в каталог, они появятся здесь —
            по десяти рабочим блокам.
          </p>
        </div>
      ) : null}

      {agents.length > 0 ? (
      <>
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
      </>
      ) : null}

      <div className="space-y-3">
        {visible.map((a) => {
          const on = opened.includes(a.id);
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
                      открыт вашей компании
                    </div>
                  ) : null}
                </div>

                <div className="flex flex-none flex-col items-start gap-2 sm:items-end">
                  {on ? (
                    <button
                      onClick={() => {
                        // Запуск агента = новое окно с ним: работа идёт в окне, а не «где-то».
                        createWindow(a.id);
                        navigate({ to: "/" });
                      }}
                      aria-label={`Открыть окно с агентом: ${a.name}`}
                      className="btn btn-primary text-[12.5px]"
                    >
                      Открыть окно
                    </button>
                  ) : asked.includes(a.id) ? (
                    <span className="text-[12px] text-muted-foreground">запрос отправлен</span>
                  ) : (
                    <button
                      onClick={() => setAsked((p) => [...p, a.id])}
                      aria-label={`Запросить агента: ${a.name}`}
                      className="btn btn-glass text-[12.5px]"
                    >
                      Запросить
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

                </div>
              ) : null}
            </div>
          );
        })}
      </div>

    </>
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
