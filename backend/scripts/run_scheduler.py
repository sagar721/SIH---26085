"""Run provider refresh loops as a dedicated production process.

Optional — only needed when RUN_SCHEDULED_REFRESHES_IN_API=False (see
app/main.py and docker-compose.yml's `scheduler` service). A plain local
`python scripts/run.py` never needs this: RUN_SCHEDULED_REFRESHES_IN_API
defaults to True, so the API process runs these same refresh loops itself
with zero extra setup.
"""

import asyncio

from app.workers import data_worker, weather_worker


async def run() -> None:
    await weather_worker.start()
    await data_worker.start()
    try:
        await asyncio.Event().wait()
    finally:
        await data_worker.stop()
        await weather_worker.stop()


if __name__ == "__main__":
    try:
        asyncio.run(run())
    except KeyboardInterrupt:
        pass
