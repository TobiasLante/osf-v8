/** Client-side modality → vendor map tab mapping (mirrors gateway/vendor-map.ts TAB_CONFIG) */

const TAB_CONFIG: Record<string, { modality: string; scale: string }> = {
  'mAb 1000L (Dyn. Perfusion)': { modality: 'mAb', scale: '1000L' },
  'mAb 2000L (Fed Batch)':      { modality: 'mAb', scale: '2000L' },
  'AAV 500L':                    { modality: 'AAV', scale: '500L' },
  'Lentivirus (LV) 50L':        { modality: 'Lentivirus', scale: '50L' },
  'ADC':                         { modality: 'ADC', scale: 'Platform' },
  'mRNA IVT 50L':                { modality: 'mRNA', scale: '50L' },
  'pDNA 40L':                    { modality: 'pDNA', scale: '40L' },
};

export function findTabByModality(modality: string, scale?: string): string | null {
  for (const [tabName, config] of Object.entries(TAB_CONFIG)) {
    if (config.modality.toLowerCase() === modality.toLowerCase()) {
      if (!scale || config.scale === scale) return tabName;
    }
  }
  return null;
}
