/** واجهة الطابور: BullMQ في الإنتاج (src/worker/queue.ts)، وتنفيذ في الذاكرة للاختبار. المنطق لا يعرف BullMQ. */
export interface PublishQueue {
  enqueuePublish(postId: string, at?: Date): Promise<void>;
  enqueuePoll(postId: string, delayMs: number): Promise<void>;
  cancelPublish(postId: string): Promise<void>;
  ping(): Promise<boolean>;
}
export class MemoryQueue implements PublishQueue {
  publishes: Array<{ postId: string; at?: Date }> = []; polls: Array<{ postId: string; delayMs: number }> = []; canceled: string[] = [];
  async enqueuePublish(postId: string, at?: Date) { this.publishes.push({ postId, at }); }
  async enqueuePoll(postId: string, delayMs: number) { this.polls.push({ postId, delayMs }); }
  async cancelPublish(postId: string) { this.canceled.push(postId); }
  async ping() { return true; }
}
