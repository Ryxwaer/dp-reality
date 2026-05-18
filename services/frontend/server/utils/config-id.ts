import { randomBytes } from 'node:crypto'

export function mintConfigId(): string {
  return randomBytes(12).toString('hex')
}
