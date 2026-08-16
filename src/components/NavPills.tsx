import { Link } from "@tanstack/react-router";
import { motion } from "motion/react";

export type NavItem = { to: string; label: string; short: string };

export function NavPills({
  items,
  path,
  mobile = false,
  className = "",
}: {
  items: NavItem[];
  path: string;
  mobile?: boolean;
  className?: string;
}) {
  const layoutId = mobile ? "nav-pill-mobile" : "nav-pill-desktop";
  return (
    <nav className={`gap-1 ${className}`} aria-label="Разделы кабинета">
      {items.map((n) => {
        const active = n.to === "/" ? path === "/" : path.startsWith(n.to);
        return (
          <Link
            key={n.to}
            to={n.to}
            aria-current={active ? "page" : undefined}
            className={`relative flex-none rounded-[var(--radius-pill)] px-3.5 py-1.5 text-[13px] transition-colors ${
              active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {active ? (
              <motion.span
                layoutId={layoutId}
                className="lg lg-strong absolute inset-0 rounded-[var(--radius-pill)]"
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
              />
            ) : null}
            <span className={`relative whitespace-nowrap ${active ? "font-semibold" : ""}`}>
              {mobile ? n.short : n.label}
            </span>
          </Link>
        );
      })}
    </nav>
  );
}
