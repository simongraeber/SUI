import { useTransition } from "react";
import { useNavigate } from "react-router-dom";

const LINKS = [
  { to: "/", label: "Home" },
  { to: "/imprint", label: "Imprint" },
  { to: "/privacy", label: "Privacy" },
  { to: "/terms", label: "Terms" },
] as const;

function FooterLink({ to, label }: { to: string; label: string }) {
  const navigate = useNavigate();
  const [isPending, startTransition] = useTransition();

  return (
    <button
      onClick={() => startTransition(() => navigate(to))}
      className={`text-muted-foreground no-underline px-3 py-2 transition-colors hover:text-foreground inline-flex items-center gap-1.5 bg-transparent border-none cursor-pointer text-sm font-medium ${isPending ? "animate-pulse" : ""}`}
    >
      {label}
    </button>
  );
}

function Footer() {
  return (
    <footer className="w-full h-16 flex items-center justify-center gap-2 sm:gap-4 md:gap-8 border-t border-[var(--footer-border)] bg-[var(--footer-bg)]">
      {LINKS.map((link) => (
        <FooterLink key={link.to} to={link.to} label={link.label} />
      ))}
    </footer>
  );
}

export default Footer;
