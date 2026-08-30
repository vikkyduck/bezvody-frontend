/**
 * Вызов чужих моделей — GPT и Gemini. Только сервер.
 *
 * Идём через тот же транзит на DO-дроплете, что и Claude: с РФ-адреса
 * api.openai.com и generativelanguage.googleapis.com отвечают 403.
 * Маршруты на транзите уже есть — /v1/* уходит в OpenAI, /gemini/* в Google.
 *
 * Пакетов SDK намеренно не ставим: у обоих провайдеров нужен один POST,
 * а зависимость пришлось бы тянуть в бандл и обновлять.
 *
 * Документы. Claude читает PDF своими глазами, эти двое — по-разному:
 * Gemini принимает PDF вложением, OpenAI в этой форме запроса — нет,
 * поэтому PDF мы разбираем у себя (unpdf) и отдаём текстом. Об этом честно
 * сказано в админке: на сканах без текстового слоя GPT увидит меньше.
 */
import type { StoredMessage } from "./conversations";
import type { Attachment } from "./documents";
import type { AskResult } from "./server-llm";

/** Корень транзита. По умолчанию — тот же, через который ходит Claude. */
const TRANSIT =
  process.env["AI_TRANSIT_URL"]?.trim() ||
  (process.env["ANTHROPIC_BASE_URL"]?.trim() || "http://127.0.0.1:8444/anthropic").replace(
    /\/anthropic\/?$/,
    "",
  ) ||
  "http://127.0.0.1:8444";

const OPENAI_URL = process.env["OPENAI_BASE_URL"]?.trim() || `${TRANSIT}/v1`;
const GEMINI_URL = process.env["GEMINI_BASE_URL"]?.trim() || `${TRANSIT}/gemini/v1beta`;

/** Десять минут: разбор на шесть страниц пишется минутами, а не секундами. */
const TIMEOUT_MS = 600_000;

export type AskOpts = {
  systemPrompt: string;
  model: string;
  history: StoredMessage[];
  question: string;
  attachments?: Attachment[];
  label?: string;
  /** Кто спрашивает — по этому пишется расход в деньгах */
  who?: import("./server-usage").Who;
};

const imageTypes = ["image/jpeg", "image/png", "image/gif", "image/webp"];

/** Шапка над документами — та же, что у Claude: источник, а не украшение. */
const DOCS_INTRO =
  "К работе приложены документы. Опирайтесь на них как на источник: " +
  "что взято оттуда — помечайте, чего в них нет — не выдумывайте.";

const framed = (a: Attachment, whose: string) =>
  `<документ имя="${a.title}" чей="${whose}">\n${a.text}\n</документ>`;

const whoseOf = (a: Attachment) =>
  a.origin === "agent" ? "документ агента" : "документ от клиента";

/** PDF у себя: у GPT в этой форме запроса вложением его не передать. */
async function pdfToText(a: Attachment): Promise<string> {
  try {
    const { extractText, getDocumentProxy } = await import("unpdf");
    const pdf = await getDocumentProxy(new Uint8Array(Buffer.from(a.base64, "base64")));
    const out = await extractText(pdf, { mergePages: true });
    return String(out.text ?? "").trim();
  } catch {
    return "";
  }
}

// ── GPT ───────────────────────────────────────────────────────────────────────

type OpenAIPart =
  { type: "text"; text: string } | { type: "image_url"; image_url: { url: string } };

async function openaiContent(
  question: string,
  attachments: Attachment[],
): Promise<string | OpenAIPart[]> {
  if (!attachments.length) return question;

  const parts: OpenAIPart[] = [{ type: "text", text: DOCS_INTRO }];
  for (const a of attachments) {
    const whose = whoseOf(a);
    if (a.base64 && imageTypes.includes(a.mime)) {
      parts.push({ type: "text", text: `Изображение «${a.title}» (${whose}):` });
      parts.push({ type: "image_url", image_url: { url: `data:${a.mime};base64,${a.base64}` } });
      continue;
    }
    if (a.base64 && a.kind === "pdf" && !a.text) {
      const text = await pdfToText(a);
      parts.push({
        type: "text",
        text: text
          ? framed({ ...a, text }, whose)
          : `<документ имя="${a.title}" чей="${whose}">[PDF не удалось прочитать текстом — вероятно, скан. Скажите об этом автору, а не додумывайте содержание]</документ>`,
      });
      continue;
    }
    parts.push({ type: "text", text: framed(a, whose) });
  }
  parts.push({ type: "text", text: question });
  return parts;
}

async function askOpenAI(opts: AskOpts, apiKey: string, started: number): Promise<AskResult> {
  const messages: Array<{ role: string; content: unknown }> = [
    { role: "system", content: opts.systemPrompt },
    ...opts.history.map((m) => ({
      role: m.from === "user" ? "user" : "assistant",
      content: m.text,
    })),
    { role: "user", content: await openaiContent(opts.question, opts.attachments ?? []) },
  ];

  // Ни температуры, ни потолка токенов: рассуждающие модели ругаются на одни
  // параметры, обычные — на другие, а нам ни то ни другое не нужно.
  const res = await fetch(`${OPENAI_URL}/chat/completions`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: opts.model, messages }),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });

  const raw = await res.text();
  if (!res.ok) return httpFail(res.status, raw, opts, started);

  const data = JSON.parse(raw) as {
    choices?: Array<{ message?: { content?: string | null } }>;
    usage?: {
      prompt_tokens?: number;
      completion_tokens?: number;
      // Часть входа, прочитанная из кеша: она входит в prompt_tokens, но
      // стоит вдесятеро дешевле. Без этого расход завышался бы.
      prompt_tokens_details?: { cached_tokens?: number };
    };
  };
  const text = (data.choices?.[0]?.message?.content ?? "").trim();
  const inTotal = data.usage?.prompt_tokens ?? 0;
  const cached = data.usage?.prompt_tokens_details?.cached_tokens ?? 0;
  const out = data.usage?.completion_tokens ?? 0;
  log(opts, started, inTotal, out);
  await spend("openai", opts, started, inTotal, out, cached);
  return text
    ? { ok: true, text }
    : { ok: false, reason: "failed", detail: "модель вернула пустой ответ" };
}

// ── Gemini ────────────────────────────────────────────────────────────────────

type GeminiPart = { text: string } | { inline_data: { mime_type: string; data: string } };

function geminiParts(question: string, attachments: Attachment[]): GeminiPart[] {
  if (!attachments.length) return [{ text: question }];

  const parts: GeminiPart[] = [{ text: DOCS_INTRO }];
  for (const a of attachments) {
    const whose = whoseOf(a);
    // PDF и картинки Gemini принимает вложением и читает сам — как Claude.
    if (a.base64 && (a.kind === "pdf" || imageTypes.includes(a.mime))) {
      parts.push({ text: `«${a.title}» (${whose}):` });
      parts.push({
        inline_data: { mime_type: a.kind === "pdf" ? "application/pdf" : a.mime, data: a.base64 },
      });
      continue;
    }
    parts.push({ text: framed(a, whose) });
  }
  parts.push({ text: question });
  return parts;
}

async function askGemini(opts: AskOpts, apiKey: string, started: number): Promise<AskResult> {
  const contents = [
    ...opts.history.map((m) => ({
      role: m.from === "user" ? "user" : "model",
      parts: [{ text: m.text }],
    })),
    { role: "user", parts: geminiParts(opts.question, opts.attachments ?? []) },
  ];

  const res = await fetch(
    `${GEMINI_URL}/models/${encodeURIComponent(opts.model)}:generateContent`,
    {
      method: "POST",
      // Ключ заголовком, а не в адресе: адреса попадают в журналы прокси.
      headers: { "content-type": "application/json", "x-goog-api-key": apiKey },
      body: JSON.stringify({
        system_instruction: { parts: [{ text: opts.systemPrompt }] },
        contents,
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    },
  );

  const raw = await res.text();
  if (!res.ok) return httpFail(res.status, raw, opts, started);

  const data = JSON.parse(raw) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
    usageMetadata?: {
      promptTokenCount?: number;
      candidatesTokenCount?: number;
      // Токены рассуждения оплачиваются как выход, но в candidatesTokenCount
      // не входят: без них расход занижается, и заметно.
      thoughtsTokenCount?: number;
      // Часть входа из кеша — считается по своей цене
      cachedContentTokenCount?: number;
    };
  };
  const text = (data.candidates?.[0]?.content?.parts ?? [])
    .map((p) => p.text ?? "")
    .join("\n")
    .trim();
  const inTotal = data.usageMetadata?.promptTokenCount ?? 0;
  const cached = data.usageMetadata?.cachedContentTokenCount ?? 0;
  // Выход = ответ плюс «мысли»: платим за оба, а приходят они порознь.
  const out =
    (data.usageMetadata?.candidatesTokenCount ?? 0) +
    (data.usageMetadata?.thoughtsTokenCount ?? 0);
  log(opts, started, inTotal, out);
  await spend("gemini", opts, started, inTotal, out, cached);

  if (!text && data.candidates?.[0]?.finishReason === "SAFETY") {
    return { ok: false, reason: "failed", detail: "модель отказалась отвечать на этот запрос" };
  }
  return text
    ? { ok: true, text }
    : { ok: false, reason: "failed", detail: "модель вернула пустой ответ" };
}

// ── Общее ─────────────────────────────────────────────────────────────────────

const secs = (started: number) => Math.round((Date.now() - started) / 1000);

function log(opts: AskOpts, started: number, input: number, output: number) {
  console.log(
    `[агент] ${opts.label ?? opts.model} · ${secs(started)}с · вход ${input} · выход ${output}`,
  );
}

/** Расход в деньгах — тем же способом, что и у Claude. */
async function spend(
  provider: "openai" | "gemini",
  opts: AskOpts,
  started: number,
  input: number,
  output: number,
  cacheRead = 0,
): Promise<void> {
  const { noteSpend } = await import("./server-llm");
  await noteSpend({
    ...(opts.who ? { who: opts.who } : {}),
    provider,
    model: opts.model,
    seconds: Math.round((Date.now() - started) / 1000),
    tokens: { input: Math.max(0, input - cacheRead), cacheRead, cacheWrite: 0, output },
  });
}

/**
 * Ошибка провайдера. Наружу отдаём короткую причину: подробности с ключами
 * и адресами остаются в журнале сервера, а не на экране клиента.
 */
function httpFail(status: number, raw: string, opts: AskOpts, started: number): AskResult {
  // 429 — «слишком часто», 5xx у провайдера — перегрузка. Это очередь, а не
  // поломка, и человеку надо сказать именно это.
  if (status === 429 || status === 529 || status === 503) {
    console.warn(
      `[агент] ${opts.label ?? opts.model} · ${secs(started)}с · модель отвечает «занято» (${status})`,
    );
    return { ok: false, reason: "busy" };
  }
  const detail = shortError(raw, status);
  console.error(
    `[агент] ${opts.label ?? opts.model} · ${secs(started)}с · сорвалось: ${status} ${raw.slice(0, 300)}`,
  );
  return { ok: false, reason: "failed", detail };
}

/** Из ответа провайдера достаём сообщение, а не вываливаем человеку весь JSON. */
function shortError(raw: string, status: number): string {
  try {
    const j = JSON.parse(raw) as { error?: { message?: string } };
    if (j.error?.message) return `${status}: ${j.error.message.slice(0, 200)}`;
  } catch {
    /* не JSON — покажем как есть */
  }
  return `${status}: ${raw.slice(0, 200) || "провайдер не объяснил причину"}`;
}

/** Единая точка входа: ключ уже прочитан вызывающим. */
export async function askAlt(
  provider: "openai" | "gemini",
  opts: AskOpts,
  apiKey: string,
): Promise<AskResult> {
  const started = Date.now();
  try {
    return provider === "openai"
      ? await askOpenAI(opts, apiKey, started)
      : await askGemini(opts, apiKey, started);
  } catch (err) {
    const detail = err instanceof Error ? err.message.slice(0, 200) : "неизвестная ошибка";
    console.error(`[агент] ${opts.label ?? opts.model} · ${secs(started)}с · сорвалось: ${detail}`);
    return { ok: false, reason: "failed", detail };
  }
}
