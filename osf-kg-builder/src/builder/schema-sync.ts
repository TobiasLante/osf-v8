import { execSync } from 'child_process';
import { existsSync } from 'fs';
import { logger } from '../shared/logger';

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

    // Build authenticated URL if token provided
    const authUrl = token
      ? repoUrl.replace('https://', `https://${token}@`)
      : repoUrl;

    try {
      if (existsSync(`${localPath}/.git`)) {
        // Already cloned — pull latest
        logger.info({ localPath }, '[SchemaSync] Repo exists, pulling latest...');
        execSync(`git -C ${localPath} fetch origin ${branch} 2>&1`, { timeout: 30_000 });
        execSync(`git -C ${localPath} reset --hard origin/${branch} 2>&1`, { timeout: 10_000 });
      } else {
        // Fresh clone
        logger.info({ repoUrl, branch }, '[SchemaSync] Cloning schema repo...');
        execSync(`git clone --branch ${branch} --depth 1 ${authUrl} ${localPath} 2>&1`, { timeout: 60_000 });
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
      return execSync(`git -C ${this.config.localPath} rev-parse HEAD`, { encoding: 'utf-8' }).trim();
    } catch {
      return '';
    }
  }

  private async checkForUpdates(): Promise<void> {
    const { localPath, branch } = this.config;
    const authUrl = this.config.token
      ? this.config.repoUrl.replace('https://', `https://${this.config.token}@`)
      : this.config.repoUrl;

    try {
      execSync(`git -C ${localPath} fetch origin ${branch} 2>&1`, { timeout: 15_000 });
      const remoteCommit = execSync(
        `git -C ${localPath} rev-parse origin/${branch}`, { encoding: 'utf-8' }
      ).trim();

      if (remoteCommit !== this.lastCommit) {
        logger.info({ oldCommit: this.lastCommit.substring(0, 7), newCommit: remoteCommit.substring(0, 7) },
          '[SchemaSync] New schemas detected — pulling...');

        execSync(`git -C ${localPath} reset --hard origin/${branch} 2>&1`, { timeout: 10_000 });
        this.lastCommit = remoteCommit;

        if (this._onUpdate) {
          await this._onUpdate();
        }
      }
    } catch (err) {
      logger.warn({ err: (err as Error).message }, '[SchemaSync] Poll failed (will retry)');
    }
  }
}
