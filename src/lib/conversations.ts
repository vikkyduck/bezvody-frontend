/**
 * Окно — один разговор с одним агентом.
 *
 * Окно принадлежит агенту с рождения и не меняет его: работа идёт по задаче,
 * а не «переключением собеседника». Всё, что агент собрал в этом окне —
 * разбор, документ, решение, — остаётся здесь же.
 */

export type Speaker = "user" | "agent";

export type StoredMessage = {
  id: string;
  from: Speaker;
  text: string;
  at: string;
};

/** Материал окна: готовый документ, который агент собрал по ходу работы. */
export type WindowDoc = {
  id: string;
  title: string;
  kind: string;
  at: string;
};

export type StoredWindow = {
  id: string;
  agentId: string;
  /** Заголовок — первый вопрос человека: список читается без открытия */
  title: string;
  messages: StoredMessage[];
  docs: WindowDoc[];
  createdAt: string;
  updatedAt: string;
};

export const shortTitle = (s: string) => (s.length <= 46 ? s : s.slice(0, 45).trimEnd() + "…");
