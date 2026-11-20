# Farm Protector Crop Monitor

A responsive agricultural monitoring dashboard with a Python/SQLite account and farm-record backend.

## Run locally

From this folder, start the application server:

```bash
python server.py
```

Then open <http://localhost:8000>. Use **Create an account** to register. Passwords must be at least 10 characters. The SQLite database is created outside the website folder at `~/.farm-protector/farm-protector.sqlite3` (on Windows, under your user profile folder); back it up to preserve accounts, profiles, sessions, and farm records. Set `FARMPROTECTOR_DB` to choose another protected path.

Run the backend tests with:

```bash
python -m unittest -v
```

Do not use `python -m http.server` for this version: it serves the page files but does not provide login or database APIs.

## Deploy to Render

The included `render.yaml` configures a single-instance Render web service with HTTPS, secure session cookies, and a persistent disk for the SQLite database. The persistent disk requires a paid Render instance; without it, user accounts and farm records could be lost when the service restarts or redeploys.

1. Create a private GitHub repository and push this project to it. Do not commit database files, secrets, or user data.
2. In Render, choose **New** → **Blueprint**, connect the repository, and apply the `render.yaml` blueprint.
3. Wait for the first deploy to finish, then open the `onrender.com` URL shown in the Render dashboard and create an account.
4. Keep the service at one instance while using its SQLite disk. Back up the persistent disk regularly.

The app does not require a dependency-install step. Camera access works only over HTTPS; remote camera connections on restrictive networks may additionally require a TURN relay, configured with `FARMPROTECTOR_ICE_SERVERS`.

## Google sign-in

Create an OAuth 2.0 **Web application** client in Google Cloud, enable the Google Identity Services authorization code flow, configure the OAuth consent screen, and add each site origin (for example, `http://localhost:8000`) to **Authorized JavaScript origins**. No redirect URL is needed for the GIS popup flow. Keep the client secret on the server; do not put it in HTML, JavaScript, or source control.

Set `GOOGLE_OAUTH_CLIENT_ID` and `GOOGLE_OAUTH_CLIENT_SECRET` in the server environment. On Render, add them as service environment variables. Restart the server after configuring both values. **Continue with Google** is shown on the login page; it becomes available when both credentials are configured and otherwise displays a setup notice. Users can sign in to an existing account with its verified Google email, or Google sign-in will create a basic farm profile automatically. Existing accounts linked to a different Google identity are not reassigned.

## Accounts and saved records

Each account has its own farmer name, farm name, crops, and short bio. Profile edits and farms added from **Farm Map** are stored on the server and scoped to the signed-in account. Sign-out invalidates the server session. Sessions use random, server-stored tokens in HttpOnly, SameSite cookies; passwords are stored as salted PBKDF2-HMAC-SHA256 hashes, never as plain text. The API requires same-origin writes, enforces input limits, and rate-limits repeated account/login attempts per server process.

This is a self-hosted starter, not a complete public identity service: it does not include email verification or password reset, and the SQLite file is not encrypted at rest. For an internet-facing deployment, use HTTPS, set `FARMPROTECTOR_SECURE_COOKIES=true`, restrict access to the host and database file, configure backups, and add operational monitoring. Keep the database outside public/static file hosting. The built-in rate limiter is per process, so use an edge or reverse-proxy rate limit for a multi-process deployment. The default server binds only to `127.0.0.1`; expose it only behind a properly configured HTTPS reverse proxy.

## Included features

- Dashboard with sensor telemetry cards
- Sensor averages and temperature trends for today, 7 days, 30 days, or a custom date range
- Crop health image analysis with local visual color percentages and comparison to the previous upload
- Live phone-camera crop viewing through WebRTC
- AI farmer assistant with multilingual response styling
- AI chart assistant with natural-language chart examples
- Drone fleet, farm map, alerts, reports, crop calendar, and expense views
- Dark mode, mobile bottom navigation, language selection, and toast notifications

## Farm map and crop analysis

Set `GOOGLE_MAPS_API_KEY` to a Google Maps JavaScript API key to use Google Maps, including its map/satellite switcher and Street View control. The app reads the key from the server and loads it only when the map is opened. Google Maps requires billing to be enabled. Restrict the key in Google Cloud to the **Maps JavaScript API** and allowed website referrers such as `http://localhost:8000/*` and your deployed domain; the browser must receive the key, so referrer/API restrictions are essential. Never commit a real key to source control.

On Windows PowerShell, set the key before starting the app:

```powershell
$env:GOOGLE_MAPS_API_KEY = "YOUR_RESTRICTED_KEY"
python server.py
```

For the Render Blueprint, enter the key as the `GOOGLE_MAPS_API_KEY` environment variable when prompted. Without a key, or if Google Maps cannot load, the existing OpenStreetMap map remains available as a backup.

Use **Farm Map** or **Farms & Fields** to add farms with their address, crop, field count, and latitude/longitude. Farm records are saved to the signed-in account and shown in both views. Farm details can be minimized or expanded from **Farms & Fields**. Use the **Live location** control to show and follow the browser's current GPS position, including its estimated accuracy area; map zoom controls are available. Location access requires browser permission and a secure context such as HTTPS or localhost.

Use **Maximize map** for a full-screen location view and **Minimize map** or Escape to return to the page. **Show all farms** stops live-location following, clears the temporary GPS marker, and recenters the map on your saved farms.

Interactive map tiles require an internet connection on the server. The app loads OpenStreetMap tiles through its signed-in, same-origin server endpoint so browser restrictions on third-party tile requests do not prevent the street map from loading. If OpenStreetMap is unavailable, the map tries CARTO Voyager through the same endpoint; if both providers are unreachable, saved farms remain visible in a coordinate map. In that fallback, choose **Find my location** and allow browser location access to plot your GPS position and coordinates without street tiles. Choose **Retry interactive map** to try restoring the street map.

Crop image percentages are calculated in the browser from green and yellow/brown pixel colors. They are visual estimates, not an AI diagnosis; use similar images of the same field for comparisons. The last crop-analysis baseline remains local to that browser.

## Live crop camera

Open **Live Crop Camera** in the farm account, add a camera device with its name and farm, and copy the one-time pairing code. On the farm phone, open `camera-device.html`, enter the code, allow camera access, and choose **Start camera broadcast**. On another device, sign into the same account, select that camera, and choose **Watch live crops**. Pairing codes expire after 10 minutes and can only be used once; re-pairing revokes the old phone's device session. The phone must remain powered, awake, connected, and keep the camera setup page open; mobile browsers may pause video when the screen locks or the tab is backgrounded. Only one viewer can connect to a camera at a time. Video is streamed over WebRTC and is not saved.

Camera access and remote viewing require the site to be hosted on a public HTTPS domain. The server's default STUN configuration may connect on some networks, but it cannot guarantee access across restrictive cellular, Wi-Fi, and farm-network NATs. For reliable viewing from anywhere, configure a TURN relay service and set `FARMPROTECTOR_ICE_SERVERS` in the server environment to JSON, for example:

```powershell
$env:FARMPROTECTOR_ICE_SERVERS='[{"urls":"stun:stun.l.google.com:19302"},{"urls":["turn:turn.example.com:3478?transport=udp","turn:turn.example.com:3478?transport=tcp","turns:turn.example.com:5349"],"username":"SHORT_LIVED_USERNAME","credential":"SHORT_LIVED_CREDENTIAL"}]'
$env:FARMPROTECTOR_SECURE_COOKIES='true'
python server.py
```

Replace the example TURN host and credentials with values from your provider; do not commit credentials to source control. Prefer short-lived TURN credentials. Run one application server process or route all camera signaling requests to the same process: live-room signaling is temporary and held in that process memory. The camera feed stops when the phone closes the page or loses connection.

## Sensor telemetry limitation

The dashboard polls the ESP32 telemetry endpoint every 10 seconds. The endpoint must be public and allow cross-origin browser requests from the site; a login-protected endpoint or missing CORS headers will be reported as a connection error. Dashboard date filters summarize real sensor readings captured by the current browser while the dashboard is open. Downsampled readings are stored locally per signed-in account for up to 30 days; they do not retrieve historical data from the remote endpoint. Temperature, humidity, battery, distance, GPS, and device status come from telemetry. Farm comparisons, insights, images, alerts, and other sample sections remain demo data.

The current telemetry endpoint is `https://farm-protector-crop.hatchable.site/api/drone/telemetry`. It must return JSON with `device_id`, `temperature`, `humidity`, `distance_cm`, `latitude`, `longitude`, `battery_percent`, `status`, and `created_at` fields. Change `telemetryEndpoint` in `app.js` if the API URL changes.
