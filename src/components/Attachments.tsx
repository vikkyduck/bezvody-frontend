import { useEffect, useRef, useState, type DragEvent } from "react";

import {
  MAX_FILE_BYTES,
  SUPPORTED_HINT,
  fileNote,
  humanSize,
  type StoredFile,
} from "@/lib/documents";

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
      {files.length ? (
        <ul
          className={
            compact
              ? "flex flex-wrap gap-2"
              : "divide-y divide-[color:var(--color-line)] border-y border-[color:var(--color-line)]"
          }
        >
          {files.map((f) => (
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
                    ссылки есть только имя и причина. */}
                {onDownload && f.size > 0 ? (
                  <button
                    onClick={() => void save(f)}
                    title={f.source ? `Скачать · ${f.source}` : "Скачать"}
                    className={`block max-w-[420px] truncate text-left ${compact ? "text-[12px]" : "text-[14px]"} underline decoration-[color:var(--color-line)] underline-offset-4 hover:decoration-current`}
                  >
                    {f.name}
                  </button>
                ) : (
                  <span
                    title={f.source}
                    className={`block max-w-[420px] truncate ${compact ? "text-[12px]" : "text-[14px]"}`}
                  >
                    {f.name}
                  </span>
                )}
                {compact ? null : (
                  <span
                    className={`mt-0.5 block text-[12px] ${f.note ? "text-[color:var(--color-error)]" : "text-muted-foreground"}`}
                  >
                    {fileNote(f)}
                  </span>
                )}
              </span>
              <span className="flex flex-none items-center gap-2">
                {compact ? (
                  <span className="text-[11px] text-muted-foreground">{humanSize(f.size)}</span>
                ) : null}
                {onGoogle && !compact && f.size > 0 ? (
                  <button
                    onClick={() => void toDrive(f)}
                    title="Положить на Google Диск"
                    className="btn btn-glass text-[11px]"
                  >
                    В Google
                  </button>
                ) : null}
                {onRemove ? (
                  <button
                    onClick={() => void onRemove(f.id)}
                    aria-label={`Убрать ${f.name}`}
                    className="text-[12px] text-muted-foreground transition-colors hover:text-[color:var(--color-error)]"
                  >
                    ✕
                  </button>
                ) : null}
              </span>
            </li>
          ))}
        </ul>
      ) : empty ? (
        <p className="text-[13px] text-muted-foreground">{empty}</p>
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
              className="btn btn-glass text-[12px] disabled:opacity-40"
            >
              {busy ? "Загружаю" : "Прикрепить документ"}
            </button>
            <span className="text-[11.5px] text-muted-foreground">
              {busy ? (
                <Uploading name={busy.name} size={busy.size} />
              ) : full ? (
                `Больше ${max} документов сюда не поместится — уберите лишние`
              ) : (
                `${SUPPORTED_HINT} · до ${humanSize(MAX_FILE_BYTES)} · можно перетащить мышью или прислать ссылкой в сообщении`
              )}
            </span>
          </div>
        </div>
      ) : null}

      {drive ? <p className="mt-3 text-[12px] text-muted-foreground">{drive}</p> : null}

      {errors.length ? (
        <ul className="mt-3 space-y-1">
          {errors.map((e, i) => (
            <li key={i} className="text-[12px] text-[color:var(--color-error)]">
              {e}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
