/**
 * Сессия: кто вошёл и что ему открыто.
 *
 * Вход по коду доступа, без пароля — код и есть логин, как в ФинДоходе.
 * Проверяет код сервер: в браузере списка людей больше нет, и подобрать
 * чужой доступ, читая бандл, невозможно.
 *
 * Код хранится в sessionStorage и уходит с каждым запросом — на этом шаге
 * он работает как ключ. Настоящая сессия (httpOnly-cookie, срок жизни,
 * защита от подбора) приедет вместе с бэкендом платформы.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import type { Participant, Role } from "./participants";
import { meServer, signInServer } from "./server-directory";

const KEY = "bv-session";

type Session = {
  person: Participant | null;
  role: Role | null;
  /** Код нужен, чтобы подписывать запросы к справочнику */
  code: string | null;
  signIn: (code: string) => Promise<{ ok: true } | { ok: false; error: string }>;
  signOut: () => void;
  /** Перечитать себя с сервера: агентов мог открыть администратор минуту назад */
  refresh: () => void;
  /** false, пока не проверили сохранённый код: до этого не решаем, пускать или нет */
  ready: boolean;
};

const Ctx = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [code, setCode] = useState<string | null>(null);
  const [person, setPerson] = useState<Participant | null>(null);
  const [ready, setReady] = useState(false);

  // Восстанавливаем вход уже на клиенте: на сервере sessionStorage нет.
  useEffect(() => {
    let saved: string | null = null;
    try {
      saved = sessionStorage.getItem(KEY);
    } catch {
      /* приватный режим браузера — работаем без запоминания */
    }
    if (!saved) {
      setReady(true);
      return;
    }
    meServer({ data: { code: saved } })
      .then((res) => {
        if (res.me) {
          setCode(saved);
          setPerson(res.me);
        } else {
          // Код отозвали, пока вкладка была открыта — выходим молча.
          try {
            sessionStorage.removeItem(KEY);
          } catch { /* см. выше */ }
        }
      })
      .catch(() => { /* сеть недоступна — покажем экран входа */ })
      .finally(() => setReady(true));
  }, []);

  const signIn = useCallback(async (raw: string) => {
    const clean = raw.trim().toUpperCase();
    if (!clean) return { ok: false as const, error: "Введите код доступа" };

    try {
      const res = await signInServer({ data: { code: clean } });
      // Одна и та же формулировка на неизвестный и на отозванный код: подбирающему
      // не подсказываем, существует ли код вообще.
      if (!res.ok) {
        return {
          ok: false as const,
          error: "Код не подходит. Проверьте раскладку или запросите новый у администратора",
        };
      }
      setCode(clean);
      setPerson(res.me);
      try {
        sessionStorage.setItem(KEY, clean);
      } catch { /* см. выше */ }
      return { ok: true as const };
    } catch {
      return { ok: false as const, error: "Платформа не отвечает. Попробуйте ещё раз" };
    }
  }, []);

  const signOut = useCallback(() => {
    setCode(null);
    setPerson(null);
    try {
      sessionStorage.removeItem(KEY);
    } catch { /* см. выше */ }
  }, []);

  const refresh = useCallback(() => {
    if (!code) return;
    meServer({ data: { code } })
      .then((res) => setPerson(res.me ?? null))
      .catch(() => { /* молча: следующий раз получится */ });
  }, [code]);

  // Возврат на вкладку — повод перечитать себя: пока человек ходил по своим
  // делам, администратор мог открыть ему агента.
  useEffect(() => {
    if (!code) return;
    const onFocus = () => refresh();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [code, refresh]);

  const value = useMemo<Session>(
    () => ({
      person,
      role: person?.role ?? null,
      code,
      signIn,
      signOut,
      refresh,
      ready,
    }),
    [person, code, signIn, signOut, refresh, ready],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSession — только внутри SessionProvider");
  return ctx;
}
