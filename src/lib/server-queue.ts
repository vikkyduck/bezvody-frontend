/**
 * Очередь к тяжёлым работам. Только сервер.
 *
 * Тридцать человек, нажавших «Отправить» в одну минуту, — это тридцать
 * одновременных запросов к модели. Модель на такое отвечает не отказом в
 * обслуживании, а лимитом: часть запросов возвращается ошибкой, и человек
 * видит «не удалось получить ответ» вместо разбора. Поэтому пропускаем
 * ограниченное число разом, остальные ждут в очереди — ждать дольше лучше,
 * чем получить ошибку.
 *
 * Счётчик живёт в памяти процесса. Процесс один, так что этого достаточно;
 * появится второй — очередь придётся вынести наружу.
 */

export type Gate = {
  /** Пропустить работу через очередь */
  run<T>(task: () => Promise<T>): Promise<T>;
  /** Сколько выполняется прямо сейчас */
  readonly busy: number;
  /** Сколько ждёт очереди */
  readonly queued: number;
  /** Очередь переполнена: дальше честнее отказать, чем держать человека час */
  readonly full: boolean;
};

function createGate(limit: number, maxQueue: number): Gate {
  let active = 0;
  const waiting: (() => void)[] = [];

  return {
    get busy() {
      return active;
    },
    get queued() {
      return waiting.length;
    },
    get full() {
      return waiting.length >= maxQueue;
    },
    async run<T>(task: () => Promise<T>): Promise<T> {
      if (active >= limit) await new Promise<void>((resolve) => waiting.push(resolve));
      else active++;

      try {
        return await task();
      } finally {
        // Слот передаём следующему из рук в руки: если сначала уменьшить
        // счётчик, в освободившееся место успеет влезть новый запрос, а
        // тот, кто ждал дольше всех, останется ждать дальше.
        const next = waiting.shift();
        if (next) next();
        else active--;
      }
    },
  };
}

const num = (name: string, fallback: number) => {
  const raw = Number(process.env[name]);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : fallback;
};

/**
 * Сколько разговоров с моделью идёт одновременно.
 * Поднимается переменной среды без правки кода: BV_MODEL_CONCURRENCY.
 */
export const modelGate = createGate(num("BV_MODEL_CONCURRENCY", 6), num("BV_MODEL_QUEUE", 40));

/** Разбор загруженного документа — работа памятью и процессором, не сетью. */
export const fileGate = createGate(num("BV_FILE_CONCURRENCY", 3), num("BV_FILE_QUEUE", 30));

/**
 * Один человек — один вопрос за раз.
 *
 * Двойной щелчок по «Отправить» или открытые в двух вкладках окна не должны
 * занимать очередь дважды: второй вопрос вежливо отправляем подождать.
 */
const inFlight = new Set<string>();

export const isAsking = (personId: string) => inFlight.has(personId);
export const startAsking = (personId: string) => inFlight.add(personId);
export const doneAsking = (personId: string) => inFlight.delete(personId);
