import { Link } from "react-router-dom";
import { motion, type Variants } from "framer-motion";
import { Button } from "@/components/ui/button";

interface HeroProps {
  title: string;
  subtitle: string;
  ctaText: string;
  ctaLink: string;
  logoSrc: string;
  logoDarkSrc?: string;
}

const container: Variants = {
  hidden: {},
  show: { transition: { staggerChildren: 0.18 } },
};

const fadeUp: Variants = {
  hidden: { opacity: 0, y: 30 },
  show: { opacity: 1, y: 0, transition: { duration: 0.6, ease: "easeOut" as const } },
};

function Hero({ title, subtitle, ctaText, ctaLink, logoSrc, logoDarkSrc }: HeroProps) {
  return (
    <motion.div
      className="hero"
      variants={container}
      initial="hidden"
      animate="show"
    >
      <motion.img
        src={logoSrc}
        alt="SIU Logo"
        className={`hero-logo${logoDarkSrc ? ' logo-light' : ''}`}
        variants={fadeUp}
      />
      {logoDarkSrc && (
        <motion.img
          src={logoDarkSrc}
          alt="SIU Logo"
          className="hero-logo logo-dark"
          variants={fadeUp}
        />
      )}
      <motion.h1 className="hero-title" variants={fadeUp}>
        {title}
      </motion.h1>
      <motion.p className="hero-subtitle" variants={fadeUp}>
        {subtitle}
      </motion.p>
      <motion.div variants={fadeUp}>
        <Button size="lg" asChild>
          <Link to={ctaLink}>{ctaText}</Link>
        </Button>
      </motion.div>
    </motion.div>
  );
}

export default Hero;
