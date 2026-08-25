import { useEffect, useState } from "react";

import { setDeliveryServer } from "@/lib/server-directory";
import { tgLinkServer, tgStatusServer, tgUnlinkServer } from "@/lib/server-telegram";
import { useSession } from "@/lib/session";

/**
 * Куда присылать готовое.
 *
 * Разбор пишется минутами, а человек живёт между встречами: сидеть и смотреть
 * на счётчик — худшее применение его времени. Здесь он включает доставку
 * готового документа в телеграм и на почту — и может уходить.
 *
 * По умолчанию всё выключено. Рассылка, о которой не просили, хуже тишины.
 */
export function Delivery() {
  const { code, person, refresh } = useSession();
  const [tgLinked, setTgLinked] = useState<boolean | null>(null);
  const [busy, setBusy] = useState(false);
  const [said, setSaid] = useState("");

  const deliver = person?.deliver ?? { telegram: false, email: false };
  const hasEmail = Boolean(person?.email.trim());

  useEffect(() => {
    if (!code) return;
    let alive = true;
    tgStatusServer({ data: { code } })
      .then((r) => alive && setTgLinked(r.linked))
      .catch(() => alive && setTgLinked(false));
    return () => {
      alive = false;
    };
  }, [code]);

  async function save(next: { telegram: boolean; email: boolean }) {
    if (!code || busy) return;
    setBusy(true);
    setSaid("");
    try {
      const res = await setDeliveryServer({ data: { code, ...next } });
      if (res.note) setSaid(res.note);
      refresh();
    } catch {
      setSaid("Не сохранилось. Проверьте связь и попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  async function linkTg() {
    if (!code || busy) return;
    setBusy(true);
    setSaid("");
    try {
      const res = await tgLinkServer({ data: { code } });
      if (res.ok && res.url) {
        // Ссылка одноразовая и живёт минуты — открываем сразу, а не копируем.
        window.open(res.url, "_blank", "noopener,noreferrer");
        setSaid("В телеграме нажмите «Начать» — бот привяжется сам.");
      } else {
        setSaid(res.note || "Бот пока не настроен — напишите администратору.");
      }
    } catch {
      setSaid("Не получилось. Проверьте связь и попробуйте ещё раз.");
    } finally {
      setBusy(false);
    }
  }

  async function unlinkTg() {
    if (!code || busy) return;
    setBusy(true);
    setSaid("");
    try {
      const res = await tgUnlinkServer({ data: { code } });
      setSaid(res.note || "Телеграм отвязан.");
      setTgLinked(false);
      if (deliver.telegram) void save({ ...deliver, telegram: false });
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card-plain px-5 py-5">
      <h2 className="ui-title">Куда присылать готовое</h2>
      <p className="ui-support measure mt-1 mb-4 text-muted-foreground">
        Готовый документ придёт сам — ждать на странице не нужно.
      </p>

      <div className="space-y-3">
        <label className="flex items-start gap-2.5">
          <input
            type="checkbox"
            checked={deliver.telegram}
            disabled={busy || !tgLinked}
            onChange={(e) => void save({ ...deliver, telegram: e.target.checked })}
            className="mt-1 flex-none"
          />
          <span className="min-w-0">
            <span className="ui-body block">В телеграм — документом в личку</span>
            <span className="ui-support block text-muted-foreground">
              {tgLinked === null
                ? "Проверяю привязку…"
                : tgLinked
                  ? "Файлы боту лягут в вашу задачу."
                  : "Сначала привяжите телеграм — кнопкой ниже."}
            </span>
          </span>
        </label>

        <label className="flex items-start gap-2.5">
          <input
            type="checkbox"
            checked={deliver.email}
            disabled={busy || !hasEmail}
            onChange={(e) => void save({ ...deliver, email: e.target.checked })}
            className="mt-1 flex-none"
          />
          <span className="min-w-0">
            <span className="ui-body block">Письмом на почту</span>
            <span className="ui-support block text-muted-foreground">
              {hasEmail
                ? `На ${person?.email}.`
                : "Почта в карточке не записана — попросите менеджера её вписать."}
            </span>
          </span>
        </label>
      </div>

      <div className="mt-4 flex flex-wrap items-center gap-3">
        {tgLinked ? (
          <button onClick={() => void unlinkTg()} disabled={busy} className="btn btn-ghost ui-meta">
            Отвязать телеграм
          </button>
        ) : (
          <button
            onClick={() => void linkTg()}
            disabled={busy || tgLinked === null}
            className="btn btn-glass ui-meta"
          >
            Привязать телеграм
          </button>
        )}
      </div>

      {said ? <p className="ui-support mt-3 text-muted-foreground">{said}</p> : null}
    </section>
  );
}
