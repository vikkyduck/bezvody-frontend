/**
 * Роли платформы. Определения переехали в participants.ts — там же, где
 * живёт сам участник; здесь остался реэкспорт, чтобы экраны не переучивать.
 */
export { roleLabel, type Role } from "./participants";

export const nf = (n: number) => n.toLocaleString("ru-RU");
