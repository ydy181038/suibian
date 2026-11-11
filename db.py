"""SQLite storage, first-run demo data and demo-data upkeep for VoltPark."""

from __future__ import annotations

import math
import os
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path

from security import hash_password

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"
DB_PATH = Path(os.environ.get("VOLTPARK_DB", DATA_DIR / "voltpark.db"))
SHANGHAI = timezone(timedelta(hours=8))

# Seeded demo accounts. They are safe to refresh because they are fixtures, not
# real registrations; self-registered accounts are never touched.
DEMO_EMAILS = ("demo@evpark.cn", "chen@evpark.cn", "zhou@evpark.cn", "gu@evpark.cn")
# If none of the demo accounts has done anything for this long, the demo lot is
# dead (no active cars, no future bookings). Rebuild it relative to "now" so a
# visitor opening the site weeks later still sees a live parking lot.
DEMO_FRESH_HOURS = 40
# A single parking session cannot stay open forever. Anything older is settled
# at this cap, which also stops an abandoned demo tab from billing for weeks.
MAX_SESSION_HOURS = 24

SCHEMA = """
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS users (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    email           TEXT NOT NULL COLLATE NOCASE UNIQUE,
    password_hash   TEXT NOT NULL,
    role            TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    avatar_color    TEXT NOT NULL DEFAULT '#C8F96A',
    created_at      TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS auth_sessions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash      TEXT NOT NULL UNIQUE,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at      TEXT NOT NULL,
    expires_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions(user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_expiry ON auth_sessions(expires_at);

CREATE TABLE IF NOT EXISTS vehicles (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    plate_no        TEXT NOT NULL COLLATE NOCASE,
    model           TEXT NOT NULL,
    battery_kwh     REAL NOT NULL DEFAULT 60,
    connector       TEXT NOT NULL DEFAULT '国标直流',
    color           TEXT NOT NULL DEFAULT '#24352F',
    is_primary      INTEGER NOT NULL DEFAULT 0 CHECK (is_primary IN (0, 1)),
    is_active       INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
    created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_vehicles_user ON vehicles(user_id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_vehicles_active_plate
    ON vehicles(user_id, plate_no) WHERE is_active = 1;

CREATE TABLE IF NOT EXISTS slots (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    code            TEXT NOT NULL UNIQUE,
    zone            TEXT NOT NULL,
    level           TEXT NOT NULL DEFAULT 'B1',
    kind            TEXT NOT NULL CHECK (kind IN ('dc', 'ac', 'parking')),
    power_kw        REAL NOT NULL DEFAULT 0,
    connector       TEXT NOT NULL DEFAULT '—',
    price_per_hour  REAL NOT NULL DEFAULT 5,
    status          TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'maintenance')),
    sort_order      INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS reservations (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    vehicle_id      INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    slot_id         INTEGER NOT NULL REFERENCES slots(id) ON DELETE CASCADE,
    start_at        TEXT NOT NULL,
    end_at          TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'reserved'
                    CHECK (status IN ('reserved', 'active', 'completed', 'cancelled', 'expired')),
    note            TEXT NOT NULL DEFAULT '',
    created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_reservations_slot_time ON reservations(slot_id, start_at, end_at);
CREATE INDEX IF NOT EXISTS idx_reservations_user ON reservations(user_id, start_at);

CREATE TABLE IF NOT EXISTS parking_records (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    vehicle_id      INTEGER NOT NULL REFERENCES vehicles(id) ON DELETE CASCADE,
    slot_id         INTEGER NOT NULL REFERENCES slots(id) ON DELETE CASCADE,
    reservation_id  INTEGER REFERENCES reservations(id) ON DELETE SET NULL,
    started_at      TEXT NOT NULL,
    ended_at        TEXT,
    energy_kwh      REAL NOT NULL DEFAULT 0,
    parking_fee     REAL NOT NULL DEFAULT 0,
    energy_fee      REAL NOT NULL DEFAULT 0,
    total_fee       REAL NOT NULL DEFAULT 0,
    status          TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed')),
    created_at      TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_parking_user ON parking_records(user_id, started_at);
CREATE INDEX IF NOT EXISTS idx_parking_slot ON parking_records(slot_id, ended_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_parking_active_slot
    ON parking_records(slot_id) WHERE ended_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS idx_parking_active_user
    ON parking_records(user_id) WHERE ended_at IS NULL;
"""


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


def iso(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def parse_iso(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


def connect(path: Path | str | None = None) -> sqlite3.Connection:
    db_path = Path(path or DB_PATH)
    db_path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(db_path, timeout=15)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    conn.execute("PRAGMA busy_timeout = 5000")
    return conn


def init_db(conn: sqlite3.Connection) -> None:
    conn.executescript(SCHEMA)
    conn.commit()
    seed_database(conn)


def _insert_user(conn, user_id, name, email, password, role, color, created_at):
    conn.execute(
        """INSERT INTO users (id, name, email, password_hash, role, avatar_color, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)""",
        (user_id, name, email, hash_password(password), role, color, created_at),
    )


def _insert_vehicle(conn, vehicle_id, user_id, plate, model, battery, connector, color, primary, created_at):
    conn.execute(
        """INSERT INTO vehicles
           (id, user_id, plate_no, model, battery_kwh, connector, color, is_primary, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)""",
        (vehicle_id, user_id, plate, model, battery, connector, color, primary, created_at),
    )


def _duration_minutes(start: datetime, end: datetime) -> int:
    return max(1, round((end - start).total_seconds() / 60))


def _fee_breakdown(price_per_hour: float, minutes: int, energy_kwh: float) -> tuple[float, float, float]:
    parking_fee = round(math.ceil(minutes / 30) * 0.5 * price_per_hour, 2)
    energy_fee = round(energy_kwh * 1.5, 2)
    return parking_fee, energy_fee, round(parking_fee + energy_fee, 2)


def _completed_record(
    conn,
    user_id,
    vehicle_id,
    slot,
    start,
    end,
    energy,
    created_at,
):
    minutes = _duration_minutes(start, end)
    parking_fee, energy_fee, total_fee = _fee_breakdown(slot["price"], minutes, energy)
    conn.execute(
        """INSERT INTO parking_records
           (user_id, vehicle_id, slot_id, reservation_id, started_at, ended_at,
            energy_kwh, parking_fee, energy_fee, total_fee, status, created_at)
           VALUES (?, ?, ?, NULL, ?, ?, ?, ?, ?, ?, 'completed', ?)""",
        (
            user_id,
            vehicle_id,
            slot["id"],
            iso(start),
            iso(end),
            round(energy, 2),
            parking_fee,
            energy_fee,
            total_fee,
            created_at,
        ),
    )


def _demo_refs(conn: sqlite3.Connection) -> tuple[dict[str, int], dict[str, int], dict[str, dict]]:
    users = {
        row["email"]: row["id"]
        for row in conn.execute(
            "SELECT id, email FROM users WHERE email IN (?, ?, ?, ?)", DEMO_EMAILS
        )
    }
    vehicle_rows = (
        conn.execute(
            "SELECT id, plate_no FROM vehicles WHERE user_id IN (?, ?, ?, ?) AND is_active = 1",
            tuple(users.values()),
        ).fetchall()
        if users
        else []
    )
    vehicles = {row["plate_no"]: row["id"] for row in vehicle_rows}
    slots = {
        row["code"]: {"id": row["id"], "price": row["price_per_hour"]}
        for row in conn.execute("SELECT id, code, price_per_hour FROM slots")
    }
    return users, vehicles, slots


def _seed_demo_activity(conn: sqlite3.Connection, now: datetime) -> bool:
    """(Re)create the live-looking demo lot anchored at *now*.

    Only rows owned by the seeded demo accounts are written; real accounts keep
    their data untouched. Returns False when the fixtures are not present.
    """
    users, vehicles, slots = _demo_refs(conn)
    required = {
        "demo": "demo@evpark.cn",
        "chen": "chen@evpark.cn",
        "zhou": "zhou@evpark.cn",
        "gu": "gu@evpark.cn",
    }
    if any(email not in users for email in required.values()):
        return False
    if any(code not in slots for code in ("A-03", "B-04", "C-06", "B-02", "B-06", "A-05", "B-07")):
        return False

    demo_id = users[required["demo"]]
    chen_id = users[required["chen"]]
    zhou_id = users[required["zhou"]]
    gu_id = users[required["gu"]]

    plates = {
        "demo_primary": "沪A·D88521",
        "demo_second": "沪A·F20917",
        "chen_primary": "沪B·C66102",
        "chen_second": "苏E·D01288",
        "zhou_primary": "浙A·F77120",
        "gu_primary": "沪D·E33210",
    }
    if any(plate not in vehicles for plate in plates.values()):
        return False
    vid = {key: vehicles[plate] for key, plate in plates.items()}

    stamp = iso(now)

    # Cars currently charging / parked – one belongs to the demo account.
    active = [
        (demo_id, vid["demo_primary"], "A-03", now - timedelta(minutes=42)),
        (chen_id, vid["chen_primary"], "B-04", now - timedelta(minutes=76)),
        (zhou_id, vid["zhou_primary"], "C-06", now - timedelta(minutes=23)),
    ]
    for user_id, vehicle_id, code, start in active:
        conn.execute(
            """INSERT INTO parking_records
               (user_id, vehicle_id, slot_id, reservation_id, started_at, ended_at,
                energy_kwh, parking_fee, energy_fee, total_fee, status, created_at)
               VALUES (?, ?, ?, NULL, ?, NULL, 0, 0, 0, 0, 'active', ?)""",
            (user_id, vehicle_id, slots[code]["id"], iso(start), iso(start)),
        )

    # A booking that is live right now, plus future bookings.
    local_now = now.astimezone(SHANGHAI)
    tomorrow_14 = (local_now + timedelta(days=1)).replace(hour=14, minute=30, second=0, microsecond=0)
    day_after_10 = (local_now + timedelta(days=2)).replace(hour=10, minute=0, second=0, microsecond=0)
    reservations = [
        (gu_id, vid["gu_primary"], "B-02", now - timedelta(minutes=8), now + timedelta(minutes=52), "reserved"),
        (demo_id, vid["demo_primary"], "B-06", tomorrow_14, tomorrow_14 + timedelta(minutes=90), "reserved"),
        (chen_id, vid["chen_primary"], "A-05", tomorrow_14 + timedelta(minutes=30), tomorrow_14 + timedelta(minutes=90), "reserved"),
        (gu_id, vid["gu_primary"], "B-07", day_after_10, day_after_10 + timedelta(hours=2), "reserved"),
    ]
    for user_id, vehicle_id, code, start, end, status in reservations:
        conn.execute(
            """INSERT INTO reservations
               (user_id, vehicle_id, slot_id, start_at, end_at, status, note, created_at)
               VALUES (?, ?, ?, ?, ?, ?, '', ?)""",
            (user_id, vehicle_id, slots[code]["id"], iso(start), iso(end), status, stamp),
        )

    # Completed charging/parking history for the demo account and the wider lot.
    history = [
        (demo_id, vid["demo_primary"], "A-01", now - timedelta(days=1, hours=4), 26, 22.6),
        (demo_id, vid["demo_primary"], "B-01", now - timedelta(days=2, hours=6), 88, 4.1),
        (demo_id, vid["demo_second"], "C-05", now - timedelta(days=3, hours=2), 72, 0),
        (demo_id, vid["demo_primary"], "A-05", now - timedelta(days=5, hours=8), 48, 33.8),
        (demo_id, vid["demo_primary"], "B-03", now - timedelta(days=9, hours=3), 125, 7.2),
        (demo_id, vid["demo_primary"], "C-02", now - timedelta(days=16, hours=5), 180, 0),
        (chen_id, vid["chen_primary"], "A-07", now - timedelta(days=1, hours=9), 34, 27.3),
        (chen_id, vid["chen_second"], "B-05", now - timedelta(days=4, hours=1), 96, 5.8),
        (gu_id, vid["gu_primary"], "A-04", now - timedelta(days=6, hours=7), 41, 31.7),
    ]
    for user_id, vehicle_id, code, start, minutes, energy in history:
        end = start + timedelta(minutes=minutes)
        _completed_record(conn, user_id, vehicle_id, slots[code], start, end, energy, iso(start))

    return True


def seed_database(conn: sqlite3.Connection) -> None:
    """Create the schema fixtures and a believable demo lot on first run."""
    if conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]:
        return

    now = utcnow()
    stamp = iso(now)

    # Five seeded accounts make the map feel alive. Only the first two are documented.
    _insert_user(conn, 1, "林晓", "demo@evpark.cn", "Demo1234", "user", "#C8F96A", stamp)
    _insert_user(conn, 2, "运营管理员", "admin@evpark.cn", "Admin1234", "admin", "#FFCF7A", stamp)
    _insert_user(conn, 3, "陈默", "chen@evpark.cn", "Hidden1234", "user", "#8FD9C6", stamp)
    _insert_user(conn, 4, "周远", "zhou@evpark.cn", "Hidden1234", "user", "#A8C4FF", stamp)
    _insert_user(conn, 5, "顾言", "gu@evpark.cn", "Hidden1234", "user", "#F3B7A5", stamp)

    _insert_vehicle(conn, 1, 1, "沪A·D88521", "小鹏 G6", 66.0, "国标直流", "#24352F", 1, stamp)
    _insert_vehicle(conn, 2, 1, "沪A·F20917", "五菱缤果", 37.9, "国标交流", "#F1E5D5", 0, stamp)
    _insert_vehicle(conn, 3, 3, "沪B·C66102", "特斯拉 Model 3", 60.0, "国标直流", "#E8ECF1", 1, stamp)
    _insert_vehicle(conn, 4, 3, "苏E·D01288", "比亚迪 海豹", 82.5, "国标直流", "#B8D7EF", 0, stamp)
    _insert_vehicle(conn, 5, 4, "浙A·F77120", "极氪 001", 100.0, "国标直流", "#D8D1C3", 1, stamp)
    _insert_vehicle(conn, 6, 5, "沪D·E33210", "蔚来 ET5", 75.0, "国标直流", "#C8D6CF", 1, stamp)

    zone_meta = {
        "A": ("极速快充区", "dc", 120.0, "国标直流", 6.0),
        "B": ("智能慢充区", "ac", 7.0, "国标交流", 4.0),
        "C": ("标准停车区", "parking", 0.0, "—", 2.0),
    }
    slot_id = 1
    for zone in ("A", "B", "C"):
        title, kind, power, connector, price = zone_meta[zone]
        for index in range(1, 9):
            code = f"{zone}-{index:02d}"
            conn.execute(
                """INSERT INTO slots
                   (id, code, zone, level, kind, power_kw, connector, price_per_hour, status, sort_order)
                   VALUES (?, ?, ?, 'B1', ?, ?, ?, ?, 'open', ?)""",
                (slot_id, code, zone, kind, power, connector, price, slot_id),
            )
            slot_id += 1

    # Make maintenance visible in the live map.
    conn.execute("UPDATE slots SET status = 'maintenance' WHERE code IN ('B-08', 'C-08')")

    _seed_demo_activity(conn, now)
    conn.commit()


def ensure_demo_freshness(conn: sqlite3.Connection, now: datetime | None = None) -> bool:
    """Refresh the seeded demo lot when it has been idle for a long time.

    Real registrations are never modified. Returns True when the demo data was
    rebuilt.
    """
    now = now or utcnow()
    demo_ids = [
        row["id"] for row in conn.execute(
            "SELECT id FROM users WHERE email IN (?, ?, ?, ?)", DEMO_EMAILS
        )
    ]
    if not demo_ids:
        return False

    params = tuple(demo_ids)
    placeholders = ", ".join("?" for _ in demo_ids)
    # A future booking or an ongoing session means the demo account is in use;
    # never pull the rug from under it.
    if conn.execute(
        f"""SELECT 1 FROM reservations
            WHERE user_id IN ({placeholders})
              AND status = 'reserved' AND end_at > ? LIMIT 1""",
        params + (iso(now),),
    ).fetchone():
        return False
    if conn.execute(
        f"""SELECT 1 FROM parking_records
            WHERE user_id IN ({placeholders})
              AND ended_at IS NULL AND started_at >= ? LIMIT 1""",
        params + (iso(now - timedelta(hours=MAX_SESSION_HOURS)),),
    ).fetchone():
        return False

    marks = placeholders
    row = conn.execute(
        f"""SELECT MAX(mark) FROM (
               SELECT MAX(started_at) AS mark FROM parking_records WHERE user_id IN ({marks})
               UNION ALL
               SELECT MAX(created_at) AS mark FROM reservations WHERE user_id IN ({marks})
            )""",
        params * 2,
    ).fetchone()
    latest = row[0]
    if latest and parse_iso(latest) >= now - timedelta(hours=DEMO_FRESH_HOURS):
        return False

    conn.execute(f"DELETE FROM parking_records WHERE user_id IN ({marks})", params)
    conn.execute(f"DELETE FROM reservations WHERE user_id IN ({marks})", params)
    if not _seed_demo_activity(conn, now):
        conn.rollback()
        return False
    conn.commit()
    return True


def settle_stale_sessions(conn: sqlite3.Connection, now: datetime | None = None) -> int:
    """Close sessions that stayed open past MAX_SESSION_HOURS and cap their fees."""
    now = now or utcnow()
    cutoff = iso(now - timedelta(hours=MAX_SESSION_HOURS))
    rows = conn.execute(
        """SELECT p.id, p.started_at, s.power_kw, s.price_per_hour, v.battery_kwh
           FROM parking_records p
           JOIN slots s ON s.id = p.slot_id
           JOIN vehicles v ON v.id = p.vehicle_id
           WHERE p.ended_at IS NULL AND p.started_at < ?""",
        (cutoff,),
    ).fetchall()
    if not rows:
        return 0

    for row in rows:
        start = parse_iso(row["started_at"])
        end = start + timedelta(hours=MAX_SESSION_HOURS)
        minutes = MAX_SESSION_HOURS * 60
        power = float(row["power_kw"] or 0)
        battery = float(row["battery_kwh"] or 60)
        energy = round(min(MAX_SESSION_HOURS * power * 0.55, battery * 0.8), 2) if power else 0.0
        parking_fee, energy_fee, total_fee = _fee_breakdown(
            float(row["price_per_hour"] or 0), minutes, energy
        )
        conn.execute(
            """UPDATE parking_records
               SET ended_at = ?, energy_kwh = ?, parking_fee = ?, energy_fee = ?,
                   total_fee = ?, status = 'completed'
               WHERE id = ?""",
            (iso(end), energy, parking_fee, energy_fee, total_fee, row["id"]),
        )
    conn.commit()
    return len(rows)
