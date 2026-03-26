import { readdirSync, readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { SMProfile, SourceSchema, SyncSchema } from '../shared/schema-types';
import { logger } from '../shared/logger';

// ── Load all schemas from a synced repo directory ────────────────

export function loadAllProfiles(basePath: string): SMProfile[] {
  const profileDir = join(basePath, 'profiles');
  const profiles = loadJsonDirRecursive<SMProfile>(profileDir);
  inheritFromParent(profiles);
  return profiles;
}

/**
 * Merge parent attributes AND relationships into child profiles.
 * Child attributes override parent attributes with the same name.
 * Child relationships override parent relationships with the same type+target.
 * Supports multi-level inheritance (grandparent → parent → child).
 */
function inheritFromParent(profiles: SMProfile[]): void {
  const byId = new Map<string, SMProfile>();
  const byLabel = new Map<string, SMProfile>();
  for (const p of profiles) {
    byId.set(p.profileId, p);
    byLabel.set(p.kgNodeLabel, p);
  }

  // Track resolved profiles to handle multi-level inheritance + cycles
  const resolved = new Set<string>();

  function resolve(profile: SMProfile): void {
    if (resolved.has(profile.profileId)) return;
    resolved.add(profile.profileId); // Mark early to prevent cycles

    const parentType = profile.parentType;
    if (!parentType || parentType === 'null' || parentType === 'None') return;

    const parent = byId.get(parentType) || byLabel.get(parentType);
    if (!parent) return;

    // Resolve parent first (multi-level)
    resolve(parent);

    let inheritedAttrs = 0;
    let inheritedRels = 0;

    // Merge attributes: child wins on name collision
    const childAttrNames = new Set(profile.attributes.map(a => a.name));
    const inherited = parent.attributes.filter(a => !childAttrNames.has(a.name));
    if (inherited.length > 0) {
      profile.attributes = [...inherited, ...profile.attributes];
      inheritedAttrs = inherited.length;
    }

    // Merge relationships: child wins on type+target collision
    const childRelKeys = new Set(profile.relationships.map(r => `${r.type}→${r.target}`));
    const inheritedRelsArr = parent.relationships.filter(r => !childRelKeys.has(`${r.type}→${r.target}`));
    if (inheritedRelsArr.length > 0) {
      profile.relationships = [...inheritedRelsArr, ...profile.relationships];
      inheritedRels = inheritedRelsArr.length;
    }

    if (inheritedAttrs > 0 || inheritedRels > 0) {
      logger.info(
        { child: profile.profileId, parent: parent.profileId, inheritedAttrs, inheritedRels },
        '[SchemaLoader] Inherited from parent',
      );
    }
  }

  for (const p of profiles) resolve(p);
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
      else if (filePath.includes('/mcp/')) s.sourceType = 'mcp';
    }
    // Accept mappingId as fallback for sourceId
    if (!s.sourceId && s.mappingId) s.sourceId = s.mappingId;
    return s as SourceSchema;
  });
}

export function loadAllSyncs(basePath: string): SyncSchema[] {
  const syncDir = join(basePath, 'sync');
  const raw = loadJsonDirWithPaths(syncDir);
  return raw.map(({ data, filePath }) => {
    const s = data as any;
    // Infer syncType from directory name if missing
    if (!s.syncType) {
      if (filePath.includes('/mqtt/')) s.syncType = 'mqtt';
      else if (filePath.includes('/polling/')) s.syncType = 'polling';
      else if (filePath.includes('/kafka/')) s.syncType = 'kafka';
      else if (filePath.includes('/webhook/')) s.syncType = 'rest-webhook';
      else if (filePath.includes('/manual/')) s.syncType = 'manual';
      else if (filePath.includes('/bridge/')) {
        logger.debug({ file: filePath }, '[SchemaLoader] Skipping bridge config (reference-only)');
        return null;
      }
    }
    // Accept mappingId as fallback for syncId
    if (!s.syncId && s.mappingId) s.syncId = s.mappingId;
    return s as SyncSchema;
  }).filter((s): s is SyncSchema => s !== null);
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
        // Replace ${ENV_VAR} references with process.env values
        // Handles both "host": "${X}" (string) and "port": "${X}" (unquoted → number)
        const resolved = raw
          .replace(/"\$\{(\w+)\}"/g, (_, key) => {
            const val = process.env[key] ?? '';
            return /^\d+$/.test(val) ? val : `"${val}"`;
          });
        results.push({ data: JSON.parse(resolved), filePath: fullPath });
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

    // Validate kafka topic profileRefs
    if (sync.syncType === 'kafka' && sync.kafka?.topics) {
      for (const topic of sync.kafka.topics) {
        if (!profileIds.has(topic.profileRef)) {
          errors.push({
            file: `sync/kafka/${sync.syncId}`,
            field: `kafka.topics[${topic.topic}].profileRef`,
            message: `Profile "${topic.profileRef}" not found.`,
          });
        }
      }
    }

    // Validate webhook profileRef
    if (sync.syncType === 'rest-webhook' && sync.webhook?.profileRef) {
      if (!profileIds.has(sync.webhook.profileRef)) {
        errors.push({
          file: `sync/webhook/${sync.syncId}`,
          field: 'webhook.profileRef',
          message: `Profile "${sync.webhook.profileRef}" not found.`,
        });
      }
    }

    // Validate manual profileRef
    if (sync.syncType === 'manual' && sync.manual?.profileRef) {
      if (!profileIds.has(sync.manual.profileRef)) {
        errors.push({
          file: `sync/manual/${sync.syncId}`,
          field: 'manual.profileRef',
          message: `Profile "${sync.manual.profileRef}" not found.`,
        });
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
