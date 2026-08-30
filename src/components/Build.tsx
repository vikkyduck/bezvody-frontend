import { useCallback, useEffect, useRef, useState } from "react";

import { Markdown } from "@/components/Markdown";
import {
  buildStateServer,
  buildVersionServer,
  buildsServer,
  type BuildState,
} from "@/lib/server-pipeline";
import { useSession } from "@/lib/session";
import { useWindows } from "@/lib/windows-store";

/**
 * Сборка документа: кнопка, ход работы и версии после каждого прогона.
 *
 * Разговор доводит фактуру, сборка делает документ — это разные действия, и
 * на экране они разные. Пока идёт сборка, видно, на каком она шаге: четыре
 * модели подряд идут десять-пятнадцать минут, и без шагов это неотличимо от
 * зависшей страницы.
 *
 * Версии после каждого прогона лежат здесь же. Без них усушке нельзя
 * доверять: не видно, что именно выпало.
 */

/** Объём версии: у документа он в тысячах, у обрывка — в знаках. */
const size = (chars: number) =>
  chars >= 2000 ? `${Math.round(chars / 1000)} тыс. знаков` : `${chars} знаков`;

/** Столько закрытых вопросов шпаргалки — и документ считается рабочим. */
const WORKING = 60;

type Progress = { closed: number; total: number };

type BuildRow = {
  id: string;
  at: string;
  versions: { passId: string; name: string; chars: number }[];
};

export function Build({ windowId }: { windowId: string }) {
  const { code } = useSession();
  const { runBuild, reload } = useWindows();

  const [progress, setProgress] = useState<Progress | null>(null);
  const [state, setState] = useState<BuildState | null>(null);
  const [builds, setBuilds] = useState<BuildRow[]>([]);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [openVersion, setOpenVersion] = useState<string | null>(null);
  const [texts, setTexts] = useState<Record<string, string>>({});
  const wasRunning = useRef(false);
  /** Счётчик перезапуска опроса: без него после нажатия никто не спрашивает
   *  сервер «как там», и кнопка навсегда остаётся в «Собираю». */
  const [poll, setPoll] = useState(0);

  // Счётчик закрытых вопросов пишет шпаргалка — читаем её итог, а не
  // пересчитываем: методика живёт на сервере, в браузере только отметки.
  const readProgress = useCallback(() => {
    try {
      const raw = localStorage.getItem("bv-6pager-progress");
      setProgress(raw ? (JSON.parse(raw) as Progress) : null);
    } catch {
      /* приватный режим браузера — работаем без счётчика */
    }
  }, []);

  useEffect(() => {
    readProgress();
    window.addEventListener("focus", readProgress);
    window.addEventListener("bv-checklist", readProgress);
    return () => {
      window.removeEventListener("focus", readProgress);
      window.removeEventListener("bv-checklist", readProgress);
    };
  }, [readProgress]);

  const loadBuilds = useCallback(() => {
    if (!code) return;
    buildsServer({ data: { code, windowId } })
      .then((r) => setBuilds(r.builds))
      .catch(() => {
        /* молча: список версий — подспорье, без него документ на месте */
      });
  }, [code, windowId]);

  useEffect(() => {
    loadBuilds();
  }, [loadBuilds]);

  // Пока сборка идёт, спрашиваем сервер, на каком она шаге. Закончилась —
  // перечитываем разговор: итоговый документ приходит в него сообщением.
  useEffect(() => {
    if (!code) return;
    let alive = true;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const tick = async () => {
      try {
        const st = await buildStateServer({ data: { code, windowId } });
        if (!alive) return;
        setState(st.running ? st : null);
        if (wasRunning.current && !st.running) {
          reload();
          loadBuilds();
        }
        wasRunning.current = st.running;
        if (st.running) timer = setTimeout(() => void tick(), 6000);
      } catch {
        if (alive) timer = setTimeout(() => void tick(), 15000);
      }
    };
    void tick();

    return () => {
      alive = false;
      if (timer) clearTimeout(timer);
    };
  }, [code, windowId, reload, loadBuilds, poll]);

  async function start() {
    setBusy(true);
    setNote("");
    try {
      const res = await runBuild(windowId);
      setNote(res.note);
      if (res.ok) {
        wasRunning.current = true;
        setState({ running: true, steps: [], minutes: 0 });
        setPoll((n) => n + 1);
      }
    } finally {
      setBusy(false);
    }
  }

  async function showVersion(buildId: string, passId: string) {
    const key = `${buildId}:${passId}`;
    if (openVersion === key) {
      setOpenVersion(null);
      return;
    }
    setOpenVersion(key);
    if (texts[key] || !code) return;
    const res = await buildVersionServer({ data: { code, buildId, passId } });
    setTexts((t) => ({ ...t, [key]: res.text }));
  }

  const running = Boolean(state?.running);
  const enough = !progress || progress.closed >= WORKING;

  return (
    <section className="mt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-3">
        <h2 className="text-[15px] font-semibold">Собрать документ</h2>
        {progress ? (
          <span className="text-[12.5px] text-muted-foreground">
            закрыто {progress.closed} из {progress.total} вопросов
          </span>
        ) : null}
      </div>
      <p className="measure mt-1 text-[12.5px] text-muted-foreground">
        Разговор выше доводит фактуру. Сборка делает из неё документ: четыре прогона подряд —
        сборка, язык, объём, сверка. Идёт десять-пятнадцать минут, страницу можно закрыть.
      </p>

      {!enough && !running ? (
        <p className="measure mt-2 text-[12.5px] text-[color:var(--color-accent)]">
          Закрыто меньше {WORKING} вопросов. Соберу и сейчас, но часть разделов уйдёт в документ
          пустыми — с пометкой «данных нет».
        </p>
      ) : null}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <button
          onClick={() => void start()}
          disabled={busy || running}
          className="btn btn-primary text-[13px] disabled:opacity-50"
        >
          {running ? "Собираю" : busy ? "Запускаю" : "Собрать документ"}
        </button>
        {running && state ? (
          <span className="text-[12px] text-muted-foreground">
            {state.minutes ? `${state.minutes}-я минута` : "начали"}
          </span>
        ) : null}
      </div>

      {note ? <p className="mt-2 text-[12.5px] text-[color:var(--color-accent)]">{note}</p> : null}

      {running && state?.steps.length ? (
        <ol className="mt-4 flex flex-wrap gap-2">
          {state.steps.map((s) => (
            <li
              key={s.passId}
              className={`rounded-[var(--radius-pill)] border px-3 py-1.5 text-[12px] ${
                s.state === "done"
                  ? "border-[color:var(--color-line)] text-muted-foreground"
                  : s.state === "running"
                    ? "border-[color:var(--color-accent)] text-foreground"
                    : s.state === "failed"
                      ? "border-[color:var(--color-error)] text-[color:var(--color-error)]"
                      : "border-[color:var(--color-line)] text-muted-foreground/60"
              }`}
              title={s.note}
            >
              {s.state === "done" ? "✓ " : s.state === "running" ? "· " : ""}
              {s.name}
              {s.state === "done" && s.seconds ? ` · ${s.seconds} с` : ""}
              {s.state === "failed" ? ` · ${s.note || "сорвался"}` : ""}
            </li>
          ))}
        </ol>
      ) : null}

      {builds.length ? (
        <div className="mt-6">
          <div className="label-caps mb-2">Версии сборки</div>
          <p className="measure mb-3 text-[12px] text-muted-foreground">
            Что получилось после каждого прогона. Итоговый документ — в разговоре выше; здесь видно,
            что изменил язык и что выпало при усушке.
          </p>
          <div className="space-y-2.5">
            {builds.map((b) => (
              <div key={b.id} className="card-flat px-5 py-4">
                <div className="text-[12.5px] text-muted-foreground">
                  Сборка от{" "}
                  {new Date(b.at).toLocaleString("ru-RU", {
                    day: "2-digit",
                    month: "2-digit",
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </div>
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {b.versions.map((v) => {
                    const key = `${b.id}:${v.passId}`;
                    return (
                      <button
                        key={key}
                        onClick={() => void showVersion(b.id, v.passId)}
                        className={`btn text-[12px] ${openVersion === key ? "btn-primary" : "btn-glass"}`}
                      >
                        {v.name} · {size(v.chars)}
                      </button>
                    );
                  })}
                </div>
                {openVersion?.startsWith(`${b.id}:`) ? (
                  <div className="mt-4 max-h-[520px] overflow-y-auto border-t border-[color:var(--color-line)] pt-4">
                    {texts[openVersion] ? (
                      <Markdown>{texts[openVersion]!}</Markdown>
                    ) : (
                      <p className="text-[12.5px] text-muted-foreground">Открываю…</p>
                    )}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}
