import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import { NavPills, type NavItem } from "@/components/NavPills";
import { roleLabel, type Role } from "@/lib/platform-data";
import { useSession } from "@/lib/session";

/**
 * Разделы у каждой роли свои. Кабинет администратора и кабинет проджекта —
 * не «ещё одна вкладка» рядом с клиентскими, а отдельные входы: клиент про
 * них не знает и не должен.
 */
const navByRole: Record<Role, NavItem[]> = {
  // У клиента разделов нет вовсе: весь кабинет — один экран. Выбрал агента,
  // открылось окно, работаешь. Три вкладки только заставляли гадать, куда идти.
  client: [],
  project: [{ to: "/pm", label: "Мои клиентские группы", short: "Группы" }],
  admin: [
    { to: "/admin", label: "Админка", short: "Админка" },
    { to: "/", label: "Кабинет заказчика", short: "Заказчик" },
    { to: "/komanda", label: "Кабинет руководителя", short: "Руководитель" },
    { to: "/pm", label: "Кабинет проджекта", short: "Проджект" },
    { to: "/platforma", label: "Витрина NOWATER.TECH", short: "Витрина" },
  ],
};

/** Куда попадает роль сразу после входа. */
export const homeByRole: Record<Role, string> = {
  client: "/",
  project: "/pm",
  admin: "/admin",
};

/** Ступень дорожки в шапке: последняя — то место, где человек стоит. */
export type Crumb = { label: string; to?: string; search?: Record<string, string | undefined> };

export function AppShell({
  children,
  allow,
  crumbs,
}: {
  children: ReactNode;
  allow: Role[];
  /**
   * Дорожка «Задачи › Задача › Разговор» в липкой шапке.
   *
   * Кнопка «← Все задачи» стоит в начале страницы и уезжает вверх при первой
   * же прокрутке — а вопрос «где я и как вернуться» возникает как раз внизу
   * длинного экрана. Шапка липкая, поэтому дорожка здесь отвечает всегда.
   */
  crumbs?: Crumb[];
}) {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const { person, role, ready, signOut } = useSession();
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
      <div className="stage flex min-h-screen flex-col items-center justify-center gap-4 bg-background">
        <div className="h-px w-12 animate-pulse bg-foreground" />
        <p className="ui-support text-muted-foreground" role="status" aria-live="polite">
          Открываем ваш кабинет…
        </p>
      </div>
    );
  }

  /**
   * Руководитель — не отдельная роль, а признак обычного кабинета: свою работу
   * он ведёт там же, где все. Поэтому раздел команды приходит не из таблицы
   * ролей, а из свойства человека.
   */
  const nav: NavItem[] = [
    ...navByRole[role],
    ...(person?.leads
      ? [{ to: "/komanda", label: "Кабинет руководителя", short: "Руководитель" }]
      : []),
  ];
  const initials = person
    ? person.name
        .split(" ")
        .map((w) => w[0])
        .join("")
        .slice(0, 2)
    : "";

  return (
    <div className="stage min-h-screen bg-background">
      {/* Шапка стеклянная: содержимое уезжает под неё, а не обрывается по
          глухой плашке — так видно, что страница продолжается. */}
      <header className="sticky top-0 z-40 border-b border-[color:var(--color-line)] bg-[color:color-mix(in_oklab,var(--color-bg-primary)_82%,transparent)] backdrop-blur-xl backdrop-saturate-150">
        <div className="mx-auto flex max-w-[1280px] items-center gap-6 px-6 py-5 sm:px-10 lg:px-[4.1vw]">
          {/* Уровень кабинета живёт в search-параметрах (/?z=…&d=…), поэтому
              логотип обязан их сбрасывать: клиент из разговора должен попадать
              в список задач, а не обратно в тот же разговор. Ссылка без
              search именно это и делает — роутер строит адрес с чистым
              набором параметров, а не наследует текущий. */}
          <Link
            to={homeByRole[role]}
            className="flex items-center gap-3 text-[12px] font-extrabold tracking-[0.02em]"
            aria-label={role === "client" ? "К списку задач" : "На главную"}
          >
            NOWATER.TECH
            {role !== "client" ? (
              <span className="hidden border-l border-[color:var(--color-line)] pl-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground 2xl:block">
                {roleLabel[role]}
              </span>
            ) : null}
          </Link>

          <NavPills
            items={nav}
            path={path}
            short
            className="hidden min-w-0 overflow-hidden lg:flex"
          />

          {/* Имя и компания — одна строка каждая: перенос превращал угол шапки
              в лесенку из трёх обрывков. Не влезло — обрезаем многоточием. */}
          <div className="ml-auto flex flex-none items-center gap-4 text-right">
            <div className="hidden max-w-[220px] text-right lg:block">
              <div className="truncate text-[12px] font-semibold leading-tight">{person?.name}</div>
              <div className="truncate text-[10px] uppercase tracking-[0.14em] text-muted-foreground">
                {person?.company || person?.position}
              </div>
            </div>
            <div
              className="flex h-9 w-9 flex-none items-center justify-center border border-[color:var(--color-line)] text-[11px] font-bold tracking-[0.08em] text-foreground"
              title={person?.name}
              aria-hidden
            >
              {initials}
            </div>
            <button
              onClick={signOut}
              className="text-[10px] font-bold uppercase tracking-[0.2em] text-muted-foreground transition-colors hover:text-foreground"
              aria-label="Выйти из кабинета"
            >
              Выйти
            </button>
          </div>
        </div>
        {crumbs && crumbs.length > 1 ? (
          <div className="border-t border-[color:var(--color-line)]">
            <nav
              aria-label="Где я"
              className="mx-auto flex max-w-[1240px] items-center gap-2 overflow-x-auto px-5 sm:px-6"
            >
              {crumbs.map((c, i) => {
                const last = i === crumbs.length - 1;
                return (
                  <span key={`${c.label}-${i}`} className="flex flex-none items-center gap-1.5">
                    {i ? (
                      <span aria-hidden className="ui-support text-muted-foreground/60">
                        ›
                      </span>
                    ) : null}
                    {last || !c.to ? (
                      <span
                        className="ui-support flex max-w-[46vw] items-center truncate py-2.5 font-semibold"
                        aria-current="page"
                      >
                        {c.label}
                      </span>
                    ) : (
                      <Link
                        to={c.to}
                        search={c.search as never}
                        className="ui-support flex min-h-[44px] max-w-[34vw] items-center truncate text-muted-foreground underline decoration-[color:var(--color-line)] underline-offset-4 hover:text-foreground hover:decoration-current"
                      >
                        {c.label}
                      </Link>
                    )}
                  </span>
                );
              })}
            </nav>
          </div>
        ) : null}

        {/* Навигация на узких экранах: горизонтальная лента вместо скрытого меню */}
        {/* Раньше лента показывалась только при двух и более разделах, и
            единственный раздел («Команда» у руководителя) на телефоне было
            не достать вовсе: на широком экране он есть, на узком исчезал. */}
        {nav.length > 0 ? (
          <div className="border-t border-[color:var(--color-line)] lg:hidden">
            <NavPills items={nav} path={path} mobile className="flex overflow-x-auto px-4 py-2" />
          </div>
        ) : null}
      </header>
      <main className="mx-auto max-w-[1280px] px-6 py-16 sm:px-10 lg:px-[4.1vw] lg:py-24">
        {children}
      </main>
      <footer className="mx-auto max-w-[1280px] border-t border-[color:var(--color-line)] px-6 pb-14 pt-9 text-[12px] leading-relaxed text-muted-foreground sm:px-10 lg:px-[4.1vw]">
        <div className="measure">
          <div className="text-[12px] font-extrabold tracking-[0.02em] text-foreground">
            NOWATER.TECH
          </div>

          {/* Два вопроса, которые руководитель задаёт кабинету до того, как
              принесёт в него P&L: где это лежит и кто ещё это увидит.
              Отвечаем ровно тем, что правда: хранение — российский контур,
              а переписку клиента администратор действительно открывает
              (Conversations.tsx). */}
        </div>
      </footer>
    </div>
  );
}

export function PageHead({
  eyebrow,
  title,
  lead,
  right,
}: {
  eyebrow: string;
  title: string;
  lead?: string;
  right?: ReactNode;
  /**
   * Трафаретный номер и капитель SectionLabel в кабинете больше не рисуем:
   * нумеровать здесь нечего, а трафарет забирал внимание у заголовка.
   * Параметр оставлен принимаемым, чтобы не ломать существующие вызовы.
   */
  n?: string;
}) {
  return (
    <div className="mb-14 flex flex-wrap items-end justify-between gap-8 border-b border-[color:var(--color-line)] pb-10 lg:mb-20 lg:pb-14">
      <div>
        <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-[color:var(--color-text-secondary)]">
          {eyebrow}
        </div>
        <h1
          className="mt-6 max-w-[16ch] font-normal leading-[0.96] tracking-[-0.01em]"
          style={{ fontSize: "clamp(2.5rem, 6vw, 5.5rem)" }}
        >
          {title}
        </h1>
        {lead ? (
          <p className="mt-7 max-w-[46ch] text-base leading-relaxed text-muted-foreground">
            {lead}
          </p>
        ) : null}
      </div>
      {right}
    </div>
  );
}

/**
 * Хлебные крошки: «Задачи / Тариф M-сегмента / Никита». Нужны потому, что
 * уровень кабинета живёт не в пути, а в search-параметрах (/?z=…&d=…), и без
 * этой строки человек не видит, где он стоит и куда возвращаться.
 *
 * Последний элемент — текущее место, он не ссылка: некуда вести. Одного
 * элемента достаточно — тогда крошки просто называют уровень.
 */
