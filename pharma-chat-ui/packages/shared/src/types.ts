export interface ChatMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  toolCalls?: ToolCall[];
  toolResults?: ToolResult[];
}

export interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, any>;
}

export interface ToolResult {
  toolCallId: string;
  name: string;
  content: string;
  isError?: boolean;
}

export interface LlmConfig {
  provider: 'anthropic' | 'openai' | 'custom';
  apiKey: string;
  model: string;
  baseUrl?: string;
}

export interface McpTool {
  name: string;
  description: string;
  inputSchema: Record<string, any>;
}

export interface ProcessStep {
  process: string;
  step: string;
  category: string;
  stepOrder: number;
  equipment: string;
  status?: 'WON' | 'OPEN' | 'COMPETITOR' | 'NO_CONTACT';
  vendor?: string;
  product?: string;
}

export interface EnrichmentResult {
  source: 'clinicaltrials' | 'fda';
  companyName: string;
  results: any[];
  summary?: string;
}

// ── Site Intelligence Types ──

export type EquipmentStatusValue = 'WON' | 'OPEN' | 'COMPETITOR' | 'NO_CONTACT';
export type EquipmentStatus = Record<string, EquipmentStatusValue>;

export type Vendor = 'Sartorius' | 'Thermo Fisher' | 'Cytiva' | 'MilliporeSigma' | 'Repligen';
export type VendorKey = 'sar' | 'tf' | 'cyt' | 'ms' | 'rep';

export interface SiteIntelligenceInput {
  accountName: string;
  location?: string;
  vendor: Vendor;
  salesGoal?: string;
}

// ── Enrichment Source Types ──

export interface ClinicalTrialStudy {
  nctId: string;
  title: string;
  phase: string;
  status: string;
  conditions: string[];
  interventions: Array<{ type: string; name: string }>;
  sponsor?: string;
  collaborators?: string[];
}

export interface FdaApproval {
  application_number: string;
  application_type: string;
  brand_name: string;
  generic_name: string;
  route: string;
  isBLA?: boolean;
}

export interface DecrsResult {
  firmName: string;
  feiNumber: string;
  dunsNumber?: string;
  businessOperations: string[];
  address: string;
  expirationDate?: string;
}

export interface HctersResult {
  hasRegistration: boolean;
  establishmentName?: string;
  details?: string[];
}

export interface EdgarResult {
  totalMentions: number;
  filings: Array<{
    filer: string;
    form: string;
    date: string;
    excerpt: string;
  }>;
}

export interface WebsiteEnrichment {
  modalities: string[];
  scale?: string;
  cgmpStatus?: string;
  partnerships: string[];
  equipmentMentions: string[];
  rawExcerpts?: string[];
}

// ── Aggregated Enrichment ──

export interface EnrichmentData {
  clinicalTrials: { studies: ClinicalTrialStudy[]; summary: string };
  openFda: { approvals: FdaApproval[]; summary: string };
  decrs: DecrsResult | null;
  hcters: HctersResult | null;
  edgar: EdgarResult | null;
  website: WebsiteEnrichment | null;
}

// ── Modality Resolution ──

export interface ModalityResolution {
  modality: string;
  scale: string;
  vendorMapTab: string;
  phase: string;
  accountType: 'innovator' | 'cdmo' | 'unknown';
  confidence: number;
  signals: string[];
}

// ── Vendor Map ──

export interface VendorMapRow {
  unitOperation: string;
  equipmentName: string;
  stepOrder: number;
  category: string;
  vendors: Record<VendorKey, string>;
}

// ── Report Request ──

export interface ReportRequest {
  input: SiteIntelligenceInput;
  enrichment: EnrichmentData;
  resolution: ModalityResolution;
  equipmentStatus: EquipmentStatus;
  processSteps: ProcessStep[];
}
