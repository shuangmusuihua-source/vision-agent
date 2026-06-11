import { randomUUID } from 'crypto'

/**
 * Generate a UUID v4 string.
 * Wrapper around Node's crypto.randomUUID() for consistent import.
 */
export function generateUUID(): string {
  return randomUUID()
}
