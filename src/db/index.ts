import { PrismaClient, type Prisma } from '@prisma/client';

export type Db = PrismaClient;
export const createDb = (url?: string) => new PrismaClient(url ? { datasources: { db: { url } } } : undefined);

export async function audit(db: Db | Prisma.TransactionClient, actor: string, action: string, target?: string, detail?: Prisma.InputJsonValue) {
  await db.auditLog.create({ data: { actor, action, target, detail } });
}
