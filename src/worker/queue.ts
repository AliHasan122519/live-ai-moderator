import { Queue, Worker, type Job } from 'bullmq';
import { Redis } from 'ioredis';
import type { PublishQueue } from '../posts/queue.js';
import type { Container } from '../container.js';
import { purgeExpiredMedia } from '../media/retention.js';

export const QUEUE_NAME = 'tiktok-publisher';
export const connect = (url: string) => new Redis(url, { maxRetriesPerRequest: null });

export class BullPublishQueue implements PublishQueue {
  constructor(public readonly q: Queue) {}
  static create(redisUrl: string) { return new BullPublishQueue(new Queue(QUEUE_NAME, { connection: connect(redisUrl) })); }

  async enqueuePublish(postId: string, at?: Date) {
    const delay = at ? Math.max(0, at.getTime() - Date.now()) : 0;
    await this.q.add('publish', { postId }, { jobId: `publish_${postId}`, delay, attempts: 1, removeOnComplete: true, removeOnFail: 200 });
  }
  async enqueuePoll(postId: string, delayMs: number) {
    // تجميع في نوافذ 5 ثوانٍ: يمنع تراكم متابعات متطابقة، ولا يتعارض مع مهمة جارية بالمعرّف نفسه
    const bucket = Math.floor((Date.now() + delayMs) / 5000);
    await this.q.add('poll', { postId }, { jobId: `poll_${postId}_${bucket}`, delay: delayMs, attempts: 1, removeOnComplete: true, removeOnFail: 100 });
  }
  async cancelPublish(postId: string) {
    const j = await this.q.getJob(`publish_${postId}`);
    try { await j?.remove(); } catch { /* نشطة الآن: CAS على الحالة يمنع التنفيذ المزدوج */ }
  }
  async ping() { try { await this.q.getJobCounts(); return true; } catch { return false; } }
  async close() { await this.q.close(); }
}

/** يشغّل العامل + المسح الدوري. المنطق كله في Publisher؛ هذا الغلاف فقط. */
export async function startWorker(c: Container, bq: BullPublishQueue, redisUrl: string, log: (m: string) => void = console.log) {
  const worker = new Worker(QUEUE_NAME, async (job: Job) => {
    switch (job.name) {
      case 'publish': return c.publisher.run(job.data.postId);
      case 'poll': return c.publisher.checkStatus(job.data.postId);
      case 'sweep': return c.publisher.sweep();
      case 'purge': return purgeExpiredMedia(c.db, c.storage);
      default: throw new Error(`مهمة غير معروفة: ${job.name}`);
    }
  }, { connection: connect(redisUrl), concurrency: 3 });
  worker.on('failed', (job, err) => log(`✗ ${job?.name} ${job?.id}: ${err.message}`));
  await bq.q.upsertJobScheduler('sweep', { every: 60_000 }, { name: 'sweep', opts: { removeOnComplete: true, removeOnFail: 20 } });
  await bq.q.upsertJobScheduler('purge', { every: 6 * 3600_000 }, { name: 'purge', opts: { removeOnComplete: true, removeOnFail: 20 } });
  await c.publisher.sweep().catch(() => {}); // التقاط فوري بعد إعادة التشغيل
  return worker;
}
