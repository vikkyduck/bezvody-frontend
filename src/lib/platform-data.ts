/**
 * Роли платформы. Всё остальное про людей теперь живёт в справочнике
 * участников (lib/directory.tsx): администратор заводит их руками,
 * и там же им открываются агенты.
 *
 *   client  — «что мне решать сегодня» (работает в окнах с агентами);
 *   project — «как идут мои клиенты» (видит участников и их наборы);
 *   admin   — «как идёт платформа» (заводит участников, открывает агентов).
 */

export type Role = "client" | "project" | "admin";

export const roleLabel: Record<Role, string> = {
  client: "Клиент",
  project: "Проджект",
  admin: "Администратор",
};

export const nf = (n: number) => n.toLocaleString("ru-RU");
