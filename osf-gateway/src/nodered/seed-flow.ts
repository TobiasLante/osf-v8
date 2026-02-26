/**
 * Default example flow shown to new users.
 * Complete guide with all OSF node types — designed for non-technical users.
 */
export const SEED_FLOW = [
  // ── Tab ──────────────────────────────────────────────────────────
  {
    id: 'osf-example-tab',
    type: 'tab',
    label: 'Mein erster Flow',
    disabled: false,
  },

  // ── Guide Comments ─────────────────────────────────────────────

  // Top guide box
  {
    id: 'guide-welcome',
    type: 'comment',
    z: 'osf-example-tab',
    name: '🏭 Willkommen im OSF Flow Editor!',
    info:
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n' +
      'Dieser Beispiel-Flow ist bereits fertig konfiguriert\n' +
      'und kann sofort ausgeführt werden.\n\n' +
      'Was macht dieser Flow?\n' +
      '1. Holt Kapazitätsdaten aus dem ERP\n' +
      '2. Holt aktuelle OEE-Werte aus der Fertigung\n' +
      '3. Ein KI-Agent analysiert beides zusammen\n' +
      '4. Bei kritischer Lage → Manager wird gefragt\n' +
      '5. Sonst → automatischer Statusbericht\n' +
      '━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━',
    x: 700,
    y: 40,
  },

  // Step-by-step guide on the right side
  {
    id: 'guide-step1',
    type: 'comment',
    z: 'osf-example-tab',
    name: '📌 Schritt 1: Flow speichern',
    info:
      '1. Klicke oben rechts auf den roten "Deploy" Button.\n' +
      '   Das speichert deinen Flow im Editor.\n\n' +
      '2. Klicke auf "Save as Flow" in der\n' +
      '   orangenen Leiste ganz oben.\n\n' +
      '3. Gib einen Namen ein, z.B. "Produktionscheck"\n' +
      '   und klicke auf "Speichern".\n\n' +
      'Der Flow erscheint dann auf der Flows-Seite.',
    x: 700,
    y: 140,
  },
  {
    id: 'guide-step2',
    type: 'comment',
    z: 'osf-example-tab',
    name: '📌 Schritt 2: Flow ausführen',
    info:
      'Gehe zurück zur Flows-Seite:\n' +
      'Klicke oben links auf "Back".\n\n' +
      'Dort siehst du deinen gespeicherten Flow.\n' +
      'Klicke auf "Run" um ihn zu starten.\n\n' +
      'Du siehst live, wie jeder Node\n' +
      'nacheinander ausgeführt wird.',
    x: 700,
    y: 240,
  },
  {
    id: 'guide-step3',
    type: 'comment',
    z: 'osf-example-tab',
    name: '📌 Schritt 3: Ergebnisse ansehen',
    info:
      'Nach dem Start siehst du den Flow-Runner.\n' +
      'Jeder Node zeigt seinen Status:\n\n' +
      '⏳ Läuft gerade...\n' +
      '✅ Fertig — klicke drauf für Details\n' +
      '❌ Fehler — klicke drauf für Fehlermeldung\n' +
      '⏸ Wartet auf deine Eingabe (Human Input)\n\n' +
      'Am Ende siehst du das Gesamtergebnis.',
    x: 700,
    y: 340,
  },
  {
    id: 'guide-step4',
    type: 'comment',
    z: 'osf-example-tab',
    name: '📌 Schritt 4: Eigene Flows bauen',
    info:
      'Ziehe neue Nodes aus der linken Palette\n' +
      'in den Editor (unter "OSF").\n\n' +
      'Verfügbare Node-Typen:\n' +
      '🟢 MCP-ERP — Daten aus dem ERP-System\n' +
      '🟠 MCP-Fertigung — Maschinen & OEE\n' +
      '🟣 MCP-QMS — Qualitätsdaten & SPC\n' +
      '⚙️ MCP-TMS — Werkzeugverwaltung\n' +
      '🤖 Agent — KI-Analyse mit Tool-Zugriff\n' +
      '💬 Prompt — Einfache LLM-Textgenerierung\n' +
      '🔀 Decision — Automatische Weiche\n' +
      '👤 Human Input — Mensch entscheidet\n\n' +
      'Verbinde Nodes: Ziehe vom Ausgang (rechts)\n' +
      'zum Eingang (links) des nächsten Nodes.\n\n' +
      'Konfiguriere per Doppelklick auf einen Node.',
    x: 700,
    y: 460,
  },

  // ── Inline comments for each node ──────────────────────────────
  {
    id: 'comment-mcp',
    type: 'comment',
    z: 'osf-example-tab',
    name: '⬇ Daten holen (ohne KI, direkt aus der Fabrik)',
    info: '',
    x: 280,
    y: 80,
  },
  {
    id: 'comment-agent',
    type: 'comment',
    z: 'osf-example-tab',
    name: '⬇ KI analysiert die Daten',
    info: '',
    x: 220,
    y: 260,
  },
  {
    id: 'comment-decision',
    type: 'comment',
    z: 'osf-example-tab',
    name: '⬇ Ist die Lage kritisch? (automatisch)',
    info: '',
    x: 260,
    y: 420,
  },

  // ── Flow Nodes ───────────────────────────────────────────────────

  // 1. ERP: Kapazitätsübersicht holen
  {
    id: 'erp-kapazitaet',
    type: 'osf-mcp-erp',
    z: 'osf-example-tab',
    name: 'Kapazitätsübersicht',
    toolName: 'factory_get_capacity_summary',
    arguments: '{}',
    x: 180,
    y: 140,
    wires: [['agent-analyse']],
  },

  // 2. Fertigung: aktuelle OEE aller Maschinen
  {
    id: 'fertigung-maschinen',
    type: 'osf-mcp-fertigung',
    z: 'osf-example-tab',
    name: 'Aktuelle OEE',
    toolName: 'factory_get_latest_oee',
    arguments: '{}',
    x: 420,
    y: 140,
    wires: [['agent-analyse']],
  },

  // 3. Agent: Analysiert die gesammelten Daten
  {
    id: 'agent-analyse',
    type: 'osf-agent',
    z: 'osf-example-tab',
    name: 'Produktionsanalyse',
    agentId: 'capacity-agent',
    passContext: true,
    maxIterations: 6,
    x: 300,
    y: 330,
    wires: [['decision-kritisch']],
  },

  // 4. Decision: Ist die Lage kritisch?
  {
    id: 'decision-kritisch',
    type: 'osf-decision',
    z: 'osf-example-tab',
    name: 'Kritisch?',
    condition: 'kritisch OR überlastet OR Engpass',
    x: 300,
    y: 490,
    wires: [['prompt-bericht'], ['human-freigabe']],
  },

  // 5a. Prompt: Zusammenfassung (nicht kritisch → linker Ausgang)
  {
    id: 'prompt-bericht',
    type: 'osf-prompt',
    z: 'osf-example-tab',
    name: 'Statusbericht erstellen',
    prompt: 'Erstelle einen kurzen Statusbericht der Produktion auf Deutsch. Fasse die wichtigsten Kennzahlen zusammen. Maximal 5 Sätze.',
    x: 140,
    y: 590,
    wires: [[]],
  },

  // Label for left path
  {
    id: 'comment-ok',
    type: 'comment',
    z: 'osf-example-tab',
    name: '✅ Alles OK → Bericht',
    info: '',
    x: 140,
    y: 550,
  },

  // 5b. Human Input: Freigabe bei kritischer Lage (rechter Ausgang)
  {
    id: 'human-freigabe',
    type: 'osf-human-input',
    z: 'osf-example-tab',
    name: 'Manager-Freigabe',
    question: 'Die Analyse zeigt kritische Engpässe. Soll eine Eskalation ausgelöst werden? Bitte mit Ja/Nein und Begründung antworten.',
    x: 500,
    y: 590,
    wires: [[]],
  },

  // Label for right path
  {
    id: 'comment-kritisch',
    type: 'comment',
    z: 'osf-example-tab',
    name: '⚠️ Kritisch → Manager fragen',
    info: '',
    x: 500,
    y: 550,
  },
];
