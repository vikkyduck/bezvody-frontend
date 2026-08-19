/**
 * Рабочее окно клиента.
 *
 * Окно — это один разговор по одному вопросу. К окну подключается агент,
 * и дальше человек просто пишет.
 *
 * Окон при первом входе нет: платформа пустая, человек сам открывает первое.
 * Агентов в списке доступных ровно столько, сколько открыл проджект или
 * администратор: клиент не подключает их себе сам — это осознанно.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react";

import { agents } from "./shtab-data";

export type Speaker = "user" | "agent";

export type WindowMessage = {
  id: string;
  from: Speaker;
  text: string;
};

export type WorkWindow = {
  id: string;
  title: string;
  /** Пока null — окно есть, а работать в нём некому: подключите агента */
  agentId: string | null;
  messages: WindowMessage[];
  updated: string;
};

type Store = {
  windows: WorkWindow[];
  activeId: string | null;
  setActive: (id: string) => void;
  createWindow: (agentId?: string) => string;
  connectAgent: (windowId: string, agentId: string) => void;
  send: (windowId: string, text: string) => void;
  /** Окно, где агент сейчас отвечает */
  thinkingId: string | null;
  /** Решения, подписанные в этой сессии */
  decided: string[];
  decide: (briefId: string) => void;
  /** Право на ошибку: подпись можно отозвать */
  undecide: (briefId: string) => void;
};

const Ctx = createContext<Store | null>(null);

let seq = 0;
const nextId = (prefix: string) => `${prefix}-${++seq}`;

export function ShtabProvider({ children }: { children: ReactNode }) {
  const [windows, setWindows] = useState<WorkWindow[]>([]);
  const [activeId, setActive] = useState<string | null>(null);
  const [thinkingId, setThinking] = useState<string | null>(null);
  const [decided, setDecided] = useState<string[]>([]);

  const createWindow = useCallback((agentId?: string) => {
    const id = nextId("w");
    const agent = agentId ? agents.find((a) => a.id === agentId) : undefined;
    setWindows((prev) => [
      { id, title: agent ? agent.name : "Новое окно", agentId: agentId ?? null, messages: [], updated: "сейчас" },
      ...prev,
    ]);
    setActive(id);
    return id;
  }, []);

  const connectAgent = useCallback((windowId: string, agentId: string) => {
    const agent = agents.find((a) => a.id === agentId);
    setWindows((prev) =>
      prev.map((w) =>
        w.id === windowId
          ? { ...w, agentId, title: w.messages.length || w.title !== "Новое окно" ? w.title : (agent?.name ?? w.title) }
          : w,
      ),
    );
  }, []);

  const send = useCallback((windowId: string, text: string) => {
    const clean = text.trim();
    if (!clean) return;

    setWindows((prev) =>
      prev.map((w) =>
        w.id === windowId
          ? {
              ...w,
              // Заголовок окна — первый вопрос человека: так список читается без открытия.
              title: w.messages.length === 0 && w.title === "Новое окно" ? shorten(clean) : w.title,
              messages: [...w.messages, { id: nextId("m"), from: "user" as const, text: clean }],
              updated: "сейчас",
            }
          : w,
      ),
    );
    setThinking(windowId);

    // Платформа ещё не подключена к агентам, поэтому ответ один и честный.
    // Здесь будет запрос к бэкенду.
    setTimeout(() => {
      setWindows((prev) =>
        prev.map((w) =>
          w.id === windowId
            ? {
                ...w,
                messages: [
                  ...w.messages,
                  {
                    id: nextId("m"),
                    from: "agent" as const,
                    text: w.agentId
                      ? "Агент ещё не подключён к платформе — ответить пока нечем."
                      : "К окну не подключён агент. Подключите его сверху, и я возьмусь за вопрос.",
                  },
                ],
              }
            : w,
        ),
      );
      setThinking(null);
    }, 700);
  }, []);

  const value = useMemo<Store>(
    () => ({
      windows,
      activeId,
      setActive,
      createWindow,
      connectAgent,
      send,
      thinkingId,
      decided,
      decide: (briefId) => setDecided((p) => (p.includes(briefId) ? p : [...p, briefId])),
      undecide: (briefId) => setDecided((p) => p.filter((x) => x !== briefId)),
    }),
    [windows, activeId, createWindow, connectAgent, send, thinkingId, decided],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useShtab() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useShtab must be used inside ShtabProvider");
  return ctx;
}

const shorten = (s: string) => (s.length <= 42 ? s : s.slice(0, 41).trimEnd() + "…");
