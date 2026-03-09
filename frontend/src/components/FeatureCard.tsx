import { motion, type Variants } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";

export const featureContainerVariants: Variants = {
  hidden: {},
  show: {
    transition: {
      delayChildren: 0.6,
      staggerChildren: 0.15,
    },
  },
};

export const featureItemVariants: Variants = {
  hidden: { opacity: 0, y: 40 },
  show: { opacity: 1, y: 0, transition: { duration: 0.5, ease: "easeOut" as const } },
};

interface FeatureCardProps {
  image: string;
  title: string;
  description: string;
}

function FeatureCard({ image, title, description }: FeatureCardProps) {
  return (
    <motion.div
      variants={featureItemVariants}
      whileHover={{ y: -6, boxShadow: "0 12px 28px rgba(0,0,0,0.1)" }}
    >
      <Card className="text-center p-6 transition-transform">
        <CardContent className="p-0 space-y-3">
          <img
            src={image}
            alt={title}
            className="w-full h-40 object-contain rounded-lg"
            loading="lazy"
          />
          <h3 className="text-base font-bold text-foreground">{title}</h3>
          <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
        </CardContent>
      </Card>
    </motion.div>
  );
}

export default FeatureCard;
