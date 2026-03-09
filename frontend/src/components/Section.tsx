import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface SectionProps {
  title: string;
  children: ReactNode;
  className?: string;
}

function Section({ title, children, className }: SectionProps) {
  return (
    <section className={cn("section", className)}>
      <h2 className="section-title">{title}</h2>
      {children}
    </section>
  );
}

export default Section;
