/**
 * Example: How rip-schema could generate Zod validation schemas
 *
 * This shows how our elegant DSL can compile to Zod's verbose API
 */

// Input (your DSL in CoffeeScript/Rip):
/*
@model 'User', ->
  @string   'name!', 100, min: 3
  @email    'email!'
  @integer  'age', 18..120
  @boolean  'active', true
  @json     'preferences', {}
  @datetime 'lastLoginAt'
*/

// Generated Output (TypeScript + Zod):
import { z } from 'zod'

export const UserSchema = z.object({
  name: z.string().min(3).max(100),
  email: z.string().email(),
  age: z.number().int().min(18).max(120).optional(),
  active: z.boolean().default(true),
  preferences: z.record(z.unknown()).default({}),
  lastLoginAt: z.date().optional(),
})

export type User = z.infer<typeof UserSchema>

// Could also generate helpful utilities:
export const UserValidation = {
  parse: (data: unknown) => UserSchema.parse(data),
  safeParse: (data: unknown) => UserSchema.safeParse(data),
  isValid: (data: unknown) => UserSchema.safeParse(data).success,
}

// Example of more complex generation:
/*
@model 'Post', ->
  @bigint   'userId!'
  @string   'title!', 200
  @text     'content!'
  @enum     'status', ['draft', 'published', 'archived'], 'draft'
  @datetime 'publishedAt'

  @refine (post) ->
    post.publishedAt || post.status != 'published',
    "Published posts must have a publishedAt date"
*/

export const PostSchema = z
  .object({
    userId: z.bigint(),
    title: z.string().max(200),
    content: z.string(),
    status: z.enum(['draft', 'published', 'archived']).default('draft'),
    publishedAt: z.date().optional(),
  })
  .refine(post => post.publishedAt || post.status !== 'published', {
    message: 'Published posts must have a publishedAt date',
  })
