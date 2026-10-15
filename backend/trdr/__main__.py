"""Start trdr: python -m trdr"""

from __future__ import annotations

import logging
import sys
import threading
import webbrowser

import uvicorn

from . import config
from .app import create_app


def main() -> None:
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(name)s: %(message)s")
    url = f"http://{config.HOST}:{config.PORT}"
    print(f"trdr is running at {url} (close this window to stop it)")
    if "--no-browser" not in sys.argv:
        threading.Timer(1.5, lambda: webbrowser.open(url)).start()
    uvicorn.run(create_app(), host=config.HOST, port=config.PORT, log_level="warning")


if __name__ == "__main__":
    main()
