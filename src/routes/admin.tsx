import { createFileRoute } from "@tanstack/react-router";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  AnimatePresence,
  motion,
  useInView,
  useMotionValue,
  useReducedMotion,
  useSpring,
  useTransform,
} from "motion/react";
import { AppShell, PageHead } from "@/components/AppShell";
import { teams, agents, domains, rub } from "@/lib/shtab-data";
import { SectionLabel, CatMark } from "@/components/bv/core";
import { Spotlight } from "@/components/bv/Spotlight";

export const Route = createFileRoute("/admin")({
  head: () => ({
    meta: [
      { title: "Администрирование кабинетов команд — Штаб" },
      {
        name: "description",
        content:
          "Корпоративное администрирование: кабинеты команд, подключённые агенты, места и стоимость подписки по подразделениям.",
      },
      { property: "og:title", content: "Администрирование кабинетов команд — Штаб" },
      { property: "og:description", content: "Каждой команде — свой кабинет с купленными агентами и своими местами." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Admin,
});

type Filter = "Все" | "Активен" | "Пилот";

const usageParts = (t: { people: number; active30: number }) => ({ used: t.active30, total: t.people });

const spendNumber = (spend: string) => Number(spend.replace(/[^\d]/g, ""));

const EASE = [0.19, 1, 0.22, 1] as const;

/** Плавный счётчик: значение «доезжает» пружиной, без резких скачков. */
function Counter({
  value,
  format = (n: number) => String(n),
  className,
  delay = 0,
}: {
  value: number;
  format?: (n: number) => string;
  className?: string;
  delay?: number;
}) {
  const ref = useRef<HTMLSpanElement>(null);
  const inView = useInView(ref, { once: true, margin: "-15%" });
  const reduce = useReducedMotion();
  const mv = useMotionValue(0);
  const spring = useSpring(mv, { stiffness: 90, damping: 26, mass: 0.9 });
  const text = useTransform(spring, (n) => format(Math.round(n)));

  useEffect(() => {
    if (!inView) return;
    if (reduce) {
      mv.set(value);
      return;
    }
    const id = setTimeout(() => mv.set(value), delay * 1000);
    return () => clearTimeout(id);
  }, [inView, value, delay, mv, reduce]);

  return (
    <span ref={ref} className={className}>
      <motion.span>{text}</motion.span>
    </span>
  );
}

/** Кольцо занятости мест: дуга вычерчивается один раз, мягко. */
function Ring({ value, size = 132 }: { value: number; size?: number }) {
  const reduce = useReducedMotion();
  const r = 56;
  const c = 2 * Math.PI * r;
  return (
    <div className="relative flex flex-none items-center justify-center" style={{ width: size, height: size }}>
      <svg viewBox="0 0 128 128" className="h-full w-full -rotate-90 overflow-visible">
        <circle cx="64" cy="64" r={r} fill="none" strokeWidth="2" className="stroke-[color:var(--color-line)]" />
        <motion.circle
          cx="64"
          cy="64"
          r={r}
          fill="none"
          strokeWidth="4"
          strokeLinecap="round"
          className="stroke-[color:var(--color-accent)]"
          style={{ filter: "drop-shadow(0 0 10px color-mix(in oklab, var(--color-accent) 45%, transparent))" }}
          strokeDasharray={c}
          initial={{ strokeDashoffset: c }}
          whileInView={{ strokeDashoffset: c - (c * value) / 100 }}
          viewport={{ once: true, margin: "-15%" }}
          transition={{ duration: reduce ? 0 : 1.6, ease: EASE, delay: 0.15 }}
        />
      </svg>
      <div className="absolute text-center">
        <Counter value={value} format={(n) => `${n}%`} className="t-number block text-[30px] leading-none" delay={0.15} />
        <div className="mt-1.5 text-[9.5px] uppercase tracking-[0.16em] text-muted-foreground">пользуются</div>
      </div>
    </div>
  );
}

function SeatBar({ pct, delay = 0 }: { pct: number; delay?: number }) {
  const reduce = useReducedMotion();
  return (
    <div className="h-[3px] w-full overflow-hidden rounded-full bg-[color:var(--color-line)]">
      <motion.div
        className="h-full rounded-full bg-[color:var(--color-accent)]"
        initial={{ scaleX: 0 }}
        whileInView={{ scaleX: pct / 100 }}
        viewport={{ once: true, margin: "-10%" }}
        transition={{ duration: reduce ? 0 : 1.1, ease: EASE, delay }}
        style={{ originX: 0 }}
      />
    </div>
  );
}


function Admin() {
  const [filter, setFilter] = useState<Filter>("Все");
  const [openTeam, setOpenTeam] = useState<string>(teams[0]!.name);

  const totals = useMemo(() => {
    const usage = teams.reduce(
      (a, t) => {
        const { used, total } = usageParts(t);
        return { used: a.used + used, total: a.total + total };
      },
      { used: 0, total: 0 },
    );
    const spend = teams.reduce((a, t) => a + spendNumber(t.spend), 0);
    const agentsTotal = teams.reduce((a, t) => a + t.agents, 0);
    return { usage, spend, agentsTotal, util: Math.round((usage.used / usage.total) * 100) };
  }, []);

  const rows = useMemo(() => (filter === "Все" ? teams : teams.filter((t) => t.state === filter)), [filter]);

  return (
    <AppShell>
      <PageHead
        n="05"
        eyebrow="Администрирование"
        title={`${teams.length} кабинетов под вашим управлением`}
        lead="Каждое подразделение покупает свой набор агентов. Данные, доступы и журнал решений изолированы по кабинету."
        right={
          <div className="flex items-center gap-2">
            <button className="btn btn-glass text-[13px]">Экспорт реестра</button>
            <button className="btn btn-primary text-[13px]">Новый кабинет</button>
          </div>
        }
      />

      {/* Одна сводная панель вместо трёх карточек */}
      <motion.section
        initial={{ opacity: 0, y: 22 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.9, ease: EASE }}
        className="card-flat grid gap-10 px-6 py-7 md:grid-cols-[auto_1px_1fr] md:items-center md:gap-12 md:px-8"
      >
        <div className="flex items-center gap-6">
          <Ring value={totals.util} />
          <div>
            <div className="label-caps">Пользуются за 30 дней</div>
            <div className="t-number mt-2 text-[28px] leading-none">
              <Counter value={totals.usage.used} delay={0.2} />
              <span className="text-muted-foreground"> / {totals.usage.total}</span>
            </div>
            <p className="mt-2 max-w-[26ch] text-[12px] text-muted-foreground">
              {totals.usage.total - totals.usage.used} человек не заходили в кабинет — стоит проверить, что мешает.
            </p>
          </div>
        </div>

        <div className="hidden h-full w-px bg-[color:var(--color-line)] md:block" />

        <dl className="grid grid-cols-2 gap-x-10 gap-y-6 sm:grid-cols-3">
          {[
            { k: "Годовая подписка", v: rub(totals.spend) },
            { k: "Подключено агентов", v: String(totals.agentsTotal) },
            { k: "Кабинетов", v: `${teams.length} · пилотов ${teams.filter((t) => t.state === "Пилот").length}` },
          ].map((m, i) => (
            <motion.div
              key={m.k}
              initial={{ opacity: 0, y: 14 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.7, ease: EASE, delay: 0.25 + i * 0.09 }}
            >
              <dt className="label-caps">{m.k}</dt>
              <dd className="t-number mt-2 text-[20px] leading-none tabular-nums">{m.v}</dd>
            </motion.div>
          ))}
        </dl>
      </motion.section>

      {/* Реестр */}
      <div className="mt-12 flex flex-wrap items-end justify-between gap-4">
        <SectionLabel n="06">Реестр кабинетов</SectionLabel>
        <div className="lg relative inline-flex rounded-[var(--radius-pill)] p-1">
          {(["Все", "Активен", "Пилот"] as Filter[]).map((f) => (
            <button
              key={f}
              onClick={() => setFilter(f)}
              className="relative rounded-[var(--radius-pill)] px-4 py-1.5 text-[12.5px] transition-colors"
            >
              {filter === f ? (
                <motion.span
                  layoutId="admin-filter-pill"
                  className="lg-strong absolute inset-0 rounded-[var(--radius-pill)]"
                  transition={{ type: "spring", stiffness: 420, damping: 34 }}
                />
              ) : null}
              <span className={filter === f ? "relative font-semibold text-foreground" : "relative text-muted-foreground"}>
                {f}
              </span>
            </button>
          ))}
        </div>
      </div>

      <motion.div layout className="mt-5 space-y-2.5">
        <AnimatePresence initial={false} mode="popLayout">
          {rows.map((t, i) => {
            const { used, total } = usageParts(t);
            const pct = total ? Math.round((used / total) * 100) : 0;
            const open = openTeam === t.name;
            const linked = agents.slice(0, t.agents);
            return (
              <motion.div
                key={t.name}
                layout
                initial={{ opacity: 0, y: 16 }}
                animate={{ opacity: 1, y: 0 }}
                exit={{ opacity: 0, y: -8, scale: 0.99 }}
                whileHover={{ y: -3 }}
                whileTap={{ scale: 0.994 }}
                transition={{
                  y: { type: "spring", stiffness: 320, damping: 26 },
                  scale: { type: "spring", stiffness: 480, damping: 30 },
                  default: { duration: 0.55, ease: EASE, delay: i * 0.05 },
                }}
                className="card-flat group relative overflow-hidden transition-shadow duration-500 hover:shadow-[var(--lg-rim),var(--shadow-float)]"
              >
                {/* курсорный блик */}
                <Spotlight />
                {/* акцентный рельс слева */}
                <span
                  aria-hidden
                  className={`pointer-events-none absolute left-0 top-0 h-full w-[2px] origin-top bg-[color:var(--color-accent)] transition-transform duration-500 ease-out ${
                    open ? "scale-y-100 opacity-100" : "scale-y-0 opacity-70 group-hover:scale-y-100"
                  }`}
                />
                <motion.button
                  onClick={() => setOpenTeam(open ? "" : t.name)}
                  aria-expanded={open}
                  className="relative z-[2] flex w-full flex-wrap items-center gap-x-8 gap-y-4 px-6 py-5 text-left"
                >

                  <div className="min-w-[210px] flex-1">
                    <div className="flex items-center gap-2.5">
                      <span
                        className={`h-1.5 w-1.5 flex-none rounded-full ${
                          t.state === "Активен"
                            ? "bg-[color:var(--color-accent)] shadow-[0_0_10px_var(--color-accent)]"
                            : "bg-[color:var(--color-text-secondary)]"
                        }`}
                      />
                      <span className="text-[15px] font-semibold">{t.name}</span>
                    </div>
                    <div className="mt-1 pl-4 text-[12px] text-muted-foreground">{t.owner}</div>
                  </div>

                  <div className="min-w-[150px] flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <span className="t-number text-[13px]">
                        {used} <span className="text-muted-foreground">/ {total}</span>
                      </span>
                      <span className="text-[11px] tabular-nums text-muted-foreground">{pct}%</span>
                    </div>
                    <div className="mt-2">
                      <SeatBar pct={pct} delay={0.15 + i * 0.06} />
                    </div>
                  </div>

                  <div className="min-w-[120px] text-right">
                    <div className="label-caps text-[10px]">Подписка</div>
                    <div className="mt-1 text-[13px] tabular-nums">{t.spend}</div>
                  </div>

                  <motion.span
                    animate={{ rotate: open ? 45 : 0, opacity: open ? 1 : 0.55 }}
                    transition={{ type: "spring", stiffness: 340, damping: 24 }}
                    className="text-[15px] leading-none text-muted-foreground"
                    aria-hidden
                  >
                    +
                  </motion.span>
                </motion.button>

                <AnimatePresence initial={false}>
                  {open ? (
                    <motion.div
                      key="body"
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: "auto", opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ height: { duration: 0.5, ease: EASE }, opacity: { duration: 0.32 } }}
                      className="overflow-hidden"
                    >
                      <div className="border-t border-[color:var(--color-line)] px-6 py-6">
                        <div className="grid gap-8 md:grid-cols-[1.4fr_1fr]">
                          <div>
                            <div className="label-caps">Подключённые агенты</div>
                            <ul className="mt-3">
                              {linked.map((a, j) => (
                                <motion.li
                                  key={a.id}
                                  initial={{ opacity: 0, x: -10 }}
                                  animate={{ opacity: 1, x: 0 }}
                                  transition={{ duration: 0.45, ease: EASE, delay: 0.06 * j }}
                                  className="flex items-start gap-3 border-t border-[color:var(--color-line)] py-3"
                                >
                                  <span className="t-number w-6 flex-none text-[12px] text-muted-foreground">
                                    {domains.find((d) => d.key === a.domain)?.num ?? "—"}
                                  </span>
                                  <div>
                                    <div className="text-[13.5px] font-semibold leading-snug">{a.name}</div>
                                    <div className="mt-0.5 text-[12px] text-muted-foreground">
                                      {domains.find((d) => d.key === a.domain)?.name} · {a.cadence} · {rub(a.price)}
                                    </div>
                                  </div>
                                </motion.li>
                              ))}
                            </ul>
                          </div>
                          <motion.div
                            initial={{ opacity: 0, y: 10 }}
                            animate={{ opacity: 1, y: 0 }}
                            transition={{ duration: 0.5, ease: EASE, delay: 0.12 }}
                            className="space-y-5"
                          >
                            <div>
                              <div className="label-caps">Изоляция кабинета</div>
                              <p className="mt-2 text-[12.5px] text-muted-foreground">
                                Источники данных, доступы и журнал решений видны только команде «{t.name}». Кросс-доступ
                                выдаёт администратор корпорации по заявке.
                              </p>
                            </div>
                            <div className="flex flex-wrap gap-2">
                              <button className="btn btn-glass text-[12.5px]">Добавить агента</button>
                              <button className="btn btn-ghost text-[12.5px]">Управлять местами</button>
                            </div>
                          </motion.div>
                        </div>
                      </div>
                    </motion.div>
                  ) : null}
                </AnimatePresence>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </motion.div>

      <motion.div
        initial={{ opacity: 0, y: 18 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true, margin: "-10%" }}
        transition={{ duration: 0.8, ease: EASE }}
        className="card-flat mt-12 flex flex-wrap items-center justify-between gap-6 px-6 py-6"
      >
        <div>
          <div className="label-caps">Граница ответственности</div>
          <p className="measure mt-2 text-[13px] text-muted-foreground">
            Администратор управляет доступом и местами. Ни один агент не получает права принимать решение — он готовит
            материал, выбор остаётся за руководителем команды.
          </p>
        </div>
        <CatMark className="h-12 w-14 flex-none text-[color:var(--color-text-primary)]/40" strokeWidth={2} />
      </motion.div>
    </AppShell>
  );
}
