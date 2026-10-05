/**
 * Вызов модели. Только сервер.
 *
 * Ходим через транзит на DO-дроплете: с РФ-адреса api.anthropic.com отвечает
 * 403. Ключ живёт на этом сервере и в браузер не попадает.
 *
 * Стримим и берём финальное сообщение: 6-pager — длинный ответ, и обычный
 * запрос успел бы упереться в таймаут раньше, чем модель договорит.
 */
import type Anthropic from "@anthropic-ai/sdk";

import {
  CHARS_PER_TOKEN,
  MAX_DOC_PARTS,
  MAX_REQUEST_TOKENS,
  PART_CHARS,
  type Attachment,
} from "./documents";
import type { StoredMessage } from "./conversations";
import { providerLabel, type Provider } from "./providers";
import { isBosAgent } from "./bos";
import { anthropicText } from "./research-sources";

/** Локальный вход в транзит — тот же, через который ходит Kotu. */
const BASE_URL = process.env["ANTHROPIC_BASE_URL"]?.trim() || "http://127.0.0.1:8444/anthropic";

export type AskResult =
  | { ok: true; text: string }
  | { ok: false; reason: "no-key" | "not-configured" | "busy" | "failed"; detail?: string };

/** Картинки модель принимает не любые — тип проверяется строго. */
const imageTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"] as const;
type ImageType = (typeof imageTypes)[number];
const asImageType = (mime: string): ImageType | null =>
  (imageTypes as readonly string[]).includes(mime) ? (mime as ImageType) : null;

/**
 * Вопрос вместе с документами.
 *
 * PDF и картинки уезжают как есть — модель читает их сама, с таблицами и
 * подписями под графиками. Всё остальное приезжает распознанным текстом,
 * обёрнутым в рамку с именем файла: без неё модель не понимает, где кончился
 * один документ и начался другой.
 *
 * Документы идут перед вопросом, а не после: так их видно раньше, чем задачу.
 */
function contentFor(question: string, attachments: Attachment[]) {
  if (!attachments.length) return question;

  const blocks: Anthropic.ContentBlockParam[] = [
    {
      type: "text",
      text:
        "К работе приложены документы. Опирайтесь на них как на источник: " +
        "что взято оттуда — помечайте, чего в них нет — не выдумывайте.",
    },
  ];

  for (const a of attachments) {
    const whose = a.origin === "agent" ? "документ агента" : "документ от клиента";
    if (a.base64 && a.kind === "pdf") {
      blocks.push({
        type: "document",
        title: a.title,
        context: whose,
        source: { type: "base64", media_type: "application/pdf", data: a.base64 },
      });
      continue;
    }
    const imageType = a.base64 ? asImageType(a.mime) : null;
    if (imageType) {
      blocks.push({ type: "text", text: `Изображение «${a.title}» (${whose}):` });
      blocks.push({
        type: "image",
        source: { type: "base64", media_type: imageType, data: a.base64 },
      });
      continue;
    }
    blocks.push({
      type: "text",
      text: `<документ имя="${a.title}" чей="${whose}">\n${a.text}\n</документ>`,
    });
  }

  // Кеш на последнем документе: в разговоре из пяти вопросов материалы иначе
  // оплачиваются пять раз. Ставим только когда есть что кешировать — на
  // коротком куске кеш всё равно не заводится.
  const weight = attachments.reduce((n, a) => n + a.text.length + a.base64.length / 4, 0);
  const last = blocks[blocks.length - 1];
  if (weight > 8000 && last && last.type !== "thinking" && last.type !== "redacted_thinking") {
    (last as { cache_control?: { type: "ephemeral" } }).cache_control = { type: "ephemeral" };
  }

  blocks.push({ type: "text", text: question });
  return blocks;
}

/**
 * Запрос целиком: история переписки плюс вопрос с документами.
 *
 * Собран отдельной функцией не для красоты: этот же набор уходит в счётчик
 * токенов. Считать одно, а отправлять другое — верный способ промахнуться мимо
 * окна ровно на ту разницу, которую забыли учесть.
 */
function messagesFor(history: StoredMessage[], question: string, attachments: Attachment[]) {
  return [
    ...history.map((m) => ({
      role: m.from === "user" ? ("user" as const) : ("assistant" as const),
      content: m.text,
    })),
    { role: "user" as const, content: contentFor(question, attachments) },
  ];
}

// ── Влезает ли вопрос в окно модели ───────────────────────────────────────────

/** Что стало с документами, пока их подгоняли под окно. */
export type FitResult = {
  /** Что в итоге уедет к агенту: часть документов могла стать выжимками */
  attachments: Attachment[];
  /** Прочитаны по частям — человеку об этом надо сказать, это дольше обычного */
  inParts: string[];
  /** Не влезли даже по частям и уехали куском — об этом тоже надо сказать */
  trimmed: string[];
};

/**
 * Прикидка запроса в токенах — по знакам, без сети.
 *
 * Мера грубая и нужна только для одного: решить, стоит ли идти к настоящему
 * счётчику. Ошибаться она должна вверх — тогда мы лишний раз сходим и уточним,
 * а не отправим вслепую то, что не влезет.
 */
function roughTokens(opts: {
  systemPrompt: string;
  history: StoredMessage[];
  question: string;
  attachments: Attachment[];
}): number {
  let chars = opts.systemPrompt.length + opts.question.length;
  for (const m of opts.history) chars += m.text.length;
  for (const a of opts.attachments) chars += a.text.length;
  let tokens = Math.ceil(chars / CHARS_PER_TOKEN);
  for (const a of opts.attachments) {
    // PDF и картинки: base64 длиннее самого файла на треть, а страница текста
    // в PDF — это примерно тридцать байт на токен. Считаем щедро: сканы дадут
    // меньше, и это ровно та сторона, в которую ошибиться не жалко.
    if (a.base64) tokens += Math.ceil((a.base64.length * 3) / 4 / 32);
  }
  return tokens;
}

/**
 * Разрезать документ на части.
 *
 * Режем по концу абзаца, а не ровно по счёту знаков: таблица, разорванная
 * посреди строки, теряет заголовок колонок, и вторая часть читается как
 * столбик чисел без смысла. Абзацев не нашлось — режем как есть, это всё
 * равно лучше, чем не прочесть вовсе.
 *
 * Частей не больше MAX_DOC_PARTS. Хвост длиннее этого мы не берём и об этом
 * честно говорим — молчаливая потеря хвоста и есть та самая ошибка, ради
 * которой всё это писалось.
 */
function chunksOf(text: string): string[] {
  const out: string[] = [];
  let at = 0;
  while (at < text.length && out.length < MAX_DOC_PARTS) {
    // Размер считаем от остатка на каждом шаге, а не один раз на весь документ:
    // если предыдущий кусок ужался до конца абзаца, следующие подберут разницу
    // и хвост не останется за бортом из-за накопленных отступов.
    const size = Math.max(PART_CHARS, Math.ceil((text.length - at) / (MAX_DOC_PARTS - out.length)));
    let end = Math.min(text.length, at + size);
    if (end < text.length) {
      const back = text.lastIndexOf("\n\n", end);
      if (back > at + Math.floor(size * 0.9)) end = back;
    }
    out.push(text.slice(at, end));
    at = end;
  }
  return out;
}

/**
 * Прочитать большой документ по частям и вернуть выжимки.
 *
 * Указание Anthropic на этот счёт простое: молча обрезать вход нельзя. Но
 * обрезать с предупреждением — тоже полумера: человек всё равно унесёт на совет
 * директоров разбор по куску отчёта. Поэтому документ читается в несколько
 * заходов, и в основной вопрос вместо вырезанного текста едут выжимки — они
 * кратно короче и держат цифры.
 *
 * Части идут по очереди и через ту же очередь к модели, что и обычные вопросы.
 * Выпущенные разом, шесть частей заняли бы все слоты, и остальные клиенты
 * встали бы ждать один тяжёлый отчёт.
 */
async function readInParts(opts: {
  client: Anthropic;
  model: string;
  title: string;
  text: string;
  question: string;
  label: string;
  /** Чтение по частям — отдельные платные вызовы, их расход тоже чей-то */
  who?: import("./server-usage").Who;
}): Promise<{ text: string; whole: boolean }> {
  const chunks = chunksOf(opts.text);
  const read = chunks.reduce((n, c) => n + c.length, 0);
  const whole = read >= opts.text.length;

  const { modelGate } = await import("./server-queue");
  const pieces: string[] = [];
  let got = 0;

  for (let i = 0; i < chunks.length; i++) {
    const started = Date.now();
    try {
      const piece = await modelGate.run(async () => {
        const stream = opts.client.messages.stream({
          model: opts.model,
          max_tokens: 8000,
          system: [
            {
              type: "text",
              text:
                "Вы читаете большой документ по частям. Ваше дело сейчас — не разбор " +
                "и не выводы, а выписка: всё из доставшейся вам части, что относится " +
                "к вопросу человека. Ничего не додумывайте и не добавляйте из общих знаний.",
            },
          ],
          // Выжимка — работа на внимательность, а не на рассуждение. Низкое
          // усилие тут быстрее и дешевле, а переписать цифру из таблицы оно
          // умеет ничуть не хуже высокого.
          output_config: { effort: "low" },
          messages: [
            {
              role: "user" as const,
              content:
                `Вопрос человека:\n${opts.question}\n\n` +
                `Ниже часть ${i + 1} из ${chunks.length} документа «${opts.title}». ` +
                "Выпишите из неё всё, что относится к вопросу: факты, цифры и суммы — " +
                "с указанием, откуда они взяты в этой части (раздел, таблица, строка), — " +
                "даты, имена, условия, а также противоречия и расхождения, если они видны. " +
                "Цифры переписывайте точно, не округляйте. Чего в этой части нет — так и " +
                "напишите, не восполняйте по памяти. Если по вопросу здесь нет ничего, " +
                "ответьте одной строкой: «В этой части ничего по вопросу нет».\n\n" +
                `<часть номер="${i + 1}" из="${chunks.length}">\n${chunks[i]}\n</часть>`,
            },
          ],
        });
        const final = await stream.finalMessage();
        // Каждая часть — отдельный оплаченный запрос. Раньше они не попадали
        // ни в один счёт: тяжёлый отчёт мог стоить дороже самого вопроса,
        // и этого не было видно нигде.
        const u = final.usage;
        await noteSpend({
          ...(opts.who ? { who: { ...opts.who, passId: "чтение по частям" } } : {}),
          provider: "anthropic",
          model: opts.model,
          seconds: 0,
          tokens: {
            input: u.input_tokens ?? 0,
            cacheRead: u.cache_read_input_tokens ?? 0,
            cacheWrite: u.cache_creation_input_tokens ?? 0,
            output: u.output_tokens ?? 0,
          },
        });
        return final.content
          .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
          .map((b) => b.text)
          .join("\n")
          .trim();
      });

      console.log(
        `[агент] ${opts.label} · «${opts.title}» часть ${i + 1} из ${chunks.length} · ` +
          `${Math.round((Date.now() - started) / 1000)}с`,
      );
      pieces.push(
        piece
          ? `<выжимка часть="${i + 1}" из="${chunks.length}">\n${piece}\n</выжимка>`
          : `<выжимка часть="${i + 1}" из="${chunks.length}">\nЧасть прочитана, ничего по вопросу в ней не нашлось.\n</выжимка>`,
      );
      if (piece) got++;
    } catch (err) {
      // Сорвалась одна часть — остальные всё равно читаем: пять частей из
      // шести лучше, чем ничего. А в выжимке об этом честно пишем, чтобы
      // агент не принял пробел за отсутствие данных.
      const detail = err instanceof Error ? err.message.slice(0, 120) : "неизвестная ошибка";
      console.warn(
        `[агент] ${opts.label} · «${opts.title}» часть ${i + 1} не прочиталась: ${detail}`,
      );
      pieces.push(
        `<выжимка часть="${i + 1}" из="${chunks.length}">\nЭту часть прочитать не удалось — что в ней, неизвестно.\n</выжимка>`,
      );
    }
  }

  // Не прочиталась ни одна часть — значит связи нет вовсе, и выжимки нет.
  // Пусть вызывающий решает по-старому: обрезать и предупредить.
  if (!got) return { text: "", whole: false };

  const head =
    (chunks.length > 1
      ? `Документ «${opts.title}» целиком в один вопрос не помещается, поэтому прочитан ` +
        `по частям — их ${chunks.length}. Ниже не сам документ, а выжимки из каждой ` +
        "части: только то, что относится к вопросу."
      : `Документ «${opts.title}» целиком в один вопрос не помещается. Ниже не сам ` +
        "документ, а выжимка из него: только то, что относится к вопросу.") +
    (whole
      ? ""
      : ` Документ длиннее, чем можно прочесть за один вопрос: прочитаны первые ${chunks.length} частей, конец документа остался непрочитанным — скажите об этом клиенту.`);

  return { text: `${head}\n\n${pieces.join("\n\n")}`, whole };
}

/**
 * Подогнать вопрос под окно модели, ничего не потеряв.
 *
 * Порядок такой:
 *   1. Прикидка по знакам. Заведомо влезает — уходим сразу, счётчик не трогаем:
 *      он сетевой, и гонять его на вопрос из трёх строк незачем.
 *   2. Настоящий счётчик токенов. Знаки — плохая мера: выгрузка из 1С даёт
 *      вдвое больше токенов, чем та же страница прозы, и по знакам мы либо
 *      режем целое, либо отправляем то, что не влезет.
 *   3. Влезает — отправляем целиком, никакой резки.
 *   4. Не влезает — самые толстые документы читаем по частям и подставляем
 *      выжимки. Резать остаётся только там, где и это не сработало.
 *
 * Вызывать эту работу нужно ДО очереди к модели, а не внутри неё: части идут
 * через ту же очередь, и запрос, который держит слот и ждёт слота, не дождётся
 * его никогда.
 */
export async function fitForModel(opts: {
  /** Кто спрашивает — чтение по частям тоже стоит денег */
  who?: import("./server-usage").Who;
  systemPrompt: string;
  model: string;
  history: StoredMessage[];
  question: string;
  attachments: Attachment[];
  agentId?: string;
  label?: string;
}): Promise<FitResult> {
  const label = opts.label ?? opts.model;
  const plain: FitResult = { attachments: opts.attachments, inParts: [], trimmed: [] };
  if (!opts.attachments.length) return plain;

  const rough = roughTokens(opts);
  // Порог — половина бюджета, и половина не от осторожности вообще, а по счёту:
  // знаковая прикидка занижает самое большее вдвое (на сплошных цифрах знаков
  // на токен вдвое меньше, чем на прозе). Занизив вдвое от половины, мы всё
  // равно останемся в окне — значит, ниже этой черты счётчик не нужен вовсе.
  if (rough <= MAX_REQUEST_TOKENS * 0.5) return plain;

  const { readApiKey } = await import("./server-data");
  const apiKey = await readApiKey("anthropic", opts.agentId);
  // Ключа нет — считать нечем и спрашивать некого. Про ключ человеку скажет
  // askAgent, а мы просто не мешаем.
  if (!apiKey) return plain;

  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic({ apiKey, baseURL: BASE_URL, maxRetries: 2 });

  const attachments = [...opts.attachments];
  let tokens = rough;
  let counted = false;
  try {
    const count = await client.messages.countTokens({
      model: opts.model,
      system: [{ type: "text", text: opts.systemPrompt }],
      messages: messagesFor(opts.history, opts.question, attachments),
    });
    tokens = count.input_tokens;
    counted = true;
  } catch (err) {
    // Счётчик ходит по сети через тот же транзит, что и модель, а сеть
    // подводит. Ронять из-за этого вопрос нельзя: работаем по знаковой
    // прикидке — она осторожная и скорее преувеличит, чем занизит.
    const detail = err instanceof Error ? err.message.slice(0, 120) : "неизвестная ошибка";
    console.warn(`[агент] ${label} · счётчик токенов не ответил (${detail}) — считаем по знакам`);
  }

  console.log(
    `[агент] ${label} · в запросе ${tokens} токенов из ${MAX_REQUEST_TOKENS}` +
      (counted ? "" : " (оценка по знакам, счётчик молчит)"),
  );
  if (tokens <= MAX_REQUEST_TOKENS) return plain;

  // Сколько токенов приходится на знак — не вообще, а на этих самых документах:
  // у выгрузки цифрами их вдвое больше, чем у прозы того же объёма. Зная это,
  // дальше считаем экономию сами и не бегаем к счётчику после каждой выжимки.
  //
  // Считаем только по тексту: PDF в знаках не меряется, и наша прикидка по его
  // байтам перекосила бы всё. Границы поставлены оттуда же: меньше 0,27 токена
  // на знак не выходит даже у гладкой прозы, больше 1 — даже у сплошных цифр,
  // и если промах по PDF выкинет счёт за эти рамки, лучше взять край.
  const textChars =
    opts.systemPrompt.length +
    opts.question.length +
    opts.history.reduce((n, m) => n + m.text.length, 0) +
    attachments.reduce((n, a) => n + a.text.length, 0);
  const rawRough = rough - Math.ceil(textChars / CHARS_PER_TOKEN);
  const perChar =
    counted && textChars > 0
      ? Math.min(1, Math.max(0.27, (tokens - rawRough) / textChars))
      : 1 / CHARS_PER_TOKEN;
  const asTokens = (chars: number) => Math.ceil(chars * perChar);

  // Сначала фактура клиента, потом документы агента: методика и шаблон — это
  // инструкция, и пересказ своими словами её только портит. Внутри — от самого
  // толстого: один большой документ отдаёт больше, чем пять мелких.
  const heavy = attachments
    .map((a, at) => ({ a, at }))
    .filter((x) => !x.a.base64 && x.a.text.length >= PART_CHARS / 2)
    .sort((l, r) =>
      l.a.origin !== r.a.origin
        ? l.a.origin === "person"
          ? -1
          : 1
        : r.a.text.length - l.a.text.length,
    );

  const inParts: string[] = [];
  const trimmed: string[] = [];

  for (const { a, at } of heavy) {
    if (tokens <= MAX_REQUEST_TOKENS) break;

    const digest = await readInParts({
      client,
      model: opts.model,
      title: a.title,
      text: a.text,
      question: opts.question,
      label,
      ...(opts.who ? { who: opts.who } : {}),
    });

    // Выжимка должна быть короче исходника — иначе она не выжимка, и менять
    // на неё документ незачем.
    if (digest.text && digest.text.length < a.text.length) {
      tokens -= asTokens(a.text.length - digest.text.length);
      attachments[at] = { ...a, text: digest.text };
      inParts.push(a.title);
      // Хвост длиннее шести частей всё-таки остался непрочитанным — для
      // человека это ровно та же новость, что и обрезка.
      if (!digest.whole) trimmed.push(a.title);
      continue;
    }

    // Выжимка не вышла вовсе — связи нет. Тогда работаем как раньше: режем и
    // говорим об этом, но не молчим.
    const over = tokens - MAX_REQUEST_TOKENS;
    const keep = Math.max(0, a.text.length - Math.ceil(over / perChar));
    tokens -= asTokens(a.text.length - keep);
    attachments[at] = {
      ...a,
      text: `${a.text.slice(0, keep)}\n\n[документ обрезан: целиком он не помещается в запрос]`,
    };
    trimmed.push(a.title);
  }

  if (tokens > MAX_REQUEST_TOKENS) {
    // Резать больше нечего: остались PDF, история переписки и мелочь. Пусть
    // уходит как есть — модель ответит ошибкой про размер, и это честнее, чем
    // выкинуть документ втихую.
    console.warn(`[агент] ${label} · после чтения по частям всё ещё ${tokens} токенов`);
  }

  return { attachments, inParts, trimmed };
}

/**
 * Записать расход одного вызова.
 *
 * Считаем деньги здесь же, по цене на момент вызова: цены и курс меняются, и
 * пересчитывать прошлое по сегодняшнему курсу — значит каждый месяц видеть
 * новые цифры за один и тот же март.
 */
export async function noteSpend(opts: {
  who?: import("./server-usage").Who;
  provider: Provider;
  model: string;
  seconds: number;
  tokens: import("./prices").Tokens;
}): Promise<void> {
  // Без «кто» строка бесполезна: расход не к кому отнести. Так бывает у
  // проверки связи из админки — её в счёт клиенту не пишем.
  if (!opts.who) return;
  const { recordUsage } = await import("./server-usage");
  const { costOf } = await import("./prices");
  const { readPriceBook } = await import("./server-prices");
  const book = await readPriceBook();
  const money = costOf(opts.model, opts.tokens, book);

  await recordUsage({
    at: new Date().toISOString(),
    personId: opts.who.personId,
    personName: opts.who.personName,
    agentId: opts.who.agentId,
    passId: opts.who.passId ?? "",
    roleId: opts.who.roleId ?? "",
    provider: opts.provider,
    model: opts.model,
    input: opts.tokens.input,
    cacheRead: opts.tokens.cacheRead,
    cacheWrite: opts.tokens.cacheWrite,
    output: opts.tokens.output,
    seconds: opts.seconds,
    rub: money?.rub ?? 0,
    usd: money?.usd ?? 0,
    rate: money?.rate ?? book.usdRub,
    unpriced: money === null,
  });
}

export async function askAgent(opts: {
  systemPrompt: string;
  model: string;
  history: StoredMessage[];
  question: string;
  attachments?: Attachment[];
  /** Чем думает агент. По умолчанию Claude — так было до появления выбора */
  provider?: Provider;
  /** ID агента, для per-agent ключа провайдера */
  agentId?: string;
  /** Для журнала: кто и с каким агентом говорит */
  label?: string;
  /** Кто спрашивает — по этому пишется расход в деньгах */
  who?: import("./server-usage").Who;
}): Promise<AskResult> {
  const provider: Provider = opts.provider ?? "anthropic";
  const { readApiKey } = await import("./server-data");
  const apiKey = await readApiKey(provider, opts.agentId);
  // Ключ свой у каждого провайдера — человеку важно знать, какого не хватает.
  if (!apiKey) return { ok: false, reason: "no-key", detail: providerLabel(provider) };
  if (!opts.systemPrompt.trim()) return { ok: false, reason: "not-configured" };

  // GPT и Gemini живут в отдельном модуле: у них другая форма запроса и
  // другая работа с документами, и мешать это с кодом Claude незачем.
  if (provider !== "anthropic") {
    const { askAlt } = await import("./server-llm-alt");
    const { agentId: _agentId, provider: _provider, ...rest } = opts;
    return askAlt(
      provider,
      {
        ...rest,
        webSearch: isBosAgent(opts.agentId ?? ""),
        maxSearches: opts.agentId === "kat" ? 5 : 30,
      },
      apiKey,
    );
  }

  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  // Повторы — не роскошь: при тридцати одновременных разговорах модель
  // отвечает «слишком часто», и это лечится паузой, а не сообщением об
  // ошибке. Пакет сам выдерживает паузу, которую просит сервер.
  const client = new Anthropic({ apiKey, baseURL: BASE_URL, maxRetries: 4 });

  // История разговора: платформа не помнит контекст за модель — он передаётся
  // целиком каждый раз, иначе агент забудет, о чём шла речь двумя репликами выше.
  const messages: Anthropic.MessageParam[] = messagesFor(
    opts.history,
    opts.question,
    opts.attachments ?? [],
  );

  const started = Date.now();
  try {
    const research = isBosAgent(opts.agentId ?? "");
    const request = {
      model: opts.model,
      max_tokens: 32000,
      // Инструкция агента — двадцать пять тысяч знаков, и она одна и та же у
      // всех клиентов этого агента. Помечаем её как кешируемую: модель хранит
      // разобранный кусок и не пересчитывает его на каждый вопрос. Это и
      // дешевле в разы, и заметно быстрее на первом токене — а при тридцати
      // работающих одновременно ещё и снимает нагрузку с лимита по токенам.
      system: [{ type: "text", text: opts.systemPrompt, cache_control: { type: "ephemeral" } }],
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
      messages,
      ...(research
        ? {
            tools: [
              {
                type: "web_search_20250305" as const,
                name: "web_search" as const,
                max_uses: opts.agentId === "kat" ? 5 : 30,
              },
            ],
          }
        : {}),
    } satisfies Omit<Anthropic.MessageCreateParamsStreaming, "stream">;
    let final = await client.messages.stream(request).finalMessage();
    const outputs = [...final.content];
    const totals = { ...final.usage };
    // Server tools can pause after several searches. Resume the same turn, retaining all tool blocks.
    for (let turn = 0; final.stop_reason === "pause_turn" && turn < 5; turn++) {
      messages.push({ role: "assistant", content: final.content });
      final = await client.messages.stream({ ...request, messages }).finalMessage();
      outputs.push(...final.content);
      totals.input_tokens += final.usage.input_tokens;
      totals.output_tokens += final.usage.output_tokens;
      totals.cache_read_input_tokens =
        (totals.cache_read_input_tokens ?? 0) + (final.usage.cache_read_input_tokens ?? 0);
      totals.cache_creation_input_tokens =
        (totals.cache_creation_input_tokens ?? 0) + (final.usage.cache_creation_input_tokens ?? 0);
    }

    // Строка в журнал сервера: видно, сколько шёл ответ, сколько стоил
    // и сработал ли кеш инструкции.
    const u = totals;
    // Расход в деньгах — строкой в журнал на диске: по нему потом видно, во
    // что обошёлся каждый участник и каждый агент.
    await noteSpend({
      ...(opts.who ? { who: opts.who } : {}),
      provider: "anthropic",
      model: opts.model,
      seconds: Math.round((Date.now() - started) / 1000),
      tokens: {
        input: u.input_tokens ?? 0,
        cacheRead: u.cache_read_input_tokens ?? 0,
        cacheWrite: u.cache_creation_input_tokens ?? 0,
        output: u.output_tokens ?? 0,
      },
    });
    console.log(
      `[агент] ${opts.label ?? opts.model} · ${Math.round((Date.now() - started) / 1000)}с · ` +
        `вход ${u.input_tokens} · из кеша ${u.cache_read_input_tokens ?? 0} · записано в кеш ${u.cache_creation_input_tokens ?? 0} · выход ${u.output_tokens}`,
    );

    if (final.stop_reason === "refusal") {
      return { ok: false, reason: "failed", detail: "модель отказалась отвечать на этот запрос" };
    }

    if (research && (final.stop_reason === "pause_turn" || final.stop_reason === "max_tokens")) {
      return {
        ok: false,
        reason: "failed",
        detail:
          "Исследование не завершено: уменьшите число факторов или игроков и повторите запрос",
      };
    }
    const text = anthropicText(outputs);

    return text
      ? { ok: true, text }
      : { ok: false, reason: "failed", detail: "модель вернула пустой ответ" };
  } catch (err) {
    // Наружу отдаём короткую причину: подробности с ключами и адресами
    // остаются в журнале сервера, а не на экране клиента.
    const status = (err as { status?: number } | null)?.status;
    const detail = err instanceof Error ? err.message.slice(0, 200) : "неизвестная ошибка";
    const secs = Math.round((Date.now() - started) / 1000);

    // 429 — «слишком часто», 529 — «модель перегружена». Это не поломка,
    // а очередь: человеку надо сказать именно это, иначе он решит, что сломалось.
    if (status === 429 || status === 529) {
      console.warn(
        `[агент] ${opts.label ?? opts.model} · ${secs}с · модель отвечает «занято» (${status})`,
      );
      return { ok: false, reason: "busy" };
    }

    console.error(`[агент] ${opts.label ?? opts.model} · ${secs}с · сорвалось: ${detail}`);
    return { ok: false, reason: "failed", detail };
  }
}
