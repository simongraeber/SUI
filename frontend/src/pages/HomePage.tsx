import Hero from "../components/Hero";
import Section from "../components/Section";
import FeatureCard from "../components/FeatureCard";
import StepCard from "../components/StepCard";
import { motion } from "framer-motion";
import { ExternalLink } from "lucide-react";
import { useAuth } from "@/lib/AuthContext";
import LinkButton from "@/components/LinkButton";
import { featureContainerVariants } from "@/lib/animations";
import onboardingWelcome from "../assets/onbording/onboarding-welcome.webp";
import onboardingCreateTeam from "../assets/onbording/onboarding-create-team.webp";
import onboardingInvite from "../assets/onbording/onboarding-invite.webp";
import featureRealtime from "../assets/onbording/feature-icon-realtime.webp";
import featureLeaderboard from "../assets/onbording/feature-icon-leaderboard.webp";
import featureTeam from "../assets/onbording/feature-icon-team.webp";
import featureMobile from "../assets/onbording/feature-icon-mobile.webp";

function HomePage() {
  const { user } = useAuth();

  return (
    <div className="home-page">
      {/* Hero */}
      <Hero
        logoSrc="/LogoSIU.svg"
        logoDarkSrc="/LogoSIUDark.svg"
        title="Someone Is Unbeatable"
        subtitle="Track your Tischkicker games in real time, compete on fair leaderboards, and prove who's truly unbeatable."
        ctaText={user ? "Go to Dashboard" : "Get Started"}
        ctaLink={user ? "/dashboard" : "/login"}
      />

      {/* Features */}
      <Section title="Why SIU?">
        <motion.div
          className="features-grid"
          variants={featureContainerVariants}
          initial="hidden"
          animate="show"
        >
          <FeatureCard
            image={featureRealtime}
            title="Real-Time Tracking"
            description="Every goal, every pause, every comeback — synced live across all devices in your group."
          />
          <FeatureCard
            image={featureLeaderboard}
            title="Fair Leaderboards"
            description="Elo ratings, Bayesian-adjusted win rates, and more. No one-game flukes at the top."
          />
          <FeatureCard
            image={featureTeam}
            title="Team Play"
            description="Create groups, invite friends with a link, and track everyone's stats in one place."
          />
          <FeatureCard
            image={featureMobile}
            title="Mobile-First"
            description="Designed for phones first. Score goals right from your pocket — or cast to a big screen."
          />
        </motion.div>
      </Section>

      {/* How It Works */}
      <Section title="How It Works" className="section--alt">
        <div className="steps">
          <StepCard
            step={1}
            image={onboardingWelcome}
            title="Sign In"
            description="Log in instantly with your Google account — no lengthy registration needed."
          />
          <StepCard
            step={2}
            image={onboardingCreateTeam}
            title="Create a Group"
            description="Set up your group in seconds. Pick a name and you're ready to compete."
            reverse
          />
          <StepCard
            step={3}
            image={onboardingInvite}
            title="Invite & Play"
            description="Share your invite link, start a match, and track goals in real time across every device."
          />
        </div>
      </Section>

      <Section title="Watch SIU in Action">
        <div className="mx-auto max-w-4xl">
          <div className="overflow-hidden rounded-2xl border border-border bg-card shadow-lg">
            <div className="relative w-full pb-[56.25%]">
              <iframe
                className="absolute left-0 top-0 h-full w-full"
                src="https://www.youtube-nocookie.com/embed/I19aq_isAMI"
                title="Someone Is Unbeatable - Demo Video"
                allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
                referrerPolicy="strict-origin-when-cross-origin"
                allowFullScreen
              />
            </div>
          </div>

          <p className="mt-3 text-center text-xs opacity-60">
            By pressing play, you agree to YouTube&apos;s{" "}
            <a
              href="https://www.youtube.com/t/terms"
              target="_blank"
              rel="noreferrer"
              className="underline"
            >
              Terms of Service
            </a>{" "}
            and{" "}
            <a
              href="https://policies.google.com/privacy"
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 underline"
            >
              Privacy Policy
              <ExternalLink className="size-3" />
            </a>
            .
          </p>
        </div>
      </Section>

      {/* CTA */}
      <section className="cta-section">
        <h2 className="cta-title">Ready to play?</h2>
        <p className="cta-subtitle">
          Create your group, invite your rivals, and find out who's truly
          unbeatable.
        </p>
        <LinkButton
          size="lg"
          variant="secondary"
          className="bg-white text-primary hover:bg-secondary"
          to={user ? "/dashboard" : "/login"}
        >
          {user ? "Go to Dashboard" : "Sign In with Google"}
        </LinkButton>
      </section>
    </div>
  );
}

export default HomePage;
