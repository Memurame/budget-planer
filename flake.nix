{
  description = "budget-planer – lokaler Budget-Planer mit Rücklagen und Statistiken";

  inputs.nixpkgs.url = "github:NixOS/nixpkgs/nixos-unstable";

  outputs =
    { self, nixpkgs }:
    let
      systems = [
        "x86_64-linux"
        "aarch64-linux"
      ];
      forAll = f: nixpkgs.lib.genAttrs systems (s: f nixpkgs.legacyPackages.${s});
    in
    {
      packages = forAll (pkgs: rec {
        budget-planer = pkgs.callPackage ./package.nix { };
        default = budget-planer;
      });

      overlays.default = final: _prev: {
        budget-planer = final.callPackage ./package.nix { };
        # Alter Name, bleibt vorerst als Alias erhalten
        budget = final.budget-planer;
      };

      apps = forAll (pkgs: {
        default = {
          type = "app";
          program = nixpkgs.lib.getExe self.packages.${pkgs.stdenv.hostPlatform.system}.default;
        };
      });

      devShells = forAll (pkgs: {
        default = pkgs.mkShell {
          packages = [
            pkgs.nodejs_22
            pkgs.electron
          ];
          ELECTRON_SKIP_BINARY_DOWNLOAD = "1";
        };
      });
    };
}
