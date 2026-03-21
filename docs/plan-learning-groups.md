# Plan: Learning Groups mit Gruppen-API-Token

## Konzept
Admin erstellt Lerngruppen und weist User zu. Ein Gruppen-Admin verwaltet ein zentrales API-Token (z.B. Anthropic Key) das für alle Gruppenmitglieder gilt — aber nur für diese Gruppe.

## User Stories

1. **Platform-Admin** erstellt Gruppe "FH Rosenheim WS26", weist 15 User zu, ernennt einen Gruppen-Admin
2. **Gruppen-Admin** gibt einen Anthropic API-Key ein → alle 15 User können chatten ohne eigenen Key
3. **User** loggt sich ein, sieht seine Gruppe, chattet mit dem Gruppen-Key (transparent)
4. **Platform-Admin** sieht Usage pro Gruppe (Token-Verbrauch, Sessions)

## Datenmodell

```sql
-- Neue Tabellen in osf DB

CREATE TABLE learning_groups (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name VARCHAR(100) NOT NULL,
  description TEXT,
  created_by UUID REFERENCES users(id),
  created_at TIMESTAMPTZ DEFAULT now(),
  is_active BOOLEAN DEFAULT true
);

CREATE TABLE learning_group_members (
  group_id UUID REFERENCES learning_groups(id) ON DELETE CASCADE,
  user_id UUID REFERENCES users(id) ON DELETE CASCADE,
  role VARCHAR(20) DEFAULT 'member',  -- 'member' | 'group_admin'
  joined_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (group_id, user_id)
);

CREATE TABLE learning_group_tokens (
  group_id UUID REFERENCES learning_groups(id) ON DELETE CASCADE,
  provider VARCHAR(50) NOT NULL,       -- 'anthropic' | 'openai' | 'local'
  api_key_encrypted TEXT NOT NULL,     -- AES-256 encrypted
  model_override VARCHAR(100),         -- optional: force specific model
  max_tokens_per_day INTEGER,          -- optional: daily limit per user
  set_by UUID REFERENCES users(id),
  updated_at TIMESTAMPTZ DEFAULT now(),
  PRIMARY KEY (group_id, provider)
);
```

## API Endpoints

### Platform-Admin (bestehende /admin/ Routes)

```
POST   /admin/groups                    — Gruppe erstellen
GET    /admin/groups                    — Alle Gruppen listen
PUT    /admin/groups/:id                — Gruppe bearbeiten
DELETE /admin/groups/:id                — Gruppe löschen
POST   /admin/groups/:id/members        — User hinzufügen (bulk)
DELETE /admin/groups/:id/members/:uid   — User entfernen
PUT    /admin/groups/:id/members/:uid   — Rolle ändern (member↔group_admin)
GET    /admin/groups/:id/usage          — Token-Verbrauch der Gruppe
```

### Gruppen-Admin (neue /group/ Routes)

```
GET    /group/me                        — Meine Gruppe(n) + Mitglieder
POST   /group/:id/token                 — API-Token setzen/aktualisieren
DELETE /group/:id/token/:provider       — API-Token entfernen
GET    /group/:id/usage                 — Usage der eigenen Gruppe
```

### Chat-Integration (bestehender Flow)

```
User sendet Chat-Nachricht
  → getLlmConfig(userId, tier)
    → Prüfe: hat User eigenen API-Key? → nutze diesen
    → Sonst: ist User in einer Gruppe mit Token? → nutze Gruppen-Token
    → Sonst: nutze Free-Tier (lokaler LLM)
```

## LLM Config Resolution (Priorität)

```
1. User-eigener API-Key          (höchste Priorität)
2. Gruppen-Token                 (Gruppen-Admin hat Key gesetzt)
3. Platform Default (Free-Tier)  (lokaler LLM auf .120)
```

## Frontend (Chat-UI)

### Admin-Panel (bestehend, erweitern)
- Neuer Tab "Groups" im Admin-Dashboard
- Tabelle: Gruppenname, Mitglieder-Count, Status, Usage
- Gruppe erstellen: Name + Description
- Mitglieder zuweisen: User-Suche + Multi-Select
- Gruppen-Admin ernennen: Toggle pro User

### Gruppen-Admin View (neu)
- Erreichbar über Profil-Menü → "Meine Gruppe"
- API-Token eingeben (Password-Feld, nur schreiben, nicht lesen)
- Mitgliederliste (read-only)
- Usage-Übersicht (Tokens verbraucht heute/diese Woche)

### User View
- Badge im Chat-Header: "Gruppe: FH Rosenheim WS26"
- Kein Zugriff auf Token oder Gruppenverwaltung

## Sicherheit

- API-Keys werden AES-256 verschlüsselt in DB gespeichert (bestehendes `llm-encryption-key` Secret)
- Gruppen-Admin sieht nur eigene Gruppe(n)
- Token wird nie im Frontend angezeigt (nur "Key gesetzt: ✅ Anthropic")
- Rate-Limiting per Gruppe möglich via `max_tokens_per_day`
- Audit-Log: wer hat wann welchen Key gesetzt/geändert

## Aufwand

| Komponente | Aufwand |
|---|---|
| DB-Migration (3 Tabellen) | 1h |
| Admin API (CRUD Groups + Members) | 3h |
| Gruppen-Admin API (Token CRUD) | 2h |
| Chat LLM Config Resolution | 2h |
| Admin-UI (Groups Tab) | 3h |
| Gruppen-Admin UI | 2h |
| User Badge | 30min |
| Tests | 2h |
| **Gesamt** | **~2 Tage** |

## Abhängigkeiten
- Gateway DB (osf-postgres) — neue Tabellen
- Bestehendes Auth-System (JWT + Rollen)
- Bestehendes Encryption-Secret für API-Keys

## Offene Fragen
1. Kann ein User in mehreren Gruppen sein? (Empfehlung: ja, aber nur ein aktiver Token wird verwendet — erste Gruppe mit Token gewinnt)
2. Soll der Gruppen-Admin auch User einladen können oder nur der Platform-Admin? (Empfehlung: nur Platform-Admin, Gruppen-Admin verwaltet nur Token)
3. Brauchen wir Usage-Limits pro User innerhalb einer Gruppe? (Empfehlung: optional, `max_tokens_per_day` pro Gruppe)
