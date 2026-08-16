/**
 * Сессия: кто вошёл и что ему видно.
 *
 * Вход по коду доступа, без пароля — код и есть логин, как в ФинДоходе.
 * Код выдаёт администратор, он же отзывает: самостоятельной регистрации нет
 * и не будет, доступ открывается после оплаты счёта.
 *
 * Здесь сессия живёт в sessionStorage, потому что данных с сервера ещё нет.
 * Когда появится API — вход становится запросом, а сессия переезжает
 * в httpOnly-cookie: в JavaScript токен сессии не кладём.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import { accessCodes, clientOf, personOf, type Client, type Person, type Role } from "./platform-data";

const KEY = "bv-session";

type Session = {
  person: Person | null;
  client: Client | null;
  role: Role | null;
  signIn: (code: string) => { ok: true } | { ok: false; error: string };
  signOut: () => void;
  /** false, пока не прочитали sessionStorage: до этого не решаем, пускать или нет */
  ready: boolean;
};

const Ctx = createContext<Session | null>(null);

export function SessionProvider({ children }: { children: ReactNode }) {
  const [personId, setPersonId] = useState<string | null>(null);
  const [ready, setReady] = useState(false);

  // Читаем уже на клиенте: на сервере sessionStorage нет, и рендер разъехался бы.
  useEffect(() => {
    try {
      setPersonId(sessionStorage.getItem(KEY));
    } catch {
      /* приватный режим браузера — работаем без запоминания */
    }
    setReady(true);
  }, []);

  const signIn = useCallback((raw: string) => {
    const code = raw.trim().toUpperCase();
    if (!code) return { ok: false as const, error: "Введите код доступа" };

    const found = accessCodes.find((c) => c.code === code);
    // Одна и та же формулировка на неизвестный и на отозванный код: подбирающему
    // не подсказываем, существует ли код вообще.
    if (!found || !found.active || !personOf(found.personId)) {
      return { ok: false as const, error: "Код не подходит. Проверьте раскладку или запросите новый у администратора" };
    }

    setPersonId(found.personId);
    try {
      sessionStorage.setItem(KEY, found.personId);
    } catch {
      /* см. выше */
    }
    return { ok: true as const };
  }, []);

  const signOut = useCallback(() => {
    setPersonId(null);
    try {
      sessionStorage.removeItem(KEY);
    } catch {
      /* см. выше */
    }
  }, []);

  const value = useMemo<Session>(() => {
    const person = personOf(personId) ?? null;
    return {
      person,
      client: person ? (clientOf(person.clientId) ?? null) : null,
      role: person?.role ?? null,
      signIn,
      signOut,
      ready,
    };
  }, [personId, ready, signIn, signOut]);

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSession() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useSession — только внутри SessionProvider");
  return ctx;
}
