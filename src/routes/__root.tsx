import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useRouter,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { WindowsProvider } from "../lib/windows-store";
import { SessionProvider } from "../lib/session";
import { DirectoryProvider } from "../lib/directory";
import { CatMark, LensFilter, Scene, StencilLogo } from "@/components/bv/core";

/* Сбойные экраны собраны на той же обёртке, что и вход: та же сцена, тот же
   логотип. Человек, у которого только что что-то не открылось, должен видеть
   свой кабинет, а не чужую служебную страницу на английском. */
function FallbackScreen({ children }: { children: ReactNode }) {
  return (
    <div className="stage grain flex min-h-screen flex-col">
      <LensFilter />
      <Scene blobs={[{ className: "left-[-18%] top-[-10%] h-[560px] w-[560px]", tone: "rose" }]} />

      <div className="flex flex-1 items-center justify-center px-5 py-12">
        <div className="w-full max-w-[420px]">
          <div className="mb-8 flex items-center gap-3">
            <CatMark
              className="h-9 w-11 text-[color:var(--color-text-primary)]/70"
              strokeWidth={2}
            />
            <StencilLogo className="logo-sm" />
          </div>
          {children}
        </div>
      </div>
    </div>
  );
}

function NotFoundComponent() {
  return (
    <FallbackScreen>
      {/* Крупных цифр «404» здесь нет: код ошибки ничего не говорит
          руководителю и читается как чужой технический экран. */}
      <h1 className="ui-h2">Такой страницы нет</h1>
      <p className="ui-support measure mt-3 text-muted-foreground">
        Ссылка устарела или в адресе опечатка. Ваши задачи, документы и разговоры на месте — они в
        кабинете.
      </p>
      {/* Выход один: на сбойном экране выбирать не из чего. */}
      <div className="mt-7">
        <Link to="/" className="btn btn-primary w-full">
          В кабинет
        </Link>
      </div>
    </FallbackScreen>
  );
}

function ErrorComponent({ error, reset }: { error: Error; reset: () => void }) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <FallbackScreen>
      <h1 className="ui-h2">Сбой на нашей стороне</h1>
      {/* Первым делом снимаем главный страх: «я нажал не то и всё потерял».
          Документы и разговоры лежат на сервере, страница их не хранит —
          поэтому это можно обещать честно. Стек и код ошибки не показываем:
          они уходят в reportLovableError, читателю от них толку нет. */}
      <p className="ui-support measure mt-3 text-muted-foreground">
        Страница не открылась — это наша ошибка, не ваша. Задачи, документы и разговоры хранятся на
        сервере, с ними ничего не случилось.
      </p>
      {/* basis-[12rem] вместо flex-1: с нулевой базой «Попробовать снова»
          на 375 px обрезается (.btn стоит на overflow:hidden), а так кнопки
          просто встают в две строки. */}
      <div className="mt-7 flex flex-wrap gap-3">
        <button
          onClick={() => {
            router.invalidate();
            reset();
          }}
          className="btn btn-primary grow basis-[12rem]"
        >
          Попробовать снова
        </button>
        {/* Обычная ссылка, а не Link: после падения роутер сам может быть
            в нерабочем состоянии, и полная перезагрузка надёжнее. */}
        <a href="/" className="btn btn-glass grow basis-[12rem]">
          В кабинет
        </a>
      </div>
    </FallbackScreen>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Платформа «Без Воды»" },
      {
        name: "description",
        content:
          "Рабочее место команды: агенты готовят управленческие решения, решает руководитель.",
      },
      // Кабинет — не витрина: в поиске ему делать нечего.
      { name: "robots", content: "noindex" },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      // Шрифты «Без Воды» хостим локально (public/fonts) — внешние CDN исключены.
      { rel: "stylesheet", href: "/fonts/fonts.css" },
      { rel: "icon", href: "/favicon.svg", type: "image/svg+xml" },
    ],
  }),

  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="ru">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  return (
    <QueryClientProvider client={queryClient}>
      <SessionProvider>
        <DirectoryProvider>
          <WindowsProvider>
            {/* Required: nested routes render here. Removing <Outlet /> breaks all child routes. */}
            <Outlet />
          </WindowsProvider>
        </DirectoryProvider>
      </SessionProvider>
    </QueryClientProvider>
  );
}
