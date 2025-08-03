/**
 * ActiveRip - ActiveRecord-inspired ORM for Bun
 *
 * A beautiful schema DSL that brings the elegance of Rails to the Bun ecosystem
 */

export * from './schema-builder'

// Re-export key functions for convenience
export { schema, RipSchema, RipTableBuilder } from './schema-builder'

// Version
export const version = '0.1.0'