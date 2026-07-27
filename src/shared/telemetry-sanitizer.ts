const FILTERED_VALUE = '[Filtered]'
const FILTERED_SESSION = '[Filtered Session]'
const PRIVATE_PATH = '[PrivatePath]'
const HOME_PATH = '[Home]'

const SECRET_KEYS = new Set([
  'apikey',
  'xapikey',
  'anthropicapikey',
  'openaiapikey',
  'authorization',
  'proxyauthorization',
  'accesstoken',
  'refreshtoken',
  'authtoken',
  'password',
  'passwd',
  'clientsecret',
  'secretkey',
  'cookie',
  'setcookie',
  'sentrydsn',
])

const SESSION_KEYS = new Set([
  'sessionid',
  'clientsessionkey',
  'sdksessionid',
])

const TOKEN_PATTERNS = [
  /\bsk-ant-[a-z0-9_-]{8,}\b/gi,
  /\bsk-[a-z0-9_-]{16,}\b/gi,
  /\bBearer\s+[a-z0-9._~+/=-]{8,}\b/gi,
]

const QUERY_SECRET_PATTERN =
  /([?&](?:api[_-]?key|access[_-]?token|auth[_-]?token|token|secret|password)=)[^&#\s]+/gi
const URL_CREDENTIAL_PATTERN = /(https?:\/\/)[^@\s/:]+:[^@\s]+@/gi

export interface TelemetrySanitizationOptions {
  secretValues?: ReadonlyArray<string | null | undefined>
  privatePathPrefixes?: readonly string[]
  homeDirectory?: string
}

function normalizeKey(key: string): string {
  return key.toLowerCase().replace(/[^a-z0-9]/g, '')
}

function isSecretKey(key: string): boolean {
  const normalized = normalizeKey(key)
  return SECRET_KEYS.has(normalized)
    || normalized.endsWith('apikey')
    || normalized.endsWith('password')
    || normalized.endsWith('secretkey')
}

function isSessionKey(key: string): boolean {
  return SESSION_KEYS.has(normalizeKey(key))
}

function replaceLiteral(value: string, search: string, replacement: string): string {
  if (!search || !value.includes(search)) return value
  return value.split(search).join(replacement)
}

function sanitizeString(value: string, options: TelemetrySanitizationOptions): string {
  let sanitized = value

  for (const secret of options.secretValues || []) {
    if (secret && secret.length >= 6) {
      sanitized = replaceLiteral(sanitized, secret, FILTERED_VALUE)
    }
  }

  for (const pattern of TOKEN_PATTERNS) {
    sanitized = sanitized.replace(pattern, FILTERED_VALUE)
  }
  sanitized = sanitized
    .replace(QUERY_SECRET_PATTERN, `$1${FILTERED_VALUE}`)
    .replace(URL_CREDENTIAL_PATTERN, `$1${FILTERED_VALUE}@`)

  const privatePaths = [...(options.privatePathPrefixes || [])]
    .filter((prefix) => prefix.length > 1)
    .sort((left, right) => right.length - left.length)
  for (const prefix of privatePaths) {
    sanitized = replaceLiteral(sanitized, prefix, PRIVATE_PATH)
  }
  if (options.homeDirectory && options.homeDirectory.length > 1) {
    sanitized = replaceLiteral(sanitized, options.homeDirectory, HOME_PATH)
  }

  return sanitized
}

function sanitizeValue(
  value: unknown,
  key: string | null,
  options: TelemetrySanitizationOptions,
  seen: WeakMap<object, unknown>,
): unknown {
  if (key && isSecretKey(key)) return FILTERED_VALUE
  if (key && isSessionKey(key)) return FILTERED_SESSION
  if (typeof value === 'string') return sanitizeString(value, options)
  if (value === null || typeof value !== 'object') return value

  const cached = seen.get(value)
  if (cached) return cached

  if (Array.isArray(value)) {
    const sanitized: unknown[] = []
    seen.set(value, sanitized)
    for (const item of value) {
      sanitized.push(sanitizeValue(item, null, options, seen))
    }
    return sanitized
  }

  const sanitized: Record<string, unknown> = {}
  seen.set(value, sanitized)
  for (const [entryKey, entryValue] of Object.entries(value)) {
    sanitized[entryKey] = sanitizeValue(entryValue, entryKey, options, seen)
  }
  return sanitized
}

export function sanitizeTelemetryEvent<T>(
  event: T,
  options: TelemetrySanitizationOptions = {},
): T {
  return sanitizeValue(event, null, options, new WeakMap()) as T
}
