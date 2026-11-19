"""Boss GT-1B Setlist Manager — saves song-to-patch mappings."""

import sqlite3
import threading
from urllib.parse import unquote
from fastapi.responses import JSONResponse


def setup(app, context):
    config_dir = context["config_dir"]
    _db_path = str(config_dir / "gt1b_setlists.db")
    _conn = None
    _lock = threading.Lock()

    def _get_db():
        nonlocal _conn
        if _conn is None:
            config_dir.mkdir(parents=True, exist_ok=True)
            _conn = sqlite3.connect(_db_path, check_same_thread=False)
            _conn.row_factory = sqlite3.Row
            _conn.execute("""
                CREATE TABLE IF NOT EXISTS song_patches (
                    song_filename TEXT PRIMARY KEY,
                    song_title TEXT NOT NULL DEFAULT '',
                    patch_number INTEGER NOT NULL DEFAULT 1,
                    patch_label TEXT NOT NULL DEFAULT ''
                );
            """)
            # Migrate older table if song_title column wasn't present yet
            cols = [r[1] for r in _conn.execute("PRAGMA table_info(song_patches)").fetchall()]
            if "song_title" not in cols:
                _conn.execute("ALTER TABLE song_patches ADD COLUMN song_title TEXT NOT NULL DEFAULT ''")
            _conn.commit()
        return _conn

    @app.get("/api/plugins/gt1b-setlist/mappings")
    def get_mappings():
        db = _get_db()
        rows = db.execute("SELECT * FROM song_patches ORDER BY song_title, song_filename").fetchall()
        return [dict(r) for r in rows]

    @app.post("/api/plugins/gt1b-setlist/mappings")
    def save_mapping(data: dict):
        song_filename = data.get("song_filename", "").strip()
        song_title = data.get("song_title", "").strip()
        patch_number = max(1, min(99, int(data.get("patch_number", 1))))
        patch_label = data.get("patch_label", "").strip()
        if not song_filename:
            return JSONResponse({"error": "song_filename required"}, 400)
        db = _get_db()
        with _lock:
            db.execute(
                """INSERT INTO song_patches (song_filename, song_title, patch_number, patch_label)
                   VALUES (?, ?, ?, ?)
                   ON CONFLICT(song_filename)
                   DO UPDATE SET song_title=excluded.song_title,
                                 patch_number=excluded.patch_number,
                                 patch_label=excluded.patch_label""",
                (song_filename, song_title, patch_number, patch_label),
            )
            db.commit()
        return {"ok": True}

    @app.delete("/api/plugins/gt1b-setlist/mappings/{song_filename:path}")
    def delete_mapping(song_filename: str):
        fn = unquote(song_filename)
        db = _get_db()
        with _lock:
            db.execute("DELETE FROM song_patches WHERE song_filename = ?", (fn,))
            db.commit()
        return {"ok": True}
