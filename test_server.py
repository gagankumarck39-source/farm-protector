import http.cookiejar
from io import BytesIO
import json
import os
import tempfile
import threading
import time
import unittest
from unittest.mock import patch
from urllib.parse import urlencode
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import HTTPCookieProcessor, Request, build_opener

from server import BASE_DIR, FarmProtectorHandler, create_server, database_connection


class FarmProtectorServerTests(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.database_path = Path(self.temp_dir.name) / "test.sqlite3"
        FarmProtectorHandler.login_attempts.clear()
        FarmProtectorHandler.pairing_attempts.clear()
        FarmProtectorHandler.camera_rooms.clear()
        self._start_server()

    def tearDown(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=3)
        self.temp_dir.cleanup()

    def _start_server(self, opener=None):
        self.server = create_server("127.0.0.1", 0, self.database_path)
        self.thread = threading.Thread(target=self.server.serve_forever, daemon=True)
        self.thread.start()
        self.base_url = f"http://127.0.0.1:{self.server.server_port}"
        self.opener = opener or build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def request(self, path, method="GET", payload=None, opener=None, origin=True):
        headers = {}
        data = None
        if payload is not None:
            headers["Content-Type"] = "application/json"
            data = json.dumps(payload).encode("utf-8")
        if origin:
            headers["Origin"] = self.base_url
        request = Request(f"{self.base_url}{path}", data=data, headers=headers, method=method)
        client = opener or self.opener
        try:
            with client.open(request) as response:
                return response.status, json.loads(response.read())
        except HTTPError as error:
            return error.code, json.loads(error.read())

    def register(self, opener=None, email="farmer@example.com"):
        return self.request(
            "/api/auth/register",
            method="POST",
            payload={
                "email": email,
                "password": "A-long-farm-password-2026",
                "name": "Asha Rao",
                "farm_name": "Green Valley",
                "crops": "Rice, vegetables",
                "bio": "Growing crops near Bengaluru.",
            },
            opener=opener,
        )

    def test_google_maps_config_exposes_only_the_server_configured_key_without_login(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=3)

        with patch.dict(os.environ, {"GOOGLE_MAPS_API_KEY": "restricted-test-key"}):
            self._start_server()
            status, config = self.request("/api/map-config")

        self.assertEqual(status, 200)
        self.assertEqual(config, {"google_maps_api_key": "restricted-test-key"})

    def test_map_tiles_require_login_and_reject_invalid_coordinates(self):
        anonymous_opener = build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))
        request = Request(f"{self.base_url}/api/map-tiles/osm/3/8/0.png")
        with self.assertRaises(HTTPError) as error:
            anonymous_opener.open(request)
        self.assertEqual(error.exception.code, 401)

        self.register()
        with patch("server.urlopen") as tile_provider:
            with self.assertRaises(HTTPError) as error:
                self.opener.open(request)

        self.assertEqual(error.exception.code, 404)
        tile_provider.assert_not_called()

    def test_map_tile_endpoint_returns_provider_png_to_signed_in_user(self):
        self.register()
        tile_data = b"\x89PNG\r\n\x1a\nfarm-map-tile"
        with patch("server.urlopen", return_value=BytesIO(tile_data)) as tile_provider:
            request = Request(f"{self.base_url}/api/map-tiles/osm/3/7/4.png")
            with self.opener.open(request) as response:
                self.assertEqual(response.status, 200)
                self.assertEqual(response.headers.get_content_type(), "image/png")
                self.assertEqual(response.headers.get("Cache-Control"), "private, max-age=86400")
                self.assertEqual(response.read(), tile_data)

        provider_request = tile_provider.call_args.args[0]
        self.assertEqual(provider_request.full_url, "https://tile.openstreetmap.org/3/7/4.png")
        self.assertEqual(provider_request.get_header("User-agent"), "FarmProtector/1.0")

    def test_google_sign_in_links_verified_email_and_creates_a_session(self):
        status, created = self.register(email="farmer@example.com")
        self.assertEqual(status, 201)
        original_name = created["user"]["name"]

        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=3)
        with patch.dict(os.environ, {
            "GOOGLE_OAUTH_CLIENT_ID": "google-client-id",
            "GOOGLE_OAUTH_CLIENT_SECRET": "google-client-secret",
        }):
            self._start_server(self.opener)
            status, config = self.request("/api/auth/google/config")
            self.assertEqual(status, 200)
            self.assertEqual(config, {"enabled": True, "client_id": "google-client-id"})

            status, state_result = self.request(
                "/api/auth/google/state",
                method="POST",
                payload={},
            )
            self.assertEqual(status, 200)
            state = state_result["state"]

            identity = {
                "aud": "google-client-id",
                "iss": "https://accounts.google.com",
                "exp": str(int(time.time()) + 300),
                "email_verified": "true",
                "email": "farmer@example.com",
                "sub": "google-subject-123",
                "name": "Google Profile Name",
            }
            provider_responses = [
                BytesIO(json.dumps({"id_token": "verified-test-token"}).encode()),
                BytesIO(json.dumps(identity).encode()),
            ]
            with patch("server.urlopen", side_effect=provider_responses):
                status, result = self.request(
                    "/api/auth/google/login",
                    method="POST",
                    payload={"code": "one-time-authorization-code", "state": state},
                )

        self.assertEqual(status, 200)
        self.assertEqual(result["user"]["name"], original_name)
        self.assertEqual(self.request("/api/session")[0], 200)
        with database_connection(self.database_path) as connection:
            user = connection.execute(
                "SELECT google_sub FROM users WHERE email = ?",
                ("farmer@example.com",),
            ).fetchone()
        self.assertEqual(user["google_sub"], "google-subject-123")

    def test_google_sign_in_rejects_a_mismatched_oauth_state(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=3)
        with patch.dict(os.environ, {
            "GOOGLE_OAUTH_CLIENT_ID": "google-client-id",
            "GOOGLE_OAUTH_CLIENT_SECRET": "google-client-secret",
        }):
            self._start_server()
            status, state_result = self.request(
                "/api/auth/google/state",
                method="POST",
                payload={},
            )
            self.assertEqual(status, 200)
            with patch("server.urlopen") as google_request:
                status, error = self.request(
                    "/api/auth/google/login",
                    method="POST",
                    payload={"code": "one-time-authorization-code", "state": "wrong-state"},
                )

        self.assertEqual(status, 403)
        self.assertIn("expired", error["error"])
        google_request.assert_not_called()

    def test_google_sign_in_creates_a_basic_profile_for_a_new_user(self):
        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=3)
        with patch.dict(os.environ, {
            "GOOGLE_OAUTH_CLIENT_ID": "google-client-id",
            "GOOGLE_OAUTH_CLIENT_SECRET": "google-client-secret",
        }):
            self._start_server()
            status, state_result = self.request(
                "/api/auth/google/state",
                method="POST",
                payload={},
            )
            self.assertEqual(status, 200)
            identity = {
                "aud": "google-client-id",
                "iss": "accounts.google.com",
                "exp": str(int(time.time()) + 300),
                "email_verified": True,
                "email": "new-farmer@example.com",
                "sub": "new-google-subject",
                "name": "New Google Farmer",
            }
            provider_responses = [
                BytesIO(json.dumps({"id_token": "verified-test-token"}).encode()),
                BytesIO(json.dumps(identity).encode()),
            ]
            with patch("server.urlopen", side_effect=provider_responses):
                status, result = self.request(
                    "/api/auth/google/login",
                    method="POST",
                    payload={"code": "one-time-authorization-code", "state": state_result["state"]},
                )

        self.assertEqual(status, 200)
        self.assertEqual(result["user"]["email"], "new-farmer@example.com")
        self.assertEqual(result["user"]["name"], "New Google Farmer")
        self.assertEqual(result["user"]["farm_name"], "My Farm")
        self.assertEqual(result["user"]["crops"], "Not specified")
        self.assertEqual(self.request("/api/session")[0], 200)

    def test_profile_and_farm_records_persist_and_are_account_scoped(self):
        status, created = self.register()
        self.assertEqual(status, 201)
        self.assertEqual(created["user"]["name"], "Asha Rao")
        self.assertEqual(self.request("/api/session")[0], 200)

        status, updated = self.request(
            "/api/profile",
            method="PUT",
            payload={
                "name": "Asha Rao",
                "farm_name": "Updated Valley",
                "crops": "Rice",
                "bio": "Organic grower.",
            },
        )
        self.assertEqual(status, 200)
        self.assertEqual(updated["profile"]["farm_name"], "Updated Valley")
        self.assertEqual(updated["profile"]["bio"], "Organic grower.")

        status, created_farm = self.request(
            "/api/farms",
            method="POST",
            payload={
                "name": "North Plot",
                "location": "Bengaluru, Karnataka",
                "latitude": 12.9716,
                "longitude": 77.5946,
                "fields": 3,
                "crop": "Rice",
            },
        )
        self.assertEqual(status, 201)
        self.assertEqual(created_farm["farm"]["name"], "North Plot")
        self.assertEqual(self.request("/api/farms")[1]["farms"][0]["id"], created_farm["farm"]["id"])

        other_opener = build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))
        self.assertEqual(self.register(opener=other_opener, email="other@example.com")[0], 201)
        status, other_farms = self.request("/api/farms", opener=other_opener)
        self.assertEqual(status, 200)
        self.assertEqual(other_farms["farms"], [])

        self.server.shutdown()
        self.server.server_close()
        self.thread.join(timeout=3)
        self._start_server(self.opener)
        status, persisted_profile = self.request("/api/profile")
        self.assertEqual(status, 200)
        self.assertEqual(persisted_profile["profile"]["farm_name"], "Updated Valley")
        self.assertEqual(len(self.request("/api/farms")[1]["farms"]), 1)

    def test_registration_rejects_weak_password_and_cross_origin(self):
        payload = {
            "email": "weak@example.com",
            "password": "short",
            "name": "Farmer",
            "farm_name": "Farm",
            "crops": "Rice",
            "bio": "",
        }
        status, error = self.request("/api/auth/register", method="POST", payload=payload)
        self.assertEqual(status, 400)
        self.assertIn("Password", error["error"])

        status, error = self.request(
            "/api/auth/register",
            method="POST",
            payload={**payload, "password": "A-long-farm-password-2026"},
            origin=False,
        )
        self.assertEqual(status, 403)
        self.assertIn("origin", error["error"])

    def test_private_api_requires_a_signed_in_user(self):
        status, error = self.request("/api/farms")
        self.assertEqual(status, 401)
        self.assertIn("Sign in", error["error"])

    def test_database_file_is_not_served_as_a_static_asset(self):
        descriptor, database_name = tempfile.mkstemp(
            prefix=".farm-protector-private-test-",
            suffix=".sqlite3",
            dir=BASE_DIR,
        )
        os.close(descriptor)
        database_path = Path(database_name)
        private_server = create_server("127.0.0.1", 0, database_path)
        private_thread = threading.Thread(target=private_server.serve_forever, daemon=True)
        private_thread.start()
        url = f"http://127.0.0.1:{private_server.server_port}/{database_path.name}"
        try:
            for method in ("GET", "HEAD"):
                request = Request(url, method=method)
                with self.assertRaises(HTTPError) as raised:
                    self.opener.open(request)
                self.assertEqual(raised.exception.code, 404)
        finally:
            private_server.shutdown()
            private_server.server_close()
            private_thread.join(timeout=3)
            for suffix in ("", "-wal", "-shm", "-journal"):
                Path(f"{database_path}{suffix}").unlink(missing_ok=True)

    def test_live_camera_signaling_is_private_and_exchanges_web_rtc_messages(self):
        self.assertEqual(self.register()[0], 201)
        self.assertEqual(self.request("/api/camera/status")[1]["online"], False)
        status, config = self.request("/api/camera/config")
        self.assertEqual(status, 200)
        self.assertTrue(config["ice_servers"])

        status, broadcast = self.request(
            "/api/camera/broadcast",
            method="POST",
            payload={"action": "start"},
        )
        self.assertEqual(status, 201)
        session_id = broadcast["session_id"]

        status, call = self.request(
            "/api/camera/view",
            method="POST",
            payload={"action": "start"},
        )
        self.assertEqual(status, 201)
        call_id = call["call_id"]
        duplicate_status, _ = self.request(
            "/api/camera/view",
            method="POST",
            payload={"action": "start"},
        )
        self.assertEqual(duplicate_status, 409)
        camera_query = urlencode({
            "session_id": session_id,
            "call_id": "",
            "role": "camera",
            "after": "0",
        })
        status, initial_signals = self.request(f"/api/camera/signals?{camera_query}")
        self.assertEqual(status, 200)
        self.assertIsNone(initial_signals["offer"])
        self.assertEqual(initial_signals["call_id"], call_id)

        offer = {"type": "offer", "sdp": "test-viewer-offer"}
        status, _ = self.request(
            "/api/camera/signal",
            method="POST",
            payload={
                "session_id": session_id,
                "call_id": call_id,
                "role": "viewer",
                "type": "offer",
                "data": offer,
            },
        )
        self.assertEqual(status, 200)
        camera_query = urlencode({
            "session_id": session_id,
            "call_id": call_id,
            "role": "camera",
            "after": "0",
        })
        status, incoming = self.request(f"/api/camera/signals?{camera_query}")
        self.assertEqual(status, 200)
        self.assertEqual(incoming["offer"], offer)

        viewer_candidate = {
            "candidate": "candidate:viewer-network-path",
            "sdpMid": "0",
            "sdpMLineIndex": 0,
            "usernameFragment": "viewer",
        }
        status, _ = self.request(
            "/api/camera/signal",
            method="POST",
            payload={
                "session_id": session_id,
                "call_id": call_id,
                "role": "viewer",
                "type": "candidate",
                "data": viewer_candidate,
            },
        )
        self.assertEqual(status, 200)
        status, incoming = self.request(f"/api/camera/signals?{camera_query}")
        self.assertEqual(status, 200)
        self.assertEqual(incoming["candidates"][0]["candidate"], viewer_candidate)
        self.assertEqual(incoming["next_cursor"], incoming["candidates"][0]["id"])

        answer = {"type": "answer", "sdp": "test-camera-answer"}
        status, _ = self.request(
            "/api/camera/signal",
            method="POST",
            payload={
                "session_id": session_id,
                "call_id": call_id,
                "role": "camera",
                "type": "answer",
                "data": answer,
            },
        )
        self.assertEqual(status, 200)
        camera_candidate = {
            "candidate": "candidate:camera-network-path",
            "sdpMid": "0",
            "sdpMLineIndex": 0,
            "usernameFragment": "camera",
        }
        status, _ = self.request(
            "/api/camera/signal",
            method="POST",
            payload={
                "session_id": session_id,
                "call_id": call_id,
                "role": "camera",
                "type": "candidate",
                "data": camera_candidate,
            },
        )
        self.assertEqual(status, 200)
        viewer_query = urlencode({
            "session_id": session_id,
            "call_id": call_id,
            "role": "viewer",
            "after": "0",
        })
        status, received = self.request(f"/api/camera/signals?{viewer_query}")
        self.assertEqual(status, 200)
        self.assertEqual(received["answer"], answer)
        self.assertEqual(received["candidates"][0]["candidate"], camera_candidate)

        status, _ = self.request(
            "/api/camera/view",
            method="POST",
            payload={"action": "stop", "call_id": call_id},
        )
        self.assertEqual(status, 200)
        status, ended = self.request(f"/api/camera/signals?{camera_query}")
        self.assertEqual(status, 200)
        self.assertTrue(ended["ended"])

        other_opener = build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))
        self.assertEqual(self.register(opener=other_opener, email="camera-other@example.com")[0], 201)
        self.assertFalse(self.request("/api/camera/status", opener=other_opener)[1]["online"])
        status, error = self.request(
            "/api/camera/view",
            method="POST",
            payload={"action": "start"},
            opener=other_opener,
        )
        self.assertEqual(status, 404)
        self.assertIn("No live crop camera", error["error"])

        status, _ = self.request(
            "/api/camera/broadcast",
            method="POST",
            payload={"action": "stop", "session_id": session_id},
        )
        self.assertEqual(status, 200)
        self.assertFalse(self.request("/api/camera/status")[1]["online"])

    def test_camera_signaling_requires_authentication(self):
        status, error = self.request("/api/camera/status")
        self.assertEqual(status, 401)
        self.assertIn("Sign in", error["error"])

    def test_camera_device_pairing_is_single_use_and_streams_under_account(self):
        self.assertEqual(self.register()[0], 201)
        status, created = self.request(
            "/api/devices",
            method="POST",
            payload={
                "action": "create",
                "name": "North Field Phone",
                "farm_name": "Green Valley",
            },
        )
        self.assertEqual(status, 201)
        device = created["device"]
        pairing_code = created["pairing_code"]
        self.assertEqual(len(pairing_code), 12)
        self.assertEqual(device["name"], "North Field Phone")
        self.assertEqual(device["farm_name"], "Green Valley")
        self.assertEqual(device["paired"], False)

        device_opener = build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))
        status, paired = self.request(
            "/api/device/pair",
            method="POST",
            payload={"code": pairing_code.lower()},
            opener=device_opener,
        )
        self.assertEqual(status, 200)
        self.assertEqual(paired["device"]["name"], device["name"])
        self.assertEqual(self.request("/api/device/session", opener=device_opener)[0], 200)

        status, error = self.request(
            "/api/device/pair",
            method="POST",
            payload={"code": pairing_code},
            opener=build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar())),
        )
        self.assertEqual(status, 401)
        self.assertIn("invalid or expired", error["error"])

        status, device_session = self.request("/api/device/session", opener=device_opener)
        self.assertEqual(status, 200)
        self.assertEqual(device_session["device"]["farm_name"], "Green Valley")
        status, broadcast = self.request(
            "/api/camera/broadcast",
            method="POST",
            payload={"action": "start"},
            opener=device_opener,
        )
        self.assertEqual(status, 201)
        session_id = broadcast["session_id"]

        status, cameras = self.request("/api/devices")
        self.assertEqual(status, 200)
        self.assertEqual(len(cameras["devices"]), 1)
        self.assertTrue(cameras["devices"][0]["online"])
        self.assertTrue(cameras["devices"][0]["paired"])

        status, view = self.request(
            "/api/camera/view",
            method="POST",
            payload={"action": "start", "device_id": device["id"]},
        )
        self.assertEqual(status, 201)
        call_id = view["call_id"]
        status, _ = self.request(
            "/api/camera/signal",
            method="POST",
            payload={
                "session_id": session_id,
                "call_id": call_id,
                "role": "viewer",
                "type": "offer",
                "data": {"type": "offer", "sdp": "camera-device-offer"},
            },
        )
        self.assertEqual(status, 200)
        camera_query = urlencode({
            "session_id": session_id,
            "call_id": "",
            "role": "camera",
            "after": "0",
        })
        status, offer = self.request(
            f"/api/camera/signals?{camera_query}",
            opener=device_opener,
        )
        self.assertEqual(status, 200)
        self.assertEqual(offer["offer"]["sdp"], "camera-device-offer")
        status, _ = self.request(
            "/api/camera/broadcast",
            method="POST",
            payload={"action": "stop", "session_id": session_id},
            opener=device_opener,
        )
        self.assertEqual(status, 200)

        status, new_code = self.request(
            "/api/devices",
            method="POST",
            payload={"action": "pair", "device_id": device["id"]},
        )
        self.assertEqual(status, 200)
        self.assertEqual(self.request("/api/device/session", opener=device_opener)[0], 401)
        self.assertNotEqual(new_code["pairing_code"], pairing_code)
        self.assertEqual(
            self.request(
                "/api/devices",
                method="POST",
                payload={"action": "remove", "device_id": device["id"]},
            )[0],
            200,
        )
        self.assertEqual(self.request("/api/devices")[1]["devices"], [])


if __name__ == "__main__":
    unittest.main()
