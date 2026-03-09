import { Link } from "react-router-dom";

function Footer() {
  return (
    <footer className="w-full h-16 flex items-center justify-center gap-2 sm:gap-4 md:gap-8 border-t border-[var(--footer-border)] bg-[var(--footer-bg)]">
      <Link
        to="/"
        className="text-muted-foreground no-underline px-3 py-2 transition-colors hover:text-foreground"
      >
        Home
      </Link>
      <Link
        to="/imprint"
        className="text-muted-foreground no-underline px-3 py-2 transition-colors hover:text-foreground"
      >
        Imprint
      </Link>
      <Link
        to="/privacy"
        className="text-muted-foreground no-underline px-3 py-2 transition-colors hover:text-foreground"
      >
        Privacy
      </Link>
      <Link
        to="/terms"
        className="text-muted-foreground no-underline px-3 py-2 transition-colors hover:text-foreground"
      >
        Terms
      </Link>
    </footer>
  );
}

export default Footer;
