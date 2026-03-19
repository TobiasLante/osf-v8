// Historian v2 — Topic Profiles
// Configurable topic parsing with profile-based segment mapping
// Follows config-manager.ts pattern: load from DB, hot-reload, in-memory lookup

import { getTopicProfiles, type TopicProfile } from './db.js';
import { logger } from './logger.js';

const RELOAD_INTERVAL_MS = 30_000;

// ─── Built-in Fallback Profiles ─────────────────────────────────────────────

export const BUILTIN_PROFILES: TopicProfile[] = [
  {
    id: -1,
    name: 'Factory (default)',
    prefix: 'Factory',
    subscription: 'Factory/#',
    seg_machine: 1,
    seg_work_order: 2,
    seg_tool_id: 3,
    seg_category: 4,
    seg_variable_start: 5,
    null_marker: '---',
    is_builtin: true,
    enabled: true,
    priority: 100,
    example_topic: 'Factory/BZ-1/FA-FFS-000000/T01/BDE/Act_Qty_Good',
    created_at: '',
    updated_at: '',
  },
  {
    id: -2,
    name: 'ISA-95',
    prefix: 'Enterprise',
    subscription: 'Enterprise/#',
    seg_machine: 4,
    seg_work_order: null,
    seg_tool_id: null,
    seg_category: 5,
    seg_variable_start: 6,
    null_marker: '---',
    is_builtin: true,
    enabled: true,
    priority: 50,
    example_topic: 'Enterprise/Site/Area/Line/CNC-01/BDE/Spindle_RPM',
    created_at: '',
    updated_at: '',
  },
];

// ─── In-Memory State ─────────────────────────────────────────────────────────

let activeProfiles: TopicProfile[] = [...BUILTIN_PROFILES];
let reloadTimer: NodeJS.Timeout | null = null;

// ─── Parsed Result ───────────────────────────────────────────────────────────

export interface ParsedTopic {
  machine: string;
  workOrder: string | null;
  toolId: string | null;
  category: string;
  variable: string;
  profileId: number;
  profileName: string;
}

// ─── Profile Loading ─────────────────────────────────────────────────────────

export async function loadProfiles(): Promise<void> {
  try {
    const dbProfiles = await getTopicProfiles();
    if (dbProfiles.length > 0) {
      // Sort by priority DESC
      activeProfiles = dbProfiles.sort((a, b) => b.priority - a.priority);
    } else {
      // DB empty → use builtins
      activeProfiles = [...BUILTIN_PROFILES];
    }
    logger.info(`[topic-profiles] Loaded ${activeProfiles.length} profiles`);
  } catch (err: any) {
    logger.error(`[topic-profiles] Failed to load profiles, using builtins: ${err.message}`);
    activeProfiles = [...BUILTIN_PROFILES];
  }
}

export function startProfileReload(): void {
  reloadTimer = setInterval(loadProfiles, RELOAD_INTERVAL_MS);
  logger.info(`[topic-profiles] Hot-reload every ${RELOAD_INTERVAL_MS / 1000}s`);
}

export function stopProfileReload(): void {
  if (reloadTimer) {
    clearInterval(reloadTimer);
    reloadTimer = null;
  }
}

// ─── Accessors ───────────────────────────────────────────────────────────────

export function getActiveProfiles(): TopicProfile[] {
  return activeProfiles;
}

export function getActiveSubscriptions(): string[] {
  const subs = new Set<string>();
  for (const p of activeProfiles) {
    if (p.enabled) subs.add(p.subscription);
  }
  return [...subs];
}

// ─── Universal Topic Parser ──────────────────────────────────────────────────

export function parseTopic(topic: string): ParsedTopic | null {
  const parts = topic.split('/');

  for (const profile of activeProfiles) {
    if (!profile.enabled) continue;

    // Check prefix match
    if (parts[0] !== profile.prefix) continue;

    // Need enough segments
    if (parts.length <= profile.seg_variable_start) continue;

    const nullMarker = profile.null_marker || '---';

    const machine = profile.seg_machine !== null && profile.seg_machine < parts.length
      ? parts[profile.seg_machine]
      : 'unknown';

    const workOrderRaw = profile.seg_work_order !== null && profile.seg_work_order < parts.length
      ? parts[profile.seg_work_order]
      : null;

    const toolIdRaw = profile.seg_tool_id !== null && profile.seg_tool_id < parts.length
      ? parts[profile.seg_tool_id]
      : null;

    const category = profile.seg_category !== null && profile.seg_category < parts.length
      ? parts[profile.seg_category]
      : 'unknown';

    const variable = parts.slice(profile.seg_variable_start).join('/');

    return {
      machine,
      workOrder: workOrderRaw === nullMarker ? null : workOrderRaw,
      toolId: toolIdRaw === nullMarker ? null : toolIdRaw,
      category,
      variable,
      profileId: profile.id,
      profileName: profile.name,
    };
  }

  return null;
}
