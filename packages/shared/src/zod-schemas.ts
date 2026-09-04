import { z } from 'zod';
import { isPositiveStroops } from './money';

export const stellarAccountIdSchema = z.string().regex(/^G[A-Z2-7]{55}$/);

export const stroopsStringSchema = z.string().regex(/^\d+$/);

export const signupSchema = z
  .object({
    email: z.email().max(254).optional(),
    phone: z.string().min(6).max(32).optional(),
    password: z.string().min(8).max(128),
    publicKey: stellarAccountIdSchema,
  })
  .refine((value) => value.email !== undefined || value.phone !== undefined, {
    message: 'Either email or phone is required',
  });

export const challengeSchema = z.object({
  publicKey: stellarAccountIdSchema,
});

export const loginSchema = z.object({
  publicKey: stellarAccountIdSchema,
  challengeXdr: z.string().min(1),
  signedXdr: z.string().min(1),
});

export const balanceSchema = z.object({
  asset: z.enum(['XLM', 'TAK']).optional(),
});

export const trustlineSchema = z.object({
  publicKey: stellarAccountIdSchema,
});

export const updateProfileSchema = z.object({
  displayName: z.string().trim().min(1).max(50),
});

export const userSearchSchema = z.object({
  query: z.string().trim().min(1).max(60),
});

export const menuItemInputSchema = z
  .object({
    name: z.string().trim().min(1).max(120),
    price: stroopsStringSchema,
  })
  .refine((value) => isPositiveStroops(value.price), {
    message: 'Price must be greater than zero',
    path: ['price'],
  });

export const shopLocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
});

export const quoteOfTheDaySchema = z.string().trim().max(240);

export const paymentRecordSchema = z
  .object({
    txHash: z.string().min(1).max(100),
    amount: stroopsStringSchema,
    asset: z.enum(['TAK', 'XLM']),
    coffeeShopId: z.number().int().positive().optional(),
    menuItemId: z.number().int().positive().optional(),
    recipientPublicKey: stellarAccountIdSchema.optional(),
  })
  .refine(
    (value) => (value.coffeeShopId !== undefined) !== (value.recipientPublicKey !== undefined),
    { message: 'Exactly one of coffeeShopId or recipientPublicKey is required' },
  )
  .refine((value) => value.menuItemId === undefined || value.coffeeShopId !== undefined, {
    message: 'menuItemId requires coffeeShopId',
  });

export const intentActionSchema = z.enum(['balance', 'shops', 'history']);

export const intentSchema = z.discriminatedUnion('action', [
  z.object({
    action: z.literal('balance'),
    asset: z.enum(['XLM', 'TAK']).optional(),
  }),
  z.object({
    action: z.literal('shops'),
    location: z.string().max(120).optional(),
  }),
  z.object({
    action: z.literal('history'),
    limit: z.number().int().min(1).max(50).optional(),
  }),
]);

export type SignupInput = z.infer<typeof signupSchema>;
export type LoginInput = z.infer<typeof loginSchema>;
export type BotIntent = z.infer<typeof intentSchema>;
export type UpdateProfileInput = z.infer<typeof updateProfileSchema>;
export type UserSearchInput = z.infer<typeof userSearchSchema>;
export type MenuItemInput = z.infer<typeof menuItemInputSchema>;
export type ShopLocation = z.infer<typeof shopLocationSchema>;
export type PaymentRecordInput = z.infer<typeof paymentRecordSchema>;
