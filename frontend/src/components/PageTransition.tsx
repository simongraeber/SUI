import type { ReactNode } from "react";
import { motion } from "framer-motion";
import { pageVariants } from "@/lib/animations";

interface PageTransitionProps {
  children: ReactNode;
  className?: string;
}

/**
 * Wraps page content with a consistent fade-up entrance animation.
 * Use this at the top level of every page component to ensure a
 * polished, uniform transition when navigation occurs.
 */
export default function PageTransition({ children, className }: PageTransitionProps) {
  return (
    <motion.div
      className={className}
      variants={pageVariants}
      initial="hidden"
      animate="show"
      exit="exit"
    >
      {children}
    </motion.div>
  );
}
