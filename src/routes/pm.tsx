import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";

import { AppShell, PageHead } from "@/components/AppShell";
import { AgentAccess, Contacts } from "@/components/AgentAccess";
import { useDirectory, type Participant } from "@/lib/directory";

export const Route = createFileRoute("/pm")({
  head: () => ({
    meta: [
      { title: "Мои клиенты — платформа «Без Воды»" },
      { name: "description", content: "Кабинет проджекта: участники и их агенты." },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ProjectCabinet,
});

function ProjectCabinet() {
  return (
    <AppShell allow={["project", "admin"]}>
      <Body />
    </AppShell>
  );
}

function Body() {
  const { participants } = useDirectory();
  const clients = participants.filter((p) => p.role === "client" && p.active);
  const [openId, setOpenId] = useState<string | null>(null);

  const withoutAgents = clients.filter((p) => p.agentIds.length === 0);

  return (
    <>
      <PageHead
        n="01"
        eyebrow="Кабинет проджекта"
        title={
          clients.length
            ? `${clients.length} ${declension(clients.length, "клиент", "клиента", "клиентов")} на вас`
            : "Клиентов пока нет"
        }
        lead="Вы видите, кому что открыто, и можете добавить или убрать агента прямо здесь."
      />

      {clients.length ? (
        <>
          <section className="grid gap-4 border-y border-[color:var(--color-line)] py-5 sm:grid-cols-2">
            <div>
              <div className="label-caps">Клиентов на вас</div>
              <div className="t-number mt-1.5 text-[26px] leading-none tabular-nums">
                {clients.length}
              </div>
              <p className="mt-1.5 text-[11.5px] text-muted-foreground">
                агентов открыто {clients.reduce((s, c) => s + c.agentIds.length, 0)}
              </p>
            </div>
            <div>
              <div className="label-caps">Без единого агента</div>
              <div className="t-number mt-1.5 text-[26px] leading-none tabular-nums">
                {withoutAgents.length}
              </div>
              <p className="mt-1.5 text-[11.5px] text-muted-foreground">
                {withoutAgents.length
                  ? withoutAgents.map((c) => c.name).join(", ")
                  : "у каждого открыт хотя бы один"}
              </p>
            </div>
          </section>

          <section className="mt-8 space-y-3">
            {clients.map((c) => (
              <ClientCard
                key={c.id}
                person={c}
                open={openId === c.id}
                onToggle={() => setOpenId(openId === c.id ? null : c.id)}
              />
            ))}
          </section>
        </>
      ) : (
        <div className="card-flat px-6 py-10 text-center">
          <p className="measure mx-auto text-[13.5px] text-muted-foreground">
            Как только администратор заведёт клиентов, они появятся здесь вместе со своими агентами.
          </p>
        </div>
      )}
    </>
  );
}

function ClientCard({
  person: p,
  open,
  onToggle,
}: {
  person: Participant;
  open: boolean;
  onToggle: () => void;
}) {
  return (
    <div className="card-flat px-5 py-5">
      <div className="flex flex-wrap items-start gap-4">
        <div className="min-w-0 flex-1">
          <div className="text-[15px] font-semibold leading-snug">{p.name}</div>
          <p className="mt-1 text-[12.5px] text-muted-foreground">
            {[p.position, p.company].filter(Boolean).join(" · ") || "должность не указана"}
          </p>
          <p className="mt-1 text-[12px] text-muted-foreground">
            <Contacts person={p} />
          </p>
        </div>

        <div className="text-right">
          <div className="text-[12.5px]">
            {p.agentIds.length} {declension(p.agentIds.length, "агент", "агента", "агентов")}
          </div>
          <div className="text-[10.5px] text-muted-foreground">
            {p.lastUsedAt ? `заходил ${p.lastUsedAt}` : "ни разу не заходил"}
          </div>
        </div>

        <button onClick={onToggle} className="btn btn-glass text-[12.5px]">
          {open ? "Свернуть" : "Агенты клиента"}
        </button>
      </div>

      {open ? (
        <div className="mt-5 border-t border-[color:var(--color-line)] pt-5">
          <div className="label-caps mb-2.5">Какие агенты открыты</div>
          <AgentAccess person={p} />
        </div>
      ) : null}
    </div>
  );
}

const declension = (n: number, one: string, few: string, many: string) => {
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 10 || mod100 >= 20)) return few;
  return many;
};
