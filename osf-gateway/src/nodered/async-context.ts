import { AsyncLocalStorage } from 'async_hooks';

interface FlowContext {
  userId: string;
}

export const flowStore = new AsyncLocalStorage<FlowContext>();

export function getUserId(): string {
  const ctx = flowStore.getStore();
  if (!ctx?.userId) {
    // During Node-RED init, storage methods are called without auth context.
    // Return a sentinel value — the storage plugin handles this gracefully.
    return '__system__';
  }
  return ctx.userId;
}
