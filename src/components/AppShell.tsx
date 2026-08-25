import { Link, useNavigate, useRouterState } from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import { NavPills, type NavItem } from "@/components/NavPills";
import { GlassPointer } from "@/components/bv/GlassPointer";
import { StencilLogo, CatMark, LensFilter, Scene } from "@/components/bv/core";
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
  project: [{ to: "/pm", label: "Мои клиенты", short: "Клиенты" }],
  admin: [{ to: "/admin", label: "Кабинет", short: "Кабинет" }],
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
      <div className="stage grain theme-paper flex min-h-screen flex-col items-center justify-center gap-4">
        <CatMark
          className="h-10 w-12 animate-pulse text-[color:var(--color-text-primary)]/40"
          strokeWidth={2}
        />
        {/* Молчащий кот на медленном 4G читается как зависший экран: человек
            жмёт перезагрузку и теряет ещё десять секунд. Слово стоит дешевле. */}
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
    ...(person?.leads ? [{ to: "/komanda", label: "Команда", short: "Команда" }] : []),
  ];
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
      {/* Фон сплошной, без backdrop-blur: липкая шапка со стеклом внутри
          обрезанной сцены (.stage) роняет композицию — при прокрутке над
          шапкой оставалось неотрисованное поле. Сплошной тон заодно держит
          контраст дорожки на любой картинке под ним. */}
      <header className="sticky top-0 z-40 border-b border-[color:var(--color-line)] bg-[color:var(--color-bg-primary)]">
        <div className="mx-auto flex max-w-[1240px] items-center gap-6 px-5 py-3 sm:px-6">
          {/* Уровень кабинета живёт в search-параметрах (/?z=…&d=…), поэтому
              логотип обязан их сбрасывать: клиент из разговора должен попадать
              в список задач, а не обратно в тот же разговор. Ссылка без
              search именно это и делает — роутер строит адрес с чистым
              набором параметров, а не наследует текущий. */}
          <Link
            to={homeByRole[role]}
            className="flex items-center gap-2.5"
            aria-label={role === "client" ? "К списку задач" : "На главную"}
          >
            <CatMark
              className="h-7 w-9 text-[color:var(--color-text-primary)]/70"
              strokeWidth={2}
            />
            <StencilLogo className="logo-sm" />
            {role !== "client" ? (
              <span className="ui-meta ml-2 hidden border-l border-[color:var(--color-line)] pl-3 font-semibold lg:block">
                {roleLabel[role]}
              </span>
            ) : null}
          </Link>
          <NavPills items={nav} path={path} className="hidden md:flex" />

          <div className="ml-auto flex items-center gap-3.5 text-right">
            <div className="hidden text-right sm:block">
              <div className="ui-meta font-semibold leading-tight">{person?.name}</div>
              <div className="ui-meta text-muted-foreground">
                {person?.company || person?.position}
              </div>
            </div>
            <div
              className="ui-meta flex h-9 w-9 flex-none items-center justify-center rounded-full bg-primary font-bold text-primary-foreground"
              title={person?.name}
              aria-hidden
            >
              {initials}
            </div>
            <button
              onClick={signOut}
              className="btn btn-ghost ui-meta"
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
          <div className="border-t border-[color:var(--color-line)] md:hidden">
            <NavPills items={nav} path={path} mobile className="flex overflow-x-auto px-4 py-2" />
          </div>
        ) : null}
      </header>
      <main className="mx-auto max-w-[1240px] px-5 py-8 sm:px-6">{children}</main>
      <footer className="ui-meta mx-auto flex max-w-[1240px] items-end justify-between gap-4 px-6 pb-10 pt-4 text-muted-foreground">
        <div className="measure">
          <div>Платформа «Без Воды»</div>
          {/* Два вопроса, которые руководитель задаёт кабинету до того, как
              принесёт в него P&L: где это лежит и кто ещё это увидит.
              Отвечаем ровно тем, что правда: хранение — российский контур,
              а переписку клиента администратор действительно открывает
              (Conversations.tsx). */}
          <p className="mt-1.5">
            Документы и разговоры хранятся на серверах в России, по требованиям 152-ФЗ.
            {role === "client" ? " Их видите вы, ваш менеджер и администратор платформы." : ""}
          </p>
          {/* С появлением панели команды обещание «код открывает только ваши
              задачи» перестало быть полной правдой. Говорим об этом сами и
              ровно в тех пределах, в каких это так: руководителю видны
              названия задач и отметка о работе, но не переписка и не файлы. */}
          {person?.watched ? (
            <p className="mt-1.5">
              Вашему руководителю видно, над какими задачами вы работаете и доведены ли они до
              документа. Переписку и сами документы он отсюда не открывает.
            </p>
          ) : null}
        </div>
        <CatMark
          className="h-10 w-12 flex-none text-[color:var(--color-text-primary)]/50"
          strokeWidth={2}
        />
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
    <div className="mb-8 flex flex-wrap items-end justify-between gap-4">
      <div>
        <div className="label-caps text-[color:var(--color-text-secondary)]">{eyebrow}</div>
        <h1 className="t-h1 mt-2">{title}</h1>
        {lead ? <p className="ui-body measure mt-2.5 text-muted-foreground">{lead}</p> : null}
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
