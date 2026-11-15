# budget-planer

Lokaler Budget-Planer für NixOS (Electron aus nixpkgs). Alle Daten bleiben auf dem eigenen Rechner in einer JSON-Datei.

- Budget nach Gruppen, Einnahmen, Sparen & Abzüge – direkt in Tabellen bearbeitbar
- **Monatsabhängige Beträge**: Ein Betrag gilt ab dem Monat, in dem er eingetragen wird, bis er in einem späteren Monat geändert wird. Frühere Monate bleiben unverändert.
- **Rücklagen für jährliche Kosten**: Betrag, Intervall, Fälligkeitsdatum, bereits angespart.
  `Rate = (Betrag − angespart) / Monate bis zur Fälligkeit` (der Fälligkeitsmonat zählt nicht mehr dazu),
  nach der Zahlung beginnt der nächste Zyklus mit `Betrag / Intervall`.
  Auch einzelne Positionen in Gruppen (z. B. ein Jahresabo) können jährlich abgerechnet werden.
- Statistiken, Verlauf, Versionen zum Vergleichen, CSV-Export, hell/dunkel

## Starten

```sh
nix run github:Memurame/budget-planer
# oder lokal
nix run .
```

## In die NixOS-Konfiguration einbinden

`/etc/nixos/flake.nix`:

```nix
inputs.budget-planer = {
  url = "github:Memurame/budget-planer";
  inputs.nixpkgs.follows = "nixpkgs";
};

# outputs = { ..., budget-planer, ... }:
{ nixpkgs.overlays = [ budget-planer.overlays.default ]; }
```

Danach das Paket `budget` installieren (z. B. in `home.packages`) – es erscheint als **Budget** im App-Menü.

## Daten

- Datei: `~/Documents/Budget/budget.json` bzw. `~/Dokumente/Budget/budget.json` (in der App unter *Einstellungen* änderbar)
- Tägliche Sicherung im Unterordner `backups/`
- Beim ersten Start wird eine leere Vorlage angelegt; danach ist die Datei der Master.

## Entwicklung

```sh
nix develop
npm install
npm run dev        # Oberfläche im Browser (Daten in localStorage)
npm run dev:app    # Electron gegen den Dev-Server (parallel zu npm run dev)
```

Nach Änderungen an `package-lock.json` muss `npmDepsHash` in `package.nix` aktualisiert werden
(auf `lib.fakeHash` setzen, `nix build` ausführen, Hash aus der Fehlermeldung übernehmen).

## Lizenz

MIT
