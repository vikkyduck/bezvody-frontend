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

          <h1 className="t-h1">Вход в кабинет</h1>
          {/* Первая строка отвечает на вопрос «что я отсюда унесу», а не предупреждает
              о слежке: до входа человек ещё не знает, зачем ему этот кабинет. */}
          <p className="measure ui-support mt-3 text-muted-foreground">
            Агенты разберут вашу задачу и соберут решение, которое можно нести на защиту.
          </p>

          <form onSubmit={submit} className="card-flat mt-7 px-6 py-6">
            <label htmlFor="code" className="label-caps">
              Код доступа
            </label>
            <input
              id="code"
              value={code}
              autoFocus
              // Код здесь — постоянный логин, а не разовый пароль из СМС. С
              // one-time-code ни браузер, ни менеджер паролей его не сохраняют,
              // и человек лезет за кодом в переписку при каждом заходе.
              autoComplete="username"
              spellCheck={false}
              onChange={(e) => {
                setCode(e.target.value);
                if (error) setError(null);
              }}
              placeholder="BV-CLIENT-01"
              aria-invalid={error ? true : undefined}
              aria-describedby={error ? "code-error" : undefined}
              // 16 px, а не 14: на меньшем кегле iOS Safari зумит страницу при
              // касании поля, и половина экрана уезжает за край.
              className="mt-2.5 w-full rounded-[var(--radius-md,10px)] border border-[color:var(--color-line)] bg-transparent px-3.5 py-2.5 text-base tracking-[0.06em] uppercase outline-none transition-colors focus:border-[color:var(--color-text-primary)]/40"
            />
            {/* Текст ошибки приходит из session: «код не подходит» и «платформа
                не отвечает» — разные строки, здесь их только показываем читаемым
                кеглем, не подменяя одной общей формулировкой. */}
            {error ? (
              <p
                id="code-error"
                role="alert"
                className="ui-support mt-2.5 text-[color:var(--color-accent)]"
              >
                {error}
              </p>
            ) : null}

            {/* Кегль кнопки задаёт сама утилита btn (15 px); прежний text-[13.5px]
                уменьшал единственное действие на экране. */}
            <button
              type="submit"
              disabled={busy}
              className="btn btn-primary mt-5 w-full disabled:opacity-50"
            >
              {busy ? "Проверяем" : "Войти"}
            </button>
          </form>

          {/* Про именной код — после кнопки: до входа это не условие допуска,
              а ответ на вопрос «кто ещё увидит мои документы». */}
          <p className="measure ui-support mt-5 text-muted-foreground">
            Код именной — открывает только ваши задачи. Потерялся — администратор выдаст новый.
          </p>
          {/* Решение о том, нести ли сюда закрытые цифры, человек принимает
              на этом экране — значит и ответ про хранение нужен здесь, а не
              в подвале кабинета, куда он попадёт уже после. */}
          <p className="measure ui-support mt-3 text-muted-foreground">
            Документы и переписка хранятся на серверах в России, по требованиям 152-ФЗ.
          </p>
        </div>
      </div>
    </div>
  );
}
