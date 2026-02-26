import { pool } from '../db/pool';
import { getGitHubToken } from './github-oauth';
import { logger } from '../logger';
import { build } from 'esbuild';

interface Manifest {
  name: string;
  description?: string;
  icon?: string;
  entry?: string;
  timeout?: number;
}

/**
 * Sync a GitHub repo: fetch manifest, fetch entry file, validate, and bundle.
 * We use the GitHub API (no git clone needed) to fetch individual files.
 */
export async function syncRepo(agentId: string, userId: string): Promise<void> {
  const agentResult = await pool.query(
    'SELECT repo_full_name, entry FROM code_agents WHERE id = $1 AND user_id = $2',
    [agentId, userId]
  );

  if (agentResult.rows.length === 0) {
    throw new Error('Agent not found');
  }

  const { repo_full_name, entry } = agentResult.rows[0];
  const token = await getGitHubToken(userId);
  if (!token) throw new Error('GitHub not connected');

  await pool.query(
    "UPDATE code_agents SET deploy_status = 'syncing', deploy_error = NULL, updated_at = NOW() WHERE id = $1",
    [agentId]
  );

  try {
    // 1. Fetch osf-agent.yaml manifest
    const manifest = await fetchManifest(token, repo_full_name);

    // 2. Check repo visibility for free tier
    const userResult = await pool.query('SELECT tier FROM users WHERE id = $1', [userId]);
    const tier = userResult.rows[0]?.tier || 'free';
    if (tier === 'free') {
      const isPrivate = await checkRepoPrivate(token, repo_full_name);
      if (isPrivate) {
        throw new Error('Free tier requires a public repository. Upgrade to use private repos.');
      }
    }

    // 3. Fetch entry file and all imported files
    const entryPath = manifest.entry || entry || 'src/main.ts';
    const files = await fetchRepoFiles(token, repo_full_name, entryPath);
    if (!files[entryPath]) {
      throw new Error(`Entry file "${entryPath}" not found in repo`);
    }

    // 4. Bundle TypeScript → JavaScript with esbuild (supports multi-file imports)
    const bundledCode = await bundleWithEsbuild(files, entryPath);

    // 5. Validate bundled code has a default export
    if (!bundledCode.includes('exports') && !bundledCode.includes('default')) {
      logger.warn({ agentId, repo: repo_full_name }, 'No default export detected in bundled code');
    }

    // 6. Update agent record
    await pool.query(
      `UPDATE code_agents SET
        name = $2, description = $3, icon = $4, entry = $5,
        timeout_seconds = $6, bundled_code = $7, manifest = $8,
        deploy_status = 'deployed', deploy_error = NULL,
        last_synced_at = NOW(), updated_at = NOW()
       WHERE id = $1`,
      [
        agentId,
        manifest.name,
        manifest.description || '',
        manifest.icon || '💻',
        entryPath,
        Math.min(manifest.timeout || 60, 600),
        bundledCode,
        JSON.stringify(manifest),
      ]
    );

    logger.info({ agentId, repo: repo_full_name }, 'Code agent synced successfully');
  } catch (err: any) {
    await pool.query(
      "UPDATE code_agents SET deploy_status = 'error', deploy_error = $2, updated_at = NOW() WHERE id = $1",
      [agentId, err.message]
    );
    throw err;
  }
}

/**
 * Initial registration: create agent record and trigger first sync.
 */
export async function registerRepo(
  userId: string,
  repoFullName: string,
  repoUrl: string
): Promise<string> {
  const token = await getGitHubToken(userId);
  if (!token) throw new Error('GitHub not connected');

  // Fetch manifest to get agent name before inserting
  const manifest = await fetchManifest(token, repoFullName);

  const result = await pool.query(
    `INSERT INTO code_agents (user_id, repo_full_name, repo_url, name, description, icon, entry, timeout_seconds, manifest, deploy_status)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, 'pending')
     RETURNING id`,
    [
      userId,
      repoFullName,
      repoUrl,
      manifest.name,
      manifest.description || '',
      manifest.icon || '💻',
      manifest.entry || 'src/main.ts',
      Math.min(manifest.timeout || 60, 600),
      JSON.stringify(manifest),
    ]
  );

  const agentId = result.rows[0].id;

  // Trigger async sync (don't block the response)
  syncRepo(agentId, userId).catch(err => {
    logger.error({ err: err.message, agentId }, 'Initial sync failed');
  });

  return agentId;
}

async function fetchManifest(token: string, repoFullName: string): Promise<Manifest> {
  // Try yaml first, then json
  let content = await fetchFile(token, repoFullName, 'osf-agent.yaml');
  if (!content) {
    content = await fetchFile(token, repoFullName, 'osf-agent.json');
  }
  if (!content) {
    throw new Error('osf-agent.yaml not found in repo root');
  }

  // Simple YAML parser (for flat key-value manifests)
  if (content.includes(':')) {
    return parseSimpleYaml(content);
  }

  return JSON.parse(content);
}

function parseSimpleYaml(text: string): Manifest {
  const result: Record<string, any> = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const colonIdx = trimmed.indexOf(':');
    if (colonIdx === -1) continue;
    const key = trimmed.slice(0, colonIdx).trim();
    let value: any = trimmed.slice(colonIdx + 1).trim();
    // Strip quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    // Decode Unicode escapes: \U0001F4CA → actual emoji, \u2603 → snowman
    value = value.replace(/\\U([0-9a-fA-F]{8})/g, (_: string, hex: string) =>
      String.fromCodePoint(parseInt(hex, 16))
    );
    value = value.replace(/\\u([0-9a-fA-F]{4})/g, (_: string, hex: string) =>
      String.fromCodePoint(parseInt(hex, 16))
    );
    // Parse numbers
    if (/^\d+$/.test(value)) value = parseInt(value, 10);
    result[key] = value;
  }
  if (!result.name) throw new Error('osf-agent.yaml must have a "name" field');
  return result as Manifest;
}

async function fetchFile(token: string, repoFullName: string, path: string): Promise<string | null> {
  const resp = await fetch(
    `https://api.github.com/repos/${repoFullName}/contents/${path}`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github.v3+json',
      },
    }
  );

  if (resp.status === 404) return null;
  if (!resp.ok) {
    const text = await resp.text();
    throw new Error(`GitHub API error ${resp.status}: ${text.slice(0, 200)}`);
  }

  const data: any = await resp.json();
  if (data.encoding === 'base64' && data.content) {
    return Buffer.from(data.content, 'base64').toString('utf8');
  }

  // If file is too large, use the download URL
  if (data.download_url) {
    const dlResp = await fetch(data.download_url, {
      headers: { Authorization: `Bearer ${token}` },
    });
    return dlResp.text();
  }

  return null;
}

async function checkRepoPrivate(token: string, repoFullName: string): Promise<boolean> {
  const resp = await fetch(`https://api.github.com/repos/${repoFullName}`, {
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: 'application/vnd.github.v3+json',
    },
  });

  if (!resp.ok) throw new Error('Failed to check repo visibility');
  const data: any = await resp.json();
  return data.private === true;
}

/**
 * Fetch all TypeScript files reachable from the entry point.
 * Scans for relative imports and fetches them recursively.
 */
async function fetchRepoFiles(
  token: string,
  repoFullName: string,
  entryPath: string
): Promise<Record<string, string>> {
  const files: Record<string, string> = {};
  const queue = [entryPath];
  const visited = new Set<string>();

  while (queue.length > 0) {
    const filePath = queue.shift()!;
    if (visited.has(filePath)) continue;
    visited.add(filePath);

    const content = await fetchFile(token, repoFullName, filePath);
    if (!content) continue;
    files[filePath] = content;

    // Find relative imports: import ... from './foo' or import ... from '../utils/bar'
    const importRegex = /(?:import|export)\s+.*?from\s+['"](\.[^'"]+)['"]/g;
    let match;
    while ((match = importRegex.exec(content)) !== null) {
      const importPath = match[1];
      const dir = filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/')) : '.';
      let resolved = dir + '/' + importPath;
      // Normalize path (resolve ../)
      const parts = resolved.split('/').filter(Boolean);
      const normalized: string[] = [];
      for (const part of parts) {
        if (part === '..') normalized.pop();
        else if (part !== '.') normalized.push(part);
      }
      resolved = normalized.join('/');
      // Try .ts extension
      if (!resolved.endsWith('.ts') && !resolved.endsWith('.js')) {
        if (!visited.has(resolved + '.ts')) queue.push(resolved + '.ts');
        if (!visited.has(resolved + '/index.ts')) queue.push(resolved + '/index.ts');
      } else {
        if (!visited.has(resolved)) queue.push(resolved);
      }
    }
  }

  return files;
}

/**
 * Bundle TypeScript files into a single JavaScript module using esbuild.
 * Supports multi-file repos with imports between files.
 */
async function bundleWithEsbuild(files: Record<string, string>, entryPath: string): Promise<string> {
  // Use esbuild's virtual filesystem via stdin + plugin
  const result = await build({
    stdin: {
      contents: files[entryPath],
      resolveDir: '/virtual',
      sourcefile: entryPath,
      loader: 'ts',
    },
    bundle: true,
    format: 'cjs',
    platform: 'neutral',
    target: 'es2022',
    write: false,
    plugins: [{
      name: 'virtual-fs',
      setup(build) {
        // Resolve relative imports to our virtual paths
        build.onResolve({ filter: /^\./ }, (args) => {
          const dir = args.importer
            ? args.importer.replace('/virtual/', '').replace(/\/[^/]+$/, '')
            : entryPath.replace(/\/[^/]+$/, '');
          let resolved = dir + '/' + args.path;
          const parts = resolved.split('/').filter(Boolean);
          const normalized: string[] = [];
          for (const part of parts) {
            if (part === '..') normalized.pop();
            else if (part !== '.') normalized.push(part);
          }
          resolved = normalized.join('/');

          // Try extensions
          const candidates = [resolved, resolved + '.ts', resolved + '/index.ts', resolved + '.js'];
          for (const candidate of candidates) {
            if (files[candidate]) {
              return { path: '/virtual/' + candidate, namespace: 'virtual' };
            }
          }
          return undefined;
        });

        // Load virtual files
        build.onLoad({ filter: /.*/, namespace: 'virtual' }, (args) => {
          const key = args.path.replace('/virtual/', '');
          if (files[key]) {
            return { contents: files[key], loader: key.endsWith('.ts') ? 'ts' : 'js' };
          }
          return undefined;
        });
      },
    }],
  });

  if (result.errors.length > 0) {
    throw new Error(`esbuild errors: ${result.errors.map(e => e.text).join(', ')}`);
  }

  return result.outputFiles[0].text;
}
