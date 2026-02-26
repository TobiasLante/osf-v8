import { logger } from '../logger';

interface ActiveRun {
  runId: string;
  promise: Promise<void>;
  startedAt: number;
}

class RunRegistry {
  private runs = new Map<string, ActiveRun>();
  private accepting = true;

  isAccepting(): boolean {
    return this.accepting;
  }

  stopAccepting(): void {
    this.accepting = false;
    logger.info({ activeRuns: this.runs.size }, 'RunRegistry: stopped accepting new flows');
  }

  register(runId: string, promise: Promise<void>): void {
    this.runs.set(runId, { runId, promise, startedAt: Date.now() });
    promise.finally(() => {
      this.runs.delete(runId);
      logger.info({ runId, activeRuns: this.runs.size }, 'RunRegistry: flow finished');
    });
    logger.info({ runId, activeRuns: this.runs.size }, 'RunRegistry: flow registered');
  }

  activeCount(): number {
    return this.runs.size;
  }

  /**
   * Wait for all active runs to complete, or timeout.
   * Returns runIds that did NOT complete within the timeout.
   */
  async drainOrTimeout(timeoutMs: number): Promise<string[]> {
    if (this.runs.size === 0) return [];

    const entries = [...this.runs.entries()];
    const timeout = new Promise<'timeout'>(r => setTimeout(() => r('timeout'), timeoutMs));
    const allDone = Promise.allSettled(entries.map(([, r]) => r.promise));

    const result = await Promise.race([allDone, timeout]);
    if (result === 'timeout') {
      return [...this.runs.keys()];
    }
    return [];
  }
}

export const runRegistry = new RunRegistry();
