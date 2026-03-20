# OSF Chat Quality Test — Manufacturing Questions

## Bewertungsschema
- **A** (5/5): Faktisch korrekt, alle relevanten Daten, actionable Empfehlungen
- **B** (4/5): Korrekt, aber unvollständig oder ohne Handlungsempfehlung
- **C** (3/5): Teilweise korrekt, wichtige Daten fehlen oder falsch interpretiert
- **D** (2/5): Überwiegend falsch oder halluziniert Daten
- **F** (1/5): Komplett falsch, Tool-Fehler, keine brauchbare Antwort

## Kategorien & Fragen

### 1. OEE / Mechanik (Zerspanende Fertigung)
| # | Frage | Tools erwartet | Note | Kommentar |
|---|-------|---------------|------|-----------|
| M1 | Welche 3 Maschinen haben aktuell die schlechteste OEE und was sind die Hauptverlustfaktoren? | factory_get_latest_oee | | |
| M2 | Vergleiche die Verfügbarkeit von Maschine 1001 und 1002 über die letzten 24 Stunden. Wo gibt es ungeplante Stillstände? | factory_get_machine_oee (x2) | | |
| M3 | Wie hat sich die Ausschussrate in der mechanischen Fertigung diese Woche entwickelt? Gibt es einen Trend? | factory_get_scrap_history | | |
| M4 | Maschine 7533 hat einen OEE-Einbruch. Analysiere die Ursache — liegt es an Verfügbarkeit, Leistung oder Qualität? | factory_get_machine_oee | | |
| M5 | Erstelle ein Kapazitätsranking aller Maschinen nach aktuellem Nutzungsgrad. Welche sind überlastet, welche unterausgelastet? | factory_get_capacity_overview | | |
| M6 | Gibt es Maschinen mit einer Leistung unter 80%? Was könnte die Ursache sein und welche Maßnahmen empfiehlst du? | factory_get_latest_oee | | |
| M7 | Wie viele Teile hat Maschine 9012 heute produziert und wie ist das Verhältnis Gut-/Schlechtteile? | factory_get_production_history, factory_get_machine_oee | | |
| M8 | Welche Maschine hat die höchste Qualitätsrate und welche die niedrigste? Vergleiche beide. | factory_get_latest_oee | | |
| M9 | Gibt es blockierte Aufträge in der Fertigung? Wenn ja, an welchen Maschinen und warum? | factory_get_blocked_orders_count, factory_get_cm21_orders | | |
| M10 | Wie sieht die Maschinenwarteschlange für die nächsten 8 Stunden aus? Gibt es Engpässe? | factory_get_machine_queue, factory_get_capacity_overview | | |

### 2. Spritzguss
| # | Frage | Tools erwartet | Note | Kommentar |
|---|-------|---------------|------|-----------|
| S1 | Wie ist die aktuelle OEE der Spritzgussmaschine ML-2? Liegt sie über dem Zielwert von 85%? | factory_get_machine_oee | | |
| S2 | Welche Prozessabweichungen gibt es aktuell in der Spritzgussfertigung? | factory_get_quality_notifications, factory_get_spc_alarms | | |
| S3 | Vergleiche den Energieverbrauch pro Teil bei den Spritzgussmaschinen mit den CNC-Maschinen. | factory_get_energy_per_part | | |
| S4 | Gibt es SPC-Alarme bei Spritzgussteilen? Welche Merkmale sind betroffen? | factory_get_spc_alarms | | |
| S5 | Wie ist die Cpk-Verteilung bei den Spritzguss-Prüfmerkmalen? Gibt es Werte unter 1.33? | factory_get_cpk_overview | | |
| S6 | Welche Rohstoffe für die Spritzgussfertigung haben einen niedrigen Bestand? | factory_get_low_stock_items | | |
| S7 | Ist die Zykluszeit der Spritzgussmaschinen stabil oder gibt es Schwankungen? | factory_get_production_history | | |
| S8 | Wie hoch ist die Ausschussrate bei Spritzgussteilen im Vergleich zu Drehteilen? | factory_get_scrap_history | | |
| S9 | Gibt es offene Qualitätsmeldungen die Spritzgussteile betreffen? Was ist der Status? | factory_get_quality_notifications | | |
| S10 | Wie ist der Energieverbrauch der Spritzgussanlage ML-2 im Vergleich zum Durchschnitt? | factory_get_machine_energy, factory_get_energy_overview | | |

### 3. Lager / WMS
| # | Frage | Tools erwartet | Note | Kommentar |
|---|-------|---------------|------|-----------|
| L1 | Welche 5 Materialien haben die geringste Reichweite? Drohen Produktionsstillstände? | factory_get_low_stock_items | | |
| L2 | Prüfe den Bestand von Artikel 100-001. Reicht er für die nächsten Aufträge? | factory_get_stock_item, factory_check_material_readiness | | |
| L3 | Gibt es offene Bestellungen die überfällig sind? Liste alle ausstehenden Lieferungen. | factory_get_pending_purchases | | |
| L4 | Welcher Lieferant hat die beste und welcher die schlechteste Liefertreue? | factory_get_supplier_evaluation | | |
| L5 | Prüfe die Materialverfügbarkeit für alle Aufträge der nächsten Woche. Wo fehlt Material? | factory_check_material_readiness | | |
| L6 | Zeige die MD04-Bedarfsvorschau für die nächsten 14 Tage. Wo sind die Spitzen? | factory_get_md04 | | |
| L7 | Erstelle eine Nachbestellliste: Welche Materialien müssen heute bestellt werden um Engpässe zu vermeiden? | factory_get_low_stock_items, factory_get_pending_purchases, factory_get_md04 | | |
| L8 | Wie ist die Lagerumschlaghäufigkeit der Top-10 Materialien? | factory_get_stock_item, factory_get_md07 | | |
| L9 | Gibt es Materialien die einen alternativen Lieferanten brauchen weil der Hauptlieferant Probleme hat? | factory_get_supplier_evaluation, factory_get_supplier_for_material | | |
| L10 | Vergleiche Soll- und Ist-Bestand aller Rohstoffe. Wo sind die größten Abweichungen? | factory_get_low_stock_items, factory_get_stock_item | | |

### 4. Montage
| # | Frage | Tools erwartet | Note | Kommentar |
|---|-------|---------------|------|-----------|
| A1 | Wie ist der aktuelle Durchsatz der Montagelinien? Welche Linie ist schneller? | factory_get_latest_oee, factory_get_production_history | | |
| A2 | Gibt es Aufträge in der Montage die hinter dem Zeitplan liegen? | factory_get_orders_at_risk, factory_get_cm21_orders | | |
| A3 | Welche Montageteile haben die höchste Ausschussrate? | factory_get_scrap_history | | |
| A4 | Ist genug Material für die Montageaufträge der nächsten 3 Tage verfügbar? | factory_check_material_readiness | | |
| A5 | Wie hoch ist die Kapazitätsauslastung der Montagelinien diese Woche? | factory_get_capacity_overview | | |
| A6 | Gibt es Qualitätsprobleme bei Montageteilen? Prüfe SPC-Alarme und Cpk-Werte. | factory_get_spc_alarms, factory_get_cpk_overview | | |
| A7 | Welche Kundenaufträge werden aktuell in der Montage bearbeitet? | factory_get_cm01, factory_get_customer_orders | | |
| A8 | Vergleiche den Energieverbrauch der Montagelinien mit der Zerspanung. | factory_get_energy_per_part, factory_get_energy_overview | | |
| A9 | Wie viele Aufträge sind in der Montagewarteschlange? Wie lang ist die Wartezeit? | factory_get_machine_queue | | |
| A10 | Gibt es Engpässe bei Zulieferteilen für die Montage? | factory_get_low_stock_items, factory_check_material_readiness | | |

### 5. ERP / Aufträge
| # | Frage | Tools erwartet | Note | Kommentar |
|---|-------|---------------|------|-----------|
| E1 | Wie viele Kundenaufträge sind aktuell offen und wie ist die Liefertreue insgesamt? | factory_get_va05_summary, factory_get_customer_otd | | |
| E2 | Welche Kunden haben die schlechteste On-Time-Delivery? Was sind die Ursachen? | factory_get_customer_otd, factory_get_orders_at_risk | | |
| E3 | Zeige alle Aufträge die in den nächsten 48 Stunden fällig sind. Welche sind gefährdet? | factory_get_orders_at_risk | | |
| E4 | Erstelle einen Überblick über die offenen Fertigungsaufträge nach Priorität. | factory_get_cm01, factory_get_cm21_orders | | |
| E5 | Wie ist der aktuelle Auftragseingang im Vergleich zur verfügbaren Kapazität? | factory_get_va05_summary, factory_get_capacity_overview | | |
| E6 | Prüfe ob für den Auftrag mit der höchsten Priorität alle Materialien und Kapazitäten verfügbar sind. | factory_get_orders_at_risk, factory_check_material_readiness, factory_get_capacity_overview | | |
| E7 | Welche Kunden haben aktuell offene Aufträge und wie ist deren Lieferstatus? | factory_get_customer_orders | | |
| E8 | Gibt es Aufträge die wegen Materialengpässen blockiert sind? | factory_get_blocked_orders_count, factory_check_material_readiness | | |
| E9 | Wie hoch ist der Rückstand bei den Fertigungsaufträgen? Können wir den diese Woche abbauen? | factory_get_cm21_orders, factory_get_capacity_overview | | |
| E10 | Erstelle eine Zusammenfassung der Auftragslage: offene, in Bearbeitung, abgeschlossene Aufträge heute. | factory_get_va05_summary, factory_get_cm01 | | |

### 6. QMS (Qualität)
| # | Frage | Tools erwartet | Note | Kommentar |
|---|-------|---------------|------|-----------|
| Q1 | Gibt es aktive SPC-Alarme? Welche Merkmale und Maschinen sind betroffen? | factory_get_spc_alarms | | |
| Q2 | Erstelle einen Cpk-Report: Welche Merkmale sind unter 1.33 und brauchen Maßnahmen? | factory_get_cpk_overview | | |
| Q3 | Welche Messmittel müssen in den nächsten 30 Tagen kalibriert werden? | factory_get_calibration_due | | |
| Q4 | Wie viele offene Qualitätsmeldungen gibt es? Gruppiere nach Meldungsart und Priorität. | factory_get_quality_notifications | | |
| Q5 | Gibt es einen Zusammenhang zwischen SPC-Alarmen und erhöhter Ausschussrate? | factory_get_spc_alarms, factory_get_scrap_history | | |
| Q6 | Welche Maschine produziert die meisten Qualitätsprobleme? Korreliere mit OEE-Daten. | factory_get_quality_notifications, factory_get_latest_oee | | |
| Q7 | Erstelle eine Übersicht der Qualitätskennzahlen: Cpk-Durchschnitt, offene QN, SPC-Alarme, Kalibrierungsstatus. | factory_get_cpk_overview, factory_get_quality_notifications, factory_get_spc_alarms, factory_get_calibration_due | | |
| Q8 | Sind alle Prüfmerkmale innerhalb der Toleranz? Welche zeigen einen Trend zur Grenze? | factory_get_cpk_overview, factory_get_spc_alarms | | |
| Q9 | Prüfe ob es wiederkehrende Qualitätsprobleme bei bestimmten Artikeln gibt. | factory_get_quality_notifications | | |
| Q10 | Wie hat sich die Qualitätsrate über die letzten 7 Tage entwickelt? Gibt es Verschlechterungen? | factory_get_scrap_history, factory_get_latest_oee | | |

### 7. TMS / Instandhaltung
| # | Frage | Tools erwartet | Note | Kommentar |
|---|-------|---------------|------|-----------|
| T1 | Welche Maschinen haben die niedrigste Verfügbarkeit und brauchen möglicherweise Wartung? | factory_get_latest_oee | | |
| T2 | Gibt es Maschinen mit häufigen ungeplanten Stillständen in der letzten Woche? | factory_get_machine_oee, factory_get_production_history | | |
| T3 | Welche Messmittel sind überfällig für die Kalibrierung? | factory_get_calibration_due | | |
| T4 | Korrelieren die SPC-Alarme mit Maschinenproblemen? Welche Maschinen brauchen Aufmerksamkeit? | factory_get_spc_alarms, factory_get_latest_oee | | |
| T5 | Wie ist der Energieverbrauch der Maschinen im Leerlauf? Gibt es Anomalien die auf Defekte hinweisen? | factory_get_base_load, factory_get_machine_energy | | |
| T6 | Erstelle eine Wartungspriorisierung: Welche 3 Maschinen brauchen am dringendsten Attention? | factory_get_latest_oee, factory_get_spc_alarms, factory_get_calibration_due | | |
| T7 | Gibt es einen Zusammenhang zwischen Maschinenlaufzeit und Qualitätsverschlechterung? | factory_get_production_history, factory_get_cpk_overview | | |
| T8 | Welche Maschinen verbrauchen deutlich mehr Energie als normal? Liegt ein technisches Problem vor? | factory_get_energy_overview, factory_get_machine_energy, factory_get_energy_trend | | |
| T9 | Wie entwickelt sich der OEE-Trend der wartungsintensivsten Maschine über die letzte Woche? | factory_get_machine_oee | | |
| T10 | Erstelle einen Instandhaltungs-Statusbericht: Kalibrierung, Verfügbarkeit, Energieanomalien. | factory_get_calibration_due, factory_get_latest_oee, factory_get_base_load | | |

### 8. Gesamtbereich (Cross-Domain / Strategisch)
| # | Frage | Tools erwartet | Note | Kommentar |
|---|-------|---------------|------|-----------|
| G1 | Erstelle einen kompletten Schichtbericht: OEE, Qualität, Aufträge, Material, Energie. | multi-agent discussion | | |
| G2 | Was passiert wenn Maschine 1001 für 4 Stunden ausfällt? Welche Aufträge und Kunden sind betroffen? | kg_what_if_machine_down, factory_get_orders_at_risk | | |
| G3 | Wo sind die 3 größten Risiken in der Produktion gerade? Bewerte nach Eintrittswahrscheinlichkeit und Auswirkung. | multi-agent discussion | | |
| G4 | Gibt es einen Zusammenhang zwischen Energiekosten und Produktionseffizienz? Wo können wir sparen? | factory_get_energy_costs, factory_get_energy_per_part, factory_get_latest_oee | | |
| G5 | Welche Abteilung hat aktuell die meisten Probleme: Fertigung, Lager, Montage oder Qualität? | multi-agent discussion | | |
| G6 | Erstelle eine Bottleneck-Analyse der gesamten Wertschöpfungskette: Material → Fertigung → Montage → Versand. | kg_bottleneck_analysis, factory_get_capacity_overview, factory_get_orders_at_risk | | |
| G7 | Wie können wir die Liefertreue von aktuell X% auf 95% steigern? Welche Maßnahmen haben den größten Hebel? | factory_get_customer_otd, factory_get_orders_at_risk, factory_get_capacity_overview | | |
| G8 | Vergleiche die KPIs dieser Woche mit letzter Woche: OEE, Ausschuss, Liefertreue, Energieverbrauch. | multi-agent discussion | | |
| G9 | Ein neuer Großauftrag mit 500 Teilen kommt rein. Prüfe ob wir die Kapazität, das Material und die Qualität sicherstellen können. | factory_get_capacity_overview, factory_check_material_readiness, factory_get_cpk_overview | | |
| G10 | Erstelle ein Executive Summary der Fabrik: Top-3 Erfolge, Top-3 Risiken, empfohlene Sofortmaßnahmen. | multi-agent discussion | | |

---

## Zusammenfassung

| Kategorie | Fragen | Ø Note | Bestanden (≥C) |
|-----------|--------|--------|----------------|
| Mechanik/OEE | M1-M10 | | /10 |
| Spritzguss | S1-S10 | | /10 |
| Lager/WMS | L1-L10 | | /10 |
| Montage | A1-A10 | | /10 |
| ERP/Aufträge | E1-E10 | | /10 |
| QMS | Q1-Q10 | | /10 |
| TMS | T1-T10 | | /10 |
| Gesamt | G1-G10 | | /10 |
| **Total** | **80** | | **/80** |
