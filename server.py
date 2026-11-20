from __future__ import annotations

import hashlib
import hmac
import json
import os
import secrets
import sqlite3
import threading
import time
import uuid
from contextlib import contextmanager
from http.cookies import CookieError, SimpleCookie
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Iterator
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlencode, urlparse
from urllib.request import Request, urlopen


BASE_DIR = Path(__file__).resolve().parent
DATABASE_PATH = Path(
    os.environ.get(
        "FARMPROTECTOR_DB",
        Path.home() / ".farm-protector" / "farm-protector.sqlite3",
    )
)
SESSION_TTL_SECONDS = 60 * 60 * 24 * 14
CAMERA_DEVICE_SESSION_TTL_SECONDS = 60 * 60 * 24 * 30
CAMERA_PAIRING_TTL_SECONDS = 60 * 10
PASSWORD_ITERATIONS = 310_000
MAX_BODY_BYTES = 64 * 1024
RATE_LIMIT_WINDOW_SECONDS = 15 * 60
RATE_LIMIT_MAX_ATTEMPTS = 10
CAMERA_HEARTBEAT_TIMEOUT_SECONDS = 25
MAX_MAP_TILE_BYTES = 1_048_576
MAP_TILE_MAX_ZOOM = 19


class GoogleAuthError(Exception):
    def __init__(self, status: int, message: str):
        super().__init__(message)
        self.status = status


def connect_database(database_path: Path) -> sqlite3.Connection:
    database_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(database_path, timeout=10)
    connection.row_factory = sqlite3.Row
    connection.execute("PRAGMA foreign_keys = ON")
    return connection


@contextmanager
def database_connection(database_path: Path) -> Iterator[sqlite3.Connection]:
    connection = connect_database(database_path)
    try:
        with connection:
            yield connection
    finally:
        connection.close()


def initialize_database(database_path: Path) -> None:
    with database_connection(database_path) as connection:
        connection.executescript(
            """
            CREATE TABLE IF NOT EXISTS users (
                id TEXT PRIMARY KEY,
                email TEXT NOT NULL UNIQUE,
                password_hash BLOB NOT NULL,
                password_salt BLOB NOT NULL,
                google_sub TEXT,
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS profiles (
                user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                farm_name TEXT NOT NULL,
                crops TEXT NOT NULL,
                bio TEXT NOT NULL DEFAULT ''
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash BLOB PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                expires_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS farms (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                location TEXT NOT NULL,
                latitude REAL NOT NULL,
                longitude REAL NOT NULL,
                fields INTEGER NOT NULL,
                crop TEXT NOT NULL,
                status TEXT NOT NULL DEFAULT 'Monitoring',
                created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS camera_devices (
                id TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
                name TEXT NOT NULL,
                farm_name TEXT NOT NULL,
                pair_code_hash BLOB,
                pair_expires_at INTEGER,
                paired_at INTEGER,
                device_session_hash BLOB,
                last_seen_at INTEGER,
                created_at INTEGER NOT NULL
            );
            CREATE INDEX IF NOT EXISTS cameras_by_owner ON camera_devices(user_id, created_at);
            CREATE INDEX IF NOT EXISTS sessions_expiry ON sessions(expires_at);
            CREATE INDEX IF NOT EXISTS farms_by_owner ON farms(user_id, created_at);
            """
        )
        user_columns = {
            row["name"] for row in connection.execute("PRAGMA table_info(users)")
        }
        if "google_sub" not in user_columns:
            connection.execute("ALTER TABLE users ADD COLUMN google_sub TEXT")
        connection.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS users_google_sub ON users(google_sub)"
        )


def hash_password(password: str, salt: bytes | None = None) -> tuple[bytes, bytes]:
    password_salt = salt or secrets.token_bytes(16)
    password_hash = hashlib.pbkdf2_hmac(
        "sha256", password.encode("utf-8"), password_salt, PASSWORD_ITERATIONS
    )
    return password_hash, password_salt


def valid_text(value: object, maximum: int, *, required: bool = True) -> str:
    if not isinstance(value, str):
        raise ValueError("Invalid field value.")
    result = value.strip()
    if (required and not result) or len(result) > maximum:
        raise ValueError("Check the form values and try again.")
    return result


class FarmProtectorHandler(SimpleHTTPRequestHandler):
    server_version = "FarmProtector"
    sys_version = ""
    database_path = DATABASE_PATH
    secure_cookies = False
    rate_lock = threading.Lock()
    login_attempts: dict[str, list[float]] = {}
    camera_lock = threading.RLock()
    camera_rooms: dict[str, dict[str, object]] = {}
    pairing_attempts: dict[str, list[float]] = {}

    def end_headers(self) -> None:
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("X-Frame-Options", "DENY")
        self.send_header("Referrer-Policy", "same-origin")
        super().end_headers()

    def _send_json(self, status: int, payload: dict[str, object], *, cookie: str | None = None) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        if cookie:
            self.send_header("Set-Cookie", cookie)
        self.end_headers()
        self.wfile.write(body)

    def _send_google_json(
        self,
        status: int,
        payload: dict[str, object],
        *,
        session_cookie: str | None = None,
    ) -> None:
        body = json.dumps(payload, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        secure = "; Secure" if self.secure_cookies else ""
        self.send_header(
            "Set-Cookie",
            f"farm_google_oauth_state=; Path=/api/auth/google; HttpOnly; SameSite=Strict; Max-Age=0{secure}",
        )
        if session_cookie:
            self.send_header("Set-Cookie", session_cookie)
        self.end_headers()
        self.wfile.write(body)

    def _read_json(self) -> dict[str, object]:
        try:
            length = int(self.headers.get("Content-Length", "0"))
        except ValueError as error:
            raise ValueError("Invalid request size.") from error
        if length < 1 or length > MAX_BODY_BYTES:
            raise ValueError("Request body is empty or too large.")
        if "application/json" not in self.headers.get("Content-Type", "").lower():
            raise ValueError("Request must use JSON.")
        try:
            body = json.loads(self.rfile.read(length))
        except (json.JSONDecodeError, UnicodeDecodeError) as error:
            raise ValueError("Invalid JSON request.") from error
        if not isinstance(body, dict):
            raise ValueError("Invalid request.")
        return body

    def _require_same_origin(self) -> bool:
        origin = self.headers.get("Origin")
        parsed = urlparse(origin or "")
        if parsed.scheme not in ("http", "https") or parsed.netloc.lower() != self.headers.get("Host", "").lower():
            self._send_json(403, {"error": "Request origin was not accepted."})
            return False
        return True

    def _cookie_token(self) -> str | None:
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get("Cookie", ""))
        except CookieError:
            return None
        morsel = cookie.get("farm_session")
        return morsel.value if morsel else None

    def _session_user(self) -> sqlite3.Row | None:
        token = self._cookie_token()
        if not token:
            return None
        token_hash = hashlib.sha256(token.encode("ascii", errors="ignore")).digest()
        now = int(time.time())
        with database_connection(self.database_path) as connection:
            return connection.execute(
                """
                SELECT users.id, users.email, profiles.name, profiles.farm_name,
                       profiles.crops, profiles.bio
                FROM sessions
                JOIN users ON users.id = sessions.user_id
                JOIN profiles ON profiles.user_id = users.id
                WHERE sessions.token_hash = ? AND sessions.expires_at > ?
                """,
                (token_hash, now),
            ).fetchone()

    def _camera_device_session(self) -> sqlite3.Row | None:
        token = self._camera_device_token()
        if not token:
            return None
        token_hash = hashlib.sha256(token.encode("ascii", errors="ignore")).digest()
        with database_connection(self.database_path) as connection:
            device = connection.execute(
                """
                SELECT camera_devices.id, camera_devices.user_id, camera_devices.name,
                       camera_devices.farm_name, users.email
                FROM camera_devices
                JOIN users ON users.id = camera_devices.user_id
                WHERE camera_devices.device_session_hash = ?
                  AND camera_devices.paired_at IS NOT NULL
                """,
                (token_hash,),
            ).fetchone()
            if device:
                connection.execute(
                    "UPDATE camera_devices SET last_seen_at = ? WHERE id = ?",
                    (int(time.time()), device["id"]),
                )
            return device

    def _camera_device_token(self) -> str | None:
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get("Cookie", ""))
        except CookieError:
            return None
        morsel = cookie.get("farm_camera_device")
        return morsel.value if morsel else None

    def _create_camera_device_session(self, device_id: str) -> str:
        token = secrets.token_urlsafe(32)
        token_hash = hashlib.sha256(token.encode("ascii")).digest()
        with database_connection(self.database_path) as connection:
            connection.execute(
                "UPDATE camera_devices SET device_session_hash = ?, paired_at = ?, last_seen_at = ? WHERE id = ?",
                (token_hash, int(time.time()), int(time.time()), device_id),
            )
        secure = "; Secure" if self.secure_cookies else ""
        return (
            f"farm_camera_device={token}; Path=/; HttpOnly; SameSite=Strict; "
            f"Max-Age={CAMERA_DEVICE_SESSION_TTL_SECONDS}{secure}"
        )

    def _pairing_rate_limited(self) -> bool:
        now = time.monotonic()
        address = self.client_address[0]
        with self.rate_lock:
            attempts = [
                attempt
                for attempt in self.pairing_attempts.get(address, [])
                if now - attempt < RATE_LIMIT_WINDOW_SECONDS
            ]
            self.pairing_attempts[address] = attempts
            return len(attempts) >= RATE_LIMIT_MAX_ATTEMPTS

    def _record_pairing_attempt(self) -> None:
        address = self.client_address[0]
        with self.rate_lock:
            self.pairing_attempts.setdefault(address, []).append(time.monotonic())

    def _create_session(self, user_id: str) -> str:
        token = secrets.token_urlsafe(32)
        token_hash = hashlib.sha256(token.encode("ascii")).digest()
        expires_at = int(time.time()) + SESSION_TTL_SECONDS
        with database_connection(self.database_path) as connection:
            connection.execute("DELETE FROM sessions WHERE expires_at <= ?", (int(time.time()),))
            connection.execute(
                "INSERT INTO sessions(token_hash, user_id, expires_at) VALUES (?, ?, ?)",
                (token_hash, user_id, expires_at),
            )
        secure = "; Secure" if self.secure_cookies else ""
        return f"farm_session={token}; Path=/; HttpOnly; SameSite=Strict; Max-Age={SESSION_TTL_SECONDS}{secure}"

    def _login_rate_limited(self) -> bool:
        now = time.monotonic()
        address = self.client_address[0]
        with self.rate_lock:
            attempts = [attempt for attempt in self.login_attempts.get(address, []) if now - attempt < RATE_LIMIT_WINDOW_SECONDS]
            self.login_attempts[address] = attempts
            return len(attempts) >= RATE_LIMIT_MAX_ATTEMPTS

    def _record_login_attempt(self) -> None:
        address = self.client_address[0]
        with self.rate_lock:
            attempts = self.login_attempts.setdefault(address, [])
            attempts.append(time.monotonic())

    def _handle_register(self) -> None:
        if not self._require_same_origin():
            return
        if self._login_rate_limited():
            self._send_json(429, {"error": "Too many attempts. Please wait before trying again."})
            return
        self._record_login_attempt()
        payload = self._read_json()
        email = valid_text(payload.get("email"), 254).lower()
        if email.count("@") != 1 or any(character.isspace() for character in email):
            raise ValueError("Enter a valid email address.")
        password = payload.get("password")
        if not isinstance(password, str) or len(password) < 10 or len(password) > 200:
            raise ValueError("Password must be 10–200 characters.")
        name = valid_text(payload.get("name"), 100)
        farm_name = valid_text(payload.get("farm_name"), 120)
        crops = valid_text(payload.get("crops"), 240)
        bio = valid_text(payload.get("bio", ""), 1000, required=False)
        user_id = str(uuid.uuid4())
        password_hash, password_salt = hash_password(password)
        try:
            with database_connection(self.database_path) as connection:
                connection.execute(
                    "INSERT INTO users(id, email, password_hash, password_salt, created_at) VALUES (?, ?, ?, ?, ?)",
                    (user_id, email, password_hash, password_salt, int(time.time())),
                )
                connection.execute(
                    "INSERT INTO profiles(user_id, name, farm_name, crops, bio) VALUES (?, ?, ?, ?, ?)",
                    (user_id, name, farm_name, crops, bio),
                )
        except sqlite3.IntegrityError:
            self._send_json(409, {"error": "An account with that email already exists."})
            return
        cookie = self._create_session(user_id)
        self._send_json(201, {"user": self._public_user(user_id)}, cookie=cookie)

    def _public_user(self, user_id: str) -> dict[str, str]:
        with database_connection(self.database_path) as connection:
            row = connection.execute(
                """
                SELECT users.email, profiles.name, profiles.farm_name, profiles.crops, profiles.bio
                FROM users JOIN profiles ON profiles.user_id = users.id WHERE users.id = ?
                """,
                (user_id,),
            ).fetchone()
        if row is None:
            raise RuntimeError("New user profile was not found.")
        return dict(row)

    def _handle_login(self) -> None:
        if not self._require_same_origin():
            return
        if self._login_rate_limited():
            self._send_json(429, {"error": "Too many attempts. Please wait before trying again."})
            return
        payload = self._read_json()
        email = valid_text(payload.get("email"), 254).lower()
        password = payload.get("password")
        if not isinstance(password, str) or len(password) > 200:
            self._record_login_attempt()
            self._send_json(401, {"error": "Email or password is incorrect."})
            return
        with database_connection(self.database_path) as connection:
            user = connection.execute(
                "SELECT id, password_hash, password_salt FROM users WHERE email = ?",
                (email,),
            ).fetchone()
        if user is None:
            self._record_login_attempt()
            self._send_json(401, {"error": "Email or password is incorrect."})
            return
        candidate, _ = hash_password(password, user["password_salt"])
        if not hmac.compare_digest(candidate, user["password_hash"]):
            self._record_login_attempt()
            self._send_json(401, {"error": "Email or password is incorrect."})
            return
        cookie = self._create_session(user["id"])
        self._send_json(200, {"user": self._public_user(user["id"])}, cookie=cookie)

    def _google_oauth_cookie_token(self) -> str | None:
        cookie = SimpleCookie()
        try:
            cookie.load(self.headers.get("Cookie", ""))
        except CookieError:
            return None
        morsel = cookie.get("farm_google_oauth_state")
        return morsel.value if morsel else None

    def _handle_google_auth(self, path: str) -> None:
        client_id = self.google_oauth_client_id
        client_secret = self.google_oauth_client_secret
        if path == "/api/auth/google/config":
            if self.command != "GET":
                self._send_json(405, {"error": "Method not allowed."})
                return
            enabled = bool(client_id and client_secret)
            self._send_json(200, {
                "enabled": enabled,
                "client_id": client_id if enabled else "",
            })
            return

        if self.command != "POST":
            self._send_json(405, {"error": "Method not allowed."})
            return
        if not self._require_same_origin():
            return
        if not client_id or not client_secret:
            self._send_json(503, {"error": "Google sign-in is not configured on this server."})
            return

        if path == "/api/auth/google/state":
            state = secrets.token_urlsafe(32)
            secure = "; Secure" if self.secure_cookies else ""
            cookie = (
                f"farm_google_oauth_state={state}; Path=/api/auth/google; HttpOnly; "
                f"SameSite=Strict; Max-Age=300{secure}"
            )
            self._send_json(200, {"state": state}, cookie=cookie)
            return

        if path != "/api/auth/google/login":
            self._send_json(404, {"error": "API route not found."})
            return
        if self._login_rate_limited():
            self._send_google_json(429, {"error": "Too many attempts. Please wait before trying again."})
            return

        payload = self._read_json()
        state = payload.get("state")
        state_cookie = self._google_oauth_cookie_token()
        if (
            not isinstance(state, str)
            or not state_cookie
            or len(state) > 256
            or not hmac.compare_digest(state, state_cookie)
        ):
            self._record_login_attempt()
            self._send_google_json(403, {"error": "Google sign-in expired. Please try again."})
            return

        try:
            identity = self._exchange_google_code(payload.get("code"), client_id, client_secret)
        except GoogleAuthError as error:
            self._record_login_attempt()
            self._send_google_json(error.status, {"error": str(error)})
            return

        email = identity["email"].strip().lower()
        if len(email) > 254 or email.count("@") != 1 or any(character.isspace() for character in email):
            self._record_login_attempt()
            self._send_google_json(401, {"error": "Google did not provide a valid verified email."})
            return

        google_sub = identity["sub"]
        with database_connection(self.database_path) as connection:
            user = connection.execute(
                "SELECT id, google_sub FROM users WHERE google_sub = ?",
                (google_sub,),
            ).fetchone()
            if user is None:
                user = connection.execute(
                    "SELECT id, google_sub FROM users WHERE email = ?",
                    (email,),
                ).fetchone()
                if user is not None and user["google_sub"] not in (None, google_sub):
                    self._send_google_json(
                        409,
                        {"error": "This email is linked to a different Google account."},
                    )
                    return

            if user is None:
                user_id = str(uuid.uuid4())
                random_password = secrets.token_urlsafe(48)
                password_hash, password_salt = hash_password(random_password)
                name = valid_text((identity.get("name") or email.split("@", 1)[0])[:100], 100)
                try:
                    connection.execute(
                        """
                        INSERT INTO users(id, email, password_hash, password_salt, google_sub, created_at)
                        VALUES (?, ?, ?, ?, ?, ?)
                        """,
                        (user_id, email, password_hash, password_salt, google_sub, int(time.time())),
                    )
                    connection.execute(
                        "INSERT INTO profiles(user_id, name, farm_name, crops, bio) VALUES (?, ?, ?, ?, '')",
                        (user_id, name, "My Farm", "Not specified"),
                    )
                except sqlite3.IntegrityError:
                    self._send_google_json(409, {"error": "That Google account is already linked. Please sign in again."})
                    return
            else:
                user_id = user["id"]
                if user["google_sub"] is None:
                    connection.execute(
                        "UPDATE users SET google_sub = ? WHERE id = ?",
                        (google_sub, user_id),
                    )

        session_cookie = self._create_session(user_id)
        self._send_google_json(
            200,
            {"user": self._public_user(user_id)},
            session_cookie=session_cookie,
        )

    @staticmethod
    def _exchange_google_code(code: object, client_id: str, client_secret: str) -> dict[str, str]:
        if not isinstance(code, str) or not code.strip() or len(code) > 4096:
            raise GoogleAuthError(400, "Google sign-in returned an invalid authorization code.")

        token_request = Request(
            "https://oauth2.googleapis.com/token",
            data=urlencode({
                "code": code,
                "client_id": client_id,
                "client_secret": client_secret,
                "redirect_uri": "postmessage",
                "grant_type": "authorization_code",
            }).encode("ascii"),
            headers={"Accept": "application/json", "Content-Type": "application/x-www-form-urlencoded"},
            method="POST",
        )
        try:
            with urlopen(token_request, timeout=10) as response:
                token_payload = json.loads(response.read())
        except HTTPError as error:
            if error.code < 500:
                raise GoogleAuthError(401, "Google could not verify this sign-in. Please try again.") from error
            raise GoogleAuthError(502, "Google sign-in is temporarily unavailable.") from error
        except (URLError, TimeoutError, json.JSONDecodeError) as error:
            raise GoogleAuthError(502, "Could not contact Google to verify your sign-in.") from error

        if not isinstance(token_payload, dict) or not isinstance(token_payload.get("id_token"), str):
            raise GoogleAuthError(401, "Google did not return a valid identity token.")

        token_info_url = "https://oauth2.googleapis.com/tokeninfo?" + urlencode({
            "id_token": token_payload["id_token"],
        })
        try:
            with urlopen(Request(token_info_url, headers={"Accept": "application/json"}), timeout=10) as response:
                identity = json.loads(response.read())
        except HTTPError as error:
            if error.code < 500:
                raise GoogleAuthError(401, "Google did not accept this sign-in token.") from error
            raise GoogleAuthError(502, "Google sign-in is temporarily unavailable.") from error
        except (URLError, TimeoutError, json.JSONDecodeError) as error:
            raise GoogleAuthError(502, "Could not verify your Google account.") from error

        if not isinstance(identity, dict):
            raise GoogleAuthError(401, "Google returned an invalid account profile.")
        try:
            expires_at = int(identity.get("exp", "0"))
        except (TypeError, ValueError) as error:
            raise GoogleAuthError(401, "Google returned an invalid sign-in token.") from error
        verified = identity.get("email_verified") in (True, "true")
        if (
            identity.get("aud") != client_id
            or identity.get("iss") not in ("accounts.google.com", "https://accounts.google.com")
            or expires_at <= int(time.time())
            or not verified
            or not isinstance(identity.get("email"), str)
            or not isinstance(identity.get("sub"), str)
            or not identity["sub"]
            or len(identity["sub"]) > 255
        ):
            raise GoogleAuthError(401, "Google account verification failed. Please try again.")
        name = identity.get("name")
        return {
            "sub": identity["sub"],
            "email": identity["email"],
            "name": name if isinstance(name, str) else "",
        }

    def _handle_map_tile(self, path: str) -> None:
        if self.command != "GET":
            self.send_error(405, "Method not allowed.")
            return
        if self._session_user() is None:
            self.send_error(401, "Sign in to load map tiles.")
            return

        parts = path.split("/")
        if (
            len(parts) != 7
            or parts[:3] != ["", "api", "map-tiles"]
            or parts[3] not in ("osm", "carto")
            or len(parts[4]) > 2
            or not parts[4].isascii()
            or not parts[4].isdigit()
            or len(parts[5]) > 6
            or not parts[5].isascii()
            or not parts[5].isdigit()
            or not parts[6].endswith(".png")
            or len(parts[6][:-4]) > 6
            or not parts[6][:-4].isascii()
            or not parts[6][:-4].isdigit()
        ):
            self.send_error(404, "Map tile not found.")
            return

        zoom, x, y = int(parts[4]), int(parts[5]), int(parts[6][:-4])
        if zoom > MAP_TILE_MAX_ZOOM or x >= 1 << zoom or y >= 1 << zoom:
            self.send_error(404, "Map tile not found.")
            return

        if parts[3] == "osm":
            tile_url = f"https://tile.openstreetmap.org/{zoom}/{x}/{y}.png"
        else:
            tile_url = f"https://basemaps.cartocdn.com/rastertiles/voyager/{zoom}/{x}/{y}.png"
        tile_request = Request(
            tile_url,
            headers={"Accept": "image/png", "User-Agent": "FarmProtector/1.0"},
        )
        try:
            with urlopen(tile_request, timeout=10) as response:
                tile_data = response.read(MAX_MAP_TILE_BYTES + 1)
        except HTTPError as error:
            self.log_error("Map tile provider returned HTTP %d for %s.", error.code, parts[3])
            self.send_error(502, "Map tile provider is unavailable.")
            return
        except (URLError, TimeoutError, OSError) as error:
            self.log_error("Map tile request failed for %s: %s", parts[3], error)
            self.send_error(502, "Map tile provider is unavailable.")
            return
        if len(tile_data) > MAX_MAP_TILE_BYTES:
            self.send_error(502, "Map tile provider returned an oversized tile.")
            return

        self.send_response(200)
        self.send_header("Content-Type", "image/png")
        self.send_header("Content-Length", str(len(tile_data)))
        self.send_header("Cache-Control", "private, max-age=86400")
        self.end_headers()
        self.wfile.write(tile_data)

    def _handle_api(self) -> None:
        path = urlparse(self.path).path
        if path.startswith("/api/auth/google/"):
            self._handle_google_auth(path)
            return
        if path.startswith("/api/map-tiles/"):
            self._handle_map_tile(path)
            return
        if path == "/api/map-config":
            if self.command != "GET":
                self._send_json(405, {"error": "Method not allowed."})
                return
            self._send_json(200, {"google_maps_api_key": self.google_maps_api_key})
            return
        if path == "/api/device/pair":
            self._handle_device_pair()
            return
        if path == "/api/device/session":
            if self.command != "GET":
                self._send_json(405, {"error": "Method not allowed."})
                return
            device = self._camera_device_session()
            if device is None:
                self._send_json(401, {"error": "Pair this phone with your farm account first."})
                return
            self._send_json(200, {"device": dict(device)})
            return
        if path == "/api/device/logout":
            if self.command != "POST":
                self._send_json(405, {"error": "Method not allowed."})
                return
            if not self._require_same_origin():
                return
            token = self._camera_device_token()
            if token:
                token_hash = hashlib.sha256(token.encode("ascii", errors="ignore")).digest()
                with database_connection(self.database_path) as connection:
                    connection.execute(
                        "UPDATE camera_devices SET device_session_hash = NULL WHERE device_session_hash = ?",
                        (token_hash,),
                    )
            self._send_json(
                200,
                {"ok": True},
                cookie="farm_camera_device=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0",
            )
            return
        if path in ("/api/auth/register", "/api/auth/login"):
            if self.command != "POST":
                self._send_json(405, {"error": "Method not allowed."})
            elif path.endswith("/register"):
                self._handle_register()
            else:
                self._handle_login()
            return
        if path == "/api/session":
            if self.command != "GET":
                self._send_json(405, {"error": "Method not allowed."})
                return
            user = self._session_user()
            if user is None:
                self._send_json(401, {"error": "Sign in to continue."})
                return
            self._send_json(200, {"user": dict(user)})
            return
        if path == "/api/auth/logout":
            if self.command != "POST":
                self._send_json(405, {"error": "Method not allowed."})
                return
            if not self._require_same_origin():
                return
            token = self._cookie_token()
            if token:
                token_hash = hashlib.sha256(token.encode("ascii", errors="ignore")).digest()
                with database_connection(self.database_path) as connection:
                    connection.execute("DELETE FROM sessions WHERE token_hash = ?", (token_hash,))
            self._send_json(200, {"ok": True}, cookie="farm_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0")
            return

        user = self._session_user()
        if path == "/api/devices":
            if user is None:
                self._send_json(401, {"error": "Sign in to continue."})
                return
            self._handle_camera_devices(user)
            return
        if path.startswith("/api/camera/"):
            device = self._camera_device_session()
            owner = user
            if device is not None:
                if user is not None and device["user_id"] != user["id"]:
                    self._send_json(403, {"error": "The camera device belongs to a different account."})
                    return
                with database_connection(self.database_path) as connection:
                    owner = connection.execute(
                        "SELECT id FROM users WHERE id = ?",
                        (device["user_id"],),
                    ).fetchone()
            if owner is None:
                self._send_json(401, {"error": "Sign in or pair this camera device to continue."})
                return
            self._handle_camera(path, owner, device=device)
            return
        if user is None:
            self._send_json(401, {"error": "Sign in to continue."})
            return
        if path == "/api/profile":
            self._handle_profile(user)
            return
        if path == "/api/farms":
            self._handle_farms(user)
            return
        self._send_json(404, {"error": "API route not found."})

    def _handle_device_pair(self) -> None:
        if self.command != "POST":
            self._send_json(405, {"error": "Method not allowed."})
            return
        if not self._require_same_origin():
            return
        if self._pairing_rate_limited():
            self._send_json(429, {"error": "Too many pairing attempts. Please wait before trying again."})
            return
        self._record_pairing_attempt()
        payload = self._read_json()
        code = valid_text(payload.get("code"), 32).upper()
        code_hash = hashlib.sha256(code.encode("utf-8")).digest()
        now = int(time.time())
        with database_connection(self.database_path) as connection:
            device = connection.execute(
                """
                SELECT id, user_id, name, farm_name FROM camera_devices
                WHERE pair_code_hash = ? AND pair_expires_at > ? AND paired_at IS NULL
                """,
                (code_hash, now),
            ).fetchone()
            if device is None:
                self._send_json(401, {"error": "Pairing code is invalid or expired."})
                return
            connection.execute(
                "UPDATE camera_devices SET pair_code_hash = NULL, pair_expires_at = NULL WHERE id = ?",
                (device["id"],),
            )
        cookie = self._create_camera_device_session(device["id"])
        self._send_json(
            200,
            {"device": {"name": device["name"], "farm_name": device["farm_name"]}},
            cookie=cookie,
        )

    def _handle_camera_devices(self, user: sqlite3.Row) -> None:
        if self.command == "GET":
            now = int(time.time())
            with self.camera_lock:
                room = self.camera_rooms.get(user["id"])
                online_device_id = (
                    room["device_id"]
                    if room is not None
                    and time.time() - float(room["heartbeat"]) <= CAMERA_HEARTBEAT_TIMEOUT_SECONDS
                    else None
                )
            with database_connection(self.database_path) as connection:
                devices = connection.execute(
                    """
                    SELECT id, name, farm_name, paired_at, pair_expires_at, last_seen_at
                    FROM camera_devices WHERE user_id = ? ORDER BY created_at, id
                    """,
                    (user["id"],),
                ).fetchall()
            self._send_json(200, {
                "devices": [
                    {
                        "id": device["id"],
                        "name": device["name"],
                        "farm_name": device["farm_name"],
                        "paired": device["paired_at"] is not None,
                        "online": device["id"] == online_device_id,
                        "pairing_expires_at": device["pair_expires_at"] if device["pair_expires_at"] and device["pair_expires_at"] > now else None,
                        "last_seen_at": device["last_seen_at"],
                    }
                    for device in devices
                ]
            })
            return
        if self.command != "POST":
            self._send_json(405, {"error": "Method not allowed."})
            return
        if not self._require_same_origin():
            return
        payload = self._read_json()
        action = payload.get("action")
        if action == "create":
            name = valid_text(payload.get("name"), 100)
            farm_name = valid_text(payload.get("farm_name"), 120)
            code = secrets.token_urlsafe(9).upper()
            code_hash = hashlib.sha256(code.encode("utf-8")).digest()
            expires_at = int(time.time()) + CAMERA_PAIRING_TTL_SECONDS
            device_id = str(uuid.uuid4())
            with database_connection(self.database_path) as connection:
                connection.execute(
                    """
                    INSERT INTO camera_devices(id, user_id, name, farm_name, pair_code_hash, pair_expires_at, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    (device_id, user["id"], name, farm_name, code_hash, expires_at, int(time.time())),
                )
            self._send_json(201, {
                "device": {
                    "id": device_id,
                    "name": name,
                    "farm_name": farm_name,
                    "paired": False,
                    "online": False,
                    "pairing_expires_at": expires_at,
                },
                "pairing_code": code,
                "pairing_expires_at": expires_at,
            })
            return
        if action == "pair":
            device_id = valid_text(payload.get("device_id"), 64)
            code = secrets.token_urlsafe(9).upper()
            code_hash = hashlib.sha256(code.encode("utf-8")).digest()
            expires_at = int(time.time()) + CAMERA_PAIRING_TTL_SECONDS
            with database_connection(self.database_path) as connection:
                cursor = connection.execute(
                    """
                    UPDATE camera_devices
                    SET pair_code_hash = ?, pair_expires_at = ?, paired_at = NULL,
                        device_session_hash = NULL, last_seen_at = NULL
                    WHERE id = ? AND user_id = ?
                    """,
                    (code_hash, expires_at, device_id, user["id"]),
                )
                if cursor.rowcount != 1:
                    self._send_json(404, {"error": "Camera device was not found."})
                    return
            with self.camera_lock:
                room = self.camera_rooms.get(user["id"])
                if room and room.get("device_id") == device_id:
                    del self.camera_rooms[user["id"]]
            self._send_json(200, {"pairing_code": code, "pairing_expires_at": expires_at})
            return
        if action == "remove":
            device_id = valid_text(payload.get("device_id"), 64)
            with database_connection(self.database_path) as connection:
                cursor = connection.execute(
                    "DELETE FROM camera_devices WHERE id = ? AND user_id = ?",
                    (device_id, user["id"]),
                )
                if cursor.rowcount != 1:
                    self._send_json(404, {"error": "Camera device was not found."})
                    return
            with self.camera_lock:
                room = self.camera_rooms.get(user["id"])
                if room and room.get("device_id") == device_id:
                    del self.camera_rooms[user["id"]]
            self._send_json(200, {"ok": True})
            return
        self._send_json(400, {"error": "Unknown camera device action."})

    def _ice_servers(self) -> list[dict[str, object]]:
        configured = os.environ.get("FARMPROTECTOR_ICE_SERVERS")
        if not configured:
            return [{"urls": "stun:stun.l.google.com:19302"}]
        try:
            ice_servers = json.loads(configured)
        except json.JSONDecodeError as error:
            raise ValueError("Live camera ICE server configuration is invalid.") from error
        if not isinstance(ice_servers, list) or not ice_servers:
            raise ValueError("Live camera ICE server configuration is invalid.")
        for server in ice_servers:
            if not isinstance(server, dict):
                raise ValueError("Live camera ICE server configuration is invalid.")
            urls = server.get("urls")
            if not (
                isinstance(urls, str) and urls
                or isinstance(urls, list) and urls and all(isinstance(url, str) and url for url in urls)
            ):
                raise ValueError("Live camera ICE server configuration is invalid.")
            if any(url.startswith("turn:") or url.startswith("turns:") for url in ([urls] if isinstance(urls, str) else urls)):
                if not isinstance(server.get("username"), str) or not isinstance(server.get("credential"), str):
                    raise ValueError("TURN servers must include username and credential.")
        return ice_servers

    def _camera_room(self, user_id: str, session_id: str) -> dict[str, object] | None:
        room = self.camera_rooms.get(user_id)
        if room is None or room["session_id"] != session_id:
            return None
        if time.time() - float(room["heartbeat"]) > CAMERA_HEARTBEAT_TIMEOUT_SECONDS:
            del self.camera_rooms[user_id]
            return None
        return room

    def _handle_camera(
        self,
        path: str,
        user: sqlite3.Row,
        *,
        device: sqlite3.Row | None = None,
    ) -> None:
        if path == "/api/camera/status":
            if self.command != "GET":
                self._send_json(405, {"error": "Method not allowed."})
                return
            with self.camera_lock:
                room = self.camera_rooms.get(user["id"])
                online = room is not None and time.time() - float(room["heartbeat"]) <= CAMERA_HEARTBEAT_TIMEOUT_SECONDS
                if not online:
                    self.camera_rooms.pop(user["id"], None)
                self._send_json(200, {"online": online})
            return
        if path == "/api/camera/config":
            if self.command != "GET":
                self._send_json(405, {"error": "Method not allowed."})
                return
            self._send_json(200, {"ice_servers": self._ice_servers()})
            return

        if self.command == "GET" and path == "/api/camera/signals":
            parameters = parse_qs(urlparse(self.path).query)
            session_id = parameters.get("session_id", [""])[0]
            call_id = parameters.get("call_id", [""])[0]
            role = parameters.get("role", [""])[0]
            try:
                after = max(0, int(parameters.get("after", ["0"])[0]))
            except ValueError:
                self._send_json(400, {"error": "Invalid live camera signal cursor."})
                return
            if role not in ("camera", "viewer"):
                self._send_json(400, {"error": "Invalid live camera signal role."})
                return
            if device is not None and role != "camera":
                self._send_json(403, {"error": "Camera devices may only receive camera signals."})
                return
            with self.camera_lock:
                room = self._camera_room(user["id"], session_id)
                if room is None:
                    self._send_json(410, {"error": "The live camera is no longer connected."})
                    return
                if device and room.get("device_id") != device["id"]:
                    self._send_json(403, {"error": "This camera session belongs to another device."})
                    return
                call = room.get("call")
                if role == "camera" and call is None:
                    self._send_json(200, {"waiting": True, "candidates": [], "next_cursor": after})
                    return
                if role == "camera" and isinstance(call, dict) and call.get("ended"):
                    room["call"] = None
                    self._send_json(200, {"ended": True, "candidates": []})
                    return
                if role == "camera" and isinstance(call, dict):
                    call_id = call["id"]
                if not isinstance(call, dict) or call.get("id") != call_id:
                    self._send_json(410, {"error": "The live viewing session has ended."})
                    return
                if call.get("ended"):
                    if role == "camera":
                        room["call"] = None
                    self._send_json(200, {"ended": True, "candidates": []})
                    return
                candidates = [
                    {"id": candidate["id"], "candidate": candidate["candidate"]}
                    for candidate in call["candidates"]
                    if int(candidate["id"]) > after and candidate["role"] != role
                ]
                result: dict[str, object] = {
                    "call_id": call["id"],
                    "ended": False,
                    "candidates": candidates,
                    "next_cursor": max([after, *(int(candidate["id"]) for candidate in candidates)]),
                }
                if role == "camera":
                    result["offer"] = call.get("offer")
                else:
                    result["answer"] = call.get("answer")
                self._send_json(200, result)
            return

        if self.command != "POST":
            self._send_json(405, {"error": "Method not allowed."})
            return
        if not self._require_same_origin():
            return
        payload = self._read_json()
        action = payload.get("action")
        if path == "/api/camera/broadcast":
            if action == "start":
                if device is None:
                    with database_connection(self.database_path) as connection:
                        paired_devices = connection.execute(
                            "SELECT COUNT(*) FROM camera_devices WHERE user_id = ? AND paired_at IS NOT NULL",
                            (user["id"],),
                        ).fetchone()[0]
                    if paired_devices:
                        self._send_json(403, {"error": "Start the broadcast from its paired farm camera device."})
                        return
                with self.camera_lock:
                    room = {
                        "session_id": secrets.token_urlsafe(24),
                        "heartbeat": time.time(),
                        "call": None,
                        "device_id": device["id"] if device else None,
                    }
                    self.camera_rooms[user["id"]] = room
                    try:
                        ice_servers = self._ice_servers()
                    except ValueError:
                        del self.camera_rooms[user["id"]]
                        raise
                    self._send_json(201, {
                        "session_id": room["session_id"],
                        "ice_servers": ice_servers,
                    })
                return
            session_id = valid_text(payload.get("session_id"), 100)
            with self.camera_lock:
                room = self._camera_room(user["id"], session_id)
                if room is None:
                    self._send_json(410, {"error": "The live camera session has expired."})
                    return
                if device is None and room.get("device_id") is not None:
                    self._send_json(403, {"error": "Only the paired camera device can control its broadcast."})
                    return
                if device is not None and room.get("device_id") != device["id"]:
                    self._send_json(403, {"error": "This camera session belongs to another device."})
                    return
                if action == "heartbeat":
                    room["heartbeat"] = time.time()
                    self._send_json(200, {"ok": True})
                elif action == "stop":
                    del self.camera_rooms[user["id"]]
                    self._send_json(200, {"ok": True})
                else:
                    self._send_json(400, {"error": "Unknown live camera action."})
            return

        if path == "/api/camera/view":
            if action == "start":
                if device is not None:
                    self._send_json(403, {"error": "Use the farm account on a separate device to view this camera."})
                    return
                device_id = payload.get("device_id")
                with self.camera_lock:
                    room = self.camera_rooms.get(user["id"])
                    if room is None or time.time() - float(room["heartbeat"]) > CAMERA_HEARTBEAT_TIMEOUT_SECONDS:
                        self.camera_rooms.pop(user["id"], None)
                        self._send_json(404, {"error": "No live crop camera is online for this account."})
                        return
                    if device_id and room.get("device_id") != device_id:
                        self._send_json(404, {"error": "The selected farm camera is not online."})
                        return
                    if room.get("call") is not None:
                        self._send_json(409, {"error": "The live camera is already being viewed."})
                        return
                    call = {
                        "id": secrets.token_urlsafe(18),
                        "offer": None,
                        "answer": None,
                        "candidates": [],
                        "next_candidate_id": 0,
                        "ended": False,
                    }
                    room["call"] = call
                    self._send_json(201, {"call_id": call["id"], "session_id": room["session_id"]})
                return
            call_id = valid_text(payload.get("call_id"), 100)
            if device is not None:
                self._send_json(403, {"error": "Only the farm account can stop the live viewer."})
                return
            with self.camera_lock:
                room = self.camera_rooms.get(user["id"])
                call = room.get("call") if room is not None else None
                if not isinstance(call, dict) or call.get("id") != call_id:
                    self._send_json(410, {"error": "The live viewing session has ended."})
                    return
                call["ended"] = True
                self._send_json(200, {"ok": True})
            return

        if path == "/api/camera/signal":
            session_id = valid_text(payload.get("session_id"), 100)
            call_id = valid_text(payload.get("call_id"), 100)
            role = payload.get("role")
            kind = payload.get("type")
            data = payload.get("data")
            if device is not None and role != "camera":
                self._send_json(403, {"error": "Camera devices may only send camera signals."})
                return
            with self.camera_lock:
                room = self._camera_room(user["id"], session_id)
                call = room.get("call") if room is not None else None
                if device is not None and room is not None and room.get("device_id") != device["id"]:
                    self._send_json(403, {"error": "This camera session belongs to another device."})
                    return
                if device is None and room is not None and room.get("device_id") is not None and role != "viewer":
                    self._send_json(403, {"error": "Use the paired device to send camera signals."})
                    return
                if not isinstance(call, dict) or call.get("id") != call_id or call.get("ended"):
                    self._send_json(410, {"error": "The live viewing session has ended."})
                    return
                if role not in ("camera", "viewer"):
                    self._send_json(400, {"error": "Invalid live camera signal role."})
                    return
                if kind in ("offer", "answer"):
                    expected_role = "viewer" if kind == "offer" else "camera"
                    if role != expected_role or not isinstance(data, dict) or not isinstance(data.get("sdp"), str):
                        self._send_json(400, {"error": "Invalid WebRTC session description."})
                        return
                    if len(data["sdp"]) > MAX_BODY_BYTES:
                        self._send_json(413, {"error": "WebRTC session description is too large."})
                        return
                    call[kind] = {"type": kind, "sdp": data["sdp"]}
                elif kind == "candidate":
                    if not isinstance(data, dict) or not isinstance(data.get("candidate"), str):
                        self._send_json(400, {"error": "Invalid WebRTC network candidate."})
                        return
                    if len(data["candidate"]) > 2048:
                        self._send_json(413, {"error": "WebRTC network candidate is too large."})
                        return
                    call["next_candidate_id"] += 1
                    call["candidates"].append({
                        "id": call["next_candidate_id"],
                        "role": role,
                        "candidate": {
                            "candidate": data["candidate"][:2048],
                            "sdpMid": data.get("sdpMid"),
                            "sdpMLineIndex": data.get("sdpMLineIndex"),
                            "usernameFragment": data.get("usernameFragment"),
                        },
                    })
                else:
                    self._send_json(400, {"error": "Unknown live camera signal type."})
                    return
                self._send_json(200, {"ok": True})
            return

        self._send_json(404, {"error": "Camera API route not found."})

    def _handle_profile(self, user: sqlite3.Row) -> None:
        if self.command == "GET":
            self._send_json(200, {"profile": dict(user)})
            return
        if self.command != "PUT":
            self._send_json(405, {"error": "Method not allowed."})
            return
        if not self._require_same_origin():
            return
        payload = self._read_json()
        name = valid_text(payload.get("name"), 100)
        farm_name = valid_text(payload.get("farm_name"), 120)
        crops = valid_text(payload.get("crops"), 240)
        bio = valid_text(payload.get("bio", ""), 1000, required=False)
        with database_connection(self.database_path) as connection:
            connection.execute(
                "UPDATE profiles SET name = ?, farm_name = ?, crops = ?, bio = ? WHERE user_id = ?",
                (name, farm_name, crops, bio, user["id"]),
            )
        self._send_json(200, {"profile": self._public_user(user["id"])})

    def _handle_farms(self, user: sqlite3.Row) -> None:
        if self.command == "GET":
            with database_connection(self.database_path) as connection:
                rows = connection.execute(
                    """
                    SELECT id, name, location, latitude, longitude, fields, crop, status
                    FROM farms WHERE user_id = ? ORDER BY created_at, id
                    """,
                    (user["id"],),
                ).fetchall()
            self._send_json(200, {"farms": [dict(row) for row in rows]})
            return
        if self.command != "POST":
            self._send_json(405, {"error": "Method not allowed."})
            return
        if not self._require_same_origin():
            return
        payload = self._read_json()
        name = valid_text(payload.get("name"), 80)
        location = valid_text(payload.get("location"), 120)
        crop = valid_text(payload.get("crop"), 80)
        try:
            latitude = float(payload.get("latitude"))
            longitude = float(payload.get("longitude"))
            fields = int(payload.get("fields"))
        except (TypeError, ValueError, OverflowError) as error:
            raise ValueError("Enter valid coordinates and a field count.") from error
        if not (-90 <= latitude <= 90 and -180 <= longitude <= 180 and 1 <= fields <= 999):
            raise ValueError("Enter valid coordinates and a field count.")
        farm = {
            "id": str(uuid.uuid4()),
            "name": name,
            "location": location,
            "latitude": latitude,
            "longitude": longitude,
            "fields": fields,
            "crop": crop,
            "status": "Monitoring",
        }
        with database_connection(self.database_path) as connection:
            connection.execute(
                """
                INSERT INTO farms(id, user_id, name, location, latitude, longitude, fields, crop, status, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                (
                    farm["id"], user["id"], name, location, latitude, longitude,
                    fields, crop, farm["status"], int(time.time()),
                ),
            )
        self._send_json(201, {"farm": farm})

    def _is_database_file_request(self) -> bool:
        requested_path = Path(self.translate_path(self.path)).resolve()
        database_path = self.database_path.resolve()
        private_paths = {
            database_path,
            Path(f"{database_path}-wal"),
            Path(f"{database_path}-shm"),
            Path(f"{database_path}-journal"),
        }
        return requested_path in private_paths

    def do_GET(self) -> None:
        if urlparse(self.path).path.startswith("/api/"):
            try:
                self._handle_api()
            except ValueError as error:
                self.log_error("Invalid API configuration or request: %s", error)
                self._send_json(500, {"error": "The live camera service is misconfigured. Please contact the site administrator."})
            except (sqlite3.Error, OSError) as error:
                self.log_error("Database or request processing failed: %s", error)
                self._send_json(500, {"error": "The request could not be completed. Please try again."})
            return
        if self._is_database_file_request():
            self.send_error(404)
            return
        super().do_GET()

    def do_HEAD(self) -> None:
        if self._is_database_file_request():
            self.send_error(404)
            return
        super().do_HEAD()

    def do_POST(self) -> None:
        self._dispatch_write()

    def do_PUT(self) -> None:
        self._dispatch_write()

    def do_DELETE(self) -> None:
        self._dispatch_write()

    def _dispatch_write(self) -> None:
        if not urlparse(self.path).path.startswith("/api/"):
            self._send_json(404, {"error": "Route not found."})
            return
        try:
            self._handle_api()
        except ValueError as error:
            self._send_json(400, {"error": str(error)})
        except (sqlite3.Error, OSError) as error:
            self.log_error("Database or request processing failed: %s", error)
            self._send_json(500, {"error": "The request could not be completed. Please try again."})

    def log_message(self, format: str, *args: object) -> None:
        super().log_message(format, *args)


def create_server(host: str, port: int, database_path: Path) -> ThreadingHTTPServer:
    initialize_database(database_path)
    handler = type(
        "ConfiguredFarmProtectorHandler",
        (FarmProtectorHandler,),
        {
            "database_path": database_path,
            "secure_cookies": os.environ.get("FARMPROTECTOR_SECURE_COOKIES", "").lower() == "true",
            "google_maps_api_key": os.environ.get("GOOGLE_MAPS_API_KEY", "").strip(),
            "google_oauth_client_id": os.environ.get("GOOGLE_OAUTH_CLIENT_ID", "").strip(),
            "google_oauth_client_secret": os.environ.get("GOOGLE_OAUTH_CLIENT_SECRET", "").strip(),
            "directory": str(BASE_DIR),
        },
    )
    return ThreadingHTTPServer((host, port), handler)


def main() -> None:
    host = os.environ.get("FARMPROTECTOR_HOST", "127.0.0.1")
    port = int(os.environ.get("PORT", "8000"))
    server = create_server(host, port, DATABASE_PATH)
    print(f"Farm Protector is running at http://{host}:{port}/")
    print(f"Farm profiles and records are stored in {DATABASE_PATH}")
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nStopping Farm Protector.")
    finally:
        server.server_close()


if __name__ == "__main__":
    main()
