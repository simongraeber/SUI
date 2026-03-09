import type { Variants } from "framer-motion";

/* ──────────────────────────────────────────────────────────────
 * Shared animation variants used across pages and components.
 * Import from "@/lib/animations" for a consistent look & feel.
 * ────────────────────────────────────────────────────────────── */

/** Fade-up entrance used by page-level wrappers. */
export const pageVariants: Variants = {
  hidden: { opacity: 0, y: 18 },
  show: {
    opacity: 1,
    y: 0,
    transition: { duration: 0.45, ease: "easeOut" },
  },
  exit: { opacity: 0, y: -12, transition: { duration: 0.25 } },
};

/** Simple fade-up for individual elements (cards, headings, etc.). */
export const fadeUp: Variants = {
  hidden: { opacity: 0, y: 24 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: "easeOut" } },
};

/** Indexed fade-up — pass `custom={index}` to stagger manually. */
export const fadeUpIndexed: Variants = {
  hidden: { opacity: 0, y: 24 },
  show: (i: number) => ({
    opacity: 1,
    y: 0,
    transition: { delay: i * 0.1, duration: 0.45, ease: "easeOut" },
  }),
};

/** Stagger container — wrap children that use `fadeUp` or any child variant. */
export const staggerContainer: Variants = {
  hidden: {},
  show: {
    transition: { staggerChildren: 0.1, delayChildren: 0.05 },
  },
};

/** Pop-in (scale) used for modals, splashes, overlays. */
export const popIn: Variants = {
  hidden: { opacity: 0, scale: 0.6 },
  show: {
    opacity: 1,
    scale: 1,
    transition: { type: "spring", stiffness: 400, damping: 18 },
  },
  exit: { opacity: 0, scale: 0.6, transition: { duration: 0.2 } },
};
