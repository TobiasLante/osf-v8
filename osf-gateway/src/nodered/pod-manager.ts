/**
 * NR Pod Manager — Manages per-user Node-RED pods on Kubernetes.
 *
 * Maintains a warm pool of pre-provisioned NR pods.
 * Assigns pods to users on demand, tracks idle timeouts,
 * and protects running flows from premature termination.
 *
 * Robustness features:
 *  - Per-user advisory lock prevents double-assignment race conditions
 *  - K8s API circuit breaker prevents cascade failures
 *  - K8s Watch for real-time pod state updates (with auto-reconnect)
 *  - Graceful pod drain: unload flows before deletion
 *  - Pod metrics (CPU/RAM) via K8s Metrics API
 *  - Continuous reconciliation (not just on startup)
 *  - Parallel health checks with guard against overlapping cycles
 *  - Retry with exponential backoff for K8s pod creation
 *  - Backpressure: limited concurrent on-demand pod creations
 *  - Proper pod_ip cleanup on termination
 */

import * as k8s from '@kubernetes/client-node';
import { pool } from '../db/pool';
import { logger } from '../logger';
import { SEED_FLOW } from './seed-flow';

const NAMESPACE = process.env.K8S_NAMESPACE || 'osf';
const POOL_SIZE = parseInt(process.env.NR_POOL_SIZE || '3', 10);
const IDLE_TIMEOUT_MS = parseInt(process.env.NR_IDLE_TIMEOUT_MIN || '20', 10) * 60 * 1000;
const CHECK_INTERVAL_MS = 30_000;
const RECONCILE_INTERVAL_MS = 60_000;
const POD_READY_TIMEOUT_MS = 60_000;
const POD_READY_POLL_MS = 2_000;
const MAX_CONCURRENT_ON_DEMAND = 3;
const K8S_RETRY_ATTEMPTS = 3;
const HEALTH_CHECK_TIMEOUT_MS = 5_000;
const DRAIN_TIMEOUT_MS = 10_000;

// --- Circuit Breaker for K8s API ---
class CircuitBreaker {
  private failures = 0;
  private lastFailure = 0;
  private readonly threshold: number;
  private readonly resetMs: number;

  constructor(threshold = 3, resetMs = 30_000) {
    this.threshold = threshold;
    this.resetMs = resetMs;
  }

  get isOpen(): boolean {
    if (this.failures < this.threshold) return false;
    // Half-open: allow retry after resetMs
    if (Date.now() - this.lastFailure > this.resetMs) return false;
    return true;
  }

  recordSuccess(): void {
    this.failures = 0;
  }

  recordFailure(): void {
    this.failures++;
    this.lastFailure = Date.now();
  }
}

export class NrPodManager {
  private kc: k8s.KubeConfig;
  private k8sApi: k8s.CoreV1Api;
  private watchAbort: any = null; // AbortController returned by k8s.Watch
  private checkTimer: ReturnType<typeof setInterval> | null = null;
  private reconcileTimer: ReturnType<typeof setInterval> | null = null;
  private metricsTimer: ReturnType<typeof setInterval> | null = null;
  private shuttingDown = false;
  private initialized = false;
  private initPromise: Promise<void> | null = null;
  private checkRunning = false; // guard against overlapping idle checks
  private onDemandCount = 0; // concurrent on-demand pod creations
  private k8sBreaker = new CircuitBreaker(3, 30_000);
  // Cache for pod metrics (CPU/RAM) from K8s Metrics API
  private podMetricsCache = new Map<string, { cpuMillicores: number; memoryMb: number; ts: number }>();

  constructor() {
    this.kc = new k8s.KubeConfig();
    try {
      this.kc.loadFromCluster();
    } catch {
      this.kc.loadFromDefault();
    }
    this.k8sApi = this.kc.makeApiClient(k8s.CoreV1Api);
  }

  // --- Lifecycle ---

  async init(): Promise<void> {
    if (this.initPromise) return this.initPromise;
    this.initPromise = this._doInit();
    return this.initPromise;
  }

  private async _doInit(): Promise<void> {
    logger.info('[PodManager] Initializing...');

    try {
      await this.reconcile();
    } catch (err: any) {
      logger.error({ err: err.message }, '[PodManager] Reconciliation failed (continuing with empty state)');
    }

    // Fill warm pool (don't block on failure)
    await this.fillPool().catch(err => {
      logger.error({ err: err.message }, '[PodManager] Initial pool fill failed');
    });

    // Start K8s Watch for real-time pod state updates
    this.startWatch();

    // Start idle-check timer with overlap guard
    this.checkTimer = setInterval(() => {
      if (this.checkRunning) {
        logger.debug('[PodManager] Skipping idle check — previous still running');
        return;
      }
      this.checkIdlePods().catch(err => {
        logger.error({ err: err.message }, '[PodManager] Idle check error');
      });
    }, CHECK_INTERVAL_MS);

    // Start continuous reconciliation
    this.reconcileTimer = setInterval(() => {
      this.reconcile().catch(err => {
        logger.error({ err: err.message }, '[PodManager] Periodic reconciliation error');
      });
    }, RECONCILE_INTERVAL_MS);

    // Refresh pod metrics every 30s
    this.metricsTimer = setInterval(() => {
      if (!this.shuttingDown) this.refreshPodMetrics().catch(() => {});
    }, 30_000);
    this.refreshPodMetrics().catch(() => {});

    this.initialized = true;
    logger.info({ poolSize: POOL_SIZE, idleTimeoutMin: IDLE_TIMEOUT_MS / 60000 }, '[PodManager] Ready');
  }

  /** Ensure init() has completed before serving requests. */
  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    if (this.initPromise) await this.initPromise;
  }

  async shutdown(): Promise<void> {
    this.shuttingDown = true;
    if (this.checkTimer) clearInterval(this.checkTimer);
    if (this.reconcileTimer) clearInterval(this.reconcileTimer);
    if (this.metricsTimer) clearInterval(this.metricsTimer);
    if (this.watchAbort) try { this.watchAbort.abort(); } catch {}

    logger.info('[PodManager] Shutting down — cleaning up pods...');

    const result = await pool.query(
      `SELECT pod_name, status, pod_ip FROM nodered_pods WHERE status IN ('starting', 'warm', 'assigned')`
    );

    for (const row of result.rows) {
      if (row.status === 'assigned' && row.pod_ip) {
        try {
          const activity = await this.fetchActivity(row.pod_ip);
          if (activity && activity.flowsRunning > 0) {
            logger.info({ pod: row.pod_name }, '[PodManager] Waiting for running flows...');
            // Poll until flows finish, up to 60s
            const deadline = Date.now() + 60_000;
            while (Date.now() < deadline) {
              await new Promise(r => setTimeout(r, 3_000));
              const a = await this.fetchActivity(row.pod_ip).catch(() => null);
              if (!a || a.flowsRunning === 0) break;
            }
          }
        } catch {}
      }
      await this.deletePod(row.pod_name).catch(() => {});
    }
  }

  // --- Pod Assignment ---

  /**
   * Assign a pod to a user. Returns the pod IP for proxying.
   * Uses PostgreSQL advisory lock per user to prevent race conditions.
   */
  async assignPod(userId: string): Promise<string> {
    await this.ensureInitialized();

    // Advisory lock based on user ID hash to serialize per-user
    const lockKey = hashToInt(userId);
    const client = await pool.connect();
    try {
      await client.query('SELECT pg_advisory_lock($1)', [lockKey]);

      // Check if user already has an assigned pod
      const existing = await client.query(
        `SELECT pod_name, pod_ip FROM nodered_pods WHERE assigned_user_id = $1 AND status = 'assigned'`,
        [userId]
      );
      if (existing.rows.length > 0 && existing.rows[0].pod_ip) {
        if (await this.isPodAlive(existing.rows[0].pod_ip)) {
          await client.query(
            `UPDATE nodered_pods SET last_activity = NOW() WHERE pod_name = $1`,
            [existing.rows[0].pod_name]
          );
          return existing.rows[0].pod_ip;
        }
        // Pod is dead — clean up
        logger.warn({ pod: existing.rows[0].pod_name }, '[PodManager] Assigned pod is dead, cleaning up');
        await this.deletePod(existing.rows[0].pod_name);
        await this.logEvent(existing.rows[0].pod_name, 'health_fail', userId);
      }

      // Try warm pods — retry up to 3 times
      const MAX_RETRIES = 3;
      for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
        const warmPod = await client.query(
          `UPDATE nodered_pods
           SET status = 'assigned', assigned_user_id = $1, assigned_at = NOW(), last_activity = NOW()
           WHERE pod_name = (
             SELECT pod_name FROM nodered_pods
             WHERE status = 'warm' AND nr_ready = TRUE
             ORDER BY created_at ASC
             LIMIT 1
             FOR UPDATE SKIP LOCKED
           )
           RETURNING pod_name, pod_ip`,
          [userId]
        );

        if (warmPod.rows.length === 0) break;

        const { pod_name: podName, pod_ip: podIp } = warmPod.rows[0];

        if (!await this.isPodAlive(podIp)) {
          logger.warn({ pod: podName, attempt }, '[PodManager] Warm pod is dead, skipping');
          await this.deletePod(podName);
          await this.logEvent(podName, 'health_fail');
          continue;
        }

        try {
          await this.loadFlowsIntoPod(podIp, userId);
        } catch (err: any) {
          logger.error({ err: err.message, pod: podName, attempt }, '[PodManager] Failed to load flows');
          await this.deletePod(podName);
          await this.logEvent(podName, 'error', userId, { error: err.message });
          continue;
        }

        await this.logEvent(podName, 'assigned', userId);
        logger.info({ pod: podName, userId }, '[PodManager] Pod assigned to user');
        this.fillPool().catch(() => {});
        return podIp;
      }

      // All warm pods exhausted — on-demand creation with backpressure
      if (this.onDemandCount >= MAX_CONCURRENT_ON_DEMAND) {
        throw new Error('Editor temporarily unavailable (high demand). Please try again in a few seconds.');
      }

      logger.warn({ userId }, '[PodManager] No usable warm pods, creating on-demand');
      return await this.createAndAssignPod(userId);
    } finally {
      await client.query('SELECT pg_advisory_unlock($1)', [lockKey]).catch(() => {});
      client.release();
    }
  }

  async getPodForUser(userId: string): Promise<string | null> {
    const result = await pool.query(
      `SELECT pod_ip FROM nodered_pods WHERE assigned_user_id = $1 AND status = 'assigned'`,
      [userId]
    );
    return result.rows[0]?.pod_ip || null;
  }

  async releasePod(podName: string, reason: string = 'released'): Promise<void> {
    const podInfo = await pool.query(
      `SELECT assigned_user_id, pod_ip FROM nodered_pods WHERE pod_name = $1`,
      [podName]
    );
    const userId = podInfo.rows[0]?.assigned_user_id;
    const podIp = podInfo.rows[0]?.pod_ip;

    // Graceful drain: unload flows before deleting
    if (podIp) {
      await this.drainPod(podName, podIp);
    }

    await this.deletePod(podName);
    await this.logEvent(podName, reason, userId);
    logger.info({ pod: podName, reason }, '[PodManager] Pod released');

    if (!this.shuttingDown) {
      this.fillPool().catch(() => {});
    }
  }

  // --- Admin APIs ---

  async getAllPods(): Promise<any[]> {
    const result = await pool.query(`
      SELECT p.pod_name, p.pod_ip, p.status, p.assigned_user_id, p.assigned_at,
             p.last_activity, p.nr_ready, p.created_at,
             u.email as user_email
      FROM nodered_pods p
      LEFT JOIN users u ON u.id = p.assigned_user_id
      WHERE p.status IN ('starting', 'warm', 'assigned', 'draining')
      ORDER BY p.status, p.created_at
    `);

    // Parallel activity fetches
    const pods = await Promise.all(result.rows.map(async (row) => {
      let activity = null;
      if (row.pod_ip && row.status === 'assigned') {
        activity = await this.fetchActivity(row.pod_ip).catch(() => null);
      }

      const metrics = this.podMetricsCache.get(row.pod_name);

      return {
        podName: row.pod_name,
        podIp: row.pod_ip,
        status: row.status,
        userId: row.assigned_user_id,
        userEmail: row.user_email,
        assignedAt: row.assigned_at,
        lastActivity: activity?.lastActivity ? new Date(activity.lastActivity).toISOString() : row.last_activity,
        idleMinutes: activity ? Math.round(activity.idleMs / 60000) : null,
        flowsRunning: activity?.flowsRunning ?? 0,
        uptimeMinutes: Math.round((Date.now() - new Date(row.created_at).getTime()) / 60000),
        memoryMb: metrics?.memoryMb ?? activity?.memoryMb ?? null,
        cpuMillicores: metrics?.cpuMillicores ?? null,
        nrReady: row.nr_ready,
      };
    }));

    return pods;
  }

  async getPoolStats(): Promise<any> {
    const counts = await pool.query(`
      SELECT status, COUNT(*) as cnt FROM nodered_pods
      WHERE status IN ('starting', 'warm', 'assigned', 'draining')
      GROUP BY status
    `);

    const statusMap: Record<string, number> = {};
    for (const row of counts.rows) {
      statusMap[row.status] = parseInt(row.cnt, 10);
    }

    return {
      warm: statusMap['warm'] || 0,
      assigned: statusMap['assigned'] || 0,
      starting: statusMap['starting'] || 0,
      draining: statusMap['draining'] || 0,
      targetSize: POOL_SIZE,
    };
  }

  async getStats24h(): Promise<any> {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

    const [assignments, idleKills, avgSession, peakResult] = await Promise.all([
      pool.query(
        `SELECT COUNT(*) as cnt FROM nodered_pod_events WHERE event_type = 'assigned' AND created_at > $1`,
        [since]
      ),
      pool.query(
        `SELECT COUNT(*) as cnt FROM nodered_pod_events WHERE event_type = 'idle_killed' AND created_at > $1`,
        [since]
      ),
      pool.query(
        `SELECT AVG(EXTRACT(EPOCH FROM (e2.created_at - e1.created_at)) / 60) as avg_min
         FROM nodered_pod_events e1
         JOIN nodered_pod_events e2 ON e1.pod_name = e2.pod_name
         WHERE e1.event_type = 'assigned' AND e2.event_type IN ('released', 'idle_killed')
           AND e1.created_at > $1 AND e2.created_at > e1.created_at`,
        [since]
      ),
      pool.query(
        `SELECT MAX(concurrent) as peak FROM (
           SELECT COUNT(*) as concurrent
           FROM nodered_pods
           WHERE status = 'assigned'
           GROUP BY date_trunc('minute', assigned_at)
         ) sub`
      ),
    ]);

    const poolStats = await this.getPoolStats();

    return {
      totalAssignments24h: parseInt(assignments.rows[0]?.cnt || '0', 10),
      avgSessionMinutes: Math.round(parseFloat(avgSession.rows[0]?.avg_min || '0')),
      peakConcurrent24h: parseInt(peakResult.rows[0]?.peak || '0', 10),
      poolHealthy: poolStats.warm >= 1,
      warmPodsAvailable: poolStats.warm,
      idleKills24h: parseInt(idleKills.rows[0]?.cnt || '0', 10),
    };
  }

  async getRecentEvents(limit: number = 50): Promise<any[]> {
    const result = await pool.query(
      `SELECT e.pod_name, e.event_type, e.user_id, e.details, e.created_at,
              u.email as user_email
       FROM nodered_pod_events e
       LEFT JOIN users u ON u.id = e.user_id
       ORDER BY e.created_at DESC
       LIMIT $1`,
      [limit]
    );
    return result.rows;
  }

  setPoolSize(size: number): void {
    (this as any)._overridePoolSize = size;
    logger.info({ newSize: size }, '[PodManager] Pool size overridden');
    this.fillPool().catch(() => {});
  }

  /** Trigger reconciliation from outside (admin cleanup). */
  async reconcileNow(): Promise<void> {
    await this.reconcile();
  }

  /**
   * Drain all pods: release all assigned + delete all warm/starting.
   * Then refill the warm pool. Used by admin "Drain All" button.
   */
  async drainAll(): Promise<{ released: number; deleted: number }> {
    const allPods = await pool.query(
      `SELECT pod_name, pod_ip, status FROM nodered_pods WHERE status IN ('assigned', 'warm', 'starting')`
    );

    let released = 0;
    let deleted = 0;

    for (const row of allPods.rows) {
      try {
        if (row.status === 'assigned') {
          await this.releasePod(row.pod_name, 'admin_drain_all');
          released++;
        } else {
          await this.deletePod(row.pod_name);
          await this.logEvent(row.pod_name, 'admin_drain_all');
          deleted++;
        }
      } catch (err: any) {
        logger.warn({ pod: row.pod_name, err: err.message }, '[PodManager] drainAll: failed to clean pod');
      }
    }

    logger.info({ released, deleted }, '[PodManager] Drain all complete, refilling pool...');

    // Refill warm pool
    await this.fillPool().catch(() => {});

    return { released, deleted };
  }

  private get targetPoolSize(): number {
    return (this as any)._overridePoolSize || POOL_SIZE;
  }

  // --- Internal Methods ---

  private async isPodAlive(podIp: string): Promise<boolean> {
    try {
      const resp = await fetch(`http://${podIp}:1880/health`, {
        signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
      });
      return resp.ok;
    } catch {
      return false;
    }
  }

  /**
   * Emergency fallback: create a pod on-demand with backpressure.
   */
  private async createAndAssignPod(userId: string): Promise<string> {
    if (this.k8sBreaker.isOpen) {
      throw new Error('Editor temporarily unavailable (K8s API issues). Please try again.');
    }

    this.onDemandCount++;
    const podName = `osf-nr-${randomId()}`;

    try {
      await pool.query(
        `INSERT INTO nodered_pods (pod_name, status, assigned_user_id, assigned_at, last_activity)
         VALUES ($1, 'starting', $2, NOW(), NOW())`,
        [podName, userId]
      );

      const podSpec = this.getPodSpec(podName);
      await this.k8sCreateWithRetry(podName, podSpec);
      const podIp = await this.waitForReady(podName);

      await pool.query(
        `UPDATE nodered_pods SET status = 'assigned', pod_ip = $2, nr_ready = TRUE WHERE pod_name = $1`,
        [podName, podIp]
      );

      await this.loadFlowsIntoPod(podIp, userId);
      await this.logEvent(podName, 'assigned', userId, { onDemand: true });
      logger.info({ pod: podName, userId }, '[PodManager] On-demand pod assigned');

      this.k8sBreaker.recordSuccess();
      this.fillPool().catch(() => {});
      return podIp;
    } catch (err: any) {
      logger.error({ err: err.message, pod: podName }, '[PodManager] On-demand pod failed');
      await this.deletePod(podName);
      throw new Error('Could not create editor pod. Please try again.');
    } finally {
      this.onDemandCount--;
    }
  }

  /**
   * Create K8s pod with retry + exponential backoff.
   */
  private async k8sCreateWithRetry(podName: string, podSpec: k8s.V1Pod): Promise<void> {
    for (let attempt = 0; attempt < K8S_RETRY_ATTEMPTS; attempt++) {
      try {
        await this.k8sApi.createNamespacedPod({ namespace: NAMESPACE, body: podSpec });
        this.k8sBreaker.recordSuccess();
        return;
      } catch (err: any) {
        this.k8sBreaker.recordFailure();
        if (attempt === K8S_RETRY_ATTEMPTS - 1) throw err;
        const delay = Math.min(1000 * Math.pow(2, attempt) + Math.random() * 500, 8000);
        logger.warn({ pod: podName, attempt, delay: Math.round(delay) }, '[PodManager] K8s create retry');
        await new Promise(r => setTimeout(r, delay));
      }
    }
  }

  /**
   * Delete K8s pod with retry. Only mark terminated in DB if K8s deletion succeeds.
   */
  private async deletePod(podName: string): Promise<void> {
    let k8sDeleted = false;

    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        await this.k8sApi.deleteNamespacedPod({ name: podName, namespace: NAMESPACE });
        k8sDeleted = true;
        break;
      } catch (err: any) {
        if (err.statusCode === 404) {
          k8sDeleted = true; // already gone
          break;
        }
        if (attempt < 2) {
          await new Promise(r => setTimeout(r, 1000 * (attempt + 1)));
        } else {
          logger.error({ err: err.message, pod: podName }, '[PodManager] Failed to delete pod from K8s after retries');
        }
      }
    }

    if (k8sDeleted) {
      await pool.query(
        `UPDATE nodered_pods SET status = 'terminated', pod_ip = NULL, nr_ready = FALSE WHERE pod_name = $1`,
        [podName]
      );
    } else {
      // Mark as draining so reconcile can retry later
      await pool.query(
        `UPDATE nodered_pods SET status = 'draining' WHERE pod_name = $1`,
        [podName]
      );
    }
  }

  private async reconcile(): Promise<void> {
    try {
      // Get all pods from DB that should be alive
      const dbPods = await pool.query(
        `SELECT pod_name, status, pod_ip FROM nodered_pods WHERE status IN ('starting', 'warm', 'assigned', 'draining')`
      );

      // Get all managed pods from K8s
      const k8sPods = await this.k8sApi.listNamespacedPod({
        namespace: NAMESPACE,
        labelSelector: 'osf.dev/managed-by=pod-manager',
      });
      const k8sPodMap = new Map<string, any>();
      for (const p of (k8sPods.items || [])) {
        if (p.metadata?.name) k8sPodMap.set(p.metadata.name, p);
      }

      // Pods in DB but not in K8s → mark terminated
      for (const row of dbPods.rows) {
        if (!k8sPodMap.has(row.pod_name)) {
          logger.warn({ pod: row.pod_name, status: row.status }, '[PodManager] Orphaned DB record (pod missing in K8s)');
          await pool.query(
            `UPDATE nodered_pods SET status = 'terminated', pod_ip = NULL WHERE pod_name = $1`,
            [row.pod_name]
          );
        }
      }

      // Pods in K8s but not in DB → delete from K8s
      const dbPodNames = new Set(dbPods.rows.map((r: any) => r.pod_name));
      for (const [name] of k8sPodMap) {
        if (!dbPodNames.has(name)) {
          logger.warn({ pod: name }, '[PodManager] Orphaned K8s pod (no DB record), deleting');
          await this.k8sApi.deleteNamespacedPod({ name, namespace: NAMESPACE }).catch(() => {});
        }
      }

      // Draining pods → retry K8s deletion
      for (const row of dbPods.rows) {
        if (row.status === 'draining' && k8sPodMap.has(row.pod_name)) {
          logger.info({ pod: row.pod_name }, '[PodManager] Retrying delete for draining pod');
          await this.deletePod(row.pod_name);
        }
      }

      // Stuck 'starting' pods (>2 min old) → clean up
      await pool.query(
        `UPDATE nodered_pods SET status = 'terminated', pod_ip = NULL
         WHERE status = 'starting' AND created_at < NOW() - INTERVAL '2 minutes'`
      );

      this.k8sBreaker.recordSuccess();
      logger.info('[PodManager] Reconciliation complete');
    } catch (err: any) {
      this.k8sBreaker.recordFailure();
      throw err;
    }
  }

  private async fillPool(): Promise<void> {
    if (this.shuttingDown) return;
    if (this.k8sBreaker.isOpen) {
      logger.warn('[PodManager] K8s circuit breaker open, skipping pool fill');
      return;
    }

    const stats = await this.getPoolStats();
    const warmNeeded = this.targetPoolSize - stats.warm - stats.starting;

    if (warmNeeded <= 0) return;

    logger.info({ warmNeeded, current: stats.warm, starting: stats.starting }, '[PodManager] Filling pool');

    const results = await Promise.allSettled(
      Array.from({ length: warmNeeded }, () => this.createWarmPod())
    );

    const failed = results.filter(r => r.status === 'rejected').length;
    if (failed > 0) {
      logger.warn({ failed, total: warmNeeded }, '[PodManager] Some warm pods failed to create');
    }
  }

  private async createWarmPod(): Promise<void> {
    const podName = `osf-nr-${randomId()}`;

    await pool.query(
      `INSERT INTO nodered_pods (pod_name, status) VALUES ($1, 'starting')`,
      [podName]
    );

    try {
      const podSpec = this.getPodSpec(podName);
      await this.k8sCreateWithRetry(podName, podSpec);
      const podIp = await this.waitForReady(podName);

      await pool.query(
        `UPDATE nodered_pods SET status = 'warm', pod_ip = $2, nr_ready = TRUE WHERE pod_name = $1`,
        [podName, podIp]
      );

      await this.logEvent(podName, 'created');
      logger.info({ pod: podName, ip: podIp }, '[PodManager] Warm pod ready');
    } catch (err: any) {
      logger.error({ err: err.message, pod: podName }, '[PodManager] Failed to create warm pod');
      await pool.query(`UPDATE nodered_pods SET status = 'terminated', pod_ip = NULL WHERE pod_name = $1`, [podName]);
      await this.k8sApi.deleteNamespacedPod({ name: podName, namespace: NAMESPACE }).catch(() => {});
      await this.logEvent(podName, 'error', undefined, { error: err.message });
    }
  }

  private async waitForReady(podName: string): Promise<string> {
    const deadline = Date.now() + POD_READY_TIMEOUT_MS;

    while (Date.now() < deadline) {
      try {
        const pod = await this.k8sApi.readNamespacedPod({ name: podName, namespace: NAMESPACE });

        // Fast-fail on terminal pod states
        const phase = pod.status?.phase;
        if (phase === 'Failed' || phase === 'Succeeded') {
          throw new Error(`Pod ${podName} in terminal state: ${phase}`);
        }

        // Check for CrashLoopBackOff
        const containerStatus = pod.status?.containerStatuses?.[0];
        if (containerStatus?.state?.waiting?.reason === 'CrashLoopBackOff') {
          throw new Error(`Pod ${podName} in CrashLoopBackOff`);
        }
        if (containerStatus?.state?.waiting?.reason === 'ImagePullBackOff') {
          throw new Error(`Pod ${podName} image pull failed`);
        }

        const podIp = pod.status?.podIP;
        const ready = pod.status?.conditions?.some((c: any) => c.type === 'Ready' && c.status === 'True');

        if (podIp && ready) {
          const resp = await fetch(`http://${podIp}:1880/health`, { signal: AbortSignal.timeout(3000) });
          if (resp.ok) return podIp;
        }
      } catch (err: any) {
        // Re-throw terminal errors (CrashLoop, Failed state)
        if (err.message?.includes('terminal state') || err.message?.includes('CrashLoopBackOff') || err.message?.includes('image pull')) {
          throw err;
        }
      }

      await new Promise(r => setTimeout(r, POD_READY_POLL_MS));
    }

    throw new Error(`Pod ${podName} did not become ready within ${POD_READY_TIMEOUT_MS / 1000}s`);
  }

  private async loadFlowsIntoPod(podIp: string, userId: string): Promise<void> {
    const result = await pool.query(
      'SELECT flow_json FROM nodered_flows WHERE user_id = $1',
      [userId]
    );

    let flows: any[];
    if (result.rows.length > 0) {
      flows = result.rows[0].flow_json;
    } else {
      flows = SEED_FLOW;
      await pool.query(
        `INSERT INTO nodered_flows (user_id, flow_json, revision, updated_at)
         VALUES ($1, $2, $3, NOW()) ON CONFLICT DO NOTHING`,
        [userId, JSON.stringify(SEED_FLOW), Date.now().toString()]
      );
      logger.info({ userId }, '[PodManager] Seeded example flow for new user');
    }

    const gatewayUrl = process.env.GATEWAY_INTERNAL_URL || 'http://osf-gateway:8080';
    const resp = await fetch(`http://${podIp}:1880/nr/load-flows`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        userId,
        flows,
        gatewayUrl,
        podSecret: process.env.NR_POD_SECRET,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!resp.ok) {
      const text = await resp.text().catch(() => '');
      throw new Error(`load-flows failed: ${resp.status} ${text}`);
    }
  }

  private async fetchActivity(podIp: string): Promise<any | null> {
    try {
      const resp = await fetch(`http://${podIp}:1880/nr/activity`, {
        signal: AbortSignal.timeout(HEALTH_CHECK_TIMEOUT_MS),
      });
      if (!resp.ok) return null;
      return await resp.json();
    } catch {
      return null;
    }
  }

  /**
   * Check idle pods + warm pod liveness. Parallel with overlap guard.
   */
  private async checkIdlePods(): Promise<void> {
    if (this.shuttingDown) return;
    this.checkRunning = true;

    try {
      // --- Assigned pods: parallel activity checks ---
      const assigned = await pool.query(
        `SELECT pod_name, pod_ip, assigned_user_id FROM nodered_pods WHERE status = 'assigned'`
      );

      await Promise.allSettled(assigned.rows.map(async (row) => {
        if (!row.pod_ip) return;

        const activity = await this.fetchActivity(row.pod_ip);
        if (!activity) {
          logger.warn({ pod: row.pod_name }, '[PodManager] Pod unreachable, releasing');
          await this.releasePod(row.pod_name, 'health_fail');
          return;
        }

        // Kill protection: never kill while flows are running
        if (activity.flowsRunning > 0) return;

        if (activity.idleMs > IDLE_TIMEOUT_MS) {
          logger.info({ pod: row.pod_name, idleMin: Math.round(activity.idleMs / 60000) }, '[PodManager] Idle timeout');
          await this.releasePod(row.pod_name, 'idle_killed');
        }
      }));

      // --- Warm pods: parallel liveness checks ---
      const warm = await pool.query(
        `SELECT pod_name, pod_ip FROM nodered_pods WHERE status = 'warm' AND pod_ip IS NOT NULL`
      );

      await Promise.allSettled(warm.rows.map(async (row) => {
        if (!await this.isPodAlive(row.pod_ip)) {
          logger.warn({ pod: row.pod_name }, '[PodManager] Warm pod dead, removing');
          await this.deletePod(row.pod_name);
          await this.logEvent(row.pod_name, 'health_fail');
        }
      }));

      // Refill pool if needed
      await this.fillPool();
    } finally {
      this.checkRunning = false;
    }
  }

  private async logEvent(podName: string, eventType: string, userId?: string, details?: any): Promise<void> {
    await pool.query(
      `INSERT INTO nodered_pod_events (pod_name, event_type, user_id, details) VALUES ($1, $2, $3, $4)`,
      [podName, eventType, userId || null, details ? JSON.stringify(details) : null]
    ).catch(err => {
      logger.warn({ err: err.message }, '[PodManager] Failed to log event');
    });
  }

  // --- K8s Watch for real-time pod events ---

  private startWatch(): void {
    if (this.shuttingDown) return;

    const watch = new k8s.Watch(this.kc);

    watch.watch(
      `/api/v1/namespaces/${NAMESPACE}/pods`,
      { labelSelector: 'osf.dev/managed-by=pod-manager' },
      (type: string, apiObj: k8s.V1Pod) => {
        this.handleWatchEvent(type, apiObj).catch(err => {
          logger.warn({ err: err.message }, '[PodManager] Watch event handler error');
        });
      },
      (err: any) => {
        if (this.shuttingDown) return;
        if (err) {
          logger.warn({ err: err?.message || err }, '[PodManager] Watch connection lost, reconnecting in 5s...');
        } else {
          logger.info('[PodManager] Watch stream ended, reconnecting in 5s...');
        }
        setTimeout(() => this.startWatch(), 5000);
      }
    ).then(abort => {
      this.watchAbort = abort as any;
      logger.info('[PodManager] K8s Watch started');
    }).catch(err => {
      logger.warn({ err: err.message }, '[PodManager] Failed to start watch, retrying in 10s');
      setTimeout(() => this.startWatch(), 10_000);
    });
  }

  private async handleWatchEvent(type: string, pod: k8s.V1Pod): Promise<void> {
    const podName = pod.metadata?.name;
    if (!podName) return;

    const phase = pod.status?.phase;
    const podIp = pod.status?.podIP;
    const containerStatus = pod.status?.containerStatuses?.[0];
    const reason = containerStatus?.state?.waiting?.reason;

    if (type === 'DELETED') {
      // Pod deleted externally or by us — ensure DB is consistent
      const dbPod = await pool.query(
        `SELECT status FROM nodered_pods WHERE pod_name = $1 AND status NOT IN ('terminated')`,
        [podName]
      );
      if (dbPod.rows.length > 0) {
        logger.info({ pod: podName, prevStatus: dbPod.rows[0].status }, '[PodManager] Watch: pod deleted');
        await pool.query(
          `UPDATE nodered_pods SET status = 'terminated', pod_ip = NULL, nr_ready = FALSE WHERE pod_name = $1`,
          [podName]
        );
        await this.logEvent(podName, 'watch_deleted');
        if (!this.shuttingDown) this.fillPool().catch(() => {});
      }
      return;
    }

    // ADDED or MODIFIED — update pod_ip and detect failures early
    if (type === 'MODIFIED' || type === 'ADDED') {
      // Update pod_ip in DB if we have one and DB doesn't yet
      if (podIp) {
        await pool.query(
          `UPDATE nodered_pods SET pod_ip = $2 WHERE pod_name = $1 AND pod_ip IS NULL AND status IN ('starting', 'warm', 'assigned')`,
          [podName, podIp]
        );
      }

      // Fast-fail: detect CrashLoopBackOff / ImagePullBackOff via watch
      if (reason === 'CrashLoopBackOff' || reason === 'ImagePullBackOff' || reason === 'ErrImagePull') {
        logger.error({ pod: podName, reason }, '[PodManager] Watch: pod in failure state');
        const dbPod = await pool.query(
          `SELECT status FROM nodered_pods WHERE pod_name = $1 AND status IN ('starting', 'warm')`,
          [podName]
        );
        if (dbPod.rows.length > 0) {
          await this.deletePod(podName);
          await this.logEvent(podName, 'error', undefined, { reason });
          if (!this.shuttingDown) this.fillPool().catch(() => {});
        }
        return;
      }

      // Detect terminated pods (phase Failed/Succeeded)
      if (phase === 'Failed' || phase === 'Succeeded') {
        const dbPod = await pool.query(
          `SELECT status, assigned_user_id FROM nodered_pods WHERE pod_name = $1 AND status NOT IN ('terminated')`,
          [podName]
        );
        if (dbPod.rows.length > 0) {
          logger.warn({ pod: podName, phase, prevStatus: dbPod.rows[0].status }, '[PodManager] Watch: pod in terminal state');
          await pool.query(
            `UPDATE nodered_pods SET status = 'terminated', pod_ip = NULL, nr_ready = FALSE WHERE pod_name = $1`,
            [podName]
          );
          await this.logEvent(podName, 'watch_terminated', dbPod.rows[0].assigned_user_id, { phase });
          if (!this.shuttingDown) this.fillPool().catch(() => {});
        }
      }
    }
  }

  // --- Graceful Pod Drain ---

  /**
   * Gracefully drain a pod: call /nr/unload-flows to clear NR state,
   * then wait briefly for cleanup. This prevents abrupt termination.
   */
  private async drainPod(podName: string, podIp: string): Promise<void> {
    try {
      logger.info({ pod: podName }, '[PodManager] Draining pod (unloading flows)...');
      await pool.query(
        `UPDATE nodered_pods SET status = 'draining' WHERE pod_name = $1 AND status = 'assigned'`,
        [podName]
      );

      const resp = await fetch(`http://${podIp}:1880/nr/unload-flows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ podSecret: process.env.NR_POD_SECRET }),
        signal: AbortSignal.timeout(DRAIN_TIMEOUT_MS),
      });

      if (resp.ok) {
        logger.info({ pod: podName }, '[PodManager] Pod drained successfully');
      } else {
        logger.warn({ pod: podName, status: resp.status }, '[PodManager] Pod drain returned non-OK');
      }
    } catch (err: any) {
      logger.warn({ pod: podName, err: err.message }, '[PodManager] Pod drain failed (proceeding with delete)');
    }
  }

  // --- Pod Metrics via K8s Metrics API ---

  /**
   * Refresh CPU/RAM metrics for all managed pods from the K8s Metrics API.
   * Caches results for use in getAllPods().
   */
  private async refreshPodMetrics(): Promise<void> {
    try {
      const metricsClient = new k8s.Metrics(this.kc);
      const podMetrics = await metricsClient.getPodMetrics(NAMESPACE);
      const now = Date.now();

      for (const item of podMetrics.items) {
        const podName = item.metadata?.name;
        if (!podName?.startsWith('osf-nr-')) continue;

        const container = item.containers?.[0];
        if (!container) continue;

        const cpuMillicores = parseCpu(container.usage?.cpu || '0');
        const memoryMb = parseMemory(container.usage?.memory || '0');

        this.podMetricsCache.set(podName, {
          cpuMillicores: Math.round(cpuMillicores),
          memoryMb: Math.round(memoryMb),
          ts: now,
        });
      }

      // Purge stale entries (>2min old)
      for (const [name, m] of Array.from(this.podMetricsCache.entries())) {
        if (now - m.ts > 120_000) this.podMetricsCache.delete(name);
      }
    } catch (err: any) {
      // Metrics API not available is not critical — just log at debug level
      logger.debug({ err: err.message }, '[PodManager] Metrics API unavailable');
    }
  }

  private getPodSpec(podName: string): k8s.V1Pod {
    const image = process.env.NR_POD_IMAGE || '192.168.178.150:32000/osf-nodered:latest';

    return {
      apiVersion: 'v1',
      kind: 'Pod',
      metadata: {
        name: podName,
        namespace: NAMESPACE,
        labels: {
          app: 'osf-nodered',
          'osf.dev/managed-by': 'pod-manager',
        },
      },
      spec: {
        securityContext: {
          runAsNonRoot: true,
          runAsUser: 1000,
          runAsGroup: 3000,
          fsGroup: 3000,
        },
        containers: [{
          name: 'nodered',
          image,
          ports: [{ containerPort: 1880 }],
          securityContext: {
            allowPrivilegeEscalation: false,
            capabilities: { drop: ['ALL'] },
            readOnlyRootFilesystem: true,
          },
          env: [
            {
              name: 'NR_POD_SECRET',
              valueFrom: { secretKeyRef: { name: 'osf-secrets', key: 'nr-pod-secret' } },
            },
            { name: 'GATEWAY_URL', value: process.env.GATEWAY_INTERNAL_URL || 'http://osf-gateway:8080' },
            { name: 'POD_NAME', value: podName },
          ],
          resources: {
            requests: { memory: '128Mi', cpu: '100m' },
            limits: { memory: '512Mi', cpu: '500m' },
          },
          volumeMounts: [
            { name: 'tmp', mountPath: '/tmp' },
            { name: 'nodered-data', mountPath: '/app/.node-red' },
          ],
          readinessProbe: {
            httpGet: { path: '/health', port: 1880 as any },
            initialDelaySeconds: 5,
            periodSeconds: 5,
          },
          livenessProbe: {
            httpGet: { path: '/health', port: 1880 as any },
            initialDelaySeconds: 15,
            periodSeconds: 30,
            failureThreshold: 10,
          },
        }],
        volumes: [
          { name: 'tmp', emptyDir: { sizeLimit: '50Mi' } },
          { name: 'nodered-data', emptyDir: { sizeLimit: '100Mi' } },
        ],
        restartPolicy: 'Never',
      },
    };
  }
}

/** Hash a UUID string to a stable 32-bit integer for pg_advisory_lock. */
function hashToInt(s: string): number {
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    hash = ((hash << 5) - hash + s.charCodeAt(i)) | 0;
  }
  return hash;
}

function randomId(): string {
  return Math.random().toString(36).substring(2, 10);
}

/** Parse K8s CPU string (e.g. "50m", "100n", "1") to millicores */
function parseCpu(cpu: string): number {
  if (cpu.endsWith('n')) return parseInt(cpu) / 1_000_000;
  if (cpu.endsWith('m')) return parseInt(cpu);
  return parseFloat(cpu) * 1000;
}

/** Parse K8s memory string (e.g. "180Mi", "1Gi", "131072Ki") to MB */
function parseMemory(mem: string): number {
  if (mem.endsWith('Ki')) return parseInt(mem) / 1024;
  if (mem.endsWith('Mi')) return parseInt(mem);
  if (mem.endsWith('Gi')) return parseFloat(mem) * 1024;
  return parseInt(mem) / (1024 * 1024);
}
