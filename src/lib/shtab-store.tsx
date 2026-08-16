import { createContext, useContext, useMemo, useState, type ReactNode } from "react";
import { agents as baseAgents } from "./shtab-data";

type Run = { agentId: string; step: number; done: boolean };

type Store = {
  installed: string[];
  install: (id: string) => void;
  uninstall: (id: string) => void;
  run: Run | null;
  startRun: (agentId: string) => void;
  nextStep: (total: number) => void;
  closeRun: () => void;
  decided: string[];
  decide: (briefId: string) => void;
  /** Право на ошибку: подпись можно отозвать */
  undecide: (briefId: string) => void;
};

const Ctx = createContext<Store | null>(null);

export function ShtabProvider({ children }: { children: ReactNode }) {
  const [installed, setInstalled] = useState<string[]>(() =>
    baseAgents.filter((a) => a.status === "active").map((a) => a.id),
  );
  const [run, setRun] = useState<Run | null>(null);
  const [decided, setDecided] = useState<string[]>([]);

  const value = useMemo<Store>(
    () => ({
      installed,
      install: (id) => setInstalled((p) => (p.includes(id) ? p : [...p, id])),
      uninstall: (id) => setInstalled((p) => p.filter((x) => x !== id)),
      run,
      startRun: (agentId) => setRun({ agentId, step: 0, done: false }),
      nextStep: (total) =>
        setRun((r) => {
          if (!r) return r;
          const step = r.step + 1;
          return { ...r, step: Math.min(step, total), done: step >= total };
        }),
      closeRun: () => setRun(null),
      decided,
      decide: (briefId) => setDecided((p) => (p.includes(briefId) ? p : [...p, briefId])),
      undecide: (briefId) => setDecided((p) => p.filter((x) => x !== briefId)),
    }),
    [installed, run, decided],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useShtab() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useShtab must be used inside ShtabProvider");
  return ctx;
}
