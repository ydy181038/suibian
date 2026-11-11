"""Password and session-token helpers for VoltPark.

Only the Python standard library is used so the demo can run offline.
"""

from __future__ import annotations

import hashlib
import hmac
import re
import secrets

PBKDF2_ITERATIONS = 260_000
SESSION_TOKEN_BYTES = 32


def hash_password(password: str) -> str:
    """Return a salted PBKDF2-SHA256 password hash."""
    salt = secrets.token_hex(16)
    digest = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), bytes.fromhex(salt), PBKDF2_ITERATIONS
    )
    return f"pbkdf2_sha256${PBKDF2_ITERATIONS}${salt}${digest.hex()}"


def verify_password(password: str, encoded: str) -> bool:
    """Compare a password with a stored hash in constant time."""
    try:
        algorithm, iterations, salt, expected = encoded.split("$", 3)
        if algorithm != "pbkdf2_sha256":
            return False
        digest = hashlib.pbkdf2_hmac(
            "sha256",
            password.encode("utf-8"),
            bytes.fromhex(salt),
            int(iterations),
        )
        return hmac.compare_digest(digest.hex(), expected)
    except (TypeError, ValueError):
        return False


def new_session_token() -> str:
    return secrets.token_urlsafe(SESSION_TOKEN_BYTES)


def token_fingerprint(token: str) -> str:
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def validate_email(email: str) -> bool:
    if not isinstance(email, str):
        return False
    email = email.strip()
    return bool(
        re.fullmatch(r"[^\s@]+@[^\s@]+\.[^\s@]{2,}", email)
        and len(email) <= 120
    )


def validate_password(password: str) -> str | None:
    """Return a friendly validation error, or None when valid."""
    if not isinstance(password, str):
        return "请输入密码"
    if len(password) < 8:
        return "密码至少需要 8 位"
    if len(password) > 72:
        return "密码不能超过 72 位"
    if not re.search(r"[A-Za-z]", password) or not re.search(r"\d", password):
        return "密码需同时包含字母和数字"
    return None
