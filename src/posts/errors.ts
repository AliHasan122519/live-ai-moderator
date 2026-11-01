export class PostError extends Error {
  constructor(public code: string, message: string, public details?: string[]) { super(message); this.name = 'PostError'; }
}
