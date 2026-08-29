import { Link } from "@tanstack/react-router";
import { motion } from "motion/react";

export type NavItem = { to: string; label: string; short: string };

/**
 * Разделы кабинета.
 *
 * Ревизия 26.08.2026: стеклянная «таблетка» под активным пунктом убрана.
 * Раздел, в котором человек стоит, отмечает одна линия под словом — этого
 * достаточно, а заливка спорила по весу с логотипом и именем в той же строке.
 */
export function NavPills({
  items,
  path,
  mobile = false,
  /** Короткие подписи: в широкой шапке полные названия не помещались */
  short = false,
  className = "",
}: {
  items: NavItem[];
  path: string;
  mobile?: boolean;
  short?: boolean;
  className?: string;
}) {
  const layoutId = mobile ? "nav-underline-mobile" : "nav-underline-desktop";
  return (
    <nav className={`gap-6 ${className}`} aria-label="Разделы кабинета">
      {items.map((n) => {
        const active = n.to === "/" ? path === "/" : path.startsWith(n.to);
        return (
          <Link
            key={n.to}
            to={n.to}
            aria-current={active ? "page" : undefined}
            className={`relative flex-none whitespace-nowrap py-2 text-[11px] font-semibold uppercase tracking-[0.14em] transition-colors ${
              active ? "text-foreground" : "text-muted-foreground hover:text-foreground"
            }`}
          >
            {mobile || short ? n.short : n.label}
            {active ? (
              <motion.span
                layoutId={layoutId}
                className="absolute inset-x-0 -bottom-0.5 h-px bg-foreground"
                transition={{ type: "spring", stiffness: 420, damping: 34 }}
              />
            ) : null}
          </Link>
        );
      })}
    </nav>
  );
}
