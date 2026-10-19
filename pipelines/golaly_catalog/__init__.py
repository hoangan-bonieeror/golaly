"""Golaly place catalog pipeline.

Extract open place data (Overture Maps, OpenStreetMap) for an area, load it into
`place_sources` (staging), normalise it, and publish canonical rows into `places`.
Every step is idempotent: running the same import twice changes nothing.
"""

__version__ = "0.1.0"
