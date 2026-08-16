/**
 * Рабочее окно клиента.
 *
 * Окно — это один разговор по одному вопросу. К окну подключается агент,
 * и дальше человек просто пишет: расход по окну виден тут же, чтобы не
 * приходилось искать его в отчётах.
 *
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
  /** Сколько кредитов стоил ответ агента */
  credits?: number;
};

export type WorkWindow = {
  id: string;
  title: string;
  /** Пока null — окно есть, а работать в нём некому: подключите агента */
  agentId: string | null;
  messages: WindowMessage[];
  credits: number;
  updated: string;
};

/** Затравка: два живых окна и одно только что открытое. */
const seed: WorkWindow[] = [
  {
    id: "w-1",
    title: "Почему просела маржа опта",
    agentId: "kpi-root-cause",
    credits: 1840,
    updated: "сегодня",
    messages: [
      { id: "m-1", from: "user", text: "Маржа опта падает шестую неделю. Разбери, из-за чего именно." },
      {
        id: "m-2",
        from: "agent",
        credits: 1840,
        text:
          "Падение на 2,4 п.п. объясняется на 78 % тремя факторами: рост скидочной глубины у трёх дистрибьюторов " +
          "(−1,1 п.п.), сдвиг микса в низкомаржинальную серию 200 (−0,6 п.п.) и удорожание логистики Урал → Юг " +
          "(−0,2 п.п.). Остальное — разовые списания.\n\nИсточники: 1С (выгрузка 14.08), CRM, тарифы перевозчика. " +
          "Управляемый рычаг здесь один — скидочная матрица: она даёт больше половины падения.",
      },
    ],
  },
  {
    id: "w-2",
    title: "Хватит ли денег до конца квартала",
    agentId: "cash-forecast",
    credits: 2610,
    updated: "вчера",
    messages: [
      { id: "m-3", from: "user", text: "Покажи прогноз денег на 13 недель и где будет провал." },
      {
        id: "m-4",
        from: "agent",
        credits: 2610,
        text:
          "Кассовый разрыв возникает на неделе 41 (около 12 млн ₽) и держится девять дней. Причина — совпадение " +
          "выплаты по контракту и задержки двух крупных поступлений.\n\nПредположение: платёж «Ориона» придёт " +
          "с задержкой в 10 дней — история платежей это подтверждает, но подтверждения от клиента нет.",
      },
    ],
  },
  {
    id: "w-3",
    title: "Новое окно",
    agentId: null,
    credits: 0,
    updated: "сегодня",
    messages: [],
  },
];

type Store = {
  windows: WorkWindow[];
  activeId: string;
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

let seq = 100;
const nextId = (prefix: string) => `${prefix}-${++seq}`;

export function ShtabProvider({ children }: { children: ReactNode }) {
  const [windows, setWindows] = useState<WorkWindow[]>(seed);
  const [activeId, setActive] = useState("w-1");
  const [thinkingId, setThinking] = useState<string | null>(null);
  const [decided, setDecided] = useState<string[]>([]);

  const createWindow = useCallback((agentId?: string) => {
    const id = nextId("w");
    const agent = agentId ? agents.find((a) => a.id === agentId) : undefined;
    setWindows((prev) => [
      { id, title: agent ? agent.name : "Новое окно", agentId: agentId ?? null, messages: [], credits: 0, updated: "сейчас" },
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

    // Пока агент не подключён к серверу, ответ собирается из того, что агент
    // обещает делать. Это заглушка ровно на время, пока нет API платформы.
    setTimeout(() => {
      setWindows((prev) =>
        prev.map((w) => {
          if (w.id !== windowId) return w;
          const agent = agents.find((a) => a.id === w.agentId);
          const credits = 320 + clean.length * 4;
          return {
            ...w,
            credits: w.credits + credits,
            messages: [
              ...w.messages,
              {
                id: nextId("m"),
                from: "agent" as const,
                credits,
                text: agent
                  ? `${agent.result}. Разбор собран по методу «${agent.method.toLowerCase()}».\n\n` +
                    "Каждое утверждение идёт с источником; где данных не хватило — помечено как предположение."
                  : "К окну не подключён агент — подключите его сверху, и я возьмусь за вопрос.",
              },
            ],
          };
        }),
      );
      setThinking(null);
    }, 1100);
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
