import { useEffect, useRef, useState, type DragEvent } from "react";

import { SUPPORTED_HINT, fileNote, humanSize, requestFit, type StoredFile } from "@/lib/documents";

/**
 * Документы: список и приём новых.
 *
 * Один и тот же список у клиента в окне и у администратора в карточке агента —
 * разница только в том, чьи это документы. Файл можно принести кнопкой или
 * бросить мышью: люди приносят их и так, и так.
 *
 * Ошибку показываем словами и рядом с местом, где её сделали: «формат не тот»,
 * «слишком большой». Молча проглотить файл нельзя — человек будет ждать, что
 * агент его прочитал.
 */

type DownloadResult = { ok: boolean; name: string; mime: string; base64: string };

/**
 * Имя режем по середине, а не с конца.
 *
 * Версия документа живёт в хвосте: «Бюджет_2026_v3.xlsx» и «Бюджет_2026_v7.xlsx»
 * с обрезанным концом превращаются в два одинаковых «Бюджет_2026_v…», и человек
 * скачивает не тот файл. Начало и хвост с расширением оставляем, пропуск —
 * в середине.
 */
function shortName(name: string, max: number): string {
  if (name.length <= max) return name;
  const tail = Math.max(8, Math.ceil(max / 2));
  const head = Math.max(1, max - tail - 1);
  return `${name.slice(0, head)}…${name.slice(-tail)}`;
}

/**
 * Пока файл едет, видно, что он едет.
 *
 * Стомегабайтная выгрузка по обычному каналу уходит минуту-другую, и без
 * счётчика это неотличимо от зависшей кнопки: человек жмёт ещё раз или уходит.
 * Точных процентов дать не можем — браузер их для таких запросов не сообщает,
 * — поэтому показываем честное: имя, вес и сколько уже идёт.
 */
function Uploading({ name, size }: { name: string; size: number }) {
  const [sec, setSec] = useState(0);

  useEffect(() => {
    setSec(0);
    const id = setInterval(() => setSec((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [name]);

  return (
    <>
      {name} · {humanSize(size)} · {sec} с
      {size > 20 * 1024 * 1024 ? " — большой файл, это займёт время" : ""}
    </>
  );
}

export function Attachments({
  files,
  max,
  onUpload,
  onRemove,
  onDownload,
  onGoogle,
  empty,
  compact = false,
}: {
  files: StoredFile[];
  max: number;
  /** Возвращает текст ошибки или пустую строку. Пусто — файл принят */
  onUpload?: (file: File) => Promise<string>;
  onRemove?: (fileId: string) => Promise<void>;
  onDownload?: (file: StoredFile) => Promise<DownloadResult>;
  /** Положить документ на Google Диск. Возвращает, что сказать человеку */
  onGoogle?: (fileId: string) => Promise<string>;
  empty?: string;
  /** Сжатый вид — для строки над полем ввода */
  compact?: boolean;
}) {
  const picker = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState<{ name: string; size: number } | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [over, setOver] = useState(false);
  const [drive, setDrive] = useState("");
  /**
   * У какого файла спрошено «убрать?».
   *
   * Спрашиваем на месте, в самой строке, а не убираем сразу с паузой на
   * «вернуть»: удаление у нас настоящее — файл уходит с сервера и пропадает
   * у всех агентов задачи разом. Пауза же означала бы, что список на экране
   * и список на сервере какое-то время разные, и всё, что человек за эти
   * секунды сделает — задаст вопрос, уйдёт на другой экран, — врёт ему об
   * исходе. Вопрос на месте защищает от промаха ровно так же и ничего не
   * обещает заранее.
   */
  const [asking, setAsking] = useState<string | null>(null);
  /** Пока запрос идёт — кнопка неактивна, чтобы не убрать дважды */
  const [removing, setRemoving] = useState<string | null>(null);

  async function confirmRemove(f: StoredFile) {
    if (!onRemove) return;
    setRemoving(f.id);
    try {
      await onRemove(f.id);
    } catch {
      // Отказ сервера нельзя проглатывать: человек нажал «Убрать» и считает
      // документ убранным. Молча вернувшийся в список файл он прочитает как
      // сбой интерфейса, а не как «сервер отказал».
      const said = `${f.name}: убрать не удалось, документ на месте`;
      // Повторные попытки не должны копить одну и ту же строку столбиком.
      setErrors((prev) => (prev.includes(said) ? prev : [...prev, said]));
    } finally {
      setRemoving(null);
      setAsking(null);
    }
  }

  async function toDrive(f: StoredFile) {
    if (!onGoogle) return;
    setDrive(`«${f.name}» — отправляю на Диск`);
    try {
      setDrive(`«${f.name}» — ${await onGoogle(f.id)}`);
    } catch {
      setDrive(`«${f.name}» — на Диск не уехало`);
    }
    setTimeout(() => setDrive(""), 8000);
  }

  const full = files.length >= max;

  /**
   * Сказать до вопроса, а не после.
   *
   * Документ, который не поместился в запрос, выглядит в списке точно так же,
   * как прочитанный, и человек узнаёт правду в лучшем случае из служебной
   * строки под ответом — когда разбор уже сделан по половине цифр.
   */
  const fit = requestFit(files);
  // Что именно набралось сверх меры, стоит назвать: тяжёлые PDF и длинный
  // текст человек разгружает по-разному.
  const overWhat =
    fit.overRaw && fit.overText ? "документов" : fit.overRaw ? "PDF и картинок" : "текста";

  async function take(list: FileList | null) {
    if (!list || !onUpload) return;
    const problems: string[] = [];
    // По одному: так видно, какой именно файл не прошёл, и сервер не давится
    // десятком тяжёлых загрузок разом.
    for (const file of Array.from(list)) {
      setBusy({ name: file.name, size: file.size });
      try {
        const err = await onUpload(file);
        if (err) problems.push(err);
      } catch {
        problems.push(`${file.name}: не удалось загрузить`);
      }
    }
    setBusy(null);
    setErrors(problems);
    if (picker.current) picker.current.value = "";
  }

  function drop(e: DragEvent) {
    e.preventDefault();
    setOver(false);
    void take(e.dataTransfer?.files ?? null);
  }

  async function save(f: StoredFile) {
    if (!onDownload) return;
    const res = await onDownload(f);
    if (!res.ok) {
      setErrors([`${f.name}: файл не нашёлся на сервере`]);
      return;
    }
    const bytes = Uint8Array.from(atob(res.base64), (c) => c.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: res.mime }));
    const a = document.createElement("a");
    a.href = url;
    a.download = res.name;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div
      onDragOver={(e) => {
        if (!onUpload) return;
        e.preventDefault();
        setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={drop}
      className={
        over
          ? "rounded-[12px] outline outline-2 outline-offset-4 outline-[color:var(--color-accent)]"
          : ""
      }
    >
      {fit.fits ? null : (
        <p className="ui-support mb-3 text-[color:var(--color-error)]">
          Здесь больше {overWhat}, чем агент читает за один вопрос: часть документов он увидит не
          целиком. Уберите лишние — иначе разбор будет сделан по неполным данным.
        </p>
      )}

      {files.length ? (
        <ul
          className={
            compact
              ? "flex flex-wrap gap-2"
              : "divide-y divide-[color:var(--color-line)] border-y border-[color:var(--color-line)]"
          }
        >
          {files.map((f) => {
            // Имя урезано по середине, поэтому полное — и состояние файла
            // вместе с ним — держим в title: его достаточно навести.
            const hint = [f.name, compact ? fileNote(f) : f.source].filter(Boolean).join(" · ");
            const shown = shortName(f.name, compact ? 24 : 38);

            // Вопрос занимает место самой строки файла: человек смотрит туда,
            // куда только что нажал, и видит там ответ на своё нажатие,
            // а не отдельное окно поверх экрана.
            if (asking === f.id) {
              const wait = removing === f.id;
              return (
                <li
                  key={f.id}
                  role="status"
                  aria-live="polite"
                  className={
                    compact
                      ? "flex items-center gap-2 rounded-[var(--radius-pill)] border border-[color:var(--color-line)] px-2.5 py-1"
                      : "flex flex-wrap items-center gap-3 py-3"
                  }
                >
                  <span
                    title={f.name}
                    className={`min-w-0 truncate ${compact ? "ui-support" : "ui-body"}`}
                  >
                    {compact ? "Убрать?" : `Убрать «${shown}»?`}
                  </span>
                  <button
                    onClick={() => void confirmRemove(f)}
                    disabled={wait}
                    className="tap-44 btn btn-glass ui-meta disabled:opacity-40"
                  >
                    {wait ? "Убираю" : "Убрать"}
                  </button>
                  <button
                    onClick={() => setAsking(null)}
                    disabled={wait}
                    className="tap-44 btn btn-glass ui-meta disabled:opacity-40"
                  >
                    Отмена
                  </button>
                </li>
              );
            }

            return (
              <li
                key={f.id}
                className={
                  compact
                    ? "flex items-center gap-2 rounded-[var(--radius-pill)] border border-[color:var(--color-line)] px-2.5 py-1"
                    : "flex flex-wrap items-baseline justify-between gap-3 py-3"
                }
              >
                <span className="min-w-0">
                  {/* Скачивать нечего, если файл не приехал: у неоткрывшейся
                    ссылки есть только имя и причина.
                    truncate оставлен подстраховкой: на 375 px даже укороченное
                    имя может не влезть в строку. */}
                  {onDownload && f.size > 0 ? (
                    <button
                      onClick={() => void save(f)}
                      title={hint}
                      aria-label={`Скачать ${f.name}`}
                      className={`block max-w-full truncate text-left ${compact ? "ui-support" : "ui-body"} underline decoration-[color:var(--color-line)] underline-offset-4 hover:decoration-current`}
                    >
                      {shown}
                    </button>
                  ) : (
                    <span
                      title={hint}
                      className={`block max-w-full truncate ${compact ? "ui-support" : "ui-body"}`}
                    >
                      {shown}
                    </span>
                  )}
                  {compact ? null : (
                    <span
                      className={`ui-support mt-0.5 block ${f.note ? "text-[color:var(--color-error)]" : "text-muted-foreground"}`}
                    >
                      {fileNote(f)}
                    </span>
                  )}
                </span>
                <span className="flex flex-none items-center gap-2">
                  {/* В сжатом виде строки про файл нет, а знать, что документ
                    не прочитан, важнее всего именно в разговоре: человек
                    ждёт ответа по документу, которого агент не увидел. */}
                  {compact && f.note ? (
                    <span title={fileNote(f)} className="ui-meta text-[color:var(--color-error)]">
                      не прочитан
                    </span>
                  ) : null}
                  {compact ? (
                    <span className="ui-meta text-muted-foreground">{humanSize(f.size)}</span>
                  ) : null}
                  {onGoogle && !compact && f.size > 0 ? (
                    <button
                      onClick={() => void toDrive(f)}
                      title="Положить на Google Диск"
                      className="btn btn-glass ui-meta"
                    >
                      В Google
                    </button>
                  ) : null}
                  {onRemove ? (
                    <button
                      onClick={() => setAsking(f.id)}
                      aria-label={`Убрать ${f.name}`}
                      className="tap-44 ui-body text-muted-foreground transition-colors hover:text-[color:var(--color-error)]"
                    >
                      ✕
                    </button>
                  ) : null}
                </span>
              </li>
            );
          })}
        </ul>
      ) : empty ? (
        <p className="ui-support text-muted-foreground">{empty}</p>
      ) : null}

      {onUpload ? (
        <div className={files.length ? "mt-3" : ""}>
          <input
            ref={picker}
            type="file"
            multiple
            hidden
            onChange={(e) => void take(e.target.files)}
          />
          <div className="flex flex-wrap items-center gap-3">
            <button
              onClick={() => picker.current?.click()}
              disabled={Boolean(busy) || full}
              className="btn btn-glass ui-support disabled:opacity-40"
            >
              {busy ? "Загружаю" : "Прикрепить документ"}
            </button>
            <span className="ui-support text-muted-foreground">
              {busy ? (
                <Uploading name={busy.name} size={busy.size} />
              ) : full ? (
                `Больше ${max} документов сюда не поместится — уберите лишние`
              ) : (
                <>
                  {/* Пределы человеку до дела нет, пока он в них не упёрся:
                      о превышении скажет сама загрузка. В покое — только виды
                      файлов, всё остальное было шумом в три строки. */}
                  {SUPPORTED_HINT}
                  <span className="hidden md:inline"> · или перетащите мышью</span>
                </>
              )}
            </span>
          </div>
        </div>
      ) : null}

      {drive ? <p className="ui-support mt-3 text-muted-foreground">{drive}</p> : null}

      {/* Причина отказа — то, что человеку нужнее всего прочесть на этом
          экране: мелким кеглем её просто не замечают и жмут «прикрепить» ещё раз. */}
      {errors.length ? (
        <ul className="mt-3 space-y-1">
          {errors.map((e, i) => (
            <li key={i} className="ui-body text-[color:var(--color-error)]">
              {e}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
