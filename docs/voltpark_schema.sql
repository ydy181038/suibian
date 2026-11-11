-- VoltPark 电动车智能停放系统 · SQLite 结构导出
-- 由 data/voltpark.db 自动导出，可直接在 sqlite3 / DB Browser for SQLite 中执行。
-- 说明：应用启动时会自动创建同样的结构（见 db.py 的 SCHEMA），此文件用于查看与迁移。

PRAGMA foreign_keys = ON;

-- table: users
CREATE TABLE users (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    name            TEXT NOT NULL,
    email           TEXT NOT NULL COLLATE NOCASE UNIQUE,
    password_hash   TEXT NOT NULL,
    role            TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin')),
    avatar_color    TEXT NOT NULL DEFAULT '#C8F96A',
    created_at      TEXT NOT NULL
);

-- table: auth_sessions
CREATE TABLE auth_sessions (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    token_hash      TEXT NOT NULL UNIQUE,
    user_id         INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at      TEXT NOT NULL,
    expires_at      TEXT NOT NULL
);

-- table: vehicles
CREATE TABLE vehicles (
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

-- table: slots
CREATE TABLE slots (
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

-- table: reservations
CREATE TABLE reservations (
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

-- table: parking_records
CREATE TABLE parking_records (
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

-- index: idx_auth_sessions_expiry
CREATE INDEX idx_auth_sessions_expiry ON auth_sessions(expires_at);

-- index: idx_auth_sessions_user
CREATE INDEX idx_auth_sessions_user ON auth_sessions(user_id);

-- index: idx_parking_active_slot
CREATE UNIQUE INDEX idx_parking_active_slot
    ON parking_records(slot_id) WHERE ended_at IS NULL;

-- index: idx_parking_active_user
CREATE UNIQUE INDEX idx_parking_active_user
    ON parking_records(user_id) WHERE ended_at IS NULL;

-- index: idx_parking_slot
CREATE INDEX idx_parking_slot ON parking_records(slot_id, ended_at);

-- index: idx_parking_user
CREATE INDEX idx_parking_user ON parking_records(user_id, started_at);

-- index: idx_reservations_slot_time
CREATE INDEX idx_reservations_slot_time ON reservations(slot_id, start_at, end_at);

-- index: idx_reservations_user
CREATE INDEX idx_reservations_user ON reservations(user_id, start_at);

-- index: idx_vehicles_active_plate
CREATE UNIQUE INDEX idx_vehicles_active_plate
    ON vehicles(user_id, plate_no) WHERE is_active = 1;

-- index: idx_vehicles_user
CREATE INDEX idx_vehicles_user ON vehicles(user_id);
