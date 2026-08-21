import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { useEffect, useState, type FormEvent } from "react";

import { homeByRole } from "@/components/AppShell";
import { CatMark, LensFilter, Scene, StencilLogo } from "@/components/bv/core";
import { useSession } from "@/lib/session";

export const Route = createFileRoute("/vhod")({
  head: () => ({
    meta: [
      { title: "Вход — платформа «Без Воды»" },
      { name: "description", content: "Вход в кабинет по коду доступа." },
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

          <h1 className="t-h1 text-[30px] leading-[1.1]">Вход в кабинет</h1>
          <p className="measure mt-3 text-[13.5px] text-muted-foreground">
            Код доступа выдаёт администратор платформы. Один код — один человек: по нему видно, кто
            и что смотрел, и его можно отозвать в любой момент.
          </p>

          <form onSubmit={submit} className="card-flat mt-7 px-6 py-6">
            <label htmlFor="code" className="label-caps">
              Код доступа
            </label>
            <input
              id="code"
              value={code}
              autoFocus
              autoComplete="one-time-code"
              spellCheck={false}
              onChange={(e) => {
                setCode(e.target.value);
                if (error) setError(null);
              }}
              placeholder="BV-CLIENT-01"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "code-error" : undefined}
              className="mt-2.5 w-full rounded-[var(--radius-md,10px)] border border-[color:var(--color-line)] bg-transparent px-3.5 py-2.5 text-[14px] tracking-[0.06em] uppercase outline-none transition-colors focus:border-[color:var(--color-text-primary)]/40"
            />
            {error ? (
              <p
                id="code-error"
                role="alert"
                className="mt-2.5 text-[12.5px] text-[color:var(--color-accent)]"
              >
                {error}
              </p>
            ) : null}

            <button
              type="submit"
              disabled={busy}
              className="btn btn-primary mt-5 w-full text-[13.5px] disabled:opacity-50"
            >
              {busy ? "Проверяем" : "Войти"}
            </button>

            <p className="mt-4 text-[11.5px] leading-relaxed text-muted-foreground">
              Потеряли код — напишите вашему проджект-менеджеру, он выпустит новый. Старый после
              этого перестанет работать.
            </p>
          </form>
        </div>
      </div>
    </div>
  );
}
