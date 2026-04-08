import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/** Elo-tier color class. */
export function eloColor(elo: number): string {
  if (elo >= 1100) return "text-green-600 dark:text-green-400";
  if (elo < 900) return "text-red-500";
  return "";
}

export function formatElo(elo: number): number {
  return Math.round(elo);
}
