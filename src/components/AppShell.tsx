import { Link, useRouterState } from "@tanstack/react-router";
import type { ReactNode } from "react";
import { team } from "@/lib/shtab-data";
import { NavPills } from "@/components/NavPills";
import { GlassPointer } from "@/components/bv/GlassPointer";
import { StencilLogo, CatMark, LensFilter, Scene, SectionLabel } from "@/components/bv/core";

/** Ежедневные разделы — их всего три. */
const nav = [
  { to: "/", label: "Кабинет", short: "Кабинет" },
  { to: "/briefs", label: "Решения", short: "Решения" },
  { to: "/agents", label: "Агенты", short: "Агенты" },
];

/** Редкие разделы живут отдельно, справа, и не спорят с ежедневными. */
const navSecondary = [
  { to: "/limits", label: "Границы", short: "Границы" },
  { to: "/admin", label: "Админ", short: "Админ" },
];


export function AppShell({ children }: { children: ReactNode }) {
  const path = useRouterState({ select: (s) => s.location.pathname });

  return (
    <div className="stage grain min-h-screen">
      <LensFilter />
      <GlassPointer />
      <Scene
        blobs={[
          { className: "left-[-14%] top-[-8%] h-[520px] w-[520px]", tone: "rose" },
          { className: "right-[-10%] top-[38%] h-[460px] w-[460px]", tone: "chrome" },
        ]}
      />
      <header className="sticky top-0 z-40 border-b border-[color:var(--color-line)] bg-[color:var(--color-bg-primary)]/80 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1240px] items-center gap-6 px-5 py-3 sm:px-6">
          <Link to="/" className="flex items-center gap-2.5" aria-label="Штаб — на главную">
            <CatMark className="h-7 w-9 text-[color:var(--color-text-primary)]/70" strokeWidth={2} />
            <StencilLogo className="logo-sm" />
            <span className="ml-2 hidden border-l border-[color:var(--color-line)] pl-3 text-[13px] font-semibold lg:block">
              Штаб
            </span>
          </Link>
          <NavPills items={nav} path={path} className="hidden md:flex" />
          <div className="ml-auto flex items-center gap-3 text-right">
            <NavPills items={navSecondary} path={path} className="hidden border-r border-[color:var(--color-line)] pr-3 lg:flex" />
            <div className="hidden sm:block">
              <div className="text-[12.5px] font-semibold leading-tight">{team.name}</div>
              <div className="text-[10.5px] text-muted-foreground">{team.company}</div>
            </div>
            <div
              className="flex h-9 w-9 items-center justify-center rounded-full bg-primary text-[12px] font-bold text-primary-foreground"
              title={`${team.owner} · ${team.company}`}
              aria-label={`Пользователь ${team.owner}`}
            >
              АК
            </div>
          </div>
        </div>
        {/* Навигация на узких экранах: горизонтальная лента вместо скрытого меню */}
        <div className="border-t border-[color:var(--color-line)] md:hidden">
          <NavPills items={[...nav, ...navSecondary]} path={path} mobile className="flex overflow-x-auto px-4 py-2" />
        </div>
      </header>
      <main className="mx-auto max-w-[1240px] px-5 py-8 sm:px-6">{children}</main>
      <footer className="mx-auto flex max-w-[1240px] items-end justify-between gap-4 px-6 pb-10 pt-4 text-[11.5px] text-muted-foreground">
        <span>Демонстрационный прототип. Агенты готовят решение — принимает его руководитель.</span>
        <CatMark className="h-10 w-12 flex-none text-[color:var(--color-text-primary)]/50" strokeWidth={2} />
      </footer>
    </div>
  );
}

export function PageHead({
  eyebrow,
  title,
  lead,
  right,
  n = "01",
}: {
  eyebrow: string;
  title: string;
  lead?: string;
  right?: ReactNode;
  n?: string;
}) {
  return (
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <SectionLabel n={n}>{eyebrow}</SectionLabel>
        <h1 className="t-h1 mt-3">{title}</h1>
        {lead ? <p className="t-body measure mt-2.5 text-muted-foreground">{lead}</p> : null}
      </div>
      {right}
    </div>
  );
}
