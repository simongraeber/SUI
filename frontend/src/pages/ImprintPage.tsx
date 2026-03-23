import { motion } from "framer-motion";
import { Card, CardContent } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";
import LinkButton from "@/components/LinkButton";
import { User, MapPin, Mail, ArrowLeft } from "lucide-react";
import PageTransition from "@/components/PageTransition";
import GreetingsAnimation from "../components/GreetingsAnimation";
import { fadeUp, popIn, staggerContainer } from "@/lib/animations";

function ImprintPage() {
  return (
    <PageTransition className="max-w-3xl mx-auto px-4 py-8 text-center">
      <motion.h1
        className="text-3xl font-bold mb-6"
        variants={fadeUp}
        initial="hidden"
        animate="show"
      >
        Imprint
      </motion.h1>

      <motion.div
        variants={staggerContainer}
        initial="hidden"
        animate="show"
      >
        <motion.div variants={popIn}>
          <Card className="relative mb-8">
        {/* Gradient glow */}
        <div className="absolute overflow-hidden top-0 left-0 w-40 h-40 rounded-full bg-gradient-to-br from-[var(--imprint-glow-from)] to-[var(--imprint-glow-to)] blur-[40px]" />

        <CardContent className="relative z-10 flex flex-col md:flex-row items-center gap-6 p-8">
          {/* Logo & Animation */}
          <div className="shrink-0 flex flex-col items-center justify-center">
            <img
              src="/LogoSIU.svg"
              alt="SIU Logo"
              className="w-24 h-24 mb-2 rounded-xl object-cover logo-light"
            />
            <img
              src="/LogoSIUDark.svg"
              alt="SIU Logo"
              className="w-24 h-24 mb-2 rounded-xl object-cover logo-dark"
            />
            <div className="relative overflow-visible scale-[1.35] -rotate-6 pl-2">
              <GreetingsAnimation />
            </div>
          </div>

          {/* Details */}
          <div className="flex flex-col gap-4 text-left min-w-0">
            <div className="flex items-center gap-2">
              <User className="size-5 text-primary" />
              <h2 className="text-xl font-bold">Simon Graeber</h2>
            </div>

            <Separator className="w-16 bg-primary h-0.5" />

            <div className="flex flex-col gap-3 text-sm">
              <div className="flex items-start gap-2">
                <MapPin className="size-4 text-muted-foreground mt-0.5 shrink-0" />
                <div>
                  <p className="m-0">Mitthenheimer Str. 6</p>
                  <p className="m-0">85764 Oberschleißheim</p>
                  <p className="m-0">Germany</p>
                </div>
              </div>
              <div className="flex items-start gap-2">
                <Mail className="size-4 text-muted-foreground mt-0.5 shrink-0" />
                <a
                  href="mailto:80-read-crewel@icloud.com"
                  className="text-primary no-underline hover:underline"
                >
                  80-read-crewel@icloud.com
                </a>
              </div>
            </div>
          </div>
        </CardContent>
      </Card>
        </motion.div>

        <motion.div variants={fadeUp}>
          <LinkButton variant="outline" to="/">
            <ArrowLeft className="size-4" />
            Back to Home
          </LinkButton>
        </motion.div>
      </motion.div>
    </PageTransition>
  );
}

export default ImprintPage;
