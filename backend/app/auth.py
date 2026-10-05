"""认证：密码哈希（scrypt，纯标准库）+ SQLite session"""
import hashlib
import hmac
import os
import secrets
from datetime import datetime, timedelta

from .db import db

COOKIE_NAME = "session"
SESSION_TTL_DAYS = 30

_SCRYPT_N = 2 ** 14
_SCRYPT_R = 8
_SCRYPT_P = 1


def hash_password(pw: str) -> str:
    salt = os.urandom(16)
    h = hashlib.scrypt(pw.encode(), salt=salt, n=_SCRYPT_N, r=_SCRYPT_R, p=_SCRYPT_P, dklen=32)
    return f"scrypt${salt.hex()}${h.hex()}"


def verify_password(pw: str, stored: str) -> bool:
    try:
        _, salt_hex, h_hex = stored.split("$")
        h = hashlib.scrypt(pw.encode(), salt=bytes.fromhex(salt_hex),
                           n=_SCRYPT_N, r=_SCRYPT_R, p=_SCRYPT_P, dklen=32)
        return hmac.compare_digest(h.hex(), h_hex)
    except Exception:
        return False


def create_session(user_id: int) -> str:
    token = secrets.token_urlsafe(32)
    expires = (datetime.now() + timedelta(days=SESSION_TTL_DAYS)).strftime("%Y-%m-%d %H:%M:%S")
    with db() as conn:
        conn.execute("INSERT INTO sessions(token,user_id,expires_at) VALUES(?,?,?)",
                     (token, user_id, expires))
    return token


def get_session_user(token: str):
    """按 token 取用户；顺带清理该过期 session"""
    if not token:
        return None
    with db() as conn:
        row = conn.execute(
            "SELECT u.id, u.username, u.is_admin, s.expires_at FROM sessions s "
            "JOIN users u ON u.id = s.user_id WHERE s.token=?", (token,)).fetchone()
        if not row:
            return None
        if row["expires_at"] < datetime.now().strftime("%Y-%m-%d %H:%M:%S"):
            conn.execute("DELETE FROM sessions WHERE token=?", (token,))
            return None
    return {"id": row["id"], "username": row["username"], "is_admin": bool(row["is_admin"])}


def delete_session(token: str):
    with db() as conn:
        conn.execute("DELETE FROM sessions WHERE token=?", (token,))


def purge_expired_sessions():
    with db() as conn:
        conn.execute("DELETE FROM sessions WHERE expires_at < ?",
                     (datetime.now().strftime("%Y-%m-%d %H:%M:%S"),))


def purge_user_sessions(user_id: int):
    with db() as conn:
        conn.execute("DELETE FROM sessions WHERE user_id=?", (user_id,))
