import { z } from 'zod'

export const UserSchema = z.object({
  id: z.number().int(),
  email: z.string().email(),
  firstName: z.string().max(100),
  lastName: z.string().max(100),
  phone: z.string().max(20),
  sex: z.string().max(10),
  dob: z.string().max(10),
  photo: z.string().optional(),
  cart: z.record(z.unknown()).optional(),
  shippingAddress: z.record(z.unknown()).optional(),
  meta: z.record(z.unknown()).optional(),
  code: z.string().optional(),
  codeExpiresAt: z.date().optional(),
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
  meta: z.record(z.unknown()),
  shippedAt: z.date().optional(),
  deliveredAt: z.date().optional(),
  completedAt: z.date().optional()
})

export type Order = z.infer<typeof OrderSchema>


export const SpecimenSchema = z.object({
  id: z.number().int(),
  userId: z.number().int(),
  testId: z.number().int(),
  barcode: z.string().max(50),
  registeredAt: z.date().optional(),
  collectedAt: z.date().optional(),
  reportedAt: z.date().optional()
})

export type Specimen = z.infer<typeof SpecimenSchema>


export const ResultSchema = z.object({
  id: z.number().int(),
  userId: z.number().int(),
  resultUrl: z.string().max(255)
})

export type Result = z.infer<typeof ResultSchema>

