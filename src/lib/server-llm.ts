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

import type { Attachment } from "./documents";
import type { StoredMessage } from "./conversations";
import { providerLabel, type Provider } from "./providers";

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
    return askAlt(provider, rest, apiKey);
  }

  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  // Повторы — не роскошь: при тридцати одновременных разговорах модель
  // отвечает «слишком часто», и это лечится паузой, а не сообщением об
  // ошибке. Пакет сам выдерживает паузу, которую просит сервер.
  const client = new Anthropic({ apiKey, baseURL: BASE_URL, maxRetries: 4 });

  // История разговора: платформа не помнит контекст за модель — он передаётся
  // целиком каждый раз, иначе агент забудет, о чём шла речь двумя репликами выше.
  const messages = [
    ...opts.history.map((m) => ({
      role: m.from === "user" ? ("user" as const) : ("assistant" as const),
      content: m.text,
    })),
    { role: "user" as const, content: contentFor(opts.question, opts.attachments ?? []) },
  ];

  const started = Date.now();
  try {
    const stream = client.messages.stream({
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
    });
    const final = await stream.finalMessage();

    // Строка в журнал сервера: видно, сколько шёл ответ, сколько стоил
    // и сработал ли кеш инструкции.
    const u = final.usage;
    console.log(
      `[агент] ${opts.label ?? opts.model} · ${Math.round((Date.now() - started) / 1000)}с · ` +
        `вход ${u.input_tokens} · из кеша ${u.cache_read_input_tokens ?? 0} · записано в кеш ${u.cache_creation_input_tokens ?? 0} · выход ${u.output_tokens}`,
    );

    if (final.stop_reason === "refusal") {
      return { ok: false, reason: "failed", detail: "модель отказалась отвечать на этот запрос" };
    }

    const text = final.content
      .filter((b): b is Extract<typeof b, { type: "text" }> => b.type === "text")
      .map((b) => b.text)
      .join("\n")
      .trim();

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
