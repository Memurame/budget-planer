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
- **Ansicht**: Kennzahlen (Total, offene Abgleiche, Buchungen ohne Konto), darunter eine kompakte Liste mit Status-Badge,
  Budget-Balken des Monats und Saldo. Details klappen pro Konto auf (Saldo-Abgleich, Buchungen, finanzierte Positionen, Einstellungen).
- **Rücklagen-Soll**: Finanziert ein Konto Rücklagen, wird der Saldo mit deren Soll-Stand am Monatsende verglichen.

## 4. Import

1. CSV wählen → Vorschau mit Anzahl neuer, bereits vorhandener und ignorierter Zeilen.
   - **Import-Ordner** `import/` neben der Budget-Datei (z. B. per Proton Drive vom Handy befüllt): Die App prüft beim Start,
     alle 30 s und bei Fensterfokus auf neue CSV-Dateien (mind. 5 s unverändert) und öffnet dann die Vorschau unter «Buchungen».
     Importiert wird erst per Klick. Nach Import oder Abbrechen wird die Datei gelöscht.
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
| Monatliche Rate | (Betrag − angespart) ÷ Monate bis zur Fälligkeit, inkl. Fälligkeitsmonat (Zahlung Ende Monat); nächster Zyklus ab Folgemonat | gleichmässig Betrag ÷ 12 |
| Ausgaben | eine geplante Zahlung am Fälligkeitsdatum | beliebig viele Buchungen übers Jahr |
| Anzeige | Fortschritt bis zur Fälligkeit | Ausgaben im Kalenderjahr vs. Jahresbudget, aktueller Stand der Rücklage |
| Rest | – | pro Position wählbar: ins nächste Jahr übertragen oder jedes Kalenderjahr neu (Stand beginnt im Januar bei 0) |

## 7. Saldo-Abgleich und Korrekturen

- Pro Konto den tatsächlichen Saldo zu einem Stichtag eintragen (typisch: Monatsende).
- Die App berechnet den erwarteten Saldo und zeigt die Differenz.
- Bei Differenz: **„Korrekturbuchung erstellen“** (`source: 'correction'`), wahlweise einer Position
  zugeordnet oder neutral.

## 8. Manuelle Buchungen

- Eingabemaske: Datum, Betrag, Text, Konto, Position.
- Für Konten ohne Export (z. B. Zahlungen direkt vom Lohnkonto).

## 8a. Wiederkehrende Buchungen und Umbuchungen

- **Umbuchung** zwischen zwei eigenen Konten (z. B. Spaces/Pockets): zwei verknüpfte Buchungen (−/+),
  beide «ignoriert» – zählen nicht als Ausgabe, aber im Saldo-Abgleich beider Konten.
- **Wiederkehrende Buchungen**: Vorlage in `budget.json` (`recurring`) mit Art (Ausgabe, Gutschrift,
  Umbuchung), Betrag, Konto, Position, Intervall (monatlich, vierteljährlich, jährlich), Tag, Start, optional Ende.
  - Beim Start der App werden alle fälligen Termine bis heute als Buchungen erzeugt
    (ID pro Vorlage und Monat → nie doppelt; gelöschte werden gemerkt; abgeschlossene Monate werden übersprungen).
  - Betragsänderungen gelten ab dem nächsten Termin; bereits erzeugte Buchungen bleiben unverändert.
  - Pausieren: keine neuen Buchungen; Termine während der Pause werden nicht nachgeholt.
- Manuelle Buchungen: Konto ist Pflicht (sobald Konten existieren), das zuletzt gewählte wird vorgeschlagen;
  das Konto lässt sich in der Liste nachträglich ändern (nicht bei CSV-Buchungen).

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

## 9a. Positionen deaktivieren

- Monatliche Positionen in Budget-Gruppen lassen sich **ab einem Monat deaktivieren** und später wieder aktivieren
  (z. B. ab Dez aus, ab März wieder an). Gespeichert werden nur die Wechsel: `active: { "2026-12": false, "2027-03": true }`.
- Frühere Monate bleiben unverändert (Betrag, Soll/Ist, zugeordnete Buchungen).
- In deaktivierten Monaten: zählt nicht ins Budget/Soll-Ist, wird beim Zuordnen von Buchungen nicht angeboten,
  erscheint auf der Budget-Seite ausgegraut am Ende der Gruppe mit «Aktivieren».
- Bereits zugeordnete Buchungen bleiben zugeordnet; die Position ist dort als «(deaktiviert)» markiert.
- Nicht für periodische Positionen, jährliche Kosten, Einnahmen und Abzüge.

## 9b. Darlehen (erhalten)

- Eigener Menüpunkt «Darlehen»; in `budget.json` unter `loans`:
  `{ id, name, amount, createdAt, interestRate, plan: 'rate' | 'due' | 'free', rate, rateStart, dueDate, note }`.
- Datum und Konto der Einzahlung kommen aus der ersten als «… – erhalten» verknüpften Buchung (bis dahin: Erfassungsdatum).
- Buchungen werden über zwei Pseudo-Positionen pro Darlehen verknüpft: «… – erhalten» (`loan-in:<id>`, zählt nicht als
  Einnahme/Ausgabe) und «… – Rückzahlung» (`loan-out:<id>`, senkt die Restschuld).
- Rückzahlung:
  - **Raten**: Rate ab erstem Monat im Budget, bis laut Plan bzw. laut Buchungen alles zurückbezahlt ist (letzte Rate = Rest).
  - **Einmalig bis Datum**: Betrag gleichmässig als Rücklage vom Monat der Einzahlung (bzw. der Erfassung) bis zum Fälligkeitsmonat (inkl.).
  - **Ohne festen Plan**: nichts im Budget, nur Restschuld.
- Zins: wird nur vermerkt, nicht berechnet.
- Übersicht: Kachel «Offene Darlehen» (Restschuld, nächste Fälligkeit), Zeile im Budget, Raten bei Soll/Ist.
- Sobald Darlehen erfasst sind, werden alle vorhandenen Buchungsjahre geladen (Einzahlung und Rückzahlungen).

## 9c. Jahresübersicht

- Eigener Menüpunkt unter «Budget»: Tabelle für das Kalenderjahr des gewählten Monats.
- Zeilen: Budget-Gruppen (nur monatliche Positionen, aufklappbar bis zur Position) und separat jährliche Kosten (Rücklagen:
  Budget = monatliche Rücklage, Ist = Zahlungen). Total Budget-Gruppen, Total Rücklagen, Gesamt.
- Zellen: effektiv (gross, rot über / grün unter Budget) und Budget (klein).
  Zukünftige Monate nur Budget, Monate vor dem Startmonat leer.
- Summen: Budget, Ist und Verfügbar **bis heute** (nur vergangene Monate inkl. laufendem), Budget fürs ganze Jahr und
  **Verfügbar Jahr** (Jahresbudget − bisher ausgegeben).

## 9d. Offene Zahlungen

- Tab «Offene Zahlungen» auf der Buchungen-Seite: vorgemerkte **Ausgaben**, die noch keine Buchungen sind
  (`openPayments` in `budget.json`: `{ id, text, amount, dueDate, accountId?, positionId?, splits?, note }`).
- Wie Buchungen auf mehrere Positionen **aufteilbar**; die Aufteilung wird beim Umwandeln übernommen (im Formular anpassbar).
- Zählen nirgends mit (Budget, Soll/Ist, Saldo, Statistik).
- Liste nach Fälligkeit: überfällig (rot), nächste 7 Tage, später; Total aller offenen Zahlungen.
- **Als Buchung erfassen**: öffnet das Buchungsformular vorausgefüllt (Datum = heute); Betrag, Datum, Konto und
  Position anpassbar. Nach dem Speichern verschwindet die offene Zahlung.
- **Erledigt**: entfernt sie ohne Buchung (z. B. wenn die Zahlung per CSV-Import kommt).
- Übersicht: Kachel «Offene Zahlungen» (Total, Anzahl überfällig bzw. nächste Fälligkeit), Klick öffnet den Tab.

## 10a. Startmonat

- In den Einstellungen: **Start des Budget-Planers** (Monat, `startMonth` in `budget.json`, optional).
- Frühere Monate lassen sich nicht anwählen; der Verlauf in der Statistik bleibt dort leer.
- Buchungen vor dem Startmonat werden ausgeblendet (nicht gelöscht), beim CSV-Import übersprungen
  und wiederkehrende Buchungen erst ab dem Startmonat erzeugt.
- Kontosalden, Saldo-Abgleich und Duplikaterkennung rechnen weiterhin mit allen Buchungen.
- Nicht gesetzt → alles wie bisher.

## 11. Umsetzung in Etappen

1. Konten, Buchungen (manuell + CSV-Import mit Duplikaterkennung), Regeln, Zuordnung, Status und Bestätigung
2. Soll/Ist-Ansichten auf Budget-Seite, Rücklagen und Statistik
3. Ausgleichs-Vorschläge, Saldo-Abgleich mit Korrekturbuchungen, Monatsabschluss

## Testdaten

Für Entwicklung und Tests ausschliesslich **erfundene Daten** im Format des Exports verwenden.
Echte Kontoauszüge gehören nicht ins Repository.
