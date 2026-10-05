/** Public form labels only; the methodology is loaded exclusively on the server. */
export const BOS_MODES = [
  { id: "main", name: "Подготовить факторы к сессии" },
  { id: "1", name: "Предложить факторы с нуля" },
  { id: "2", name: "Проверить и дополнить список" },
  { id: "3", name: "Переформулировать факторы" },
] as const;
export const isBosAgent = (id: string) => id === "kat" || id === "stirlitz";

export function bosTitle(agentId: string, text: string): string {
  if (!isBosAgent(agentId)) return text;
  const industry = text.split("### Отрасль / рынок\n")[1]?.split("\n")[0]?.trim();
  return industry ? `${agentId === "kat" ? "Факторы" : "Канва"}: ${industry}` : text;
}
export const BOS_FIELDS = [
  ["industry", "Отрасль / рынок"],
  ["main_company", "Главная компания"],
  ["business_model", "Модель бизнеса"],
  ["alternatives_list", "Конкуренты для сравнения"],
  ["client_profile", "Профиль клиента"],
  ["team_context", "Чем занимается команда"],
  ["team_factors", "Факторы команды"],
  ["context", "Дополнительный контекст"],
] as const;

export function bosQuestion(agentId: string, mode: string, values: Record<string, string>): string {
  return [
    agentId === "kat"
      ? `Режим Кэт: ${BOS_MODES.find((m) => m.id === mode)?.name ?? BOS_MODES[0].name}`
      : "Задача Штирлица: стратегическая канва «как есть»",
    ...BOS_FIELDS.map(([key, label]) => `### ${label}\n${values[key]?.trim() || "не указано"}`),
    "Начните анализ по этим данным и приложенным материалам. Укажите источники и степень уверенности.",
  ].join("\n\n");
}
