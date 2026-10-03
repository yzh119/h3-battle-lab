"""macOS development bootstrap: relink existing VCMI objects with owned profile paths.

Reads an existing Ninja build; writes only to a NEW private output directory.
This is a bootstrap for local investigation, not a portable release build.
"""
import argparse
from pathlib import Path
import shlex
import subprocess
import sys


def build(build_dir, output):
    if sys.platform != "darwin":
        raise ValueError("This development bootstrap currently supports macOS only")
    build_dir, output = Path(build_dir).resolve(), Path(output).resolve()
    if output.exists():
        raise ValueError("Output already exists; use a new directory")
    commands = subprocess.check_output([
        "ninja", "-C", str(build_dir), "-t", "commands", "bin/libvcmi.dylib"
    ], text=True).splitlines()
    compile_command = next(c for c in commands if "VCMIDirs.cpp.o" in c and " -c " in c)
    link_command = next(c for c in reversed(commands) if "-dynamiclib" in c and "-o bin/libvcmi.dylib" in c)
    # Ignore all post-link commands: upstream copies resources into its build directory.
    link = shlex.split(link_command.split("&&")[1])
    compile_args = shlex.split(compile_command)
    old_object = compile_args[compile_args.index("-o") + 1]
    if old_object not in link:
        raise ValueError("VCMIDirs object not present in the core link command")
    output.mkdir(parents=True)
    replacement = output / "profile-dirs.o"
    for option in ("-o", "-MF", "-MT"):
        if option in compile_args:
            i = compile_args.index(option) + 1
            compile_args[i] = str(replacement) + (".d" if option == "-MF" else "")
    compile_args[compile_args.index("-c") + 1] = str(Path(__file__).with_name("profile-dirs.cpp").resolve())
    link[link.index(old_object)] = str(replacement)
    link[link.index("-o") + 1] = str(output / "libvcmi-battle-lab.dylib")
    link[link.index("-install_name") + 1] = "@rpath/libvcmi-battle-lab.dylib"
    subprocess.run(compile_args, cwd=build_dir, check=True)
    subprocess.run(link, cwd=build_dir, check=True)
    print("Built owned core derivative; upstream objects and resources were not modified.")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--vcmi-build", required=True)
    parser.add_argument("--out", required=True)
    args = parser.parse_args()
    build(args.vcmi_build, args.out)
