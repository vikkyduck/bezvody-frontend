import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import { NavPills, type NavItem } from "@/components/NavPills";
import { GlassPointer } from "@/components/bv/GlassPointer";
import { StencilLogo, CatMark, LensFilter, Scene, SectionLabel } from "@/components/bv/core";
import { roleLabel, type Role } from "@/lib/platform-data";
import { useSession } from "@/lib/session";

/**
 * Разделы у каждой роли свои. Кабинет администратора и кабинет проджекта —
 * не «ещё одна вкладка» рядом с клиентскими, а отдельные входы: клиент про
 * них не знает и не должен.
 */
const navByRole: Record<Role, NavItem[]> = {
  client: [
    { to: "/", label: "Окна", short: "Окна" },
    { to: "/briefs", label: "Решения", short: "Решения" },
    { to: "/agents", label: "Агенты", short: "Агенты" },
  ],
  project: [{ to: "/pm", label: "Мои клиенты", short: "Клиенты" }],
  admin: [{ to: "/admin", label: "Кабинет", short: "Кабинет" }],
};

/** Куда попадает роль сразу после входа. */
export const homeByRole: Record<Role, string> = {
  client: "/",
  project: "/pm",
  admin: "/admin",
};

export function AppShell({ children, allow }: { children: ReactNode; allow: Role[] }) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { person, client, role, ready, signOut } = useSession();
  const navigate = useNavigate();

  // Проверять доступ можно только после того, как прочитали сессию, иначе
  // при перезагрузке страницы вышвыривало бы уже вошедшего человека.
  useEffect(() => {
    if (!ready) return;
    if (!role) {
      navigate({ to: "/vhod", replace: true });
      return;
    }
    if (!allow.includes(role)) navigate({ to: homeByRole[role], replace: true });
  }, [ready, role, allow, navigate]);

  if (!ready || !role || !allow.includes(role)) {
    return (
      <div className="stage grain theme-paper flex min-h-screen items-center justify-center">
        <CatMark className="h-10 w-12 animate-pulse text-[color:var(--color-text-primary)]/40" strokeWidth={2} />
      </div>
    );
  }

  const nav = navByRole[role];
  const initials = person
    ? person.name
        .split(" ")
        .map((w) => w[0])
        .join("")
        .slice(0, 2)
    : "";

  return (
    // theme-paper: внутри кабинетов светлый «Сухой остаток», обложка входа остаётся угольной
    <div className="stage grain theme-paper min-h-screen">
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
          <Link to={homeByRole[role]} className="flex items-center gap-2.5" aria-label="На главную">
            <CatMark className="h-7 w-9 text-[color:var(--color-text-primary)]/70" strokeWidth={2} />
            <StencilLogo className="logo-sm" />
            {role !== "client" ? (
              <span className="ml-2 hidden border-l border-[color:var(--color-line)] pl-3 text-[13px] font-semibold lg:block">
                {roleLabel[role]}
              </span>
            ) : null}
          </Link>
          <NavPills items={nav} path={path} className="hidden md:flex" />

          <div className="ml-auto flex items-center gap-3.5 text-right">
            <div className="hidden text-right sm:block">
              <div className="text-[12.5px] font-semibold leading-tight">{person?.name}</div>
              <div className="text-[10.5px] text-muted-foreground">
                {client ? client.unit : person?.position}
              </div>
            </div>
            <div
              className="flex h-9 w-9 flex-none items-center justify-center rounded-full bg-primary text-[12px] font-bold text-primary-foreground"
              title={person?.name}
              aria-hidden
            >
              {initials}
            </div>
            <button onClick={signOut} className="btn btn-ghost text-[12px]" aria-label="Выйти из кабинета">
              Выйти
            </button>
          </div>
        </div>
        {/* Навигация на узких экранах: горизонтальная лента вместо скрытого меню */}
        {nav.length > 1 ? (
          <div className="border-t border-[color:var(--color-line)] md:hidden">
            <NavPills items={nav} path={path} mobile className="flex overflow-x-auto px-4 py-2" />
          </div>
        ) : null}
      </header>
      <main className="mx-auto max-w-[1240px] px-5 py-8 sm:px-6">{children}</main>
      <footer className="mx-auto flex max-w-[1240px] items-end justify-between gap-4 px-6 pb-10 pt-4 text-[11.5px] text-muted-foreground">
        <span>Платформа «Без Воды»</span>
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
