import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";

import { homeByRole } from "@/components/AppShell";
import { useSession } from "@/lib/session";

export const Route = createFileRoute("/vhod")({
  head: () => ({
    meta: [
      { title: "Вход в кабинет — NOWATER.TECH" },
      {
        name: "description",
        content: "Безопасный вход в кабинет NOWATER.TECH по персональному коду доступа.",
      },
      { property: "og:title", content: "Вход в кабинет — NOWATER.TECH" },
      {
        property: "og:description",
        content: "Безопасный вход в кабинет NOWATER.TECH по персональному коду доступа.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
      // Кабинет не для поиска: индексировать вход незачем.
      { name: "robots", content: "noindex" },
    ],
  }),
  component: SignIn,
});

function SignIn() {
  const { signIn, role, ready } = useSession();
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Уже вошёл — форму показывать незачем, сразу в свой кабинет.
  useEffect(() => {
    if (ready && role) navigate({ to: homeByRole[role], replace: true });
  }, [ready, role, navigate]);

  const [busy, setBusy] = useState(false);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    const result = await signIn(code);
    setBusy(false);
    setError(result.ok ? null : result.error);
  }

  return (
    <main className="stage flex min-h-screen flex-col overflow-hidden">
      {/* Шапка ровно та же, что на витрине: человек не должен чувствовать,
          что попал на другой сайт. */}
      <header className="rise flex flex-none items-center justify-between px-6 pt-7 sm:px-10 md:px-[4.1vw] md:pt-10">
        <Link to="/" className="text-[12px] font-extrabold tracking-[0.02em]">
          NOWATER.TECH
        </Link>
        <span className="text-[9px] font-semibold uppercase tracking-[0.2em] text-[color:var(--color-text-muted)]">
          Закрытый контур
        </span>
      </header>

      <div className="mx-auto grid w-full max-w-[1600px] flex-1 items-center gap-16 px-6 pb-12 pt-[12vh] sm:px-10 md:px-[4.1vw] lg:grid-cols-[minmax(0,1fr)_minmax(0,440px)] lg:pt-[14vh]">
        <section className="rise rise-1 max-w-[620px]">
          <h1 className="text-[clamp(2.5rem,6vw,5.25rem)] font-normal leading-[0.94] tracking-[-0.022em]">
            Вход
            <br />
            <span className="text-[color:var(--color-text-muted)]">в кабинет</span>
          </h1>
        </section>

        {/* Форма — единственное действие на экране, поэтому она не в карточке:
            карточка была бы рамкой вокруг очевидного. */}
        <section className="rise rise-2 w-full">
          <form onSubmit={submit}>
            <label
              htmlFor="code"
              className="text-[9px] font-semibold uppercase tracking-[0.2em] text-[color:var(--color-text-muted)]"
            >
              Персональный код
            </label>
            <input
              id="code"
              value={code}
              autoFocus
              autoComplete="username"
              spellCheck={false}
              onChange={(e) => {
                setCode(e.target.value);
                if (error) setError(null);
              }}
              placeholder="BV-CLIENT-01"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "code-error" : undefined}
              className="mt-4 w-full border-0 border-b border-[color:var(--color-line)] bg-transparent px-0 py-4 text-2xl font-normal uppercase tracking-[0.06em] outline-none transition-[border-color,box-shadow] focus-visible:outline-none focus:shadow-[inset_0_-1px_0_0_var(--color-text-primary)] placeholder:normal-case placeholder:tracking-[0.04em] placeholder:text-[color:var(--color-text-muted)]/60 focus:border-[color:var(--color-text-primary)] sm:text-3xl"
              data-numeric
            />
            {error ? (
              <p
                id="code-error"
                role="alert"
                className="mt-4 text-sm leading-relaxed text-[color:var(--color-accent)]"
              >
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={busy}
              className="btn btn-primary mt-10 w-full text-[10px] font-bold uppercase tracking-[0.2em] disabled:opacity-40"
            >
              {busy ? "Проверяем" : "Войти в кабинет"}
            </button>
          </form>
        </section>
      </div>

      <footer className="rise rise-3 mx-auto w-full max-w-[1600px] border-t border-[color:var(--color-line)] px-6 py-6 text-[12px] leading-relaxed text-[color:var(--color-text-muted)] sm:px-10 md:px-[4.1vw]">
        Документы и переписка хранятся на серверах в России по требованиям 152-ФЗ
      </footer>
    </main>
  );
}
