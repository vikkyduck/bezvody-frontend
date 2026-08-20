/**
 * Чем думает агент: Claude, GPT или Gemini.
 *
 * Провайдер задаётся агенту, а не платформе: один и тот же документ можно
 * прогнать разными моделями и сравнить, кто судит жёстче. Ключ у каждого
 * провайдера свой — отзыв одного не роняет остальных.
 *
 * Наружу все трое идут через один транзит на DO-дроплете: с РФ-адреса
 * api.anthropic.com, api.openai.com и generativelanguage.googleapis.com
 * отвечают 403.
 */

export type Provider = "anthropic" | "openai" | "gemini";

export const PROVIDERS: Array<{ id: Provider; label: string; hint: string }> = [
  { id: "anthropic", label: "Claude", hint: "Anthropic. Держит длинную инструкцию и роль, читает PDF как есть" },
  { id: "openai", label: "GPT", hint: "OpenAI. Короче и суше в формулировках; PDF платформа читает сама" },
  { id: "gemini", label: "Gemini", hint: "Google. Большой контекст и дешевле на объёмных материалах" },
];

export const providerLabel = (p: Provider) => PROVIDERS.find((x) => x.id === p)?.label ?? p;

/**
 * Модели Claude выбираются списком: их немного и они наши.
 * У чужих провайдеров имя модели вписывается руками — их линейки меняются
 * чаще, чем мы правим код, и зашитый список устареет молча. Подсказки ниже
 * не проверяются: если имя устарело, «Проверить связь» покажет ответ
 * провайдера дословно, и правильное имя видно из их консоли.
 */
export const MODEL_HINTS: Record<Provider, string[]> = {
  anthropic: [],
  openai: ["gpt-5", "gpt-5-mini"],
  gemini: ["gemini-2.5-pro", "gemini-2.5-flash"],
};

export const DEFAULT_MODEL_OF: Record<Provider, string> = {
  anthropic: "claude-opus-5",
  openai: "gpt-5",
  gemini: "gemini-2.5-pro",
};

export const isProvider = (v: unknown): v is Provider =>
  v === "anthropic" || v === "openai" || v === "gemini";
