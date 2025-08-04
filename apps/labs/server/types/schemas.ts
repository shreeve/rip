import { z } from 'zod'

export const UserSchema = z.object({
  id: z.number().int(),
  email: z.string().email(),
  firstName: z.string().max(100),
  lastName: z.string().max(100),
  phone: z.string().max(20),
  sex: z.string().max(10),
  dob: z.string().max(10),
  admin: z.boolean().default(false)
})

export type User = z.infer<typeof UserSchema>


export const OrderSchema = z.object({
  id: z.number().int(),
  userId: z.number().int(),
  number: z.string().max(50),
  payment: z.string().max(100),
  subtotal: z.number().int(),
  total: z.number().int(),
  meta: z.record(z.unknown())
})

export type Order = z.infer<typeof OrderSchema>

