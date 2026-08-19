/**
 * Окна разговоров на стороне браузера — тонкая обёртка над сервером.
 *
 * Переписка не живёт в памяти вкладки: закрыл ноутбук, открыл с телефона —
 * всё на месте. Хранится она у участника, и это то, что видит администратор.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import type { StoredWindow } from "./conversations";
import {
  deleteWindowServer,
  listWindowsServer,
  openWindowServer,
  sendMessageServer,
} from "./server-windows";
import { useSession } from "./session";

type Store = {
  windows: StoredWindow[];
  ready: boolean;
  /** Какое окно открыто; null — экран выбора агента */
  activeId: string | null;
  setActive: (id: string | null) => void;
  open: (agentId: string, title?: string) => Promise<void>;
  send: (windowId: string, text: string) => Promise<void>;
  remove: (windowId: string) => Promise<void>;
  /** Окно, где агент сейчас отвечает */
  thinkingId: string | null;
};

const Ctx = createContext<Store | null>(null);

export function WindowsProvider({ children }: { children: ReactNode }) {
  const { code, role } = useSession();
  const [windows, setWindows] = useState<StoredWindow[]>([]);
  const [ready, setReady] = useState(false);
  const [activeId, setActive] = useState<string | null>(null);
  const [thinkingId, setThinking] = useState<string | null>(null);

  useEffect(() => {
    // Окна есть только у того, кто работает в них сам.
    if (!code || role !== "client") {
      setWindows([]);
      setReady(true);
      return;
    }
    listWindowsServer({ data: { code } })
      .then((res) => setWindows(res.windows))
      .catch(() => { /* молча: экран покажет пустоту словами */ })
      .finally(() => setReady(true));
  }, [code, role]);

  const open = useCallback(
    async (agentId: string, title = "") => {
      if (!code) return;
      const res = await openWindowServer({ data: { code, agentId, title } });
      setWindows(res.windows);
      if (res.opened) setActive(res.opened.id);
    },
    [code],
  );

  const send = useCallback(
    async (windowId: string, text: string) => {
      if (!code || !text.trim()) return;
      setThinking(windowId);
      try {
        const res = await sendMessageServer({ data: { code, windowId, text } });
        setWindows(res.windows);
      } finally {
        setThinking(null);
      }
    },
    [code],
  );

  const remove = useCallback(
    async (windowId: string) => {
      if (!code) return;
      const res = await deleteWindowServer({ data: { code, windowId } });
      setWindows(res.windows);
      setActive((cur) => (cur === windowId ? null : cur));
    },
    [code],
  );

  const value = useMemo<Store>(
    () => ({ windows, ready, activeId, setActive, open, send, remove, thinkingId }),
    [windows, ready, activeId, open, send, remove, thinkingId],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useWindows() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useWindows — только внутри WindowsProvider");
  return ctx;
}
