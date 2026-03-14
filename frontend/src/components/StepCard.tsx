import { motion } from "framer-motion";
import { Card } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { slideInX } from "@/lib/animations";

interface StepCardProps {
  step: number;
  image: string;
  title: string;
  description: string;
  reverse?: boolean;
}

function StepCard({ step, image, title, description, reverse = false }: StepCardProps) {
  return (
    <motion.div
      custom={reverse ? 60 : -60}
      variants={slideInX}
      initial="hidden"
      whileInView="show"
      viewport={{ once: true, margin: "-60px" }}
    >
      <Card
        className={cn(
          "flex flex-col items-center gap-6 p-6 shadow-md md:gap-10 md:p-8",
          reverse ? "md:flex-row-reverse" : "md:flex-row",
        )}
      >
        <motion.div
          className="shrink-0 w-full max-w-[260px]"
          whileHover={{ scale: 1.04 }}
          transition={{ duration: 0.3 }}
        >
          <img
            src={image}
            alt={title}
            className="w-full rounded-xl object-cover shadow-lg"
            loading="lazy"
          />
        </motion.div>
        <div className={cn("flex-1 text-center", reverse ? "md:text-right" : "md:text-left")}>
          <Badge variant="secondary" className="mb-2 uppercase tracking-wider text-xs">
            Step {step}
          </Badge>
          <h3 className="text-xl font-bold text-foreground mt-2 mb-1">{title}</h3>
          <p className="text-sm leading-relaxed text-muted-foreground">{description}</p>
        </div>
      </Card>
    </motion.div>
  );
}

export default StepCard;
