import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { SMProfile, SourceSchema, SyncSchema } from '../shared/schema-types';
import { logger } from '../shared/logger';

// ── Load all schemas from a synced repo directory ────────────────

export function loadAllProfiles(basePath: string): SMProfile[] {
  const profileDir = join(basePath, 'profiles');
  return loadJsonDirRecursive<SMProfile>(profileDir);
}

export function loadAllSources(basePath: string): SourceSchema[] {
  const sourceDir = join(basePath, 'sources');
  const raw = loadJsonDirWithPaths(sourceDir);
  return raw.map(({ data, filePath }) => {
    const s = data as any;
    // Infer sourceType from directory name if missing
    if (!s.sourceType) {
      if (filePath.includes('/opcua/')) s.sourceType = 'opcua';
      else if (filePath.includes('/postgresql/')) s.sourceType = 'postgresql';
      else if (filePath.includes('/rest/')) s.sourceType = 'rest';
    }
    // Accept mappingId as fallback for sourceId
    if (!s.sourceId && s.mappingId) s.sourceId = s.mappingId;
    return s as SourceSchema;
  });
}

export function loadAllSyncs(basePath: string): SyncSchema[] {
  const syncDir = join(basePath, 'sync');
  return loadJsonDirRecursive<SyncSchema>(syncDir);
}

// Backward-compat aliases
export function loadAllOpcUaMappings(basePath: string): SourceSchema[] {
  return loadAllSources(basePath).filter(s => s.sourceType === 'opcua');
}

export function loadAllUnsMappings(basePath: string): SyncSchema[] {
  return loadAllSyncs(basePath).filter(s => s.syncType === 'mqtt');
}

/**
 * Recursively load all .json files from a directory and its subdirectories.
 */
function loadJsonDirRecursive<T>(dirPath: string): T[] {
  return loadJsonDirWithPaths(dirPath).map(({ data }) => data as T);
}

function loadJsonDirWithPaths(dirPath: string): Array<{ data: unknown; filePath: string }> {
  const results: Array<{ data: unknown; filePath: string }> = [];
  if (!existsSync(dirPath)) {
    logger.warn({ dirPath }, '[SchemaLoader] Directory not found');
    return results;
  }

  const entries = readdirSync(dirPath, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dirPath, entry.name);
    if (entry.isDirectory()) {
      results.push(...loadJsonDirWithPaths(fullPath));
    } else if (entry.name.endsWith('.json')) {
      try {
        const raw = readFileSync(fullPath, 'utf-8');
        results.push({ data: JSON.parse(raw), filePath: fullPath });
      } catch (err) {
        logger.warn({ file: fullPath, err: (err as Error).message }, '[SchemaLoader] Failed to parse JSON');
      }
    }
  }

  return results;
}

// ── Cross-Reference Validation ──────────────────────────────────

export interface ValidationError {
  file: string;
  field: string;
  message: string;
}

export function validateSchemaRefs(
  profiles: SMProfile[],
  sources: SourceSchema[],
  syncs: SyncSchema[],
): ValidationError[] {
  const errors: ValidationError[] = [];
  const profileIds = new Set(profiles.map(p => p.profileId));

  // Build attribute lookup per profile
  const allSmAttributes = new Map<string, Set<string>>();
  for (const p of profiles) {
    allSmAttributes.set(p.profileId, new Set(p.attributes.map(a => a.name)));
  }

  // Validate all sources reference valid profiles
  for (const s of sources) {
    if (!profileIds.has(s.profileRef)) {
      errors.push({
        file: `sources/${s.sourceType}/${s.sourceId}`,
        field: 'profileRef',
        message: `Profile "${s.profileRef}" not found. Available: ${[...profileIds].join(', ')}`,
      });
    }
  }

  // Validate polling syncs reference valid sources
  const sourceIds = new Set(sources.map(s => s.sourceId));
  for (const sync of syncs) {
    if (sync.syncType === 'polling' && sync.sources) {
      for (const ref of sync.sources) {
        if (!sourceIds.has(ref.sourceRef)) {
          errors.push({
            file: `sync/polling/${sync.syncId}`,
            field: 'sources.sourceRef',
            message: `Source "${ref.sourceRef}" not found.`,
          });
        }
      }
    }
  }

  if (errors.length > 0) {
    logger.warn({ errorCount: errors.length }, '[SchemaLoader] Schema validation errors found');
    for (const e of errors) {
      logger.warn({ file: e.file, field: e.field }, e.message);
    }
  } else {
    logger.info(
      { profiles: profiles.length, sources: sources.length, syncs: syncs.length },
      '[SchemaLoader] All schema cross-references valid',
    );
  }

  return errors;
}
