# OSF Chat Quality Test — Ergebnisse

**Datum:** 2026-03-10
**Gateway Version:** 8.6.0
**Factory Sim Version:** 3.1.8
**Testmethode:** `test-chat.sh -v` → SSE-Event-Auswertung + Ground-Truth-Vergleich

## Bewertungsschema
| Note | Beschreibung |
|------|-------------|
| **A** | Richtige Tools, korrekte Daten, gute Analyse |
| **B** | Richtige Tools, korrekte Daten, aber unvollständig |
| **C** | Teilweise korrekt |
| **D** | Überwiegend falsch oder halluziniert |
| **F** | Keine Antwort, falsche Tools, komplett fehlerhaft |

---

## Ergebnisse

### M1: Welche 3 Maschinen haben aktuell die schlechteste OEE?
| Tools | Antwort | Note |
|-------|---------|------|
| `factory_get_latest_oee` ✅ | 9019 (1.3%), 9015 (28.9%), 9012 (33.1%) — Leistung als Hauptverlustfaktor identifiziert | **A** |

### S1: OEE der Spritzgussmaschine ML-2?
| Tools | Antwort | Note |
|-------|---------|------|
| `factory_get_machine_oee` + `factory_get_latest_oee` ✅ | ML-2 hat NaN/0% OEE, clever Fallback auf latest_oee für Kontext | **B** |
Abzug: fragt "Möchten Sie..." statt klare Aussage

### L1: 5 Materialien mit geringster Reichweite?
| Tools | Antwort | Note |
|-------|---------|------|
| `factory_get_material_coverage` ✅ | ABS V0 (21d), BG-GG-004 (41d), 14-0021-010 (78d), POM-C (82d), BG-WE-002 (83d) | **A** |
**Vorher: F** (Intent-Classifier-Bug → Discussion-Pipeline → Timeout)

### A1: Durchsatz der Montagelinien?
| Tools | Antwort | Note |
|-------|---------|------|
| `montage_get_bde` (ML-1 + ML-2) ✅ | ML-2 schneller (8 vs 6 Gutteile), STARVING-Status erkannt | **A** |

### E1: Offene Kundenaufträge und Liefertreue?
| Tools | Antwort | Note |
|-------|---------|------|
| `factory_get_customer_orders` + `factory_get_customer_otd` ✅ | 38.300 offen, OTD 31.8% (kritisch), Top/Bottom-Kunden genannt | **A** |
**Vorher: F** (Tool-Result-Overflow → leere Antwort)

### Q1: Aktive SPC-Alarme?
| Tools | Antwort | Note |
|-------|---------|------|
| `factory_get_spc_alarms` ✅ | Keine aktiven Alarme, korrekte Interpretation | **A** |

### T1: Maschinen mit niedrigster Verfügbarkeit?
| Tools | Antwort | Note |
|-------|---------|------|
| `kg_bottleneck_analysis` + `factory_get_machine_reliability` ✅ | 7533: 97.7%, 364 Ausfälle, 16.7h Stillstand | **B** |
**Vorher: F** (N/A-Bug + Loop-Exhaustion → leere Antwort)

### G2: Impact-Analyse Maschine 1001 ausfällt?
| Tools | Antwort | Note |
|-------|---------|------|
| KG → 4 Specialists → 2 Runden → Debate ✅ | Volle Discussion-Pipeline, Maßnahmenplan geliefert | **C** |
**Vorher: F** (Content-Stream fehlte). Abzug: halluziniert Platzhalter-Daten ("Auftrag 12345", "Kunde A")

---

## Zusammenfassung

| Test | Vorher | Nachher | Verbesserung |
|------|--------|---------|-------------|
| M1 (OEE) | A | **A** | — |
| S1 (Spritzguss) | B | **B** | — |
| L1 (Lager) | **F** | **A** | Intent-Classifier Fix |
| A1 (Montage) | A | **A** | — |
| E1 (ERP) | **F** | **A** | Tool-Result Truncation |
| Q1 (QMS) | A | **A** | — |
| T1 (TMS) | **F** | **B** | N/A-Fix + Loop-Fallback |
| G2 (Impact) | **F** | **C** | Content-Stream Fix |

**Bestanden (≥C): 8/8** (vorher 4/8)
**Durchschnitt: A-/B+**

---

## Behobene Bugs

1. **Tool-Result Overflow** — Tool-Results auf 3000 Chars truncated bevor sie an LLM gehen (`routes.ts`)
2. **Intent-Classifier False Positives** — Regex-Fallback: einfache Phrasen ("Welche", "Gibt es"...) werden nie als complex eingestuft (`routes.ts`)
3. **Discussion Content-Stream** — `runDynamicDiscussion` return-value wird in `routes.ts` als Content gestreamt
4. **N/A-Daten in Reliability** — Factory-Sim Handler: Property-Namen gefixt (waren `undefined`), klare Fehlermeldung bei fehlenden Daten + Hinweis auf alternatives Tool (`handlers.ts`)
5. **Loop-Exhaustion** — Tool-Loop von 5 auf 8 Iterationen + Fallback-Summary wenn Loop exhausted (`routes.ts`)
6. **Doppelter Content-Stream** — `routes.ts` und `discussion-runner.ts` streamten beide → discussion-runner entfernt

## Offene Punkte

- **G2 Halluzination**: Discussion-Runner produziert Platzhalter-Daten ("Auftrag 12345", "Kunde A") statt echte Daten aus KG/MCP. Specialist-Prompts oder Synthesis-Prompt muss strikter werden.
- **ML-2 OEE NaN**: Spritzgussmaschine ML-2 liefert `NaN%` für alle OEE-Werte — Factory-Sim Datenqualitäts-Problem.
