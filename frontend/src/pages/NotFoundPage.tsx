import { ArrowLeft } from "lucide-react";
import { motion } from "framer-motion";
import LinkButton from "@/components/LinkButton";
import { fadeUpIndexed } from "@/lib/animations";
import notFoundImage from "../assets/Messages/404.webp";

function NotFoundPage() {
  return (
    <div className="flex flex-col items-center justify-center text-center min-h-[70vh] px-6 py-12">
      <motion.img
        src={notFoundImage}
        alt="Page not found"
        className="w-[min(320px,80vw)] mb-8 rounded-2xl drop-shadow-[0_8px_24px_rgba(99,102,241,0.18)] md:w-[360px]"
        custom={0}
        variants={fadeUpIndexed}
        initial="hidden"
        animate="show"
      />

      <motion.h1
        className="text-4xl md:text-5xl font-extrabold tracking-tight mb-3 bg-gradient-to-br from-[var(--gradient-title-from)] to-[var(--gradient-title-to)] bg-clip-text text-transparent"
        custom={1}
        variants={fadeUpIndexed}
        initial="hidden"
        animate="show"
      >
        Lost in the Game
      </motion.h1>

      <motion.p
        className="max-w-md mx-auto mb-8 text-lg leading-relaxed text-muted-foreground"
        custom={2}
        variants={fadeUpIndexed}
        initial="hidden"
        animate="show"
      >
        The page you're looking for doesn't exist or has been moved.
      </motion.p>

      <motion.div
        custom={3}
        variants={fadeUpIndexed}
        initial="hidden"
        animate="show"
      >
        <LinkButton size="lg" to="/">
          <ArrowLeft className="size-4" />
          Back to Home
        </LinkButton>
      </motion.div>
    </div>
  );
}

export default NotFoundPage;
