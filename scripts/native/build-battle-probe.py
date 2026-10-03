"""Compile the real VCMI server smoke test against an owned core derivative."""
import argparse
from pathlib import Path
import subprocess


def build(source, upstream_build, core, output, dependency_include, dependency_lib, backend=False):
    source, upstream_build, core, output = map(lambda p: Path(p).resolve(), (source, upstream_build, core, output))
    if output.exists():
        raise ValueError("Output already exists; use a new directory")
    helpers = source / "test/mock"
    if not (core / "libvcmi-battle-lab.dylib").is_file():
        raise ValueError("Build the owned core derivative first")
    output.mkdir(parents=True)
    copies = []
    for name in ("TinyH3MBuilder.cpp", "TinyH3MWriter.cpp"):
        # Test helpers contain no combat logic. Remove their test-framework umbrella
        # include from private copies; upstream files stay unchanged.
        code = (helpers / name).read_text()
        if '#include "StdInc.h"' not in code:
            raise ValueError("Unexpected helper source layout")
        target = output / name
        if backend and name == "TinyH3MBuilder.cpp":
            # Keep the army containers' map terrain consistent with the sand
            # battlefield. VCMI terrain limiters consult those map stacks too.
            original = 'w.writeUInt8(2);    // terrain type = GRASS in H3M ordering'
            if code.count(original) != 1:
                raise ValueError("Unsupported upstream fixture terrain writer")
            code = code.replace(original, 'w.writeUInt8(1);    // terrain type = SAND in H3M ordering')
            code = code.replace('w.writeUInt8(0x31); // terView — plain-grass tile', 'w.writeUInt8(0); // terView — sand fixture tile')
        target.write_text(code.replace('#include "StdInc.h"', '#include "Global.h"'))
        copies.append(str(target))
    includes = [source, source / "include", source / "lib", source / "server", helpers, Path(dependency_include)]
    target_name = "battle-backend" if backend else "battle-probe"
    command = ["c++", "-std=c++20", *[f"-I{p}" for p in includes],
        str(Path(__file__).with_name(target_name + ".cpp").resolve()), *copies,
        *([str(source / "lib/json/JsonParser.cpp")] if backend else []),
        str(upstream_build / "bin/libvcmiservercommon.a"), f"-L{core}", "-lvcmi-battle-lab",
        f"-L{dependency_lib}", "-lboost_filesystem", "-lboost_program_options", "-lz",
        f"-Wl,-rpath,{core}", "-o", str(output / target_name)]
    subprocess.run(command, check=True)


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--vcmi-source", required=True)
    parser.add_argument("--vcmi-build", required=True)
    parser.add_argument("--core", required=True)
    parser.add_argument("--out", required=True)
    parser.add_argument("--dependency-include", required=True)
    parser.add_argument("--dependency-lib", required=True)
    parser.add_argument("--backend", action="store_true", help="Build the JSON-lines battle service")
    args = parser.parse_args()
    build(args.vcmi_source, args.vcmi_build, args.core, args.out, args.dependency_include, args.dependency_lib, args.backend)
