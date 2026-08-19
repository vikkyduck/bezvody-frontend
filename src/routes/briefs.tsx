import { createFileRoute, Link, Outlet, useRouterState } from "@tanstack/react-router";
import { AppShell, PageHead } from "@/components/AppShell";
import { agents, briefs } from "@/lib/shtab-data";
import { DecisionCard, EmptyState } from "@/components/DecisionCard";
import { useShtab } from "@/lib/shtab-store";

export const Route = createFileRoute("/briefs")({
  head: () => ({
    meta: [
      { title: "Решения — платформа «Без Воды»" },
      {
        name: "description",
        content:
          "Решение на одну страницу: что изменилось, почему, какие варианты и риски, кто владелец решения и как проверяется эффект.",
      },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: Briefs,
});

function Briefs() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  const isDetail = path !== "/briefs";
  const { decided } = useShtab();

  if (isDetail) return <Outlet />;

  const pending = briefs.filter((b) => b.status === "Требует решения" && !decided.includes(b.id));
  const wordForm = (n: number) => (n === 1 ? "решение ждёт" : n < 5 ? "решения ждут" : "решений ждут");

  return (
    <AppShell allow={["client"]}>
      <PageHead
        eyebrow="Решения"
        title={
          pending.length
            ? `${pending.length} ${wordForm(pending.length)} вашей подписи`
            : briefs.length
              ? "Все решения приняты"
              : "Решений пока нет"
        }
        lead="Агент готовит решение и показывает доказательства. Выбор и подпись — за руководителем."
      />

      {briefs.length ? (
        <div className="space-y-2.5">
          {briefs.map((b) => (
            <DecisionCard key={b.id} brief={b} agentName={agents.find((a) => a.id === b.agentId)?.name} />
          ))}
        </div>
      ) : (
        <EmptyState
          title="Пока ничего не ждёт вас"
          note="Решения появятся здесь, как только агент закончит подготовку. Ничего срочного сейчас нет."
          action={
            <Link to="/agents" className="btn btn-glass text-[12.5px]">
              Каталог агентов
            </Link>
          }
        />
      )}

    </AppShell>
  );
}
