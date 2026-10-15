"""Paths and process-level settings.

Everything user-editable (data keys, fees, data mode) lives in the database
settings table so it can be changed from the Settings page. This module only
decides where files go and which port the server uses.
"""

from __future__ import annotations

import os
from pathlib import Path

HOST = os.environ.get("TRDR_HOST", "127.0.0.1")
PORT = int(os.environ.get("TRDR_PORT", "8765"))

REPO_ROOT = Path(__file__).resolve().parents[2]
FRONTEND_DIST = REPO_ROOT / "frontend" / "dist"


def data_dir() -> Path:
    """Folder for the database and price history.

    Defaults to ./data next to the code so the whole app stays in one folder on
    Windows; TRDR_DATA_DIR overrides it.
    """
    path = Path(os.environ.get("TRDR_DATA_DIR", REPO_ROOT / "data"))
    path.mkdir(parents=True, exist_ok=True)
    return path


def db_path() -> Path:
    return data_dir() / "trdr.db"
