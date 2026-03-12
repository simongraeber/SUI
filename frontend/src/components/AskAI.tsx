import { useState, useRef, useEffect, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Sparkles, Send, Loader2,
  Goal, Flame, Crown, Trophy, Gamepad2,
  Target, Users, TrendingUp, Clock, Star,
  type LucideIcon,
} from "lucide-react";
import { askQuestion, resolveImageUrl, type AskResponse, type AIComponent, ApiError } from "@/lib/api";
import { Avatar, AvatarImage, AvatarFallback } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";

/** Card wrapper for AI answer components — uses bg-background so the
 *  border-border is visible against the parent Card's bg-card, matching
 *  the same contrast the leaderboard Card has on the page. */
function AICard({ children, className = "" }: { children: React.ReactNode; className?: string }) {
  return (
    <div className={`rounded-2xl border border-border bg-background text-card-foreground shadow-sm ${className}`}>
      {children}
    </div>
  );
}

/* ── Icon + color mapping ── */
const ICON_MAP: Record<string, LucideIcon> = {
  goal: Goal,
  flame: Flame,
  crown: Crown,
  trophy: Trophy,
  gamepad: Gamepad2,
  target: Target,
  users: Users,
  "trending-up": TrendingUp,
  clock: Clock,
  star: Star,
};

const ICON_STYLE: Record<string, { iconColor: string }> = {
  goal:           { iconColor: "text-red-500" },
  flame:          { iconColor: "text-orange-500" },
  crown:          { iconColor: "text-yellow-500" },
  trophy:         { iconColor: "text-green-500" },
  gamepad:        { iconColor: "text-blue-500" },
  target:         { iconColor: "text-purple-500" },
  users:          { iconColor: "text-blue-500" },
  "trending-up":  { iconColor: "text-green-500" },
  clock:          { iconColor: "text-blue-500" },
  star:           { iconColor: "text-yellow-500" },
};

const EXAMPLE_QUESTIONS = [
  "Who has the most friendly fire goals?",
  "What is the best team combination?",
  "Who scored the most goals?",
  "What's the longest game ever played?",
  "Who wins most often on side A?",
];

/* ── Component Renderers ── */

/** Renders 1+ overlapping avatars from an image_urls array */
function AvatarStack({ urls, name, size = "sm" }: { urls?: string[]; name: string; size?: "sm" | "md" }) {
  const resolved = (urls ?? []).map(resolveImageUrl).filter(Boolean) as string[];
  if (resolved.length === 0) return null;
  const sizeClass = size === "md" ? "size-10" : "size-6";
  const textClass = size === "md" ? "text-xs" : "text-[10px]";
  const overlap = size === "md" ? "-ml-3" : "-ml-2";

  return (
    <span className="flex items-center">
      {resolved.map((url, i) => (
        <Avatar key={i} className={`${sizeClass} ${i > 0 ? overlap : ""} ring-2 ring-background`}>
          <AvatarImage src={url} alt={name} />
          <AvatarFallback className={textClass}>{name.charAt(0)}</AvatarFallback>
        </Avatar>
      ))}
    </span>
  );
}

function RankedListCard({ icon, title, items }: Extract<AIComponent, { type: "ranked-list" }>) {
  const Icon = ICON_MAP[icon] ?? Star;
  const style = ICON_STYLE[icon] ?? ICON_STYLE.star;

  return (
    <AICard>
      <CardContent className="pt-5 pb-4">
        <div className="flex items-center gap-2 mb-3">
          <Icon className={`size-5 shrink-0 ${style.iconColor}`} />
          <span className="text-sm font-semibold">{title}</span>
        </div>
        <div className="space-y-1.5">
          {items.map((item, i) => (
              <div key={i} className="flex items-center justify-between text-sm">
                <span className="flex items-center gap-2">
                  <span className="text-xs text-muted-foreground font-medium w-5 text-right shrink-0">
                    {i + 1}.
                  </span>
                  <AvatarStack urls={item.image_urls} name={item.label} />
                  <span className="font-medium">{item.label}</span>
                </span>
                <span className="text-muted-foreground font-mono text-xs">{item.value}</span>
              </div>
          ))}
        </div>
      </CardContent>
    </AICard>
  );
}

function StatHighlightCard({ icon, label, value, subtitle, image_urls }: Extract<AIComponent, { type: "stat-highlight" }>) {
  const Icon = ICON_MAP[icon] ?? Star;
  const style = ICON_STYLE[icon] ?? ICON_STYLE.star;
  const hasAvatar = image_urls && image_urls.length > 0;

  return (
    <AICard>
      <CardContent className="pt-5 pb-4 flex items-center gap-4">
        {hasAvatar ? (
          <AvatarStack urls={image_urls} name={label} size="md" />
        ) : (
          <div className="p-2.5 rounded-xl bg-muted">
            <Icon className={`size-6 ${style.iconColor}`} />
          </div>
        )}
        <div>
          <p className="text-xs text-muted-foreground font-medium">{label}</p>
          <p className="text-2xl font-bold tracking-tight">{value}</p>
          {subtitle && <p className="text-xs text-muted-foreground">{subtitle}</p>}
        </div>
      </CardContent>
    </AICard>
  );
}

function ComparisonCard({ title, sides }: Extract<AIComponent, { type: "comparison" }>) {
  return (
    <AICard>
      <CardContent className="pt-5 pb-4">
        <p className="text-sm font-semibold mb-3 text-center">{title}</p>
        <div className="grid grid-cols-2 gap-4">
          {sides.map((side, i) => (
            <div key={i} className="text-center space-y-2">
              <div className="flex justify-center">
                <AvatarStack urls={side.image_urls} name={side.name} size="md" />
              </div>
              <p className="text-sm font-semibold">{side.name}</p>
              {side.stats.map((s) => (
                <div key={s.label} className="text-xs">
                  <span className="text-muted-foreground">{s.label}: </span>
                  <span className="font-mono font-medium">{s.value}</span>
                </div>
              ))}
            </div>
          ))}
        </div>
      </CardContent>
    </AICard>
  );
}

function BarChartCard({ title, bars }: Extract<AIComponent, { type: "bar-chart" }>) {
  const max = Math.max(...bars.map((b) => b.value), 1);

  return (
    <AICard>
      <CardContent className="pt-5 pb-4">
        <p className="text-sm font-semibold mb-3">{title}</p>
        <div className="space-y-2">
          {bars.map((bar, i) => (
              <div key={i} className="space-y-1">
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5">
                    <AvatarStack urls={bar.image_urls} name={bar.label} />
                    <span className="font-medium">{bar.label}</span>
                  </span>
                  <span className="font-mono text-muted-foreground">{bar.value}</span>
                </div>
                <div className="h-2 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full rounded-full bg-primary/60"
                    style={{ width: `${(bar.value / max) * 100}%` }}
                  />
                </div>
              </div>
          ))}
        </div>
      </CardContent>
    </AICard>
  );
}

function TableCard({ title, columns, rows }: Extract<AIComponent, { type: "table" }>) {
  return (
    <AICard>
      <CardContent className="pt-5 pb-4">
        <p className="text-sm font-semibold mb-3">{title}</p>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-border">
                {columns.map((col) => (
                  <th key={col} className="text-left py-1.5 px-2 font-medium text-muted-foreground">
                    {col}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {rows.map((row, i) => (
                <tr key={i} className="border-b border-border/50 last:border-0">
                  {columns.map((col) => (
                    <td key={col} className="py-1.5 px-2">{row[col] ?? ""}</td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </CardContent>
    </AICard>
  );
}

function CalloutCard({ emoji, text }: Extract<AIComponent, { type: "callout" }>) {
  return (
    <AICard className="px-4 py-3 flex items-start gap-2">
      <span className="text-lg">{emoji}</span>
      <p className="text-sm text-foreground leading-relaxed">{text}</p>
    </AICard>
  );
}

function HeadToHeadCard({ player_a, player_b, stats }: Extract<AIComponent, { type: "head-to-head" }>) {
  return (
    <AICard>
      <CardContent className="pt-5 pb-4">
        {/* Player headers */}
        <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 mb-4">
          <div className="text-center">
            <div className="flex justify-center mb-1">
              <AvatarStack urls={player_a.image_urls} name={player_a.name} size="md" />
            </div>
            <p className="text-sm font-semibold">{player_a.name}</p>
          </div>
          <span className="text-xs font-bold text-muted-foreground">VS</span>
          <div className="text-center">
            <div className="flex justify-center mb-1">
              <AvatarStack urls={player_b.image_urls} name={player_b.name} size="md" />
            </div>
            <p className="text-sm font-semibold">{player_b.name}</p>
          </div>
        </div>
        {/* Stats rows */}
        <div className="space-y-1.5">
          {stats.map((s) => (
            <div key={s.label} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 text-xs">
              <span className="text-right font-mono font-medium">{s.a}</span>
              <span className="text-muted-foreground text-center min-w-[60px]">{s.label}</span>
              <span className="text-left font-mono font-medium">{s.b}</span>
            </div>
          ))}
        </div>
      </CardContent>
    </AICard>
  );
}

/* ── Apple-style Shimmer Border ── */
function AIShimmerBorder({
  active = false,
  borderWidth = 2,
  className,
  children,
}: {
  active?: boolean;
  borderWidth?: number;
  className?: string;
  children: React.ReactNode;
}) {
  const wrapperRef = useRef<HTMLDivElement>(null);

  // JS-driven rotation — eased multi-wave motion for organic Apple feel
  const rafRef = useRef<number>(0);
  const startRef = useRef<number | null>(null);

  const tick = useCallback((ts: number) => {
    if (startRef.current === null) startRef.current = ts;
    const t = (ts - startRef.current) / 1000; // seconds
    // Layer two sine waves at different speeds for non-uniform, lush movement
    const angle = (t * 90)                  // slow base drift (~4s per revolution)
      + Math.sin(t * 1.2) * 30             // broad sway
      + Math.sin(t * 2.7) * 15;            // faster shimmer ripple
    wrapperRef.current?.style.setProperty("--shimmer-angle", `${angle % 360}deg`);
    rafRef.current = requestAnimationFrame(tick);
  }, []);

  useEffect(() => {
    if (active) {
      rafRef.current = requestAnimationFrame(tick);
    } else {
      cancelAnimationFrame(rafRef.current);
      startRef.current = null;
    }
    return () => cancelAnimationFrame(rafRef.current);
  }, [active, tick]);

  return (
    <div ref={wrapperRef} className={cn("relative", className)}>
      {/* Glow — blurred gradient halo */}
      <div
        className="absolute -inset-1 pointer-events-none transition-opacity duration-700"
        style={{ opacity: active ? 0.45 : 0, willChange: "transform" }}
      >
        <div
          className="ai-shimmer ai-shimmer-glow size-full"
          style={{ "--shimmer-radius": "0.875rem" } as React.CSSProperties}
        />
      </div>
      {/* Gradient border */}
      <div
        className="absolute inset-0 transition-opacity duration-700"
        style={{ opacity: active ? 1 : 0 }}
      >
        <div
          className="ai-shimmer size-full"
          style={{ "--shimmer-radius": "0.75rem" } as React.CSSProperties}
        />
      </div>
      {/* Inner content */}
      <div
        className="relative bg-background transition-[border-color] duration-500 focus-within:ring-2 focus-within:ring-ring focus-within:ring-offset-2 ring-offset-background"
        style={{
          borderRadius: "calc(0.75rem - 2px)",
          margin: `${borderWidth}px`,
          border: "1px solid",
          borderColor: active ? "transparent" : "var(--input)",
        }}
      >
        {children}
      </div>
    </div>
  );
}

function AIComponentRenderer({ component }: { component: AIComponent }) {
  switch (component.type) {
    case "ranked-list":
      return <RankedListCard {...component} />;
    case "stat-highlight":
      return <StatHighlightCard {...component} />;
    case "comparison":
      return <ComparisonCard {...component} />;
    case "bar-chart":
      return <BarChartCard {...component} />;
    case "table":
      return <TableCard {...component} />;
    case "callout":
      return <CalloutCard {...component} />;
    case "head-to-head":
      return <HeadToHeadCard {...component} />;
    default:
      return null;
  }
}

/* ── Main component ── */
function AskAI({ groupId }: { groupId: string }) {
  const [question, setQuestion] = useState("");
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<AskResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const handleAsk = async (q?: string) => {
    const text = (q ?? question).trim();
    if (!text || loading) return;
    setLoading(true);
    setError(null);
    setResult(null);
    try {
      const res = await askQuestion(groupId, text);
      setResult(res);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError("Something went wrong. Please try again.");
      }
    } finally {
      setLoading(false);
    }
  };

  const handleExampleClick = (q: string) => {
    setQuestion(q);
    handleAsk(q);
  };

  return (
    <Card className="mt-8 overflow-visible">
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Sparkles className="size-5 text-purple-500" />
          Ask AI
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        {/* Input row with shimmer when loading */}
        <AIShimmerBorder active={loading} borderWidth={2}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              handleAsk();
            }}
            className="flex gap-2 p-0"
          >
            <Input
              ref={inputRef}
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              placeholder="Ask anything about your group's stats…"
              disabled={loading}
              maxLength={500}
              className="border-0 focus-visible:ring-0 focus-visible:ring-offset-0"
            />
            <Button type="submit" disabled={loading || !question.trim()} size="icon" className="shrink-0">
              {loading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Send className="size-4" />
              )}
            </Button>
          </form>
        </AIShimmerBorder>

        {/* Example questions */}
        {!result && !error && !loading && (
          <div className="flex flex-wrap gap-1.5">
            {EXAMPLE_QUESTIONS.map((q) => (
              <button
                key={q}
                onClick={() => handleExampleClick(q)}
                className="text-xs px-2.5 py-1 rounded-full border border-border bg-muted/50 text-muted-foreground hover:bg-accent hover:text-accent-foreground transition-colors cursor-pointer"
              >
                {q}
              </button>
            ))}
          </div>
        )}

        {/* Error */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="rounded-lg bg-destructive/10 text-destructive text-sm px-4 py-3"
            >
              {error}
            </motion.div>
          )}
        </AnimatePresence>

        {/* Result */}
        <AnimatePresence>
          {result && (
            <motion.div
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0 }}
              className="space-y-3"
            >
              {/* Answer text — only shown when there are no components */}
              {result.components.length === 0 && (
                <AICard className="px-4 py-3">
                  <div className="flex items-start gap-2">
                    <Sparkles className="size-4 text-purple-500 mt-0.5 shrink-0" />
                    <p className="text-sm leading-relaxed text-foreground">{result.answer}</p>
                  </div>
                </AICard>
              )}

              {/* Generated components */}
              {result.components.length > 0 && (
                <div className="grid gap-3 sm:grid-cols-2">
                  {result.components.map((comp, i) => (
                    <motion.div
                      key={i}
                      initial={{ opacity: 0, y: 8 }}
                      animate={{ opacity: 1, y: 0 }}
                      transition={{ delay: i * 0.1 }}
                      className={
                        ["table", "head-to-head", "comparison", "bar-chart"].includes(comp.type)
                          ? "sm:col-span-2" : ""
                      }
                    >
                      <AIComponentRenderer component={comp} />
                    </motion.div>
                  ))}
                </div>
              )}

              {/* Rate limit + disclaimer */}
              <div className="flex items-center justify-between text-xs text-muted-foreground">
                <span>AI can make mistakes — verify important stats.</span>
                <span>
                  {result.remaining} question{result.remaining !== 1 ? "s" : ""}{" "}
                  remaining this hour
                </span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </CardContent>
    </Card>
  );
}

export default AskAI;
