"""Prepare and start trdr. Called by start.bat (Windows) or start.sh.

1. Installs the Python packages when backend/requirements.txt changes.
2. Rebuilds the web app when anything under frontend/ changes.
3. Starts the local server and opens trdr in your browser.
"""

from __future__ import annotations

import hashlib
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
BACKEND = ROOT / "backend"
FRONTEND = ROOT / "frontend"
STAMP = ROOT / ".venv" / ".trdr-requirements"


def run(cmd: list[str], cwd: Path) -> None:
    print(">", " ".join(cmd))
    subprocess.run(cmd, cwd=cwd, check=True)


def python_packages() -> None:
    req = BACKEND / "requirements.txt"
    digest = hashlib.sha256(req.read_bytes()).hexdigest()
    if STAMP.exists() and STAMP.read_text().strip() == digest:
        return
    print("Installing Python packages...")
    run([sys.executable, "-m", "pip", "install", "--disable-pip-version-check", "-q", "-r", str(req)], ROOT)
    STAMP.parent.mkdir(parents=True, exist_ok=True)
    STAMP.write_text(digest)


def newest(paths: list[Path]) -> float:
    latest = 0.0
    for p in paths:
        if p.is_file():
            latest = max(latest, p.stat().st_mtime)
        elif p.is_dir():
            for f in p.rglob("*"):
                if f.is_file():
                    latest = max(latest, f.stat().st_mtime)
    return latest


def web_app() -> None:
    built = FRONTEND / "dist" / "index.html"
    sources = [FRONTEND / "src", FRONTEND / "index.html", FRONTEND / "package.json", FRONTEND / "vite.config.ts"]
    if built.exists() and built.stat().st_mtime >= newest(sources):
        return
    npm = shutil.which("npm")
    if not npm:
        sys.exit("Node.js 20 or newer is needed to build the web app: https://nodejs.org/")
    lock = FRONTEND / "package-lock.json"
    installed = FRONTEND / "node_modules" / ".package-lock.json"
    if not installed.exists() or installed.stat().st_mtime < lock.stat().st_mtime:
        print("Installing web app packages...")
        run([npm, "ci", "--no-audit", "--no-fund"], FRONTEND)
    print("Building the web app...")
    run([npm, "run", "build"], FRONTEND)


def main() -> None:
    python_packages()
    web_app()
    sys.path.insert(0, str(BACKEND))
    from trdr.__main__ import main as serve

    serve()


if __name__ == "__main__":
    try:
        main()
    except subprocess.CalledProcessError as exc:
        sys.exit(f"Setup step failed: {exc}")
    except KeyboardInterrupt:
        pass
