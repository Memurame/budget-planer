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
  pname = "budget";
  version = "1.0.0";

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

  npmDepsHash = "sha256-48dctDm4QL2PWWOEhC5MsLmGywaqupZRew81khqXkTY=";

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

    app=$out/share/budget/app
    mkdir -p $app $out/bin $out/share/icons/hicolor/scalable/apps
    cp -r package.json dist electron $app/
    rsvg-convert -w 256 -h 256 public/icon.svg -o $app/icon.png

    cp public/icon.svg $out/share/icons/hicolor/scalable/apps/budget.svg
    for s in 32 48 64 128 256 512; do
      mkdir -p $out/share/icons/hicolor/''${s}x''${s}/apps
      rsvg-convert -w $s -h $s public/icon.svg -o $out/share/icons/hicolor/''${s}x''${s}/apps/budget.png
    done

    makeWrapper ${lib.getExe electron} $out/bin/budget \
      --add-flags $app \
      --add-flags "--ozone-platform-hint=auto" \
      --add-flags "--enable-wayland-ime=true"

    runHook postInstall
  '';

  desktopItems = [
    (makeDesktopItem {
      name = "budget";
      desktopName = "Budget";
      genericName = "Budget-Planer";
      comment = "Lokaler Budget-Planer mit Rücklagen und Statistiken";
      exec = "budget";
      icon = "budget";
      startupWMClass = "budget";
      categories = [ "Office" "Finance" ];
    })
  ];

  meta = {
    description = "Lokaler Budget-Planer (Electron) mit Rücklagen für jährliche Kosten und Statistiken";
    license = lib.licenses.mit;
    platforms = lib.platforms.linux;
    mainProgram = "budget";
  };
}
