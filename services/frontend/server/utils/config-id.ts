import { randomBytes } from 'node:crypto'

/**
 * Mint a fresh per-configuration id. 12 random bytes hex-encoded — 24
 * chars, the same width as a Mongo ObjectID, used as the `_id` of the
 * row that the owning bot service stores in <service>_config and as
 * `config_id` in users.bots[].
 */
export function mintConfigId(): string {
  return randomBytes(12).toString('hex')
}
