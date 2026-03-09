import { Loader2 } from "lucide-react";

interface LoadingStateProps {
  /** Message displayed beneath the spinner. */
  message?: string;
}

/**
 * Centered loading spinner + optional message.
 * Use in place of raw "Loading…" text for a consistent look
 * across all pages and guard components.
 */
export default function LoadingState({ message = "Loading…" }: LoadingStateProps) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 min-h-[60vh]">
      <Loader2 className="size-8 animate-spin text-primary" />
      <p className="text-muted-foreground text-sm">{message}</p>
    </div>
  );
}
