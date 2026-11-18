{
  lib,
  buildNpmPackage,
  electron,
  makeWrapper,
  makeDesktopItem,
  copyDesktopItems,
  librsvg,
}:

buildNpmPackage {
  pname = "budget-planer";
  version = "1.4.0";

  # Nur die Quelldateien – node_modules und dist bleiben draussen
  src = lib.fileset.toSource {
    root = ./.;
    fileset = lib.fileset.unions [
      ./package.json
      ./package-lock.json
      ./index.html
      ./vite.config.js
      ./src
      ./public
      ./electron
    ];
  };

  npmDepsHash = "sha256-m4+fRWSx4srAtRBHFAN0SJAEUHTreyiTiCDKzmPXU3w=";

  nativeBuildInputs = [
    makeWrapper
    copyDesktopItems
    librsvg
  ];

  # Electron kommt aus nixpkgs, nicht aus npm
  env.ELECTRON_SKIP_BINARY_DOWNLOAD = "1";

  # npm run build → vite build → dist/
  installPhase = ''
    runHook preInstall

    app=$out/share/budget-planer/app
    mkdir -p $app $out/bin $out/share/icons/hicolor/scalable/apps
    cp -r package.json dist electron $app/
    rsvg-convert -w 256 -h 256 public/icon.svg -o $app/icon.png

    cp public/icon.svg $out/share/icons/hicolor/scalable/apps/budget-planer.svg
    for s in 32 48 64 128 256 512; do
      mkdir -p $out/share/icons/hicolor/''${s}x''${s}/apps
      rsvg-convert -w $s -h $s public/icon.svg -o $out/share/icons/hicolor/''${s}x''${s}/apps/budget-planer.png
    done

    makeWrapper ${lib.getExe electron} $out/bin/budget-planer \
      --add-flags $app \
      --add-flags "--ozone-platform-hint=auto" \
      --add-flags "--enable-wayland-ime=true"

    runHook postInstall
  '';

  desktopItems = [
    (makeDesktopItem {
      name = "budget-planer";
      desktopName = "Budget";
      genericName = "Budget-Planer";
      comment = "Lokaler Budget-Planer mit Rücklagen und Statistiken";
      exec = "budget-planer";
      icon = "budget-planer";
      startupWMClass = "budget-planer";
      categories = [ "Office" "Finance" ];
    })
  ];

  meta = {
    description = "Lokaler Budget-Planer (Electron) mit Rücklagen für jährliche Kosten und Statistiken";
    license = lib.licenses.mit;
    platforms = lib.platforms.linux;
    mainProgram = "budget-planer";
  };
}
