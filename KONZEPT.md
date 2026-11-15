# Konzept: Buchungen, Soll/Ist-Vergleich und Kontrolle

> Status: **umgesetzt** (Etappen 1–3).
> Ziel: Effektive Ausgaben erfassen, Budget-Positionen zuordnen und mit dem Budget vergleichen.
> Alle Daten bleiben lokal; es gibt keine Bankanbindung.

## 1. Ausgangslage

- Das Budget wird pro Monat geplant (monatsabhängige Beträge, Rücklagen für periodische Kosten).
- Ausgaben laufen über mehrere Konten. Bei Revolut über mehrere **Pockets** (z. B. ein Pocket pro Budget-Gruppe).
- Der Revolut-CSV-Export ist **nicht pro Pocket** aufgeteilt:
  - `Produkt` unterscheidet nur das Girokonto und „Erspartes“ (alle Pockets zusammen).
  - `Kontostand` ist der Gesamtsaldo des Produkts, nicht der Saldo eines Pockets.
  - Der Pocket-Name erscheint nur bei Umbuchungen, und zwar nur das Ziel-Pocket.
- Daraus folgt: Das **bezahlende Konto** und die **Budget-Position**, zu der eine Ausgabe gehört, sind zwei getrennte Dinge und werden getrennt geführt.

### Revolut-CSV (Spalten)

```
Art, Produkt, Datum des Beginns, Datum des Abschlusses, Beschreibung, Betrag, Gebühr, Währung, Status, Kontostand
```

- `Art`: Kartenbezahlung, Transfer, Einzahlung, Rückerstattung, Geldautomat, …
- `Datum des Beginns` = Kaufdatum → bestimmt den **Monat** der Buchung (nicht das Abschlussdatum).
- `Status`: nur `ABGESCHLOSSEN` übernehmen; ausstehende/stornierte ignorieren oder separat anzeigen.
- `Gebühr` wird zum Betrag addiert.

## 2. Datenmodell (Ergänzung zu `budget.json`)

```js
accounts: [
  { id, name, type: 'giro' | 'pocket' | 'extern', funds: [positionId, ...] }
]

transactions: [
  {
    id,                 // stabil, aus den Quelldaten abgeleitet (für Duplikaterkennung)
    accountId,          // bezahlendes Konto (optional, falls unbekannt)
    date,               // Kaufdatum (YYYY-MM-DD)
    bookedDate,
    text,               // Beschreibung aus dem Export
    amount,             // negativ = Ausgabe, positiv = Gutschrift
    source: 'csv' | 'manual' | 'correction',
    positionId,         // zugeordnete Budget-Position
    status: 'open' | 'auto' | 'manual' | 'confirmed' | 'ignored',
    ruleId,             // welche Regel zugeordnet hat (bei status 'auto')
    linkedId,           // optional: verknüpfte Ausgleichsbuchung
  }
]

rules: [
  { id, pattern, field: 'text', positionId | action: 'ignore', priority }
]

balances: [
  { accountId, date, amount }   // tatsächlicher Saldo zum Stichtag
]

closedMonths: ['YYYY-MM', ...]
```

### Dateiaufteilung

Buchungen werden **von Anfang an pro Jahr in eigenen Dateien** gespeichert:

```
Budget/
├── budget.json              # Budget, Rücklagen, Konten, Regeln, Versionen, Einstellungen
├── buchungen/
│   ├── 2026.json            # transactions, balances, closedMonths dieses Jahres
│   └── 2027.json
└── backups/
    ├── budget-YYYY-MM-DD.json
    └── buchungen-2026-YYYY-MM-DD.json
```

- Zuordnung zum Jahr über das **Kaufdatum** der Buchung.
- Die App lädt nur die Jahre, die gerade gebraucht werden (gewählter Monat, Verlauf/Statistik).
- Gespeichert wird nur die geänderte Datei, jeweils atomar (temporäre Datei, dann umbenennen).
- Die tägliche Sicherung gilt pro Datei.
- Abgeschlossene Jahre bleiben unverändert liegen und lassen sich einfach archivieren.
- Beim Ändern des Speicherorts wird der ganze Ordner mitgenommen.

## 3. Konten

- Konten frei anlegen: Girokonto, Pockets, externe Konten (z. B. Lohnkonto).
- Pro Konto festlegen, **welche Budget-Positionen es finanziert** (für die Kontrolle pro Konto).
- Konten ohne CSV-Export werden nur über manuelle Buchungen und Salden geführt.

## 4. Import

1. CSV wählen → Vorschau mit Anzahl neuer, bereits vorhandener und ignorierter Zeilen.
2. **Duplikaterkennung** über einen Schlüssel aus Kaufdatum, Abschlussdatum, Text, Betrag und Kontostand.
   Überlappende Zeiträume können also mehrfach importiert werden.
3. **Automatisch ignoriert** (über Standardregeln, anpassbar):
   - Umbuchungen zwischen Pockets (z. B. Texte mit „einzustecken“, „Auszahlung bei Pocket“)
   - Einzahlungen vom eigenen Lohnkonto (z. B. „Apple Pay Einzahlung“)
4. Alle übrigen Buchungen durchlaufen die Zuordnungsregeln.

## 5. Zuordnung zu Positionen

- Zugeordnet wird auf **Positionen** (nicht nur Gruppen); Gruppensummen ergeben sich daraus.
- **Regeln**: Textmuster (Teilstring oder regulärer Ausdruck) → Position oder „ignorieren“, mit Priorität.
- Manuelle Zuordnungen erzeugen **Regelvorschläge** (einer pro Händler). Sie werden in einer Liste gesammelt
  und müssen bewusst erstellt oder verworfen werden – einzeln oder alle auf einmal. Das Muster ist vorher anpassbar.
- **Manuelle Zuordnungen haben immer Vorrang** und werden von Regeln oder erneutem Import nie überschrieben.
- Nicht erkannte Buchungen landen in **„Nicht zugeordnet“**.
- **Aufteilen (Split)**: Eine Buchung kann auf mehrere Positionen verteilt werden (z. B. ein Einkauf für
  mehrere Zwecke). Die Summe der Teile muss dem Buchungsbetrag entsprechen.
- **Löschen**: einzeln oder mehrere ausgewählte. Gelöschte Buchungen aus einem CSV-Import werden gemerkt
  (`deletedIds` in der Jahresdatei) und beim erneuten Import derselben Datei übersprungen.

### Ausgleichsbuchungen

Typischer Fall: Eine Ausgabe wird aus dem falschen Pocket bezahlt (z. B. eine jährliche Ausgabe aus dem
Lifestyle-Pocket) und anschliessend mit einer Umbuchung ausgeglichen.

- Die **Ausgabe** wird der richtigen Position zugeordnet (z. B. der jährlichen Ausgabe) → belastet deren Rücklage.
- Die **Umbuchung** ist ein Ausgleich und zählt nicht als Ausgabe.
- Die App **schlägt Paare vor** (gleicher Betrag innerhalb weniger Tage) und verknüpft sie nach Bestätigung.

## 6. Kontrolle und Bestätigung

| Status | Bedeutung |
|---|---|
| Offen | keine Position zugeordnet |
| Automatisch | per Regel zugeordnet, noch nicht geprüft |
| Manuell | von Hand zugeordnet, noch nicht bestätigt |
| Bestätigt | manuell kontrolliert |
| Ignoriert | Umbuchung o. Ä., zählt nicht |

- **Bestätigte Buchungen sind geschützt**: Regeln und Import ändern sie nicht mehr.
- **Massenbestätigung**:
  - Mehrfachauswahl per Checkbox → „Bestätigen“
  - „Alle sichtbaren bestätigen“ in Kombination mit Filtern (Monat, Konto, Position, Status, Text)
- Fortschritt pro Monat, z. B. *„48 von 55 bestätigt · 3 offen · 4 automatisch“*.

## 6a. Arten von Rücklagen

| | Fällige Zahlung | Jahresbudget |
|---|---|---|
| Beispiel | Versicherung, fällig am 1.3. | Service, Geschenke – laufende Ausgaben ohne festen Termin |
| Monatliche Rate | (Betrag − angespart) ÷ Monate bis zur Fälligkeit | gleichmässig Betrag ÷ 12 |
| Ausgaben | eine geplante Zahlung am Fälligkeitsdatum | beliebig viele Buchungen übers Jahr |
| Anzeige | Fortschritt bis zur Fälligkeit | Ausgaben im Kalenderjahr vs. Jahresbudget, aktueller Stand der Rücklage |
| Rest | – | wird ins nächste Jahr übertragen |

## 7. Saldo-Abgleich und Korrekturen

- Pro Konto den tatsächlichen Saldo zu einem Stichtag eintragen (typisch: Monatsende).
- Die App berechnet den erwarteten Saldo und zeigt die Differenz.
- Bei Differenz: **„Korrekturbuchung erstellen“** (`source: 'correction'`), wahlweise einer Position
  zugeordnet oder neutral.

## 8. Manuelle Buchungen

- Eingabemaske: Datum, Betrag, Text, Konto, Position.
- Für Konten ohne Export (z. B. Zahlungen direkt vom Lohnkonto).

## 9. Soll/Ist-Auswertung

- **Budget-Seite**: pro Position zusätzlich *Effektiv* und *Abweichung* mit Farbbalken
  (unter Budget / knapp / überschritten).
- **Rücklagen**: geplanter Betrag vs. tatsächlich bezahlt. Abweichungen werden **angezeigt, nicht automatisch
  korrigiert**, mit Aktionen wie:
  - „Betrag für nächsten Zyklus übernehmen“
  - „Angespart-Stand anpassen“
- **Statistik**: Soll vs. Ist im Verlauf, grösste Überschreitungen, Ausgaben pro Konto und pro Position.
- **Konten**: berechneter Saldo vs. eingetragener Saldo.

## 10. Monatsabschluss (geführter Ablauf)

1. CSV importieren (Duplikate und Umbuchungen werden automatisch behandelt).
2. Offene Buchungen zuordnen (dabei ggf. Regeln anlegen).
3. Automatisch zugeordnete prüfen und gesammelt bestätigen.
4. Manuelle Buchungen ergänzen.
5. Salden abgleichen, Korrekturen erstellen.
6. Soll/Ist prüfen, Rücklagen-Hinweise bearbeiten.
7. Optional **Monat abschliessen** → Buchungen dieses Monats nur noch nach Rückfrage änderbar.

## 11. Umsetzung in Etappen

1. Konten, Buchungen (manuell + CSV-Import mit Duplikaterkennung), Regeln, Zuordnung, Status und Bestätigung
2. Soll/Ist-Ansichten auf Budget-Seite, Rücklagen und Statistik
3. Ausgleichs-Vorschläge, Saldo-Abgleich mit Korrekturbuchungen, Monatsabschluss

## Testdaten

Für Entwicklung und Tests ausschliesslich **erfundene Daten** im Format des Exports verwenden.
Echte Kontoauszüge gehören nicht ins Repository.
