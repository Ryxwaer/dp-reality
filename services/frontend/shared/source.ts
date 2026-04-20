export function sourceLabel(key: string): string {
  if (!key) return 'Unknown'
  return key.charAt(0).toUpperCase() + key.slice(1)
}
