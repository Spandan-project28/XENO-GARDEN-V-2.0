"""
Builds and runs the firmware logic tests on the host (no ESP32 needed).

    python firmware/test/run_native.py

Uses `ziglang` (pip install ziglang) as a portable C++ compiler, or $CXX if set. ArduinoJson
(header-only) is taken from the PlatformIO libdeps folder (run `pio pkg install` once) or
from $ARDUINOJSON_INCLUDE.
"""
import glob
import os
import shutil
import subprocess
import sys

here = os.path.dirname(os.path.abspath(__file__))
fw = os.path.dirname(here)
repo = os.path.dirname(fw)
out_dir = os.path.join(fw, ".pio", "native-tests")
os.makedirs(out_dir, exist_ok=True)


def find_arduinojson():
    env = os.environ.get("ARDUINOJSON_INCLUDE")
    if env:
        return env
    hits = glob.glob(os.path.join(fw, ".pio", "libdeps", "*", "ArduinoJson", "src"))
    if hits:
        return hits[0]
    sys.exit("ArduinoJson not found: run `pio pkg install -d firmware` or set ARDUINOJSON_INCLUDE")


def compiler():
    cxx = os.environ.get("CXX")
    if cxx:
        return cxx.split()
    try:
        import ziglang  # noqa: F401

        return [sys.executable, "-m", "ziglang", "c++"]
    except ImportError:
        pass
    for name in ("g++", "clang++"):
        if shutil.which(name):
            return [name]
    sys.exit("No C++ compiler: pip install ziglang, or set CXX")


sources = glob.glob(os.path.join(fw, "lib", "xg_core", "src", "*.cpp")) + glob.glob(
    os.path.join(here, "native", "*.cpp")
)
exe = os.path.join(out_dir, "xg_core_tests" + (".exe" if os.name == "nt" else ""))
cmd = compiler() + [
    "-std=c++17",
    "-O1",
    "-Wall",
    "-Wno-unused-function",
    "-Wno-nullability-completeness",
    "-I" + os.path.join(fw, "lib", "xg_core", "src"),
    "-I" + find_arduinojson(),
    "-o",
    exe,
] + sources
print("[native] compiling %d files..." % len(sources))
r = subprocess.run(cmd)
if r.returncode:
    sys.exit(r.returncode)
vectors = os.path.join(repo, "packages", "shared", "test-vectors", "automation.json")
sys.exit(subprocess.run([exe, vectors]).returncode)
