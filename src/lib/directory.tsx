/**
 * Справочник участников на стороне браузера — тонкая обёртка над сервером.
 *
 * Здесь нет ни списка людей, ни их кодов до тех пор, пока сервер их не отдал,
 * и отдаёт он ровно то, что позволено роли звонящего.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

import type { Participant, ParticipantDraft } from "./participants";
import { listServer, mutateServer } from "./server-directory";
import { useSession } from "./session";

type Directory = {
  participants: Participant[];
  /** false, пока список не приехал с сервера */
  ready: boolean;
  add: (draft: ParticipantDraft) => Promise<Participant | null>;
  update: (id: string, patch: Partial<Omit<Participant, "id" | "code">>) => void;
  remove: (id: string) => void;
  /** Открыть или закрыть агента конкретному человеку */
  toggleAgent: (id: string, agentId: string) => void;
  setActive: (id: string, active: boolean) => void;
  reload: () => void;
};

const Ctx = createContext<Directory | null>(null);

export function DirectoryProvider({ children }: { children: ReactNode }) {
  const { code, person, refresh } = useSession();
  const [participants, setParticipants] = useState<Participant[]>([]);
  const [ready, setReady] = useState(false);

  const reload = useCallback(() => {
    if (!code) {
      setParticipants([]);
      setReady(true);
      return;
    }
    listServer({ data: { code } })
      .then((res) => setParticipants(res.participants))
      .catch(() => { /* молча: экраны покажут пустоту словами */ })
      .finally(() => setReady(true));
  }, [code]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Любое изменение возвращает свежий список — состояние не собираем сами,
  // иначе браузер и сервер разъедутся ровно так же, как разъезжались раньше.
  const apply = useCallback(
    async (mutation: Parameters<typeof mutateServer>[0] extends never ? never : any) => {
      if (!code) return null;
      const res = await mutateServer({ data: { code, mutation } });
      setParticipants(res.participants);
      // Себе тоже могли что-то поменять — обновим карточку в шапке.
      refresh();
      return "created" in res ? (res.created ?? null) : null;
    },
    [code, refresh],
  );

  const value = useMemo<Directory>(
    () => ({
      participants,
      ready,
      add: (draft) => apply({ kind: "add", draft }),
      update: (id, patch) => void apply({ kind: "update", id, patch }),
      remove: (id) => void apply({ kind: "remove", id }),
      toggleAgent: (id, agentId) => void apply({ kind: "toggleAgent", id, agentId }),
      setActive: (id, active) => void apply({ kind: "setActive", id, active }),
      reload,
    }),
    [participants, ready, apply, reload],
  );

  // Клиенту список не нужен вовсе: он видит только себя, и это делает сессия.
  void person;

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useDirectory() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useDirectory — только внутри DirectoryProvider");
  return ctx;
}

export type { Participant } from "./participants";
export { cleanTelegram } from "./participants";
