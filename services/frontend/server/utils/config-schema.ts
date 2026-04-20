import Ajv from 'ajv'
import type { ValidateFunction } from 'ajv'

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

export const EMPTY_CONFIG_SCHEMA: Record<string, unknown> = {
  type: 'object',
  additionalProperties: true
}
