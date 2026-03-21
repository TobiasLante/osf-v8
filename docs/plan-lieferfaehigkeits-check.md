# Plan: Lieferfähigkeits-Check Pipeline (Chat-UI)

## Use Case
Ein Button "Lieferfähigkeits-Check" im Chat-UI. Klick startet einen Agent-Chain der automatisch 5 Prüfschritte durchläuft und pro kritischem Auftrag eine Ampel-Bewertung (grün/gelb/rot) liefert.

## UX: Harmonika (Accordion)

```
[▶ Lieferfähigkeits-Check starten]

↓ (nach Klick)

┌─────────────────────────────────────────────┐
│ ✅ Schritt 1: Kritische Aufträge            │
│    3 Aufträge gefährdet                     │
├─────────────────────────────────────────────┤
│ ⏳ Schritt 2: Materialverfügbarkeit         │
│    Prüfe MD04 für FA252618512...            │
├─────────────────────────────────────────────┤
│ ⬜ Schritt 3: Lagerbestand                  │
├─────────────────────────────────────────────┤
│ ⬜ Schritt 4: Kapazität & Schicht           │
├─────────────────────────────────────────────┤
│ ⬜ Schritt 5: Ergebnis & Empfehlung         │
│    Ampel pro Auftrag + Maßnahmen            │
└─────────────────────────────────────────────┘
```

## Pipeline-Schritte

| # | Schritt | MCP Tool | Input | Output |
|---|---------|----------|-------|--------|
| 1 | Kritische Aufträge | `factory_get_orders_at_risk` | — | Liste gefährdeter Aufträge |
| 2 | Material prüfen | `factory_get_md04` | je teil_id aus Auftrag | Bedarfs-/Bestandsliste, Unterdeckungen |
| 3 | Lagerbestand | `factory_get_md07` | — | Alle Teile mit Fehlmengen |
| 4 | Kapazität & Schicht | `factory_get_cm01` + `factory_get_capacity_overview` | je Maschine | Auslastung, freie Kapazität |
| 5 | Bewertung | LLM | Ergebnisse 1-4 | Ampel pro Auftrag + Empfehlungen |

## Ampel-Logik

- 🟢 **Grün**: Material da, Kapazität frei, Liefertermin haltbar
- 🟡 **Gelb**: Material knapp ODER Kapazität >90% — schaffbar mit Maßnahmen
- 🔴 **Rot**: Material fehlt UND/ODER Kapazität überlastet — Liefertermin nicht haltbar

## Implementierung

### Frontend (chat-ui/chat.html)
- Neuer Button neben Chat-Input: "Lieferfähigkeits-Check"
- Accordion-Komponente mit 5 Panels (collapsed by default)
- Jedes Panel zeigt Status-Icon (⬜→⏳→✅/❌) + Ergebnis
- SSE-Stream vom Backend aktualisiert Panels live

### Backend (osf-gateway)
- Neuer Endpoint: `POST /api/chat/pipeline/delivery-check`
- SSE Response mit Events: `step_start`, `step_result`, `step_error`, `done`
- Sequentieller Tool-Aufruf via MCP (kein LLM für Schritte 1-4, nur Schritt 5)
- System-Prompt für Schritt 5 enthält alle gesammelten Daten

### Alternative: Rein Chat-basiert (einfacher)
- Kein neuer Endpoint
- Button sendet vorkonfigurierte Nachricht: "Führe einen Lieferfähigkeits-Check durch: 1. Hole kritische Aufträge, 2. Prüfe Material, 3. Prüfe Bestand, 4. Prüfe Kapazität, 5. Bewerte mit Ampel."
- LLM arbeitet die Schritte mit Tool-Calls ab
- Accordion-Darstellung der Tool-Call-Ergebnisse im Chat

## Aufwand
- **Chat-basiert (Alternative)**: ~2h — Button + System-Prompt + Accordion für Tool-Results
- **Dedizierter Endpoint**: ~1 Tag — Backend Pipeline + Frontend Accordion + SSE

## Abhängigkeiten
- MCP Tools müssen laufen (factory-sim)
- Chat-UI muss deployed sein
- Kein KG nötig (rein MCP-basiert)

## Nächste Schritte
1. KG Build fertig machen (aktuell)
2. Chat-basierte Variante implementieren (schnell, zeigbar)
3. Feedback vom Kunden
4. Ggf. dedizierter Endpoint als V2
