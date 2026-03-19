import { execFileSync } from 'child_process';
import { existsSync } from 'fs';
import { logger } from '../shared/logger';

const SAFE_PATH_RE = /^[a-zA-Z0-9._\-\/]+$/;
const SAFE_BRANCH_RE = /^[a-zA-Z0-9._\-\/]+$/;

function validateBranch(branch: string): string {
  if (!SAFE_BRANCH_RE.test(branch)) throw new Error(`Invalid branch name: ${branch}`);
  return branch;
}

function validatePath(p: string): string {
  if (!SAFE_PATH_RE.test(p)) throw new Error(`Invalid path: ${p}`);
  return p;
}

export interface SchemaSyncConfig {
  repoUrl: string;
  localPath: string;
  branch: string;
  pollIntervalMs: number;
  token?: string;
}

/**
 * Clones/pulls the osf-schemas GitHub repo and polls for updates.
 * When new commits are detected, calls the onUpdate callback.
 */
export class SchemaSync {
  private config: SchemaSyncConfig;
  private pollTimer: NodeJS.Timeout | null = null;
  private lastCommit: string = '';
  private _onUpdate: (() => Promise<void>) | null = null;
  private isChecking: boolean = false;

  constructor(config: SchemaSyncConfig) {
    this.config = config;
  }

  set onUpdate(fn: (() => Promise<void>) | null) {
    this._onUpdate = fn;
  }

  getLocalPath(): string {
    return this.config.localPath;
  }

  getLastCommit(): string {
    return this.lastCommit;
  }

  async start(): Promise<void> {
    const { repoUrl, localPath, branch, token } = this.config;

    const safeBranch = validateBranch(branch);
    const safePath = validatePath(localPath);

    // Build authenticated URL if token provided
    const authUrl = token
      ? repoUrl.replace('https://', `https://${token}@`)
      : repoUrl;

    try {
      if (existsSync(`${safePath}/.git`)) {
        // Already cloned — pull latest
        logger.info({ localPath: safePath }, '[SchemaSync] Repo exists, pulling latest...');
        execFileSync('git', ['-C', safePath, 'fetch', 'origin', safeBranch], { timeout: 30_000 });
        execFileSync('git', ['-C', safePath, 'reset', '--hard', `origin/${safeBranch}`], { timeout: 10_000 });
      } else {
        // Fresh clone
        logger.info({ repoUrl, branch: safeBranch }, '[SchemaSync] Cloning schema repo...');
        execFileSync('git', ['clone', '--branch', safeBranch, '--depth', '1', authUrl, safePath], { timeout: 60_000 });
      }

      this.lastCommit = this.getCurrentCommit();
      logger.info({ commit: this.lastCommit }, '[SchemaSync] Schemas loaded');
    } catch (err) {
      logger.error({ err: (err as Error).message }, '[SchemaSync] Initial clone/pull failed');
      throw err;
    }

    // Start polling
    if (this.config.pollIntervalMs > 0) {
      this.pollTimer = setInterval(() => this.checkForUpdates(), this.config.pollIntervalMs);
      logger.info({ intervalMs: this.config.pollIntervalMs }, '[SchemaSync] Polling started');
    }
  }

  async stop(): Promise<void> {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }

  private getCurrentCommit(): string {
    try {
      return execFileSync('git', ['-C', this.config.localPath, 'rev-parse', 'HEAD'], { encoding: 'utf-8' }).trim();
    } catch {
      return '';
    }
  }

  private async checkForUpdates(): Promise<void> {
    if (this.isChecking) return;
    this.isChecking = true;

    const { localPath, branch } = this.config;
    const safePath = validatePath(localPath);
    const safeBranch = validateBranch(branch);

    try {
      execFileSync('git', ['-C', safePath, 'fetch', 'origin', safeBranch], { timeout: 15_000 });
      const remoteCommit = execFileSync(
        'git', ['-C', safePath, 'rev-parse', `origin/${safeBranch}`], { encoding: 'utf-8' }
      ).trim();

      if (remoteCommit !== this.lastCommit) {
        logger.info({ oldCommit: this.lastCommit.substring(0, 7), newCommit: remoteCommit.substring(0, 7) },
          '[SchemaSync] New schemas detected — pulling...');

        execFileSync('git', ['-C', safePath, 'reset', '--hard', `origin/${safeBranch}`], { timeout: 10_000 });
        this.lastCommit = remoteCommit;

        if (this._onUpdate) {
          await this._onUpdate();
        }
      }
    } catch (err) {
      logger.warn({ err: (err as Error).message }, '[SchemaSync] Poll failed (will retry)');
    } finally {
      this.isChecking = false;
    }
  }
}
