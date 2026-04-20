/**
 * Source helpers shared between frontend and BFF. After the modules
 * rework, `source` is a top-level field on both `modules` and
 * `users.bots[]`, so there's no derivation from matcher filters
 * anymore — the only thing left is humanising a key for display.
 */

/** Human-readable label for a source key. Known portals get a curated name; */
/** unknowns fall back to the raw key (title-cased). */
export function sourceLabel(key: string): string {
  const known: Record<string, string> = {
    bazos: 'Bazos',
    sreality: 'Sreality'
  }
  if (known[key]) return known[key]
  if (!key) return 'Unknown'
  return key.charAt(0).toUpperCase() + key.slice(1)
}
