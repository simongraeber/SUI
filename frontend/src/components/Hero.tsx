import { motion } from "framer-motion";
import LinkButton from "@/components/LinkButton";
import { fadeUp, staggerContainer } from "@/lib/animations";

interface HeroProps {
  title: string;
  subtitle: string;
  ctaText: string;
  ctaLink: string;
  logoSrc: string;
  logoDarkSrc?: string;
}

function Hero({ title, subtitle, ctaText, ctaLink, logoSrc, logoDarkSrc }: HeroProps) {
  return (
    <motion.div
      className="hero"
      variants={staggerContainer}
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
        <LinkButton size="lg" to={ctaLink}>{ctaText}</LinkButton>
      </motion.div>
    </motion.div>
  );
}

export default Hero;
