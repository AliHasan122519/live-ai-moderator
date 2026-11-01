const MiB = 1024 * 1024;

/**
 * قواعد القطع (من معرفتي بالوثائق، غير مُتحقَّقة من الحية): أقل من 5MB = قطعة واحدة؛
 * وإلا قطع بين 5 و64MB والأخيرة تمتص الباقي (حتى 128MB). نستخدم 10MB.
 */
export function planChunks(size: number, chunk = 10 * MiB) {
  if (size <= 0) throw new Error('حجم غير صالح');
  if (size < 5 * MiB) return { chunkSize: size, total: 1 };
  if (size < chunk) return { chunkSize: size, total: 1 }; // بين 5MB وحجم القطعة: قطعة واحدة كاملة
  if (chunk < 5 * MiB || chunk > 64 * MiB) throw new Error('حجم القطعة خارج المسموح');
  return { chunkSize: chunk, total: Math.floor(size / chunk) };
}

export function chunkRanges(size: number, plan: { chunkSize: number; total: number }) {
  return Array.from({ length: plan.total }, (_, i) => ({
    start: i * plan.chunkSize,
    end: i === plan.total - 1 ? size - 1 : (i + 1) * plan.chunkSize - 1,
  }));
}
