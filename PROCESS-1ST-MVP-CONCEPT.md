# Process-1st Site Intelligence MVP — Gesamtkonzept

**Version:** 1.0 | **Datum:** 7. April 2026 | **Deadline:** 20. April 2026  
**Projekt:** TT-PSC × Process-1st LLC | **Ziel:** Interphex Demo-Ready

---

## 1. Vision

Ein Salesperson gibt eine Facility-Adresse ein und bekommt in unter 60 Sekunden einen vollständigen Account Intelligence Report — mit Molecule Type, Process Template, Equipment Scope, Competitive Landscape, Strategy und einer visuellen Process Treasure Map.

Heute braucht Justin dafür 6 manuelle Steps über 3 verschiedene Tools. Das MVP automatisiert das in einen einzigen Flow.

---

## 2. Justins manueller Workflow (Ist-Zustand)

| Step | Was | Tool | Zeit |
|------|-----|------|------|
| 1 | Intake Form ausfüllen (15+ Felder) | Base44 App | 5 min |
| 2 | Base44 durchsucht öffentliche DBs, prepopuliert Equipment-Tabelle | Base44 Backend | 1 min |
| 3 | Intake Report per E-Mail erhalten (PDF) | Base44 → Gmail | 1 min |
| 4 | Report-Text in OSF Chat-UI kopieren → Sales Brief generieren | pharma-chat-ui | 3 min |
| 5 | Rohtext in Claude kopieren → nach Template v3 formatieren | Claude (extern) | 5 min |
| 6 | Fertigen DOCX-Report manuell prüfen | Word | 5 min |

**Total: ~20 Minuten, 3x Copy-Paste, 3 Tools**

---

## 3. MVP Flow (Soll-Zustand)

| Screen | Was | User-Aktion | Zeit |
|--------|-----|-------------|------|
| 1 | Minimal Input: Account Name + Location + Vendor + Sales Goal | 4 Felder ausfüllen | 15 sec |
| 2 | Enrichment läuft (6 APIs parallel), Modality erkannt | Bestätigen oder korrigieren | 10-30 sec |
| 3 | Equipment Review + Live Treasure Map Preview | Status pro Zeile korrigieren (optional) | 30 sec |
| 4 | Report generiert + Treasure Map gerendert | Warten | 5-15 sec |
| 5 | Download DOCX/PDF + Interaktive Web Treasure Map | Download | 5 sec |

**Total: ~60 Sekunden, 1 User-Interaktion, 1 Tool**

---

## 4. Datenquellen

### 4.1 Bestehend (bereits implementiert)

| Quelle | Endpoint | Was sie liefert |
|--------|----------|-----------------|
| **ClinicalTrials.gov v2** | `POST /api/enrich/clinicaltrials` | NCT IDs, Phase, Intervention Type (BIOLOGICAL/DRUG/GENETIC), Conditions, Sponsor |
| **openFDA drugsfda** | `POST /api/enrich/fda` | Application Number (BLA/NDA Prefix), Brand Name, Sponsor, Route |

**Notwendige Erweiterungen am bestehenden Code:**
- `fda-api.ts`: Sponsor Name und Collaborators aus CT.gov Response hinzufügen
- `fda-api.ts`: BLA/NDA Prefix aus Application Number parsen (BLA = Biologic, NDA = Drug)

### 4.2 Neu zu bauen

| Quelle | Access Method | Was sie liefert | Aufwand |
|--------|---------------|-----------------|---------|
| **FDA DECRS** | POST auf `accessdata.fda.gov/scripts/cder/drls/getdrls.cfm` | FEI Number, Business Operations (API MANUFACTURE, MANUFACTURE), Address, Registration Expiration | 1.5 Tage |
| **CBER/HCTERS** | POST auf `accessdata.fda.gov/scripts/cber/CFAppsPub/tiss/index.cfm` | HCT/P Registration (Gene/Cell Therapy Signal) | 1 Tag |
| **SEC EDGAR** | REST `efts.sec.gov/LATEST/search-index` | Erwähnungen in SEC Filings (10-K, 8-K) — entdeckt CDMO-Client-Beziehungen | 1.5 Tage |
| **Website Scrape** | HTTP Fetch (Homepage + /about + /capabilities) → LLM Extraction | Modalities, Scale, cGMP, Partnerships, Equipment Mentions | 2 Tage |

### 4.3 Live-Test-Ergebnisse

| Quelle | Innovator (Regeneron) | CDMO (Matica) | Gene Therapy (Bluebird) |
|--------|----------------------|---------------|--------------------------|
| CT.gov | Hunderte Treffer ✅ | 0 Treffer ❌ | 10-50 Treffer ✅ |
| openFDA | 3 BLAs ✅ | 0 ❌ | 1-2 BLAs ✅ |
| DECRS | 3 Facilities + Ops ✅ | 0 (nicht registriert) ❌ | Zu testen |
| HCTERS | N/A | Zu testen | Wahrscheinlich ✅ |
| SEC EDGAR | Eigene 10-Ks ✅ | **1 Treffer: Calidi 8-K nennt Matica als GMP Partner** ✅ | Eigene Filings ✅ |
| Website | Ergänzend | **Hauptquelle** ✅ | Ergänzend |

**Kernerkenntnis:** Für CDMOs ist die Kombination aus Website Scrape + SEC EDGAR die einzige Quelle. SEC EDGAR ist der CDMO-Killer-Feature — es offenbart Client-Beziehungen die sonst nirgends öffentlich sind.

### 4.4 Nicht im MVP

| Quelle | Warum nicht |
|--------|-------------|
| WHO ICTRP | Zielgruppe ist US-Facilities, CT.gov deckt US ab |
| SciRank CDMO Database | Kein öffentlicher API-Zugang |
| i3x / OPC-UA | Keine Live-Verbindung zu analysierten Facilities, erst relevant wenn eigene Facility analysiert wird |

---

## 5. Modality Resolution Engine

### 5.1 Entscheidungsbaum

```
SIGNAL 1: ClinicalTrials.gov Intervention Type
├── "GENETIC" → Gene Therapy
│   ├── Website "AAV" → AAV 500L Fed Batch
│   ├── Website "lentivirus" / "CAR-T" → Lentivirus 50L Fed Batch
│   ├── HCTERS Registration vorhanden → AAV/LV (Website differenziert)
│   └── Unklar → AAV (häufiger) + Flag zur User-Bestätigung
├── "BIOLOGICAL" → Biologic
│   ├── openFDA BLA Prefix → mAb
│   │   ├── Website "perfusion" → mAb 1000L Dynamic Perfusion
│   │   ├── Website "fed batch" / "2000L" → mAb 2000L Fed Batch
│   │   └── Unklar → User fragen (einzige Modality mit Scale-Ambiguität)
│   ├── Website "ADC" / "conjugate" → ADC Platform Scale
│   └── Website "mRNA" / "IVT" → mRNA IVT 50L
├── "DRUG" → Small Molecule oder ADC
│   └── Website "conjugate" → ADC, sonst: außerhalb Scope
└── Kein CT.gov Treffer → APIs leer

SIGNAL 2: DECRS Business Operations
├── "API MANUFACTURE" → Bestätigt Produktion
├── "MANUFACTURE" → Bestätigt Produktion
└── Kein DECRS Match → Weiter mit anderen Signalen

SIGNAL 3: Keine API-Treffer (typisch CDMO)
├── Website ist einzige Quelle
│   ├── Keywords: "mRNA manufacturing" → mRNA IVT 50L
│   ├── Keywords: "viral vector" / "AAV" → AAV 500L
│   ├── Keywords: "lentivirus" / "CAR-T" → LV 50L
│   ├── Keywords: "plasmid" / "pDNA" → pDNA 40L
│   ├── Keywords: "antibody" / "mAb" → mAb (Scale klären)
│   └── Keywords: "ADC" / "conjugate" → ADC
└── SEC EDGAR: Client-Beziehungen als Kontext-Info
```

### 5.2 Scale-Zuordnung (Modality → Vendor Map Tab)

| Modality | Verfügbare Tabs | Ambiguität |
|----------|----------------|------------|
| AAV | AAV 500L | Keine — nur 1 Option |
| Lentivirus | LV 50L | Keine |
| ADC | ADC Platform Scale | Keine |
| mRNA | mRNA IVT 50L | Keine |
| pDNA | pDNA 40L | Keine |
| **mAb** | **1000L DP oder 2000L FB** | **Ja — User muss wählen** |

Nur bei mAb gibt es eine Dropdown-Auswahl. Alle anderen Modalities haben exakt einen Tab.

### 5.3 Output

```typescript
interface ModalityResolution {
  modality: string;           // "AAV" | "mAb" | "LV" | "ADC" | "mRNA" | "pDNA"
  scale: string;              // "500L" | "1000L" | "2000L" | "50L" | "40L" | "Platform"
  vendorMapTab: string;       // "AAV 500L" — exakter Tab-Name im Vendor Map
  phase: string;              // "Phase II" | "Commercial" | "CDMO"
  accountType: string;        // "innovator" | "cdmo"
  confidence: number;         // 0.0 - 1.0
  signals: SignalSource[];    // Welche Quellen haben beigetragen
}
```

---

## 6. Vendor Equipment Map

### 6.1 Struktur

7 Tabs im Excel, bereits als Datei vorhanden (`Process1st_Vendor_Map_v3_REVIEWED.xlsx`):

| Tab | Modality | Rows | Vendors |
|-----|----------|------|---------|
| mAb 1000L (Dyn. Perfusion) | mAb | 20 | SAR, TF, CYT, MS, REP |
| mAb 2000L (Fed Batch) | mAb | 26 | SAR, TF, CYT, MS, REP |
| AAV 500L | AAV | 20 | SAR, TF, CYT, MS, REP |
| Lentivirus (LV) 50L | LV | 15 | SAR, TF, CYT, MS, REP |
| ADC | ADC | 14 | SAR, TF, CYT, MS, REP |
| mRNA IVT 50L | mRNA | 15 | SAR, TF, CYT, MS, REP |
| pDNA 40L | pDNA | 17 | SAR, TF, CYT, MS, REP |

Jeder Tab hat pro Row: Unit Operation → Equipment Name → 5 Vendor-Spalten (Product Name + Status)

### 6.2 Lookup-Logik

```
Input:  vendorMapTab = "AAV 500L", userVendor = "Thermo Fisher"
Output: ProcessStep[] Array mit:
  - step = Unit Operation
  - equipment = Equipment Name (from BFD)
  - ourProduct = TF Product Name
  - competitors = [{vendor: "SAR", product: "..."}, {vendor: "CYT", product: "..."}, ...]
  - stepOrder = Reihenfolge im Tab
```

**100% deterministisch.** Kein LLM involviert. Kein Halluzinationsrisiko.

---

## 7. Status Inference

### 7.1 Default

Alle Unit Operations starten als `NO_CONTACT`.

### 7.2 Automatische Upgrades (LLM-basiert aus Enrichment-Daten)

| Signal aus Enrichment | Status-Änderung |
|-----------------------|-----------------|
| Website: "Sartorius partnership / alpha site" | Upstream Rows → `COMPETITOR` (Sartorius) |
| Website: "[Vendor X] installed" | Betroffene Row → `COMPETITOR` |
| Website: "evaluating [Product Y]" | Betroffene Row → `OPEN` |
| SEC EDGAR: "[Sponsor] manufacturing agreement" | Kontext-Info für Strategy, kein Status-Change |
| User Sales Goal: "downstream equipment" | Downstream Rows bleiben `NO_CONTACT` (User entscheidet auf Screen 3) |

### 7.3 User Override (Screen 3)

Jede Zeile hat ein Dropdown: `WON` / `OPEN` / `COMPETITOR` / `NO_CONTACT`. User kann jeden automatischen Status überschreiben.

---

## 8. Report Template v3

### 8.1 Struktur (7 Sections, 19 Tabellen)

| Section | Inhalt | Datenquelle | Methode |
|---------|--------|-------------|---------|
| **1A** | Site Intelligence Profile | Alle APIs + Website | Deterministisch + LLM Summary |
| **1B** | Facility Pipeline | CT.gov | Deterministisch (Innovator) oder "NOT APPLICABLE" (CDMO) |
| **2** | Process Equipment Map | Vendor Map + User Status | **100% deterministisch** |
| **3** | Recommended Strategy (3 Plays) | Gesamtbild | **LLM generiert** |
| **4** | Talking Points (3 Sätze) | Gesamtbild | **LLM generiert** |
| **5** | Cross-Selling Opportunities | — | **Placeholder** (Content von Process-1st) |
| **6** | Process Treasure Map | Vendor Map + BFD | **Deterministisch + Visualisierung** |
| **7** | Meeting Preparation Checklist | Standard + Account | **LLM generiert** (4 fix + 2-4 variabel) |

### 8.2 Section 1A — Felder und Quellen

| Feld | Primäre Quelle | Fallback |
|------|---------------|----------|
| Company | Website Scrape | User Input |
| Address | User Input | — |
| Modalities | Modality Resolution | Website |
| GMP Status | DECRS + Website | openFDA (BLA = implizit GMP) |
| Scale | Website | User Input |
| Phase | CT.gov | Website |
| IND Visibility | CT.gov (wenn leer → "CDMO") | Regelbasiert |
| Process Templates | Modality Resolution → Tab-Name | — |
| Equipment Scope | Vendor Map Tab | — |
| Sales Temperature | LLM Inferenz aus Gesamtbild | — |
| Data Sources Used | System (automatisch geloggt) | — |

### 8.3 Section 2 — Equipment Table

Direkt aus Vendor Map Tab + User-Status aus Screen 3. Spalten:
1. Unit Operation
2. Equipment Name
3. Our Product [Vendor Name]
4. Competitive Threats

Farbcodierung: ✓ WON | ● OPEN | ◆ NO CONTACT | ✕ COMPETITOR

### 8.4 Section 6 — Process Treasure Map (Hybrid-Ansatz)

**Im DOCX/PDF Report:**
- BFD PDF als Referenz-Bild (statisch, pro Modality)
- Darunter: Farbcodierte Status-Tabelle (Unit Op → Status → Farbcode)
- Link zur interaktiven Web-Version

**Im Frontend (Web):**
- Bestehendes `ProcessMap.tsx` Component
- Equipment-Icons pro Unit Operation (20+ PNGs vorhanden)
- Farbcodierte Borders: Grün=WON, Orange=OPEN, Rot=COMPETITOR, Grau=NO_CONTACT
- Status Badges + Vendor Namen
- PDF Export Button (html-to-image → jsPDF, bereits implementiert)
- **Das ist der Interphex-Demo-Moment**

---

## 9. Architektur

### 9.1 Neue Module im Gateway

```
pharma-chat-ui/packages/gateway/src/
├── fda-api.ts                    ← EXISTIERT, erweitern
├── site-intelligence/
│   ├── decrs-api.ts              ← NEU: FDA DECRS Scraper
│   ├── hcters-api.ts             ← NEU: CBER HCTERS Scraper
│   ├── edgar-api.ts              ← NEU: SEC EDGAR Search + Smart Extract
│   ├── website-enrichment.ts     ← NEU: HTTP Fetch + LLM Extraction
│   ├── modality-resolver.ts      ← NEU: Entscheidungsbaum
│   ├── vendor-map.ts             ← NEU: Excel → JSON, Tab Lookup
│   ├── status-inference.ts       ← NEU: LLM-basierte Status-Zuweisung
│   ├── report-generator.ts       ← NEU: Template v3 → DOCX
│   └── index.ts                  ← Router: orchestriert den Flow
```

### 9.2 Neue Frontend Components

```
pharma-chat-ui/packages/web/src/components/
├── ProcessMap.tsx                ← EXISTIERT, unverändert
├── SiteIntelligence/
│   ├── IntakeForm.tsx            ← Screen 1: 4 Felder
│   ├── EnrichmentStatus.tsx      ← Screen 2: API-Ergebnisse + Modality
│   ├── EquipmentReview.tsx       ← Screen 3: Tabelle + Status Dropdowns
│   ├── TreasureMapPreview.tsx    ← Screen 3: Live ProcessMap Einbindung
│   ├── ReportDownload.tsx        ← Screen 4+5: Generate + Download
│   └── index.tsx                 ← Page/Route
```

### 9.3 Knowledge Graph Erweiterung

Neuer Node Type `Facility` in `pharma.json`:

```
Facility
├── facility_id (string, required)
├── company_name (string, required)
├── address (string)
├── parent_company (string)
├── modalities (string[])
├── gmp_status (string)
├── scale (string)
├── phase (string)
├── account_type (string: innovator/cdmo)
├── fei_number (string, aus DECRS)
├── sales_temperature (string: HOT/WARM/COLD/MONITOR)
├── enrichment_timestamp (datetime)
├── enrichment_sources (string[])
└── confidence_score (float)

Neue Relationships:
├── HAS_PIPELINE → ClinicalTrial (nct_id, phase, intervention_type)
├── REGISTERED_AT → RegulatoryRecord (source, fei, business_operations)
├── MENTIONED_IN → SECFiling (filer, form_type, date, excerpt)
├── MAPS_TO → ProcessTemplate (modality, scale, vendor_map_tab)
└── HAS_EQUIPMENT_POSITION → EquipmentPosition (unit_op, status, our_product, competitor)
```

### 9.4 Keine neue Infrastruktur

Kein neuer Service, kein neuer Container, kein neuer Datenbankserver. Alles lebt im bestehenden Gateway + Frontend + Neo4j.

---

## 10. Prozessfluss — End-to-End

```
┌─────────────────────────────────────────┐
│          SCREEN 1: USER INPUT           │
│                                         │
│  Account Name:  [___________________]   │
│  Location:      [___________________]   │
│  Your Vendor:   [Sartorius|TF|CYT|▼]   │
│  Sales Goal:    [___________________]   │
│                                         │
│  [Search & Enrich →]                    │
└──────────────────┬──────────────────────┘
                   │
     ┌─────────────▼──────────────┐
     │   PARALLEL API ENRICHMENT  │
     │   (10-30 Sekunden)         │
     │                            │
     │  ┌─────────┐ ┌─────────┐  │
     │  │ CT.gov  │ │ openFDA │  │
     │  │ (REST)  │ │ (REST)  │  │
     │  └────┬────┘ └────┬────┘  │
     │  ┌────┴────┐ ┌────┴────┐  │
     │  │  DECRS  │ │ HCTERS  │  │
     │  │ (POST/  │ │ (POST/  │  │
     │  │ scrape) │ │ scrape) │  │
     │  └────┬────┘ └────┬────┘  │
     │  ┌────┴────┐ ┌────┴────┐  │
     │  │  SEC    │ │ Website │  │
     │  │ EDGAR   │ │ Scrape  │  │
     │  │ (REST)  │ │ (HTTP+  │  │
     │  │         │ │  LLM)   │  │
     │  └────┬────┘ └────┬────┘  │
     └───────┼────────────┼───────┘
             │            │
             ▼            ▼
     ┌────────────────────────────┐
     │   MODALITY RESOLUTION      │
     │                            │
     │  CT.gov Intervention Type  │
     │  + openFDA BLA/NDA Prefix  │
     │  + DECRS Business Ops      │
     │  + HCTERS Registration     │
     │  + Website Keywords        │
     │  + SEC EDGAR Context       │
     │          ↓                 │
     │  Output: Modality + Scale  │
     │  + Confidence Score        │
     └────────────┬───────────────┘
                  │
┌─────────────────▼───────────────────┐
│     SCREEN 2: ENRICHMENT RESULT     │
│                                     │
│  ✅ ClinicalTrials.gov   X studies  │
│  ✅ openFDA              X products │
│  ✅ DECRS                FEI: ...   │
│  ✅ HCTERS               found/—    │
│  ✅ SEC EDGAR            X mentions │
│  ✅ Website              extracted  │
│                                     │
│  Detected: AAV 500L Fed Batch       │
│  Confidence: HIGH                   │
│  Account Type: CDMO                 │
│                                     │
│  [Confirm]  [Correct Modality ▼]    │
└─────────────────┬───────────────────┘
                  │
     ┌────────────▼────────────┐
     │  VENDOR MAP LOOKUP      │
     │  (deterministisch)      │
     │                         │
     │  Tab "AAV 500L"         │
     │  + Vendor "Thermo"      │
     │  → ProcessStep[] Array  │
     │                         │
     │  STATUS INFERENCE       │
     │  (LLM-assisted)         │
     │                         │
     │  Website Signale →      │
     │  Upstream = COMPETITOR  │
     │  Rest = NO_CONTACT      │
     └────────────┬────────────┘
                  │
┌─────────────────▼────────────────────────┐
│     SCREEN 3: EQUIPMENT REVIEW           │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │ Unit Operation   │ Equip  │Status▼│  │
│  │──────────────────┼────────┼───────│  │
│  │ Cell Seed        │ ...    │COMPET.│  │
│  │ Rocking 10L      │ ...    │COMPET.│  │
│  │ Depth Filtration │ ...    │NO CON.│  │
│  │ Capture Chrom    │ ...    │NO CON.│  │
│  │ ...              │        │       │  │
│  └────────────────────────────────────┘  │
│                                          │
│  ┌────────────────────────────────────┐  │
│  │     🗺️ LIVE TREASURE MAP PREVIEW  │  │
│  │                                    │  │
│  │  [Icon]→[Icon]→[Icon]→[Icon]→...  │  │
│  │  grün   grün   rot    grau        │  │
│  │  WON    WON    COMP   NO CON     │  │
│  │                                    │  │
│  │  ProcessMap.tsx mit Equipment-     │  │
│  │  Icons, Farben, Status Badges     │  │
│  └────────────────────────────────────┘  │
│                                          │
│  [Generate Report →]                     │
└─────────────────┬────────────────────────┘
                  │
     ┌────────────▼─────────────┐
     │  REPORT GENERATION       │
     │                          │
     │  DETERMINISTISCH:        │
     │  • Sec 1A: Site Profile  │
     │  • Sec 1B: Pipeline      │
     │  • Sec 2: Equipment Tab  │
     │  • Sec 6: BFD + Status   │
     │                          │
     │  LLM-GENERIERT:          │
     │  • Sec 3: Strategy       │
     │  • Sec 4: Talking Points │
     │  • Sec 5: Placeholder    │
     │  • Sec 7: Checklist      │
     │                          │
     │  PARALLEL:               │
     │  • Facility Node → Neo4j │
     └────────────┬─────────────┘
                  │
┌─────────────────▼───────────────────┐
│     SCREEN 4+5: DOWNLOAD            │
│                                     │
│  ✅ Report generated                │
│                                     │
│  Matica Bio — AAV 500L — Thermo     │
│  7 April 2026                       │
│                                     │
│  [Download DOCX]  [Download PDF]    │
│  [View Interactive Treasure Map]    │
│  [Save to Account History]          │
└─────────────────────────────────────┘
```

---

## 11. Validierungsplan

### 11.1 Test Accounts

| Account | Typ | Modality | API-Erwartung | Validierung gegen |
|---------|-----|----------|---------------|-------------------|
| **Matica Bio** | CDMO | AAV/LV | APIs leer, Website+EDGAR liefern | Justins Intake Form + Matica Report v1 |
| **TriLink BioTech** | CDMO | mRNA/pDNA | APIs leer, Website+EDGAR liefern | Proposal Live Example |
| **Regeneron** | Innovator | mAb | CT.gov+openFDA+DECRS voll | Public Knowledge |
| **Bluebird Bio** | Innovator | Gene Therapy (LV) | CT.gov GENETIC | Public Knowledge |
| **NovaBio** | Dummy | mAb 1000L | Fiktiv — kein API-Match | Dummy Account Sheet |
| **Cascade Biologics** | Dummy | mAb 2000L | Fiktiv | Dummy Account Sheet |
| **Meridian Gene** | Dummy | AAV 500L | Fiktiv | Dummy Account Sheet |
| **VectorBridge** | Dummy | LV 50L | Fiktiv | Dummy Account Sheet |
| **Atlas BioMfg** | Dummy | ADC | Fiktiv | Dummy Account Sheet + Atlas Report v2 |
| **Helix mRNA** | Dummy | mRNA 50L | Fiktiv | Dummy Account Sheet |
| **OriginGene** | Dummy | pDNA 40L | Fiktiv | Dummy Account Sheet |

### 11.2 Accuracy-Schwelle

Justin: "In sales, I would be thrilled with >82% or less."

Messbar an den 2 Real-World Accounts (Matica, TriLink):
- Modality korrekt erkannt?
- Phase korrekt?
- Equipment Table korrekt befüllt?
- Strategy/Talking Points plausibel?

---

## 12. Risiken

| Risiko | Impact | Wahrsch. | Mitigation |
|--------|--------|----------|------------|
| Website Scrape liefert zu wenig (SPA, Bot-Protection) | Mittel | Mittel | Fallback: User füllt Lücken auf Screen 2 |
| LLM-Strategy/Talking Points sind generisch | Mittel | Mittel | Prompt-Engineering mit Justins echten Reports als Few-Shot Examples |
| DOCX-Formatierung kaputt (Tabellen, Farbcodierung) | Mittel | Hoch | Validation Layer + ggf. PDF statt DOCX als Primärformat |
| DECRS/HCTERS Scraper bricht bei FDA-Website-Änderung | Niedrig | Niedrig | Graceful Degradation: Quelle fällt aus → weniger Daten, kein Crash |
| Accuracy unter 82% bei Real-World Accounts | Hoch | Niedrig | Validation in KW3 mit genug Puffer für Iteration |

---

## 13. Nicht im MVP (bewusst)

| Feature | Warum nicht | Wann |
|---------|-------------|------|
| CRM Integration (Salesforce/HubSpot) | Justins Steps 5+6, SaaS-Feature | Phase 2 |
| Living Report / CRM Feedback Loop | Braucht CRM-Daten | Phase 2 |
| WHO ICTRP | US-Fokus, niedriger Mehrwert | Phase 2+ |
| Multi-Report-Vergleich | Braucht Report-Persistierung + Suchindex | Phase 3 |
| Autonomous Agent (Post-Meeting Follow-Up) | Braucht CRM + Voice | Phase 3 |
| Section 5 Cross-Selling (echte Inhalte) | Content muss von Process-1st kommen | Wenn Justin liefert |
| i3x / OPC-UA Live Equipment Data | Keine Verbindung zu externen Facilities | Phase 2 (eigene Facility) |
| Dynamische ProcessMap als SVG im DOCX | SSR + DOCX Embedding zu komplex für Timeline | Sofortiger Follow-Up |

---

## 14. Timeline

| Phase | Tage | Deliverables |
|-------|------|-------------|
| **Daten-Layer** | 7.–10. Apr | Vendor Map → JSON, fda-api.ts erweitern, DECRS Scraper, HCTERS Scraper, SEC EDGAR Connector, Website Enrichment |
| **Logik-Layer** | 11.–13. Apr | Modality Resolution Engine, Status Inference, Report Generator (DOCX/PDF), Schema-Update (Facility Node) |
| **UI-Layer** | 14.–16. Apr | Screens 1-5, ProcessMap Integration (Treasure Map), End-to-End Flow |
| **Validation** | 17.–20. Apr | 11 Test Accounts, Accuracy-Check, Feinschliff, Demo-Readiness |

---

## 15. Dateien im Projekt

### 15.1 Input-Dateien (von Process-1st erhalten)

| Datei | Pfad | Inhalt |
|-------|------|--------|
| Vendor Map v3 | `/opt/Tobias Package/Process1st_Vendor_Map_v3_REVIEWED.xlsx` | 7 Tabs × 5 Vendors × 14-26 Rows |
| Dummy Accounts v2 | `/opt/Tobias Package/Process1st_Dummy_Accounts_v2 - Copy.xlsx` | 6 Dummy Accounts + Process Reference |
| BFD PDFs (7×) | `/opt/Tobias Package/Block Flow Diagrams [CONFIDENTIAL]/` | Prozessfluss-Diagramme pro Modality |
| PFD Images (20+) | `/opt/Tobias Package/PFD Images/` | Equipment Icons (PNG) |
| Report Template v3 | `/opt/P1st_Report_Template_v3.docx` | 7 Sections, 19 Tabellen, strikte Regeln |
| Matica Report v1 | `/opt/P1st_Matica_Bio_Intelligence_Report.docx` | Validierungs-Referenz (statisch) |
| Matica Report v2 | `/opt/P1st_Matica_Bio_Intelligence_Report_v2.docx` | Validierungs-Referenz (CRM-enhanced) |
| Atlas Report v2 | `/opt/P1st_Atlas_BioManufacturing_Report_v2.docx` | Validierungs-Referenz (ADC) |
| Email Exchange | `/opt/Email_Exchange_Thermo_Fisher_Matica_Bio.docx` | CRM-Simulation (Phase 2 Referenz) |
| Sales Intelligence Text | `/opt/P1st_Sales_Intelligence_Text Output.docx` | Ist-Zustand: Rohtext-Output unseres Systems |

### 15.2 Bestehender Code

| Datei | Pfad | Rolle |
|-------|------|-------|
| FDA API | `/opt/osf-v8/pharma-chat-ui/packages/gateway/src/fda-api.ts` | CT.gov + openFDA (erweitern) |
| i3x Client | `/opt/osf-v8/pharma-chat-ui/packages/gateway/src/i3x-client.ts` | NICHT für MVP |
| ProcessMap | `/opt/osf-v8/pharma-chat-ui/packages/web/src/components/ProcessMap.tsx` | Treasure Map Component (wiederverwenden) |
| Pharma Schema | `/opt/osf-v8/osf-kg-builder/templates/pharma.json` | KG Schema (erweitern) |
| Domain Config | `/opt/osf-v8/osf-kg-builder/src/shared/domain-config.ts` | Domain-Definition (erweitern) |
