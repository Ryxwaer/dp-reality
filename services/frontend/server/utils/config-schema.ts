import Ajv from 'ajv'
import type { ValidateFunction } from 'ajv'

/**
 * JSON Schema validator for module-declared `configSchema`.
 *
 * This is the trust boundary between the module author (fully trusted
 * — their .mjs already runs in every user's browser with full page
 * privileges) and the end user filling in bot config (not trusted).
 * Every `bot.config` goes through `validateBotConfig(configSchema)`
 * before it's persisted; an invalid config is a 400, never a silent
 * runtime fail later.
 *
 * Hardening:
 *   - `$ref` resolution is disabled (only JSON Pointer refs inside the
 *     same document would be allowed by Ajv's default; we add a
 *     `validateFormats: false` + strict schema so authors don't sneak
 *     in remote schemas).
 *   - Schemas are capped at 16 KB of JSON so an author can't ship a
 *     pathological 10 MB schema that stalls Ajv on every save.
 *   - Validator compilation is cached per schema JSON string — same
 *     module, same cached compiled function.
 *   - The meta-schema validation on upload catches malformed schemas
 *     at module-upload time, not on every bot save.
 */

const SCHEMA_MAX_BYTES = 16 * 1024

const ajv = new Ajv({
  strict: true,
  allErrors: true,
  allowUnionTypes: true,
  validateFormats: false,
  loadSchema: async () => {
    throw new Error('remote $ref resolution is disabled')
  }
})

/**
 * Cache of compiled validators keyed by canonical schema JSON. Modules
 * don't change often; bot saves are the hot path, so avoiding
 * recompilation on every save is worth the tiny memory footprint.
 */
const COMPILED = new Map<string, ValidateFunction>()

function canonicalize(schema: unknown): string {
  return JSON.stringify(schema)
}

export interface ConfigValidationError {
  path: string
  message: string
}

export class ConfigValidationFailed extends Error {
  errors: ConfigValidationError[]
  constructor(errors: ConfigValidationError[]) {
    super(`bot config failed validation (${errors.length} issue(s))`)
    this.errors = errors
  }
}

/**
 * Compile-and-check a schema at module-upload time. Throws a human
 * readable error if the schema itself is malformed.
 */
export function validateConfigSchemaShape(schema: unknown): void {
  const canonical = canonicalize(schema)
  if (Buffer.byteLength(canonical, 'utf8') > SCHEMA_MAX_BYTES) {
    throw new Error(`configSchema exceeds ${SCHEMA_MAX_BYTES} bytes`)
  }
  if (!schema || typeof schema !== 'object' || Array.isArray(schema)) {
    throw new Error('configSchema must be a JSON object')
  }
  const s = schema as Record<string, unknown>
  if (s.type !== undefined && s.type !== 'object') {
    throw new Error('configSchema root `type` must be "object"')
  }
  try {
    ajv.compile(schema as object)
  } catch (err) {
    throw new Error(`configSchema is not a valid JSON Schema: ${(err as Error).message}`)
  }
}

function getValidator(schema: unknown): ValidateFunction {
  const canonical = canonicalize(schema)
  const cached = COMPILED.get(canonical)
  if (cached) return cached
  const fn = ajv.compile(schema as object)
  COMPILED.set(canonical, fn)
  return fn
}

/**
 * Validate a bot's config against the module-declared schema. Throws
 * {@link ConfigValidationFailed} on mismatch; returns silently on
 * success. The config is not mutated.
 */
export function validateBotConfig(
  schema: unknown,
  config: unknown
): void {
  const validate = getValidator(schema)
  const ok = validate(config)
  if (ok) return
  const errors: ConfigValidationError[] = (validate.errors ?? []).map(e => ({
    path: e.instancePath || '(root)',
    message: `${e.message ?? 'invalid'}${e.params ? ' ' + JSON.stringify(e.params) : ''}`
  }))
  throw new ConfigValidationFailed(errors)
}

/**
 * A permissive default used when a module is created without its own
 * schema. Accepts any JSON object — useful for trivial modules with
 * no user-editable config.
 */
export const EMPTY_CONFIG_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: true
}
