"use client";

import React, { useState, useCallback } from "react";
import type {
  SiteIntelligenceInput, EnrichmentData, ModalityResolution,
  EquipmentStatus, EquipmentStatusValue, ProcessStep, ReportRequest,
} from "@p1/shared";
import {
  siteEnrichStream, siteResolve, siteInferStatus,
  siteGetProcessSteps, siteGenerateReports,
  type BothReportsResponse,
} from "../../lib/api";
import { IntakeForm } from "../../components/site-intelligence/IntakeForm";
import { EnrichmentStatus } from "../../components/site-intelligence/EnrichmentStatus";
import { EquipmentReview } from "../../components/site-intelligence/EquipmentReview";
import { ReportDownload } from "../../components/site-intelligence/ReportDownload";

import { findTabByModality } from "./modality-tabs";

type Step = 1 | 2 | 3 | 4;

export default function SiteIntelligencePage() {
  const [currentStep, setCurrentStep] = useState<Step>(1);
  const [isLoading, setIsLoading] = useState(false);

  const [input, setInput] = useState<SiteIntelligenceInput | null>(null);
  const [enrichment, setEnrichment] = useState<EnrichmentData | null>(null);
  const [sourceStatus, setSourceStatus] = useState<Record<string, 'pending' | 'running' | 'done' | 'error'>>({});
  const [sourcePreviews, setSourcePreviews] = useState<Record<string, string>>({});
  const [resolution, setResolution] = useState<ModalityResolution | null>(null);
  const [equipmentStatus, setEquipmentStatus] = useState<EquipmentStatus>({});
  const [processSteps, setProcessSteps] = useState<ProcessStep[]>([]);
  const [reportBlob, setReportBlob] = useState<Blob | null>(null);
  const [reportData, setReportData] = useState<BothReportsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);

  // ── Step 1 → 2: Enrich with live progress + Resolve ──
  const handleEnrich = useCallback(async (formInput: SiteIntelligenceInput) => {
    setIsLoading(true);
    setError(null);
    setInput(formInput);
    setCurrentStep(2);

    // Init all sources as pending
    const sources = ['clinicalTrials', 'openFda', 'decrs', 'hcters', 'edgar', 'website', 'news'];
    setSourceStatus(Object.fromEntries(sources.map(s => [s, 'pending' as const])));
    setSourcePreviews({});

    try {
      const data = await siteEnrichStream(
        formInput,
        (name) => setSourceStatus(prev => ({ ...prev, [name]: 'running' })),
        (name, preview) => {
          setSourceStatus(prev => ({ ...prev, [name]: 'done' }));
          setSourcePreviews(prev => ({ ...prev, [name]: preview }));
        },
        (name) => setSourceStatus(prev => ({ ...prev, [name]: 'error' })),
      );
      setEnrichment(data);

      // Auto-resolve
      try {
        const res = await siteResolve(data);
        setResolution(res);
        if (res.vendorMapTab) {
          try {
            const status = await siteInferStatus(data, res.vendorMapTab, formInput.vendor);
            setEquipmentStatus(status);
          } catch { /* defaults */ }
        }
      } catch { /* user selects manually */ }
    } catch (err: any) {
      setError(err.message || "Enrichment failed");
    } finally {
      setIsLoading(false);
    }
  }, []);

  // ── Step 2 → 3: Confirm and load equipment ──
  const handleConfirm = useCallback(async () => {
    if (!resolution || !input) return;
    setIsLoading(true);
    setError(null);

    try {
      const steps = await siteGetProcessSteps(
        resolution.vendorMapTab, input.vendor, equipmentStatus
      );
      setProcessSteps(steps);
      setCurrentStep(3);
    } catch (err: any) {
      setError(err.message || "Failed to load equipment data");
    } finally {
      setIsLoading(false);
    }
  }, [resolution, input, equipmentStatus]);

  // ── Override modality ──
  const handleOverrideModality = useCallback(async (modality: string, scale: string) => {
    if (!input || !enrichment) return;
    const tab = findTabByModality(modality, scale);
    if (!tab) return;

    const newResolution: ModalityResolution = {
      modality, scale,
      vendorMapTab: tab,
      phase: resolution?.phase || "Unknown",
      accountType: resolution?.accountType || "unknown",
      confidence: 1.0,
      signals: ["Manual override by user"],
    };
    setResolution(newResolution);

    // Re-infer status for new tab
    try {
      const status = await siteInferStatus(enrichment, tab, input.vendor);
      setEquipmentStatus(status);
    } catch { /* keep existing */ }
  }, [input, enrichment, resolution]);

  // ── Step 3: Status change ──
  const handleStatusChange = useCallback((stepIndex: number, status: EquipmentStatusValue) => {
    setProcessSteps(prev => {
      const next = [...prev];
      next[stepIndex] = { ...next[stepIndex], status };
      return next;
    });
    // Also update the status map
    const step = processSteps[stepIndex];
    if (step) {
      setEquipmentStatus(prev => ({ ...prev, [step.step]: status, [step.equipment]: status }));
    }
  }, [processSteps]);

  // ── Step 3 → 4: Generate report ──
  const handleGenerate = useCallback(async () => {
    if (!input || !enrichment || !resolution) return;
    setIsLoading(true);
    setError(null);

    try {
      const request: ReportRequest = {
        input, enrichment, resolution, equipmentStatus, processSteps,
      };
      const data = await siteGenerateReports(request);
      setReportData(data);
      setCurrentStep(4);
    } catch (err: any) {
      setError(err.message || "Report generation failed");
    } finally {
      setIsLoading(false);
    }
  }, [input, enrichment, resolution, equipmentStatus, processSteps]);

  // ── Reset ──
  const handleRestart = useCallback(() => {
    setCurrentStep(1);
    setInput(null);
    setEnrichment(null);
    setResolution(null);
    setEquipmentStatus({});
    setProcessSteps([]);
    setReportBlob(null);
    setReportData(null);
    setError(null);
    setSourceStatus({});
    setSourcePreviews({});
  }, []);

  return (
    <div className="min-h-screen p-6">
      {/* Step indicator */}
      <div className="max-w-2xl mx-auto mb-8">
        <div className="flex items-center justify-center gap-2">
          {[1, 2, 3, 4].map((s) => (
            <React.Fragment key={s}>
              {s > 1 && <div className={`w-8 h-px ${s <= currentStep ? "bg-cyan-500" : "bg-p1-border"}`} />}
              <div className={`w-8 h-8 rounded-full flex items-center justify-center text-xs font-bold ${
                s < currentStep ? "bg-emerald-500 text-white" :
                s === currentStep ? "bg-cyan-500 text-white" :
                "bg-p1-surface text-p1-dim border border-p1-border"
              }`}>
                {s < currentStep ? "✓" : s}
              </div>
            </React.Fragment>
          ))}
        </div>
        <div className="flex justify-center gap-6 mt-2 text-[10px] text-p1-dim uppercase tracking-wider">
          <span>Input</span><span>Enrich</span><span>Review</span><span>Report</span>
        </div>
      </div>

      {/* Error display */}
      {error && (
        <div className="max-w-2xl mx-auto mb-4 p-3 rounded-lg border border-red-500/30 bg-red-500/5 text-red-400 text-sm">
          {error}
        </div>
      )}

      {/* Current screen */}
      {currentStep === 1 && (
        <IntakeForm onSubmit={handleEnrich} isLoading={isLoading} />
      )}

      {currentStep === 2 && (
        <EnrichmentStatus
          enrichment={enrichment}
          resolution={resolution}
          isResolving={isLoading && !resolution}
          sourceStatus={sourceStatus}
          sourcePreviews={sourcePreviews}
          onConfirm={handleConfirm}
          onOverrideModality={handleOverrideModality}
        />
      )}

      {currentStep === 3 && (
        <EquipmentReview
          steps={processSteps}
          vendorMapTab={resolution?.vendorMapTab || ""}
          vendor={input?.vendor || ""}
          onStatusChange={handleStatusChange}
          onGenerate={handleGenerate}
          isLoading={isLoading}
        />
      )}

      {currentStep === 4 && (
        <ReportDownload
          reportData={reportData}
          reportBlob={reportBlob}
          accountName={input?.accountName || ""}
          steps={processSteps}
          onRestart={handleRestart}
        />
      )}
    </div>
  );
}
