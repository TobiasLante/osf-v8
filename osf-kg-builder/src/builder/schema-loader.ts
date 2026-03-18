import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { SMProfile, OpcUaMapping, UnsMapping } from '../shared/schema-types';
import { logger } from '../shared/logger';

// ── Load all schemas from a synced repo directory ────────────────

export function loadAllProfiles(basePath: string): SMProfile[] {
  return loadJsonDir<SMProfile>(join(basePath, 'profiles'));
}

export function loadAllOpcUaMappings(basePath: string): OpcUaMapping[] {
  return loadJsonDir<OpcUaMapping>(join(basePath, 'mappings', 'opcua'));
}

export function loadAllUnsMappings(basePath: string): UnsMapping[] {
  return loadJsonDir<UnsMapping>(join(basePath, 'mappings', 'uns'));
}

function loadJsonDir<T>(dirPath: string): T[] {
  try {
    const files = readdirSync(dirPath).filter(f => f.endsWith('.json'));
    return files.map(f => {
      const raw = readFileSync(join(dirPath, f), 'utf-8');
      return JSON.parse(raw) as T;
    });
  } catch (err) {
    logger.warn({ dirPath, err: (err as Error).message }, '[SchemaLoader] Directory not found or empty');
    return [];
  }
}

// ── Cross-Reference Validation ──────────────────────────────────

export interface ValidationError {
  file: string;
  field: string;
  message: string;
}

export function validateSchemaRefs(
  profiles: SMProfile[],
  opcuaMappings: OpcUaMapping[],
  unsMappings: UnsMapping[],
): ValidationError[] {
  const errors: ValidationError[] = [];
  const profileIds = new Set(profiles.map(p => p.profileId));
  const allSmAttributes = new Map<string, Set<string>>();

  // Build attribute lookup per profile
  for (const p of profiles) {
    allSmAttributes.set(p.profileId, new Set(p.attributes.map(a => a.name)));
  }

  // Validate OPC-UA mappings reference valid profiles
  for (const m of opcuaMappings) {
    if (!profileIds.has(m.profileRef)) {
      errors.push({
        file: `mappings/opcua/${m.machineId}.json`,
        field: 'profileRef',
        message: `Profile "${m.profileRef}" not found. Available: ${[...profileIds].join(', ')}`,
      });
    }

    // Validate node mappings reference valid SM attributes
    const profileAttrs = allSmAttributes.get(m.profileRef);
    if (profileAttrs) {
      for (const nm of m.nodeMappings) {
        if (!profileAttrs.has(nm.smAttribute)) {
          errors.push({
            file: `mappings/opcua/${m.machineId}.json`,
            field: `nodeMappings.smAttribute`,
            message: `Attribute "${nm.smAttribute}" not in profile "${m.profileRef}"`,
          });
        }
      }
    }
  }

  // Validate UNS mappings reference attributes that exist in at least one profile
  const allAttributes = new Set<string>();
  for (const attrs of allSmAttributes.values()) {
    for (const a of attrs) allAttributes.add(a);
  }

  for (const u of unsMappings) {
    for (const am of u.attributeMapping.mappings) {
      if (!allAttributes.has(am.smAttribute)) {
        // Warning only — UNS may map attributes that not all profiles have
        logger.debug({ mapping: u.mappingId, attr: am.smAttribute },
          '[SchemaLoader] UNS attribute not in any profile (may be type-specific)');
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
      { profiles: profiles.length, opcuaMappings: opcuaMappings.length, unsMappings: unsMappings.length },
      '[SchemaLoader] All schema cross-references valid',
    );
  }

  return errors;
}
