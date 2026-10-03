# Third-party source dependencies

## VCMI

`vcmi/` is a Git submodule of the official repository:

- Repository: https://github.com/vcmi/vcmi.git
- Pinned commit: `bc0fc2a9f83c9caf0d90575e38ad4b7008b2764a`
- Integration: [`scripts/native/`](../scripts/native/) and [native setup guide](../docs/vcmi-adapter.md)

This upstream commit has the same core, server, AI, headers, build configuration,
test helpers and engine resource configuration as the existing local reference
checkout at `9012c9fbdcd5640115010728240a3107f990d780`. The latter also contains
separate art-tool history, which is not needed for this dependency.

Initialize the pinned source and its upstream submodules with:

```sh
git submodule update --init --recursive --depth 1 3rdparty/vcmi
export VCMI_SOURCE="$PWD/3rdparty/vcmi"
```

The web GUI runs without initializing this dependency. Native combat requires a
compatible VCMI build and a prepared private game-resource profile, as described
in the setup guide. Adding this submodule does not rebuild or replace an already
running backend. The current native build bootstrap remains macOS-specific and
uses an existing compatible Ninja build; it is not a portable build from scratch.

Keep dependency source unchanged. Store adapters and any required patches in this
repository, and put generated build output under ignored `.local/`. Original H3
game resources and imported/generated art are not supplied by this dependency.
VCMI's license and notices remain in its upstream checkout.
