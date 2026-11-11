#!/usr/bin/env python3
"""VoltPark · 电动车智能停放系统

A dependency-free local web application: Python's standard library HTTP server,
SQLite storage, cookie sessions and a static single-page frontend.
"""

from __future__ import annotations

import argparse
import json
import math
import mimetypes
import os
import re
import sqlite3
import sys
import threading
import time
import traceback
from collections import defaultdict, deque
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit

import db as database
from security import (
    hash_password,
    new_session_token,
    token_fingerprint,
    validate_email,
    validate_password,
    verify_password,
)

BASE_DIR = Path(__file__).resolve().parent
STATIC_DIR = BASE_DIR / "static"
SESSION_COOKIE = "voltpark_session"
SESSION_DAYS = 7
SHANGHAI = timezone(timedelta(hours=8))
ENERGY_SERVICE_RATE = 1.5
CHECKIN_EARLY_MINUTES = 15
MAX_RESERVATION_DAYS = 30
MAX_JSON_BYTES = 1_000_000

ZONE_META = {
    "A": {
        "name": "极速快充区",
        "short": "A 区",
        "kind": "dc",
        "tagline": "120 kW 直流快充",
        "color": "lime",
    },
    "B": {
        "name": "智能慢充区",
        "short": "B 区",
        "kind": "ac",
        "tagline": "7 kW 交流慢充",
        "color": "teal",
    },
    "C": {
        "name": "标准停车区",
        "short": "C 区",
        "kind": "parking",
        "tagline": "灵活短停 · 经济之选",
        "color": "sand",
    },
}

KIND_LABELS = {"dc": "直流快充", "ac": "交流慢充", "parking": "标准车位"}


# ---------------------------------------------------------------------------
# Time and formatting helpers
# ---------------------------------------------------------------------------


def utcnow() -> datetime:
    return datetime.now(timezone.utc).replace(microsecond=0)


def iso(moment: datetime) -> str:
    return moment.astimezone(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def parse_time(value: str | None) -> datetime:
    if not value:
        raise ApiError(400, "缺少时间参数")
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        raise ApiError(400, "时间格式不正确")
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=SHANGHAI)
    return parsed.astimezone(timezone.utc)


def money(value: float) -> float:
    return round(float(value or 0) + 1e-9, 2)


def mask_plate(plate: str) -> str:
    if not plate:
        return "—"
    if len(plate) <= 3:
        return plate[0] + "***"
    return plate[:3] + "***" + plate[-1:]


def clean_text(value, *, field_name: str, min_len=1, max_len=80) -> str:
    if not isinstance(value, str):
        raise ApiError(400, f"请填写{field_name}")
    text = value.strip()
    if len(text) < min_len:
        raise ApiError(400, f"{field_name}至少需要 {min_len} 个字符")
    if len(text) > max_len:
        raise ApiError(400, f"{field_name}不能超过 {max_len} 个字符")
    return text


def positive_int(value, *, field_name: str, minimum=1, maximum=100000) -> int:
    try:
        number = int(value)
    except (TypeError, ValueError):
        raise ApiError(400, f"{field_name}格式不正确")
    if not minimum <= number <= maximum:
        raise ApiError(400, f"{field_name}超出范围")
    return number


# ---------------------------------------------------------------------------
# Views / serializers
# ---------------------------------------------------------------------------


def user_view(row: sqlite3.Row | dict) -> dict:
    return {
        "id": row["id"],
        "name": row["name"],
        "email": row["email"],
        "role": row["role"],
        "avatarColor": row["avatar_color"],
        "createdAt": row["created_at"],
    }


def vehicle_view(row: sqlite3.Row | dict) -> dict:
    return {
        "id": row["id"],
        "plate": row["plate_no"],
        "model": row["model"],
        "batteryKwh": row["battery_kwh"],
        "connector": row["connector"],
        "color": row["color"],
        "isPrimary": bool(row["is_primary"]),
        "createdAt": row["created_at"],
    }


def reservation_view(row: sqlite3.Row | dict, now: datetime) -> dict:
    start = parse_time(row["start_at"])
    end = parse_time(row["end_at"])
    status = row["status"]
    can_check_in = (
        status == "reserved"
        and start - timedelta(minutes=CHECKIN_EARLY_MINUTES) <= now < end
    )
    return {
        "id": row["id"],
        "status": status,
        "startAt": row["start_at"],
        "endAt": row["end_at"],
        "createdAt": row["created_at"],
        "note": row["note"],
        "durationMinutes": max(1, round((end - start).total_seconds() / 60)),
        "canCheckIn": can_check_in,
        "canCancel": status == "reserved" and end > now,
        "slot": {
            "id": row["slot_id"],
            "code": row["slot_code"],
            "zone": row["slot_zone"],
            "kind": row["slot_kind"],
            "powerKw": row["slot_power"],
            "pricePerHour": row["slot_price"],
        },
        "vehicle": {
            "id": row["vehicle_id"],
            "plate": row["plate_no"],
            "model": row["vehicle_model"],
            "batteryKwh": row["battery_kwh"],
        },
    }


SESSION_SELECT = """
    SELECT p.id AS record_id, p.status, p.started_at, p.ended_at, p.energy_kwh,
           p.parking_fee, p.energy_fee, p.total_fee, p.reservation_id,
           s.id AS slot_id, s.code AS slot_code, s.zone AS slot_zone, s.level AS slot_level,
           s.kind AS slot_kind, s.power_kw, s.price_per_hour,
           v.id AS vehicle_id, v.plate_no, v.model AS vehicle_model, v.battery_kwh,
           v.connector, v.color AS vehicle_color
    FROM parking_records p
    JOIN slots s ON s.id = p.slot_id
    JOIN vehicles v ON v.id = p.vehicle_id
"""


def session_view(row: sqlite3.Row | dict, now: datetime) -> dict:
    start = parse_time(row["started_at"])
    active = row["status"] == "active"
    end = now if active else parse_time(row["ended_at"])
    minutes = max(1, round((end - start).total_seconds() / 60))
    power = float(row["power_kw"] or 0)
    price = float(row["price_per_hour"] or 0)
    battery = float(row["battery_kwh"] or 60)

    if active:
        raw_energy = (minutes / 60) * power * 0.55 if power else 0
        energy = round(min(raw_energy, battery * 0.8), 2)
        parking_fee = money(math.ceil(minutes / 30) * 0.5 * price)
        energy_fee = money(energy * ENERGY_SERVICE_RATE)
        total_fee = money(parking_fee + energy_fee)
    else:
        energy = round(float(row["energy_kwh"] or 0), 2)
        parking_fee = money(row["parking_fee"])
        energy_fee = money(row["energy_fee"])
        total_fee = money(row["total_fee"])

    progress = 0
    if battery > 0:
        progress = min(99, round(energy / (battery * 0.8) * 100))

    return {
        "id": row["record_id"],
        "status": row["status"],
        "startedAt": row["started_at"],
        "endedAt": row["ended_at"],
        "energyKwh": energy,
        "parkingFee": parking_fee,
        "energyFee": energy_fee,
        "totalFee": total_fee,
        "durationMinutes": minutes,
        "batteryGainPercent": round(energy / battery * 100, 1) if battery else 0,
        "progressPercent": progress,
        "powerKw": power,
        "slot": {
            "id": row["slot_id"],
            "code": row["slot_code"],
            "zone": row["slot_zone"],
            "level": row["slot_level"],
            "kind": row["slot_kind"],
            "powerKw": power,
            "pricePerHour": price,
        },
        "vehicle": {
            "id": row["vehicle_id"],
            "plate": row["plate_no"],
            "model": row["vehicle_model"],
            "batteryKwh": battery,
            "connector": row["connector"],
            "color": row["vehicle_color"],
        },
    }


def get_active_session(conn: sqlite3.Connection, user_id: int, now: datetime) -> dict | None:
    row = conn.execute(
        SESSION_SELECT + " WHERE p.user_id = ? AND p.ended_at IS NULL LIMIT 1",
        (user_id,),
    ).fetchone()
    return session_view(row, now) if row else None


def expire_reservations(conn: sqlite3.Connection, now: datetime) -> None:
    conn.execute(
        """UPDATE reservations SET status = 'expired'
           WHERE status = 'reserved' AND end_at < ?""",
        (iso(now),),
    )


def load_slot_map(
    conn: sqlite3.Connection, user_id: int, now: datetime
) -> tuple[list[dict], list[dict]]:
    """Return the live slot list plus aggregate zone information."""
    now_iso = iso(now)
    soon_iso = iso(now + timedelta(minutes=CHECKIN_EARLY_MINUTES))

    active_rows = conn.execute(
        """SELECT p.*, v.plate_no, v.model AS vehicle_model
           FROM parking_records p JOIN vehicles v ON v.id = p.vehicle_id
           WHERE p.ended_at IS NULL"""
    ).fetchall()
    active_by_slot = {row["slot_id"]: row for row in active_rows}

    current_rows = conn.execute(
        """SELECT r.*, v.plate_no
           FROM reservations r JOIN vehicles v ON v.id = r.vehicle_id
           WHERE r.status IN ('reserved', 'active')
             AND r.start_at <= ? AND r.end_at > ?
           ORDER BY r.start_at""",
        (soon_iso, now_iso),
    ).fetchall()
    current_by_slot = {row["slot_id"]: row for row in current_rows}

    upcoming_rows = conn.execute(
        """SELECT slot_id, COUNT(*) AS total
           FROM reservations
           WHERE status = 'reserved' AND start_at > ?
           GROUP BY slot_id""",
        (now_iso,),
    ).fetchall()
    upcoming_count = {row["slot_id"]: row["total"] for row in upcoming_rows}

    own_upcoming_rows = conn.execute(
        """SELECT * FROM reservations
           WHERE user_id = ? AND status = 'reserved' AND end_at > ?
           ORDER BY start_at""",
        (user_id, now_iso),
    ).fetchall()
    own_upcoming: dict[int, sqlite3.Row] = {}
    for row in own_upcoming_rows:
        own_upcoming.setdefault(row["slot_id"], row)

    slots = []
    for row in conn.execute("SELECT * FROM slots ORDER BY sort_order").fetchall():
        active = active_by_slot.get(row["id"])
        current_res = current_by_slot.get(row["id"])
        state = "available"
        occupant = None
        reservation = None

        if row["status"] == "maintenance":
            state = "maintenance"
        elif active:
            state = "charging" if row["power_kw"] else "occupied"
            is_mine = active["user_id"] == user_id
            occupant = {
                "isMine": is_mine,
                "plate": active["plate_no"] if is_mine else mask_plate(active["plate_no"]),
                "startedAt": active["started_at"],
                "elapsedMinutes": max(
                    1, round((now - parse_time(active["started_at"])).total_seconds() / 60)
                ),
            }
        elif current_res:
            state = "reserved"
            is_mine = current_res["user_id"] == user_id
            reservation = {
                "id": current_res["id"],
                "isMine": is_mine,
                "startAt": current_res["start_at"],
                "endAt": current_res["end_at"],
                "status": current_res["status"],
            }

        own_next = own_upcoming.get(row["id"])
        next_booking = None
        if own_next and (not current_res or own_next["id"] != current_res["id"]):
            next_booking = {
                "id": own_next["id"],
                "startAt": own_next["start_at"],
                "endAt": own_next["end_at"],
                "status": own_next["status"],
            }

        slots.append(
            {
                "id": row["id"],
                "code": row["code"],
                "zone": row["zone"],
                "zoneName": ZONE_META[row["zone"]]["name"],
                "level": row["level"],
                "kind": row["kind"],
                "kindLabel": KIND_LABELS[row["kind"]],
                "powerKw": row["power_kw"],
                "connector": row["connector"],
                "pricePerHour": row["price_per_hour"],
                "state": state,
                "maintenance": row["status"] == "maintenance",
                "isMine": bool(occupant and occupant["isMine"]),
                "occupant": occupant,
                "reservation": reservation,
                "nextBooking": next_booking,
                "upcomingCount": upcoming_count.get(row["id"], 0),
            }
        )

    zones = []
    for zone_id, meta in ZONE_META.items():
        zone_slots = [slot for slot in slots if slot["zone"] == zone_id]
        zones.append(
            {
                "id": zone_id,
                **meta,
                "total": len(zone_slots),
                "available": sum(1 for slot in zone_slots if slot["state"] == "available"),
                "occupied": sum(
                    1 for slot in zone_slots if slot["state"] in ("occupied", "charging")
                ),
                "reserved": sum(1 for slot in zone_slots if slot["state"] == "reserved"),
                "maintenance": sum(1 for slot in zone_slots if slot["state"] == "maintenance"),
            }
        )
    return slots, zones


def upcoming_reservation_row(
    conn: sqlite3.Connection, user_id: int, now: datetime
) -> sqlite3.Row | None:
    return conn.execute(
        """SELECT r.*, s.code AS slot_code, s.zone AS slot_zone, s.kind AS slot_kind,
                  s.power_kw AS slot_power, s.price_per_hour AS slot_price,
                  v.plate_no, v.model AS vehicle_model, v.battery_kwh
           FROM reservations r
           JOIN slots s ON s.id = r.slot_id
           JOIN vehicles v ON v.id = r.vehicle_id
           WHERE r.user_id = ? AND r.status = 'reserved' AND r.end_at > ?
           ORDER BY r.start_at ASC LIMIT 1""",
        (user_id, iso(now)),
    ).fetchone()


def month_summary(conn: sqlite3.Connection, user_id: int, now: datetime) -> dict:
    local_now = now.astimezone(SHANGHAI)
    month_start = datetime(
        local_now.year, local_now.month, 1, tzinfo=SHANGHAI
    ).astimezone(timezone.utc)
    row = conn.execute(
        """SELECT COUNT(*) AS sessions, COALESCE(SUM(energy_kwh), 0) AS energy,
                  COALESCE(SUM(total_fee), 0) AS spend
           FROM parking_records
           WHERE user_id = ? AND status = 'completed' AND started_at >= ?""",
        (user_id, iso(month_start)),
    ).fetchone()
    return {
        "sessions": row["sessions"],
        "energy": round(row["energy"], 2),
        "spend": money(row["spend"]),
    }


def weekly_energy(conn: sqlite3.Connection, user_id: int, now: datetime) -> list[dict]:
    local_now = now.astimezone(SHANGHAI)
    today = local_now.date()
    first_day = today - timedelta(days=6)
    first_dt = datetime(
        first_day.year, first_day.month, first_day.day, tzinfo=SHANGHAI
    ).astimezone(timezone.utc)
    rows = conn.execute(
        """SELECT started_at, energy_kwh, total_fee FROM parking_records
           WHERE user_id = ? AND status = 'completed' AND started_at >= ?""",
        (user_id, iso(first_dt)),
    ).fetchall()
    buckets = {
        (first_day + timedelta(days=offset)): {"energy": 0.0, "spend": 0.0}
        for offset in range(7)
    }
    weekday_names = ["周一", "周二", "周三", "周四", "周五", "周六", "周日"]
    for row in rows:
        local_date = parse_time(row["started_at"]).astimezone(SHANGHAI).date()
        if local_date in buckets:
            buckets[local_date]["energy"] += float(row["energy_kwh"] or 0)
            buckets[local_date]["spend"] += float(row["total_fee"] or 0)
    points = []
    for date_value, values in buckets.items():
        points.append(
            {
                "date": date_value.isoformat(),
                "label": weekday_names[date_value.weekday()],
                "day": f"{date_value.month}/{date_value.day}",
                "energy": round(values["energy"], 2),
                "spend": money(values["spend"]),
                "isToday": date_value == today,
            }
        )
    return points


def recent_activity(
    conn: sqlite3.Connection, user_id: int, now: datetime, active: dict | None
) -> list[dict]:
    items: list[dict] = []
    if active:
        items.append(
            {
                "kind": "charging" if active["powerKw"] else "parking",
                "title": f"正在 {active['slot']['code']} 充电"
                if active["powerKw"]
                else f"正在 {active['slot']['code']} 停车",
                "description": f"{active['vehicle']['plate']} · 已进行 {active['durationMinutes']} 分钟",
                "time": active["startedAt"],
                "sort": parse_time(active["startedAt"]).timestamp(),
            }
        )

    completed = conn.execute(
        SESSION_SELECT
        + """ WHERE p.user_id = ? AND p.status = 'completed'
              ORDER BY p.started_at DESC LIMIT 3""",
        (user_id,),
    ).fetchall()
    for row in completed:
        view = session_view(row, now)
        items.append(
            {
                "kind": "completed",
                "title": f"{view['slot']['code']} "
                + ("充电完成" if view["powerKw"] else "停车完成"),
                "description": f"{view['energyKwh']} kWh · ¥{view['totalFee']:.2f}"
                if view["powerKw"]
                else f"{view['durationMinutes']} 分钟 · ¥{view['totalFee']:.2f}",
                "time": view["endedAt"],
                "sort": parse_time(view["endedAt"]).timestamp(),
            }
        )

    upcoming = conn.execute(
        """SELECT r.*, s.code AS slot_code, s.zone AS slot_zone, s.kind AS slot_kind,
                  s.power_kw AS slot_power, s.price_per_hour AS slot_price,
                  v.plate_no, v.model AS vehicle_model, v.battery_kwh
           FROM reservations r
           JOIN slots s ON s.id = r.slot_id
           JOIN vehicles v ON v.id = r.vehicle_id
           WHERE r.user_id = ? AND r.status = 'reserved' AND r.end_at > ?
           ORDER BY r.start_at ASC LIMIT 2""",
        (user_id, iso(now)),
    ).fetchall()
    for row in upcoming:
        res = reservation_view(row, now)
        items.append(
            {
                "kind": "reservation",
                "title": f"已预约 {res['slot']['code']} 车位",
                "description": f"{res['vehicle']['plate']} · {res['durationMinutes']} 分钟",
                "time": res["startAt"],
                "sort": parse_time(res["createdAt"]).timestamp() + 0.1,
            }
        )
    items.sort(key=lambda item: item["sort"], reverse=True)
    for item in items:
        item.pop("sort", None)
    return items[:5]


# ---------------------------------------------------------------------------
# API context / errors
# ---------------------------------------------------------------------------


class ApiError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status
        self.message = message


@dataclass
class Context:
    handler: "AppHandler"
    conn: sqlite3.Connection
    method: str
    path: str
    query: dict
    body: dict
    user: dict | None
    pending_cookies: list[str] = field(default_factory=list)

    def queue_cookie(self, cookie: str) -> None:
        self.pending_cookies.append(cookie)


def require_user(ctx: Context) -> dict:
    if not ctx.user:
        raise ApiError(401, "登录状态已失效，请重新登录")
    return ctx.user


def require_admin(ctx: Context) -> dict:
    user = require_user(ctx)
    if user["role"] != "admin":
        raise ApiError(403, "仅运营管理员可以访问该功能")
    return user


def current_user(conn: sqlite3.Connection, token: str | None) -> dict | None:
    if not token:
        return None
    row = conn.execute(
        """SELECT u.* FROM auth_sessions a
           JOIN users u ON u.id = a.user_id
           WHERE a.token_hash = ? AND a.expires_at > ?""",
        (token_fingerprint(token), iso(utcnow())),
    ).fetchone()
    return user_view(row) if row else None


def issue_session(conn: sqlite3.Connection, ctx: Context, user_id: int) -> None:
    token = new_session_token()
    now = utcnow()
    conn.execute(
        """INSERT INTO auth_sessions (token_hash, user_id, created_at, expires_at)
           VALUES (?, ?, ?, ?)""",
        (
            token_fingerprint(token),
            user_id,
            iso(now),
            iso(now + timedelta(days=SESSION_DAYS)),
        ),
    )
    conn.execute("DELETE FROM auth_sessions WHERE expires_at <= ?", (iso(now),))
    ctx.queue_cookie(
        f"{SESSION_COOKIE}={token}; Path=/; HttpOnly; SameSite=Strict; "
        f"Max-Age={SESSION_DAYS * 86400}"
    )


# ---------------------------------------------------------------------------
# Authentication API
# ---------------------------------------------------------------------------


def auth_login(ctx: Context) -> dict:
    email = str(ctx.body.get("email", "")).strip().lower()
    password = ctx.body.get("password", "")
    if not email or not isinstance(password, str) or not password:
        raise ApiError(400, "请输入邮箱和密码")
    if check_login_rate(ctx.handler.client_address[0]):
        raise ApiError(429, "尝试次数过多，请 10 分钟后再试")

    row = ctx.conn.execute("SELECT * FROM users WHERE email = ?", (email,)).fetchone()
    if not row or not verify_password(password, row["password_hash"]):
        record_login_failure(ctx.handler.client_address[0])
        raise ApiError(401, "邮箱或密码不正确")

    clear_login_failures(ctx.handler.client_address[0])
    issue_session(ctx.conn, ctx, row["id"])
    ctx.conn.commit()
    return {"user": user_view(row), "message": "登录成功"}


def auth_register(ctx: Context) -> dict:
    name = clean_text(ctx.body.get("name"), field_name="昵称", min_len=2, max_len=20)
    email = str(ctx.body.get("email", "")).strip().lower()
    password = ctx.body.get("password", "")

    if not validate_email(email):
        raise ApiError(400, "请输入有效的邮箱地址")
    password_error = validate_password(password)
    if password_error:
        raise ApiError(400, password_error)

    try:
        cursor = ctx.conn.execute(
            """INSERT INTO users (name, email, password_hash, role, avatar_color, created_at)
               VALUES (?, ?, ?, 'user', '#C8F96A', ?)""",
            (name, email, hash_password(password), iso(utcnow())),
        )
    except sqlite3.IntegrityError:
        raise ApiError(409, "该邮箱已注册，请直接登录")

    user_id = cursor.lastrowid
    issue_session(ctx.conn, ctx, user_id)
    ctx.conn.commit()
    row = ctx.conn.execute("SELECT * FROM users WHERE id = ?", (user_id,)).fetchone()
    return {"user": user_view(row), "message": "账号创建成功"}


def auth_logout(ctx: Context) -> dict:
    cookie = ctx.handler.cookie_value(SESSION_COOKIE)
    if cookie:
        ctx.conn.execute(
            "DELETE FROM auth_sessions WHERE token_hash = ?", (token_fingerprint(cookie),)
        )
        ctx.conn.commit()
    ctx.queue_cookie(f"{SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0")
    return {"message": "已安全退出"}


def auth_me(ctx: Context) -> dict:
    return {"authenticated": bool(ctx.user), "user": ctx.user}


# ---------------------------------------------------------------------------
# User-facing API
# ---------------------------------------------------------------------------


def get_slots(ctx: Context) -> dict:
    user = require_user(ctx)
    now = utcnow()
    slots, zones = load_slot_map(ctx.conn, user["id"], now)
    active = get_active_session(ctx.conn, user["id"], now)
    upcoming = upcoming_reservation_row(ctx.conn, user["id"], now)
    return {
        "slots": slots,
        "zones": zones,
        "activeSession": active,
        "upcomingReservation": reservation_view(upcoming, now) if upcoming else None,
        "updatedAt": iso(now),
    }


def get_dashboard(ctx: Context) -> dict:
    user = require_user(ctx)
    now = utcnow()
    expire_reservations(ctx.conn, now)
    ctx.conn.commit()
    slots, zones = load_slot_map(ctx.conn, user["id"], now)
    active = get_active_session(ctx.conn, user["id"], now)

    serviceable = [slot for slot in slots if not slot["maintenance"]]
    occupied = [slot for slot in slots if slot["state"] in ("occupied", "charging")]
    reserved = [slot for slot in slots if slot["state"] == "reserved"]
    available = [slot for slot in slots if slot["state"] == "available"]
    charging_slots = [slot for slot in serviceable if slot["kind"] in ("dc", "ac")]
    charging_free = [slot for slot in charging_slots if slot["state"] == "available"]
    month = month_summary(ctx.conn, user["id"], now)
    upcoming = upcoming_reservation_row(ctx.conn, user["id"], now)

    stats = {
        "totalSlots": len(slots),
        "serviceableSlots": len(serviceable),
        "available": len(available),
        "occupied": len(occupied),
        "reserved": len(reserved),
        "maintenance": len(slots) - len(serviceable),
        "occupancyRate": round((len(occupied) + len(reserved)) / max(1, len(serviceable)) * 100),
        "chargingTotal": len(charging_slots),
        "chargingFree": len(charging_free),
        "chargingNow": sum(1 for slot in occupied if slot["kind"] in ("dc", "ac")),
        "monthEnergy": month["energy"],
        "monthSpend": month["spend"],
        "monthSessions": month["sessions"],
        "savedCarbon": round(month["energy"] * 0.501, 1),
        "activePower": active["powerKw"] if active else 0,
    }

    recommendations = sorted(
        available,
        key=lambda slot: (
            0 if slot["kind"] == "dc" else 1 if slot["kind"] == "ac" else 2,
            slot["code"],
        ),
    )[:3]

    return {
        "user": user,
        "stats": stats,
        "zones": zones,
        "slots": slots,
        "activeSession": active,
        "upcomingReservation": reservation_view(upcoming, now) if upcoming else None,
        "weekly": weekly_energy(ctx.conn, user["id"], now),
        "activity": recent_activity(ctx.conn, user["id"], now, active),
        "recommendations": recommendations,
        "serverTime": iso(now),
    }


def get_vehicles(ctx: Context) -> dict:
    user = require_user(ctx)
    rows = ctx.conn.execute(
        """SELECT * FROM vehicles WHERE user_id = ? AND is_active = 1
           ORDER BY is_primary DESC, created_at ASC""",
        (user["id"],),
    ).fetchall()
    return {"vehicles": [vehicle_view(row) for row in rows]}


def normalize_plate(value) -> str:
    raw = str(value or "").upper().replace(" ", "")
    raw = re.sub(r"[·•.]", "", raw)
    if not re.fullmatch(r"[\u4e00-\u9fff][A-Z][A-Z0-9]{5,6}", raw):
        raise ApiError(400, "请输入正确的车牌号，例如 沪A·D88521")
    return raw[:2] + "·" + raw[2:]


def create_vehicle(ctx: Context) -> dict:
    user = require_user(ctx)
    count = ctx.conn.execute(
        "SELECT COUNT(*) FROM vehicles WHERE user_id = ? AND is_active = 1", (user["id"],)
    ).fetchone()[0]
    if count >= 5:
        raise ApiError(409, "每个账号最多绑定 5 辆爱车")

    plate = normalize_plate(ctx.body.get("plate"))
    model = clean_text(ctx.body.get("model"), field_name="车型", min_len=2, max_len=40)
    try:
        battery = float(ctx.body.get("batteryKwh", 60))
    except (TypeError, ValueError):
        raise ApiError(400, "电池容量格式不正确")
    if not 10 <= battery <= 200:
        raise ApiError(400, "电池容量需在 10–200 kWh 之间")
    connector = ctx.body.get("connector", "国标直流")
    if connector not in ("国标直流", "国标交流"):
        raise ApiError(400, "请选择充电接口")
    is_primary = 1 if count == 0 or ctx.body.get("isPrimary") else 0
    if is_primary:
        ctx.conn.execute(
            "UPDATE vehicles SET is_primary = 0 WHERE user_id = ? AND is_active = 1",
            (user["id"],),
        )

    try:
        cursor = ctx.conn.execute(
            """INSERT INTO vehicles
               (user_id, plate_no, model, battery_kwh, connector, color, is_primary, created_at)
               VALUES (?, ?, ?, ?, ?, ?, ?, ?)""",
            (
                user["id"],
                plate,
                model,
                battery,
                connector,
                "#DFE8DF",
                is_primary,
                iso(utcnow()),
            ),
        )
    except sqlite3.IntegrityError:
        raise ApiError(409, "这辆车已经绑定过了")
    ctx.conn.commit()
    row = ctx.conn.execute("SELECT * FROM vehicles WHERE id = ?", (cursor.lastrowid,)).fetchone()
    return {"vehicle": vehicle_view(row), "message": "爱车已绑定"}


def delete_vehicle(ctx: Context, vehicle_id: int) -> dict:
    user = require_user(ctx)
    row = ctx.conn.execute(
        "SELECT * FROM vehicles WHERE id = ? AND user_id = ? AND is_active = 1",
        (vehicle_id, user["id"]),
    ).fetchone()
    if not row:
        raise ApiError(404, "未找到这辆车")
    active = ctx.conn.execute(
        "SELECT 1 FROM parking_records WHERE vehicle_id = ? AND ended_at IS NULL", (vehicle_id,)
    ).fetchone()
    upcoming = ctx.conn.execute(
        """SELECT 1 FROM reservations WHERE vehicle_id = ?
           AND status IN ('reserved', 'active')""",
        (vehicle_id,),
    ).fetchone()
    if active or upcoming:
        raise ApiError(409, "该车辆有进行中的停车或预约，暂时不能解绑")
    # Archive instead of deleting so historical bills stay readable.
    ctx.conn.execute(
        "UPDATE vehicles SET is_active = 0, is_primary = 0 WHERE id = ?", (vehicle_id,)
    )
    if row["is_primary"]:
        replacement = ctx.conn.execute(
            """SELECT id FROM vehicles WHERE user_id = ? AND is_active = 1
               ORDER BY created_at LIMIT 1""",
            (user["id"],),
        ).fetchone()
        if replacement:
            ctx.conn.execute(
                "UPDATE vehicles SET is_primary = 1 WHERE id = ?", (replacement["id"],)
            )
    ctx.conn.commit()
    return {"message": "已解绑该车辆"}


def set_primary_vehicle(ctx: Context, vehicle_id: int) -> dict:
    user = require_user(ctx)
    row = ctx.conn.execute(
        "SELECT id FROM vehicles WHERE id = ? AND user_id = ? AND is_active = 1",
        (vehicle_id, user["id"]),
    ).fetchone()
    if not row:
        raise ApiError(404, "未找到这辆车")
    ctx.conn.execute(
        "UPDATE vehicles SET is_primary = 0 WHERE user_id = ? AND is_active = 1",
        (user["id"],),
    )
    ctx.conn.execute("UPDATE vehicles SET is_primary = 1 WHERE id = ?", (vehicle_id,))
    ctx.conn.commit()
    return {"message": "已设为默认车辆"}


def get_reservations(ctx: Context) -> dict:
    user = require_user(ctx)
    now = utcnow()
    expire_reservations(ctx.conn, now)
    ctx.conn.commit()
    rows = ctx.conn.execute(
        """SELECT r.*, s.code AS slot_code, s.zone AS slot_zone, s.kind AS slot_kind,
                  s.power_kw AS slot_power, s.price_per_hour AS slot_price,
                  v.plate_no, v.model AS vehicle_model, v.battery_kwh
           FROM reservations r
           JOIN slots s ON s.id = r.slot_id
           JOIN vehicles v ON v.id = r.vehicle_id
           WHERE r.user_id = ?
           ORDER BY r.start_at DESC""",
        (user["id"],),
    ).fetchall()
    views = [reservation_view(row, now) for row in rows]
    upcoming = sorted(
        [item for item in views if item["status"] == "reserved"],
        key=lambda item: parse_time(item["startAt"]),
    )
    active = [item for item in views if item["status"] == "active"]
    history = [item for item in views if item["status"] in ("completed", "cancelled", "expired")]
    return {"upcoming": upcoming, "active": active, "history": history, "serverTime": iso(now)}


def create_reservation(ctx: Context) -> dict:
    user = require_user(ctx)
    now = utcnow()
    expire_reservations(ctx.conn, now)
    slot_id = positive_int(ctx.body.get("slotId"), field_name="车位")
    vehicle_id = positive_int(ctx.body.get("vehicleId"), field_name="车辆")
    try:
        duration = int(ctx.body.get("durationMinutes", 60))
    except (TypeError, ValueError):
        raise ApiError(400, "预约时长格式不正确")
    if duration < 30 or duration > 480 or duration % 30:
        raise ApiError(400, "预约时长需在 30–480 分钟之间，并以 30 分钟为单位")
    start = parse_time(ctx.body.get("startAt"))
    end = start + timedelta(minutes=duration)

    if start < now - timedelta(minutes=5):
        raise ApiError(400, "预约开始时间不能早于当前时间")
    if start > now + timedelta(days=MAX_RESERVATION_DAYS):
        raise ApiError(400, "最多可提前 30 天预约")

    slot = ctx.conn.execute("SELECT * FROM slots WHERE id = ?", (slot_id,)).fetchone()
    if not slot:
        raise ApiError(404, "未找到该车位")
    if slot["status"] == "maintenance":
        raise ApiError(409, "该车位正在维护，暂时无法预约")
    vehicle = ctx.conn.execute(
        "SELECT * FROM vehicles WHERE id = ? AND user_id = ? AND is_active = 1",
        (vehicle_id, user["id"]),
    ).fetchone()
    if not vehicle:
        raise ApiError(404, "未找到该车辆，请先绑定爱车")

    slot_clash = ctx.conn.execute(
        """SELECT 1 FROM reservations
           WHERE slot_id = ? AND status IN ('reserved', 'active')
             AND start_at < ? AND end_at > ?""",
        (slot_id, iso(end), iso(start)),
    ).fetchone()
    if slot_clash:
        raise ApiError(409, "该时段已被预约，请选择其他时间或车位")

    active_parking = ctx.conn.execute(
        "SELECT 1 FROM parking_records WHERE slot_id = ? AND ended_at IS NULL", (slot_id,)
    ).fetchone()
    if active_parking and start < now + timedelta(hours=2):
        raise ApiError(409, "该车位当前有车辆停放，请预约 2 小时后的时段")

    own_clash = ctx.conn.execute(
        """SELECT 1 FROM reservations
           WHERE user_id = ? AND status IN ('reserved', 'active')
             AND start_at < ? AND end_at > ?""",
        (user["id"], iso(end), iso(start)),
    ).fetchone()
    if own_clash:
        raise ApiError(409, "您在该时段已有其他预约")

    upcoming_count = ctx.conn.execute(
        """SELECT COUNT(*) FROM reservations
           WHERE user_id = ? AND status = 'reserved' AND end_at > ?""",
        (user["id"], iso(now)),
    ).fetchone()[0]
    if upcoming_count >= 5:
        raise ApiError(409, "最多同时保有 5 个待到店预约")

    note = str(ctx.body.get("note", "") or "").strip()[:80]
    cursor = ctx.conn.execute(
        """INSERT INTO reservations
           (user_id, vehicle_id, slot_id, start_at, end_at, status, note, created_at)
           VALUES (?, ?, ?, ?, ?, 'reserved', ?, ?)""",
        (user["id"], vehicle_id, slot_id, iso(start), iso(end), note, iso(now)),
    )
    ctx.conn.commit()
    row = ctx.conn.execute(
        """SELECT r.*, s.code AS slot_code, s.zone AS slot_zone, s.kind AS slot_kind,
                  s.power_kw AS slot_power, s.price_per_hour AS slot_price,
                  v.plate_no, v.model AS vehicle_model, v.battery_kwh
           FROM reservations r JOIN slots s ON s.id = r.slot_id
           JOIN vehicles v ON v.id = r.vehicle_id WHERE r.id = ?""",
        (cursor.lastrowid,),
    ).fetchone()
    return {"reservation": reservation_view(row, now), "message": "车位预约成功"}


def cancel_reservation(ctx: Context, reservation_id: int) -> dict:
    user = require_user(ctx)
    now = utcnow()
    row = ctx.conn.execute(
        "SELECT * FROM reservations WHERE id = ? AND user_id = ?",
        (reservation_id, user["id"]),
    ).fetchone()
    if not row:
        raise ApiError(404, "未找到该预约")
    if row["status"] != "reserved":
        raise ApiError(409, "当前状态的预约无法取消")
    if parse_time(row["end_at"]) <= now:
        raise ApiError(409, "该预约已经结束")
    ctx.conn.execute(
        "UPDATE reservations SET status = 'cancelled' WHERE id = ?", (reservation_id,)
    )
    ctx.conn.commit()
    return {"message": "预约已取消"}


def check_in_reservation(ctx: Context, reservation_id: int) -> dict:
    user = require_user(ctx)
    now = utcnow()
    row = ctx.conn.execute(
        """SELECT r.*, s.status AS slot_status, s.code AS slot_code,
                  s.power_kw, v.user_id AS vehicle_owner
           FROM reservations r JOIN slots s ON s.id = r.slot_id
           JOIN vehicles v ON v.id = r.vehicle_id
           WHERE r.id = ? AND r.user_id = ?""",
        (reservation_id, user["id"]),
    ).fetchone()
    if not row:
        raise ApiError(404, "未找到该预约")
    if row["status"] != "reserved":
        raise ApiError(409, "该预约当前不可签到")
    start = parse_time(row["start_at"])
    end = parse_time(row["end_at"])
    if now < start - timedelta(minutes=CHECKIN_EARLY_MINUTES):
        raise ApiError(409, f"请在开始前 {CHECKIN_EARLY_MINUTES} 分钟内签到")
    if now >= end:
        raise ApiError(409, "该预约已过期")
    if row["slot_status"] == "maintenance":
        raise ApiError(409, "该车位正在维护，请联系运营人员")
    if ctx.conn.execute(
        "SELECT 1 FROM parking_records WHERE user_id = ? AND ended_at IS NULL", (user["id"],)
    ).fetchone():
        raise ApiError(409, "您已有进行中的停车，请先结束当前订单")
    if ctx.conn.execute(
        "SELECT 1 FROM parking_records WHERE slot_id = ? AND ended_at IS NULL", (row["slot_id"],)
    ).fetchone():
        raise ApiError(409, "该车位当前被占用，请联系现场工作人员")

    cursor = ctx.conn.execute(
        """INSERT INTO parking_records
           (user_id, vehicle_id, slot_id, reservation_id, started_at, ended_at,
            energy_kwh, parking_fee, energy_fee, total_fee, status, created_at)
           VALUES (?, ?, ?, ?, ?, NULL, 0, 0, 0, 0, 'active', ?)""",
        (user["id"], row["vehicle_id"], row["slot_id"], reservation_id, iso(now), iso(now)),
    )
    ctx.conn.execute("UPDATE reservations SET status = 'active' WHERE id = ?", (reservation_id,))
    ctx.conn.commit()
    session_row = ctx.conn.execute(
        SESSION_SELECT + " WHERE p.id = ?", (cursor.lastrowid,)
    ).fetchone()
    return {
        "session": session_view(session_row, now),
        "message": f"欢迎入场，已开始使用 {row['slot_code']}",
    }


def start_session(ctx: Context) -> dict:
    user = require_user(ctx)
    now = utcnow()
    slot_id = positive_int(ctx.body.get("slotId"), field_name="车位")
    vehicle_id = positive_int(ctx.body.get("vehicleId"), field_name="车辆")
    slot = ctx.conn.execute("SELECT * FROM slots WHERE id = ?", (slot_id,)).fetchone()
    if not slot:
        raise ApiError(404, "未找到该车位")
    if slot["status"] == "maintenance":
        raise ApiError(409, "该车位正在维护")
    vehicle = ctx.conn.execute(
        "SELECT * FROM vehicles WHERE id = ? AND user_id = ? AND is_active = 1",
        (vehicle_id, user["id"]),
    ).fetchone()
    if not vehicle:
        raise ApiError(404, "请选择已绑定的爱车")

    if ctx.conn.execute(
        "SELECT 1 FROM parking_records WHERE user_id = ? AND ended_at IS NULL", (user["id"],)
    ).fetchone():
        raise ApiError(409, "您已有进行中的停车订单，请先结束当前订单")
    if ctx.conn.execute(
        "SELECT 1 FROM parking_records WHERE slot_id = ? AND ended_at IS NULL", (slot_id,)
    ).fetchone():
        raise ApiError(409, "该车位刚刚被占用，请刷新后重试")
    reservation = ctx.conn.execute(
        """SELECT 1 FROM reservations
           WHERE slot_id = ? AND status IN ('reserved', 'active')
             AND start_at <= ? AND end_at > ?""",
        (slot_id, iso(now + timedelta(minutes=CHECKIN_EARLY_MINUTES)), iso(now)),
    ).fetchone()
    if reservation:
        raise ApiError(409, "该车位已被预约，请选择其他车位")

    try:
        cursor = ctx.conn.execute(
            """INSERT INTO parking_records
               (user_id, vehicle_id, slot_id, reservation_id, started_at, ended_at,
                energy_kwh, parking_fee, energy_fee, total_fee, status, created_at)
               VALUES (?, ?, ?, NULL, ?, NULL, 0, 0, 0, 0, 'active', ?)""",
            (user["id"], vehicle_id, slot_id, iso(now), iso(now)),
        )
    except sqlite3.IntegrityError:
        raise ApiError(409, "该车位刚刚被占用，请选择其他车位")
    ctx.conn.commit()
    session_row = ctx.conn.execute(
        SESSION_SELECT + " WHERE p.id = ?", (cursor.lastrowid,)
    ).fetchone()
    return {
        "session": session_view(session_row, now),
        "message": f"已开始使用 {slot['code']}"
        + ("，充电已启动" if slot["power_kw"] else ""),
    }


def end_session(ctx: Context, session_id: int) -> dict:
    user = require_user(ctx)
    now = utcnow()
    row = ctx.conn.execute(
        SESSION_SELECT + " WHERE p.id = ? AND p.user_id = ?",
        (session_id, user["id"]),
    ).fetchone()
    if not row:
        raise ApiError(404, "未找到该停车订单")
    if row["status"] != "active":
        raise ApiError(409, "该订单已经结束")
    start = parse_time(row["started_at"])
    minutes = max(1, round((now - start).total_seconds() / 60))
    power = float(row["power_kw"] or 0)
    battery = float(row["battery_kwh"] or 60)
    energy = round(min((minutes / 60) * power * 0.55, battery * 0.8), 2) if power else 0.0
    parking_fee = money(math.ceil(minutes / 30) * 0.5 * float(row["price_per_hour"]))
    energy_fee = money(energy * ENERGY_SERVICE_RATE)
    total_fee = money(parking_fee + energy_fee)
    ctx.conn.execute(
        """UPDATE parking_records
           SET ended_at = ?, energy_kwh = ?, parking_fee = ?, energy_fee = ?,
               total_fee = ?, status = 'completed'
           WHERE id = ? AND status = 'active'""",
        (iso(now), energy, parking_fee, energy_fee, total_fee, session_id),
    )
    if row["reservation_id"]:
        ctx.conn.execute(
            "UPDATE reservations SET status = 'completed' WHERE id = ?",
            (row["reservation_id"],),
        )
    ctx.conn.commit()
    updated = ctx.conn.execute(
        SESSION_SELECT + " WHERE p.id = ?", (session_id,)
    ).fetchone()
    return {
        "session": session_view(updated, now),
        "message": f"订单已结算，共计 ¥{total_fee:.2f}",
    }


def get_sessions(ctx: Context) -> dict:
    user = require_user(ctx)
    now = utcnow()
    active = get_active_session(ctx.conn, user["id"], now)
    rows = ctx.conn.execute(
        SESSION_SELECT
        + """ WHERE p.user_id = ? AND p.status = 'completed'
              ORDER BY p.started_at DESC LIMIT 60""",
        (user["id"],),
    ).fetchall()
    history = [session_view(row, now) for row in rows]
    summary_row = ctx.conn.execute(
        """SELECT COUNT(*) AS count, COALESCE(SUM(energy_kwh), 0) AS energy,
                  COALESCE(SUM(total_fee), 0) AS spend,
                  COALESCE(AVG((julianday(ended_at) - julianday(started_at)) * 1440), 0) AS avg_minutes
           FROM parking_records WHERE user_id = ? AND status = 'completed'""",
        (user["id"],),
    ).fetchone()
    return {
        "activeSession": active,
        "history": history,
        "summary": {
            "count": summary_row["count"],
            "energy": round(summary_row["energy"], 2),
            "spend": money(summary_row["spend"]),
            "avgMinutes": round(summary_row["avg_minutes"]),
        },
        "weekly": weekly_energy(ctx.conn, user["id"], now),
        "serverTime": iso(now),
    }


# ---------------------------------------------------------------------------
# Admin API
# ---------------------------------------------------------------------------


def admin_overview(ctx: Context) -> dict:
    require_admin(ctx)
    now = utcnow()
    # Admin revenue covers all accounts.
    month_start = datetime(
        now.astimezone(SHANGHAI).year,
        now.astimezone(SHANGHAI).month,
        1,
        tzinfo=SHANGHAI,
    ).astimezone(timezone.utc)
    all_month = ctx.conn.execute(
        """SELECT COUNT(*) AS sessions, COALESCE(SUM(energy_kwh), 0) AS energy,
                  COALESCE(SUM(total_fee), 0) AS revenue
           FROM parking_records WHERE status = 'completed' AND started_at >= ?""",
        (iso(month_start),),
    ).fetchone()
    local_today = now.astimezone(SHANGHAI).replace(hour=0, minute=0, second=0, microsecond=0)
    day_start = local_today.astimezone(timezone.utc)
    day_end = (local_today + timedelta(days=1)).astimezone(timezone.utc)
    reservations_today = ctx.conn.execute(
        """SELECT COUNT(*) FROM reservations
           WHERE start_at >= ? AND start_at < ? AND status != 'cancelled'""",
        (iso(day_start), iso(day_end)),
    ).fetchone()[0]

    slots, zones = load_slot_map(ctx.conn, 0, now)
    live_rows = ctx.conn.execute(
        SESSION_SELECT + " WHERE p.ended_at IS NULL ORDER BY p.started_at"
    ).fetchall()
    live = []
    for row in live_rows:
        view = session_view(row, now)
        user_row = ctx.conn.execute(
            "SELECT name, email FROM users WHERE id = (SELECT user_id FROM parking_records WHERE id = ?)",
            (row["record_id"],),
        ).fetchone()
        view["customer"] = {"name": user_row["name"], "email": user_row["email"]}
        live.append(view)

    user_count = ctx.conn.execute("SELECT COUNT(*) FROM users").fetchone()[0]
    vehicle_count = ctx.conn.execute(
        "SELECT COUNT(*) FROM vehicles WHERE is_active = 1"
    ).fetchone()[0]
    return {
        "stats": {
            "users": user_count,
            "vehicles": vehicle_count,
            "activeSessions": len(live),
            "reservationsToday": reservations_today,
            "monthRevenue": money(all_month["revenue"]),
            "monthEnergy": round(all_month["energy"], 2),
            "monthSessions": all_month["sessions"],
            "occupancyRate": round(
                sum(1 for slot in slots if slot["state"] in ("occupied", "charging", "reserved"))
                / max(1, sum(1 for slot in slots if not slot["maintenance"]))
                * 100
            ),
        },
        "zones": zones,
        "slots": slots,
        "liveSessions": live,
        "serverTime": iso(now),
    }


def admin_update_slot(ctx: Context, slot_id: int) -> dict:
    require_admin(ctx)
    status = str(ctx.body.get("status", ""))
    if status not in ("open", "maintenance"):
        raise ApiError(400, "车位状态不正确")
    slot = ctx.conn.execute("SELECT * FROM slots WHERE id = ?", (slot_id,)).fetchone()
    if not slot:
        raise ApiError(404, "未找到该车位")
    if status == "maintenance":
        if ctx.conn.execute(
            "SELECT 1 FROM parking_records WHERE slot_id = ? AND ended_at IS NULL", (slot_id,)
        ).fetchone():
            raise ApiError(409, "该车位正在使用中，不能切换为维护状态")
        if ctx.conn.execute(
            """SELECT 1 FROM reservations WHERE slot_id = ? AND status IN ('reserved', 'active')
               AND end_at > ?""",
            (slot_id, iso(utcnow())),
        ).fetchone():
            raise ApiError(409, "该车位还有未完成的预约，不能切换为维护状态")
    ctx.conn.execute("UPDATE slots SET status = ? WHERE id = ?", (status, slot_id))
    ctx.conn.commit()
    return {"message": "车位已恢复运营" if status == "open" else "车位已进入维护状态"}


# ---------------------------------------------------------------------------
# Router
# ---------------------------------------------------------------------------


def route(ctx: Context) -> dict:
    path = ctx.path.rstrip("/") or "/"
    method = ctx.method

    if method == "GET" and path == "/api/health":
        return {"status": "ok", "time": iso(utcnow())}

    if method == "POST" and path == "/api/auth/login":
        return auth_login(ctx)
    if method == "POST" and path == "/api/auth/register":
        return auth_register(ctx)
    if method == "POST" and path == "/api/auth/logout":
        return auth_logout(ctx)
    if method == "GET" and path == "/api/auth/me":
        return auth_me(ctx)

    if method == "GET" and path == "/api/dashboard":
        return get_dashboard(ctx)
    if method == "GET" and path == "/api/slots":
        return get_slots(ctx)
    if method == "GET" and path == "/api/vehicles":
        return get_vehicles(ctx)
    if method == "POST" and path == "/api/vehicles":
        return create_vehicle(ctx)

    match = re.fullmatch(r"/api/vehicles/(\d+)", path)
    if match:
        if method == "DELETE":
            return delete_vehicle(ctx, int(match.group(1)))
        if method == "PATCH":
            return set_primary_vehicle(ctx, int(match.group(1)))

    if method == "GET" and path == "/api/reservations":
        return get_reservations(ctx)
    if method == "POST" and path == "/api/reservations":
        return create_reservation(ctx)

    match = re.fullmatch(r"/api/reservations/(\d+)/cancel", path)
    if match and method == "POST":
        return cancel_reservation(ctx, int(match.group(1)))
    match = re.fullmatch(r"/api/reservations/(\d+)/check-in", path)
    if match and method == "POST":
        return check_in_reservation(ctx, int(match.group(1)))

    if method == "GET" and path == "/api/sessions":
        return get_sessions(ctx)
    if method == "POST" and path == "/api/sessions/start":
        return start_session(ctx)
    match = re.fullmatch(r"/api/sessions/(\d+)/end", path)
    if match and method == "POST":
        return end_session(ctx, int(match.group(1)))

    if method == "GET" and path == "/api/admin/overview":
        return admin_overview(ctx)
    match = re.fullmatch(r"/api/admin/slots/(\d+)", path)
    if match and method == "PATCH":
        return admin_update_slot(ctx, int(match.group(1)))

    raise ApiError(404, "接口不存在")


# ---------------------------------------------------------------------------
# Login throttling (in memory; suitable for a local single-process app)
# ---------------------------------------------------------------------------

LOGIN_ATTEMPTS: dict[str, deque] = defaultdict(deque)
LOGIN_LOCK = threading.Lock()
LOGIN_WINDOW_SECONDS = 600
LOGIN_MAX_FAILURES = 8


def check_login_rate(ip: str) -> bool:
    now_ts = time.time()
    with LOGIN_LOCK:
        bucket = LOGIN_ATTEMPTS[ip]
        while bucket and now_ts - bucket[0] > LOGIN_WINDOW_SECONDS:
            bucket.popleft()
        return len(bucket) >= LOGIN_MAX_FAILURES


def record_login_failure(ip: str) -> None:
    with LOGIN_LOCK:
        LOGIN_ATTEMPTS[ip].append(time.time())


def clear_login_failures(ip: str) -> None:
    with LOGIN_LOCK:
        LOGIN_ATTEMPTS.pop(ip, None)


# ---------------------------------------------------------------------------
# HTTP handler
# ---------------------------------------------------------------------------


class AppHandler(BaseHTTPRequestHandler):
    server_version = "VoltPark/1.0"
    sys_version = ""
    protocol_version = "HTTP/1.1"

    def do_GET(self):
        self._handle("GET")

    def do_POST(self):
        self._handle("POST")

    def do_PATCH(self):
        self._handle("PATCH")

    def do_DELETE(self):
        self._handle("DELETE")

    def do_HEAD(self):
        self._handle("HEAD")

    def cookie_value(self, name: str) -> str | None:
        header = self.headers.get("Cookie", "")
        for part in header.split(";"):
            if "=" not in part:
                continue
            key, value = part.strip().split("=", 1)
            if key == name:
                return value
        return None

    def _common_headers(self) -> dict:
        return {
            "X-Content-Type-Options": "nosniff",
            "X-Frame-Options": "DENY",
            "Referrer-Policy": "same-origin",
            "Content-Security-Policy": (
                "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'; "
                "script-src 'self'; connect-src 'self'; font-src 'self'; base-uri 'self'; "
                "form-action 'self'; frame-ancestors 'none'"
            ),
        }

    def _handle(self, method: str) -> None:
        parsed = urlsplit(self.path)
        raw_path = unquote(parsed.path)
        if not raw_path.startswith("/api/"):
            self._serve_static(method, raw_path)
            return

        conn = None
        ctx = None
        status = 200
        payload: dict
        try:
            conn = database.connect()
            body = self._read_json(method)
            token = self.cookie_value(SESSION_COOKIE)
            user = current_user(conn, token)
            ctx = Context(
                handler=self,
                conn=conn,
                method=method,
                path=raw_path,
                query=parse_qs(parsed.query),
                body=body,
                user=user,
            )
            payload = route(ctx)
            status = 200
        except ApiError as exc:
            status = exc.status
            payload = {"error": exc.message}
        except sqlite3.IntegrityError:
            status = 409
            payload = {"error": "操作冲突，请刷新后重试"}
            traceback.print_exc()
        except Exception:
            status = 500
            payload = {"error": "服务器开了个小差，请稍后重试"}
            traceback.print_exc()
        finally:
            if conn:
                conn.close()

        headers = self._common_headers()
        if ctx:
            for cookie in ctx.pending_cookies:
                headers.setdefault("__cookies__", [])
                headers["__cookies__"].append(cookie)
        self._send_json(status, payload, headers)

    def _read_json(self, method: str) -> dict:
        if method in ("GET", "HEAD"):
            return {}
        length_header = self.headers.get("Content-Length")
        if not length_header:
            return {}
        try:
            length = int(length_header)
        except ValueError:
            raise ApiError(400, "请求格式不正确")
        if length > MAX_JSON_BYTES:
            raise ApiError(413, "请求内容过大")
        raw = self.rfile.read(length)
        if not raw:
            return {}
        content_type = self.headers.get("Content-Type", "")
        if "application/json" not in content_type:
            raise ApiError(415, "请求需使用 JSON 格式")
        try:
            body = json.loads(raw.decode("utf-8"))
        except (UnicodeDecodeError, json.JSONDecodeError):
            raise ApiError(400, "请求内容不是有效的 JSON")
        if not isinstance(body, dict):
            raise ApiError(400, "请求内容格式不正确")
        origin = self.headers.get("Origin")
        if origin:
            host = self.headers.get("Host", "")
            if urlsplit(origin).netloc != host:
                raise ApiError(403, "请求来源不被允许")
        return body

    def _send_json(self, status: int, payload: dict, headers: dict) -> None:
        body = json.dumps(payload, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        cookies = headers.pop("__cookies__", [])
        self.send_response(status)
        for key, value in headers.items():
            self.send_header(key, value)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        for cookie in cookies:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _serve_static(self, method: str, path: str) -> None:
        if method not in ("GET", "HEAD"):
            self._send_json(405, {"error": "请求方法不被允许"}, self._common_headers())
            return
        relative = "index.html" if path in ("/", "") else path.lstrip("/")
        if relative.startswith("static/"):
            relative = relative[len("static/") :]
        if relative in ("favicon.ico",):
            relative = "favicon.svg"
        target = (STATIC_DIR / relative).resolve()
        try:
            target.relative_to(STATIC_DIR.resolve())
        except ValueError:
            self._send_json(403, {"error": "禁止访问"}, self._common_headers())
            return
        if not target.is_file():
            self._send_html_404()
            return
        body = target.read_bytes()
        mime, _ = mimetypes.guess_type(str(target))
        content_type = mime or "application/octet-stream"
        if target.suffix == ".js":
            content_type = "text/javascript; charset=utf-8"
        elif target.suffix in (".html", ".css", ".svg"):
            content_type += "; charset=utf-8"
        self.send_response(200)
        for key, value in self._common_headers().items():
            self.send_header(key, value)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        if self.command != "HEAD":
            self.wfile.write(body)

    def _send_html_404(self) -> None:
        body = (
            "<!doctype html><html lang='zh-CN'><meta charset='utf-8'>"
            "<title>页面未找到 · VoltPark</title>"
            "<style>body{background:#0f1b17;color:#eaf1e7;font-family:system-ui;"
            "display:grid;place-items:center;height:100vh;margin:0}"
            "a{color:#c8f96a}</style><div><h1>404</h1><p>这个车位不存在。</p>"
            "<a href='/'>返回 VoltPark</a></div></html>"
        ).encode("utf-8")
        self.send_response(404)
        for key, value in self._common_headers().items():
            self.send_header(key, value)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, fmt: str, *args) -> None:
        if args and str(args[0]).startswith(("GET /static", "GET /favicon")):
            return
        print(f"  {self.address_string()} · {fmt % args}")


class VoltParkServer(ThreadingHTTPServer):
    daemon_threads = True
    allow_reuse_address = True

    def handle_error(self, request, client_address) -> None:
        # Browsers routinely close keep-alive sockets; that is not a server error.
        error = sys.exc_info()[1]
        if isinstance(error, (ConnectionResetError, ConnectionAbortedError, BrokenPipeError)):
            return
        super().handle_error(request, client_address)


def main() -> None:
    parser = argparse.ArgumentParser(description="VoltPark 电动车智能停放系统")
    parser.add_argument("--host", default=os.environ.get("VOLTPARK_HOST", "127.0.0.1"))
    parser.add_argument("--port", type=int, default=int(os.environ.get("VOLTPARK_PORT", "8777")))
    parser.add_argument("--db", default=None, help="可选的自定义 SQLite 数据库路径")
    args = parser.parse_args()

    if args.db:
        database.DB_PATH = Path(args.db).resolve()
    conn = database.connect()
    database.init_db(conn)
    # Keep the seeded demo lot alive without ever touching real registrations,
    # and stop abandoned sessions from billing for days.
    database.ensure_demo_freshness(conn)
    database.settle_stale_sessions(conn)
    conn.close()

    try:
        server = VoltParkServer((args.host, args.port), AppHandler)
    except OSError as exc:
        print(f"\n  无法在 {args.host}:{args.port} 启动服务：{exc}")
        print("  端口可能已被占用。可设置 VOLTPARK_PORT 使用其他端口。\n")
        return
    url = f"http://{args.host}:{args.port}"
    print("")
    print("  VoltPark 电动车智能停放系统")
    print(f"  > 本地地址   {url}")
    print(f"  > 数据库     {database.DB_PATH}")
    print("  > 演示账号   demo@evpark.cn / Demo1234")
    print("  > 管理账号   admin@evpark.cn / Admin1234")
    print("  > 按 Ctrl+C 停止服务")
    print("")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\n  服务已停止。")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
