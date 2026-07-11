// Minimal className joiner (clsx-lite). Falsy entries dropped.
export function cn(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}
