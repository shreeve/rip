/**
 * ActiveRip - ActiveRecord-inspired ORM for Bun
 *
 * A beautiful schema DSL that brings the elegance of Rails to the Bun ecosystem
 */

// Use v2 which properly integrates with Drizzle
export * from './schema-builder-v2'

// Re-export key functions for convenience
export { schema, Schema, TableBuilder } from './schema-builder-v2'

// Version
export const version = '0.2.0'