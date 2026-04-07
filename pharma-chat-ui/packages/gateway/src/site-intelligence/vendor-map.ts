/**
 * Vendor Map Parser — reads Process1st_Vendor_Map_v3 Excel and provides
 * deterministic lookups for modality → equipment → vendor product mapping.
 */

import * as XLSX from 'xlsx';
import * as path from 'path';
import type { VendorMapRow, VendorKey, ProcessStep, EquipmentStatus } from '@p1/shared';

// ── Tab ↔ Modality Mapping ──

export const TAB_CONFIG: Record<string, { modality: string; scale: string }> = {
  'mAb 1000L (Dyn. Perfusion)': { modality: 'mAb', scale: '1000L' },
  'mAb 2000L (Fed Batch)':      { modality: 'mAb', scale: '2000L' },
  'AAV 500L':                    { modality: 'AAV', scale: '500L' },
  'Lentivirus (LV) 50L':        { modality: 'Lentivirus', scale: '50L' },
  'ADC':                         { modality: 'ADC', scale: 'Platform' },
  'mRNA IVT 50L':                { modality: 'mRNA', scale: '50L' },
  'pDNA 40L':                    { modality: 'pDNA', scale: '40L' },
};

export const VENDOR_KEYS: Record<string, VendorKey> = {
  'Sartorius':      'sar',
  'Thermo Fisher':  'tf',
  'Cytiva':         'cyt',
  'MilliporeSigma': 'ms',
  'Repligen':       'rep',
};

// Column indices in the Excel (0-based): Unit Op, Equipment, SAR prod, SAR status, TF prod, TF status, ...
const COL_UNIT_OP = 0;
const COL_EQUIP   = 1;
const VENDOR_COLS: Array<{ key: VendorKey; prodCol: number; statusCol: number }> = [
  { key: 'sar', prodCol: 2,  statusCol: 3 },
  { key: 'tf',  prodCol: 4,  statusCol: 5 },
  { key: 'cyt', prodCol: 6,  statusCol: 7 },
  { key: 'ms',  prodCol: 8,  statusCol: 9 },
  { key: 'rep', prodCol: 10, statusCol: 11 },
];

// ── Singleton Cache ──

let vendorMapCache: Map<string, VendorMapRow[]> | null = null;

function getVendorMapPath(): string {
  return process.env.VENDOR_MAP_PATH
    || path.resolve('/opt/Tobias Package/Process1st_Vendor_Map_v3_REVIEWED.xlsx');
}

function loadVendorMap(): Map<string, VendorMapRow[]> {
  if (vendorMapCache) return vendorMapCache;

  const filePath = getVendorMapPath();
  const wb = XLSX.readFile(filePath);
  const result = new Map<string, VendorMapRow[]>();

  for (const sheetName of wb.SheetNames) {
    const config = TAB_CONFIG[sheetName];
    if (!config) continue; // skip unknown tabs

    const ws = wb.Sheets[sheetName];
    const rows: any[][] = XLSX.utils.sheet_to_json(ws, { header: 1 });

    const parsed: VendorMapRow[] = [];
    let stepOrder = 0;
    let currentUnitOp = '';

    // Skip header rows (first 3 rows: title, column headers, sub-headers)
    for (let i = 3; i < rows.length; i++) {
      const row = rows[i];
      if (!row || row.length < 2) continue;

      const unitOp = String(row[COL_UNIT_OP] || '').trim();
      const equip  = String(row[COL_EQUIP] || '').trim();

      if (!equip) continue; // skip empty rows
      // Skip status legend rows at the bottom
      if (equip.includes('Status:') || equip.includes('✓ OK')) continue;

      if (unitOp) currentUnitOp = unitOp;

      const vendors: Record<VendorKey, string> = { sar: '', tf: '', cyt: '', ms: '', rep: '' };
      for (const vc of VENDOR_COLS) {
        const prod = String(row[vc.prodCol] || '').trim();
        if (prod && prod !== '—' && prod !== '-') {
          vendors[vc.key] = prod;
        }
      }

      stepOrder++;
      parsed.push({
        unitOperation: currentUnitOp || equip,
        equipmentName: equip,
        stepOrder,
        category: `${config.modality}_${config.scale}`,
        vendors,
      });
    }

    result.set(sheetName, parsed);
  }

  vendorMapCache = result;
  console.log(`[vendor-map] Loaded ${result.size} tabs from ${filePath}`);
  return result;
}

// ── Public API ──

export function getVendorMapTabs(): string[] {
  return Array.from(loadVendorMap().keys());
}

export function getVendorMapTab(tabName: string): VendorMapRow[] {
  return loadVendorMap().get(tabName) || [];
}

export function findTabByModality(modality: string, scale?: string): string | null {
  for (const [tabName, config] of Object.entries(TAB_CONFIG)) {
    if (config.modality.toLowerCase() === modality.toLowerCase()) {
      if (!scale || config.scale === scale) return tabName;
    }
  }
  return null;
}

export function getProcessSteps(
  tabName: string,
  userVendor: string,
  statusMap: EquipmentStatus = {},
): ProcessStep[] {
  const rows = getVendorMapTab(tabName);
  const vendorKey = VENDOR_KEYS[userVendor];
  const config = TAB_CONFIG[tabName];
  if (!rows.length || !vendorKey || !config) return [];

  return rows.map((row) => {
    const ourProduct = row.vendors[vendorKey] || '';

    // Build competitor list: all other vendors that have a product for this row
    const competitors = Object.entries(row.vendors)
      .filter(([k, v]) => k !== vendorKey && v)
      .map(([k, v]) => {
        const vendorName = Object.entries(VENDOR_KEYS).find(([, vk]) => vk === k)?.[0] || k;
        return `${vendorName}: ${v}`;
      });

    return {
      process: `${config.modality} ${config.scale}`,
      step: row.unitOperation,
      category: row.category,
      stepOrder: row.stepOrder,
      equipment: row.equipmentName,
      product: ourProduct,
      status: statusMap[row.unitOperation] || statusMap[row.equipmentName] || 'NO_CONTACT',
      vendor: competitors.length > 0 ? competitors.join(' | ') : '—',
    };
  });
}
