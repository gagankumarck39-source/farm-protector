const dashboardMetrics = [
  { title: 'Temperature', value: '—', change: 'Waiting for sensor data', trend: 'warning', detail: '°C' },
  { title: 'Humidity', value: '—', change: 'Waiting for sensor data', trend: 'warning', detail: '%' },
  { title: 'Devices observed', value: '—', change: 'Waiting for sensor data', trend: 'warning', detail: 'In selected period' },
  { title: 'Battery', value: '—', change: 'Waiting for sensor data', trend: 'warning', detail: '%' },
];

const telemetryEndpoint = 'https://farm-protector-crop.hatchable.site/api/drone/telemetry';
const telemetryPollIntervalMs = 10000;
function buildFieldImage(title, colors) {
  const svg = `
    <svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 640 420'>
      <defs>
        <linearGradient id='sky' x1='0' x2='0' y1='0' y2='1'>
          <stop offset='0%' stop-color='#${colors[0]}'/>
          <stop offset='100%' stop-color='#${colors[1]}'/>
        </linearGradient>
      </defs>
      <rect width='640' height='420' fill='url(#sky)'/>
      <rect y='180' width='640' height='240' fill='#${colors[2]}'/>
      <path d='M0 250 C 140 220, 180 280, 300 250 S 540 210, 640 248 L 640 420 L 0 420 Z' fill='rgba(255,255,255,0.18)'/>
      <path d='M0 280 L 640 260 L 640 420 L 0 420 Z' fill='rgba(29,68,52,0.12)'/>
      <g fill='rgba(255,255,255,0.18)'>
        <circle cx='120' cy='80' r='48'/>
        <circle cx='500' cy='60' r='30'/>
      </g>
      <rect x='20' y='20' width='220' height='44' rx='12' fill='rgba(10,20,16,0.3)'/>
      <text x='36' y='48' fill='white' font-family='Arial' font-size='23' font-weight='700'>${title}</text>
    </svg>
  `;
  return `data:image/svg+xml;charset=UTF-8,${encodeURIComponent(svg)}`;
}

const recentImages = [
  { name: 'North rice block', date: 'Today', url: buildFieldImage('North rice block', ['bfe5d5', 'dfeeea', '5fa86d']) },
  { name: 'Tomato field', date: 'Yesterday', url: buildFieldImage('Tomato field', ['d9f1d1', 'eff7df', '8db86b']) },
  { name: 'Coconut grove', date: '2 days ago', url: buildFieldImage('Coconut grove', ['cfe9d2', 'eef9d3', '6d9371']) },
  { name: 'Paddy comparison', date: 'Last week', url: buildFieldImage('Paddy comparison', ['d0e8d7', 'f2f8ef', '7ba576']) },
];

const recentAlerts = [
  { severity: 'warning', title: 'Low battery', field: 'Field B-3', time: '4 mins ago' },
  { severity: 'danger', title: 'Disconnected drone', field: 'Drone 07', time: '30 mins ago' },
  { severity: 'info', title: 'Missing crop image', field: 'Farm C', time: '1 hr ago' },
];

const telemetryRows = [];

const farmRows = [
  // Populated from the signed-in user's farm records.
];

const alertLog = [
  { type: 'Low battery', farm: 'Green Valley Farm', field: 'Field B-3', drone: 'Drone 07', time: '2026-10-12 07:40', priority: 'High' },
  { type: 'Missing telemetry', farm: 'Sunrise Harvest', field: 'Field A-1', drone: 'Drone 17', time: '2026-10-12 06:18', priority: 'Medium' },
  { type: 'Obstacle detection', farm: 'Delta Agro Fields', field: 'Field C-5', drone: 'Drone 03', time: '2026-10-11 22:10', priority: 'Critical' },
];

const calendarItems = [
  { date: '12 Oct', title: 'Irrigation cycle', detail: 'North paddy block • 30 min • 06:30 AM' },
  { date: '14 Oct', title: 'Pest inspection', detail: 'Tomato field • 2 workers • Field C2' },
  { date: '18 Oct', title: 'Fertilizer planning', detail: 'Maize plot • Soil test review' },
];

const expenseItems = [
  { name: 'Seeds', total: '₹18,400', farm: 'Green Valley Farm' },
  { name: 'Fertilizer', total: '₹12,300', farm: 'Delta Agro Fields' },
  { name: 'Drone maintenance', total: '₹9,450', farm: 'Sunrise Harvest' },
];

const chatHistory = [
  { from: 'ai', text: 'Hello! I can explain crop health, telemetry, and trends using the latest farm records. Ask a question in English or another supported language.' },
  { from: 'user', text: 'Show crop growth for the last 7 days.' },
  { from: 'ai', text: 'I reviewed the latest crop measurements. Growth in Field A and Field B increased by 12.8% and 9.4% respectively over the last 7 days.' },
];

const advancedInsights = [
  { label: 'Crop vigor', value: '+12.8%', detail: 'vs previous week' },
  { label: 'Water stress', value: 'Low', detail: '2 fields flagged' },
  { label: 'Drone uptime', value: '96.4%', detail: 'fleet health' },
  { label: 'Alerts', value: '7 active', detail: '2 critical' },
];

const toast = document.getElementById('toast');
const cropAnalysisStorageKey = 'farm-protector-last-crop-analysis';
let latestTelemetry = null;
let telemetryPollInProgress = false;
let telemetryConnectionMessage = 'Waiting for sensor data';
let lastTelemetryErrorMessage = '';
let farmMap = null;
let farmMapProvider = null;
let farmMarkers = null;
let farmTileLayer = null;
let usingBackupFarmTiles = false;
let farmCoordinateFallback = false;
let farmFallbackLocation = null;
let farmFallbackLocationError = '';
let farmFallbackTimer = null;
let googleMapsLoadPromise = null;
let googleMapsFailed = false;
let googleIdentityScriptPromise = null;
let googleOAuthConfig = null;
let googleCodeClient = null;
let googleStateRenewTimer = null;
let liveLocationWatchId = null;
let liveLocationTracking = false;
let liveLocationMarker = null;
let liveLocationAccuracy = null;
let liveLocationControlButton = null;
let cropPreviewUrl = null;
let cropAnalysis = null;
let previousCropAnalysis = loadPreviousCropAnalysis();
let telemetryHistory = [];
let telemetryHistoryStorageKey = '';
let telemetryHistoryStorageErrorLogged = false;
let dashboardRange = { type: 'today', start: null, end: null };
let cameraBroadcastSessionId = null;
let isCameraBroadcaster = false;
let cameraStream = null;
let cameraWakeLock = null;
let cameraCallId = null;
let cameraPeerConnection = null;
let cameraSignalCursor = 0;
let cameraSignalPollTimer = null;
let cameraHeartbeatTimer = null;
let cameraStatusTimer = null;
let cameraSignalPollInProgress = false;
let cameraRemoteDescriptionSet = false;
let pendingCameraCandidates = [];
let cameraIceServers = [];
let cameraDevices = [];

function showToast(message) {
  if (!toast) return;
  toast.textContent = window.FarmProtectorI18n?.translate(message) || message;
  toast.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove('show'), 2400);
}

function escapeHTML(value) {
  return String(value).replace(/[&<>"']/g, (character) => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

async function apiRequest(path, options = {}) {
  const headers = new Headers(options.headers || {});
  if (options.body) headers.set('Content-Type', 'application/json');
  const response = await fetch(path, {
    ...options,
    headers,
    credentials: 'same-origin',
    cache: 'no-store',
  });
  let result;
  try {
    result = await response.json();
  } catch (error) {
    throw new Error(`The server returned an unreadable response (${response.status}).`, { cause: error });
  }
  if (!response.ok) throw new Error(result.error || `The server returned ${response.status}.`);
  return result;
}

async function loadFarmLocations() {
  const result = await apiRequest('/api/farms');
  if (!Array.isArray(result.farms)) throw new Error('The server returned an invalid farm list.');
  farmRows.splice(0, farmRows.length, ...result.farms);
}

function updateProfileDisplay(profile) {
  document.getElementById('profileName').textContent = profile.name;
  document.getElementById('profileFarmName').textContent = profile.farm_name;
  document.querySelector('.profile-pill .avatar').textContent = profile.name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0].toLocaleUpperCase())
    .join('');
  document.querySelector('#profileForm [name="name"]').value = profile.name;
  document.querySelector('#profileForm [name="farm_name"]').value = profile.farm_name;
  document.querySelector('#profileForm [name="crops"]').value = profile.crops;
  document.querySelector('#profileForm [name="bio"]').value = profile.bio || '';
  document.getElementById('profileEmail').textContent = profile.email;
}

async function activateDashboard(profile) {
  updateProfileDisplay(profile);
  loadTelemetryHistory(profile.id || profile.email);
  await loadFarmLocations();
  document.getElementById('authGate').hidden = true;
  document.getElementById('appShell').hidden = false;
  renderMetricCards();
  renderInsightPanel();
  renderArduinoPanel();
  renderRecentImages();
  renderAlerts();
  renderTelemetryTable();
  renderFarmList();
  renderAlertTable();
  renderCalendar();
  renderExpenses();
  renderAnalysisSummary();
  renderChat();
  renderDroneCards();
  renderReportSummary();
  setupDashboardRange();
  renderDashboardCharts();
  renderAIChart();
  setupNavigation();
  setupLiveCamera();
  setupDashboardDeviceShortcut();
  setupFarmLocations();
  setupChartQuery();
  setupFileUpload();
  setupVoiceInput();
  setupReportExports();
  setupSendChat();
  setupTelemetryPolling();
  showToast('Farm Dashboard ready');
}

function setupAuthentication() {
  const form = document.getElementById('authForm');
  const registerFields = document.getElementById('registrationFields');
  const modeButton = document.getElementById('authModeToggle');
  const errorMessage = document.getElementById('authError');
  const googleButton = document.getElementById('googleSignInButton');
  const googleDivider = document.getElementById('googleAuthDivider');
  const googleAuthNote = document.getElementById('googleAuthNote');
  let googleAuthStatus = '';
  let registering = false;

  const setMode = (registerMode) => {
    registering = registerMode;
    registerFields.hidden = !registerMode;
    form.elements.password.autocomplete = registerMode ? 'new-password' : 'current-password';
    for (const field of registerFields.querySelectorAll('input, textarea')) {
      field.required = registerMode && field.name !== 'bio';
    }
    document.getElementById('authTitle').textContent = registerMode ? 'Create farmer account' : 'Farmer sign in';
    document.getElementById('authDescription').textContent = registerMode
      ? 'Create an account to save your profile and farm records.'
      : 'Sign in to securely access your farm profile and saved records.';
    document.getElementById('authSubmit').textContent = registerMode ? 'Create account' : 'Sign in';
    document.getElementById('authSwitchText').textContent = registerMode
      ? 'Already have an account?'
      : 'New to Farm Protector?';
    modeButton.textContent = registerMode ? 'Sign in' : 'Create an account';
    googleButton.hidden = registerMode;
    googleButton.disabled = !googleCodeClient;
    googleDivider.hidden = registerMode;
    googleAuthNote.textContent = googleAuthStatus;
    googleAuthNote.hidden = registerMode || !googleAuthStatus;
    errorMessage.hidden = true;
  };

  const prepareGoogleCodeClient = async () => {
    if (!googleOAuthConfig) return;
    const { state } = await apiRequest('/api/auth/google/state', {
      method: 'POST',
      body: JSON.stringify({}),
    });
    googleCodeClient = window.google.accounts.oauth2.initCodeClient({
      client_id: googleOAuthConfig.client_id,
      scope: 'openid email profile',
      ux_mode: 'popup',
      state,
      callback: async (response) => {
        if (response.error || !response.code || response.state !== state) {
          errorMessage.textContent = 'Google sign-in was cancelled or could not be verified. Please try again.';
          errorMessage.hidden = false;
          googleButton.disabled = true;
          void prepareGoogleCodeClient().catch((error) => {
            console.error('Could not refresh Google sign-in state:', error);
          });
          return;
        }
        errorMessage.hidden = true;
        let signedIn = false;
        try {
          const result = await apiRequest('/api/auth/google/login', {
            method: 'POST',
            body: JSON.stringify({ code: response.code, state }),
          });
          await activateDashboard(result.user);
          signedIn = true;
        } catch (error) {
          console.error('Google sign-in failed:', error);
          errorMessage.textContent = error.message || 'Google sign-in failed. Please try again.';
          errorMessage.hidden = false;
        } finally {
          if (signedIn) {
            if (googleStateRenewTimer !== null) clearTimeout(googleStateRenewTimer);
            googleStateRenewTimer = null;
            googleCodeClient = null;
          } else {
            googleButton.disabled = true;
            void prepareGoogleCodeClient().catch((error) => {
              console.error('Could not refresh Google sign-in state:', error);
            });
          }
        }
      },
      error_callback: (error) => {
        console.error('Google sign-in popup could not open:', error);
        errorMessage.textContent = 'Google sign-in could not open. Allow pop-ups and try again.';
        errorMessage.hidden = false;
        googleButton.disabled = false;
        void prepareGoogleCodeClient().catch((refreshError) => {
          console.error('Could not refresh Google sign-in state:', refreshError);
        });
      },
    });
    googleButton.disabled = false;
    if (googleStateRenewTimer !== null) clearTimeout(googleStateRenewTimer);
    googleStateRenewTimer = window.setTimeout(() => {
      void prepareGoogleCodeClient().catch((error) => {
        console.error('Could not renew Google sign-in state:', error);
        googleButton.disabled = true;
      });
    }, 4 * 60 * 1000);
  };

  const loadGoogleIdentityServices = () => {
    if (window.google?.accounts?.oauth2) return Promise.resolve();
    if (googleIdentityScriptPromise) return googleIdentityScriptPromise;
    googleIdentityScriptPromise = new Promise((resolve, reject) => {
      const script = document.createElement('script');
      const timeoutId = window.setTimeout(() => {
        script.remove();
        reject(new Error('Google sign-in did not finish loading in time.'));
      }, 15000);
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = () => {
        window.clearTimeout(timeoutId);
        if (window.google?.accounts?.oauth2) resolve();
        else reject(new Error('Google sign-in loaded without its authorization API.'));
      };
      script.onerror = () => {
        window.clearTimeout(timeoutId);
        script.remove();
        reject(new Error('Google sign-in could not be loaded.'));
      };
      document.head.append(script);
    }).catch((error) => {
      googleIdentityScriptPromise = null;
      throw error;
    });
    return googleIdentityScriptPromise;
  };

  googleButton.addEventListener('click', () => {
    if (!googleCodeClient || googleButton.disabled) return;
    if (googleStateRenewTimer !== null) {
      clearTimeout(googleStateRenewTimer);
      googleStateRenewTimer = null;
    }
    errorMessage.hidden = true;
    googleButton.disabled = true;
    try {
      googleCodeClient.requestCode();
    } catch (error) {
      console.error('Could not start Google sign-in:', error);
      errorMessage.textContent = 'Google sign-in could not start. Please try again.';
      errorMessage.hidden = false;
      void prepareGoogleCodeClient().catch((refreshError) => {
        console.error('Could not refresh Google sign-in state:', refreshError);
      });
    }
  });

  void apiRequest('/api/auth/google/config')
    .then(async (config) => {
      if (!config.enabled || typeof config.client_id !== 'string' || !config.client_id) {
        googleButton.hidden = true;
        googleDivider.hidden = true;
        googleAuthNote.hidden = true;
        return;
      }
      googleOAuthConfig = config;
      googleButton.hidden = false;
      googleDivider.hidden = false;
      googleAuthStatus = '';
      googleAuthNote.hidden = true;
      await loadGoogleIdentityServices();
      await prepareGoogleCodeClient();
    })
    .catch((error) => {
      console.error('Could not load Google sign-in configuration:', error);
      googleButton.hidden = true;
      googleButton.disabled = true;
      googleDivider.hidden = true;
      googleAuthNote.hidden = true;
      googleAuthStatus = '';
    });

  modeButton.addEventListener('click', () => setMode(!registering));
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    errorMessage.hidden = true;
    const submitButton = document.getElementById('authSubmit');
    submitButton.disabled = true;
    const values = new FormData(form);
    const payload = {
      email: values.get('email'),
      password: values.get('password'),
    };
    if (registering) {
      payload.name = values.get('name');
      payload.farm_name = values.get('farm_name');
      payload.crops = values.get('crops');
      payload.bio = values.get('bio');
    }
    try {
      const result = await apiRequest(registering ? '/api/auth/register' : '/api/auth/login', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      await activateDashboard(result.user);
    } catch (error) {
      console.error('Sign-in or account creation failed:', error);
      errorMessage.textContent = error.message.includes('Failed to fetch')
        ? 'Could not connect to the farm server. Start it with python server.py and reload.'
        : error.message;
      errorMessage.hidden = false;
    } finally {
      submitButton.disabled = false;
    }
  });

  document.getElementById('profileForm').addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    const payload = Object.fromEntries(['name', 'farm_name', 'crops', 'bio'].map((name) => [
      name,
      values.get(name),
    ]));
    try {
      const result = await apiRequest('/api/profile', {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
      updateProfileDisplay(result.profile);
      showToast('Profile saved');
    } catch (error) {
      console.error('Could not save farmer profile:', error);
      showToast(error.message);
    }
  });

  document.getElementById('logoutButton').addEventListener('click', async () => {
    try {
      await stopCameraViewing();
      await apiRequest('/api/auth/logout', { method: 'POST', body: '{}' });
      window.location.reload();
    } catch (error) {
      console.error('Could not sign out:', error);
      showToast(error.message);
    }
  });
}

function setCameraStatus(elementId, message, state = 'neutral') {
  const element = document.getElementById(elementId);
  if (!element) return;
  element.textContent = window.FarmProtectorI18n?.translate(message) || message;
  element.className = `tag ${state}`;
}

async function refreshCameraStatus() {
  try {
    await loadCameraDevices();
  } catch (error) {
    console.error('Could not check live camera status:', error);
    setCameraStatus('cameraBroadcastStatus', error.message, 'warning');
  }
}

function updateSelectedCameraStatus() {
  const select = document.getElementById('cameraDeviceSelect');
  const device = cameraDevices.find((item) => item.id === select.value);
  if (!device) {
    setCameraStatus('cameraBroadcastStatus', cameraDevices.length ? 'Select a farm camera' : 'No camera device selected');
    document.getElementById('startCameraViewing').disabled = true;
    return;
  }
  setCameraStatus(
    'cameraBroadcastStatus',
    device.online ? `${device.name} is online` : device.paired ? `${device.name} is offline` : `${device.name} needs pairing`,
    device.online ? 'success' : device.paired ? 'neutral' : 'warning',
  );
  document.getElementById('startCameraViewing').disabled = !device.paired;
}

function renderCameraDevices() {
  const select = document.getElementById('cameraDeviceSelect');
  const list = document.getElementById('cameraDeviceList');
  const selectedId = select.value;
  const pairedDevices = cameraDevices.filter((device) => device.paired);
  select.innerHTML = pairedDevices.length
    ? pairedDevices.map((device) => `<option value="${escapeHTML(device.id)}">${escapeHTML(device.name)} · ${escapeHTML(device.farm_name)}</option>`).join('')
    : `<option value="">${window.FarmProtectorI18n?.translate('No paired camera devices') || 'No paired camera devices'}</option>`;
  if (pairedDevices.some((device) => device.id === selectedId)) select.value = selectedId;
  select.disabled = pairedDevices.length === 0;
  document.getElementById('startCameraViewing').disabled = pairedDevices.length === 0;
  list.innerHTML = cameraDevices.length
    ? cameraDevices.map((device) => `
      <article class="camera-device-row">
        <div>
          <strong>${escapeHTML(device.name)}</strong>
          <span>${escapeHTML(device.farm_name)}</span>
          <small>${window.FarmProtectorI18n?.translate(device.online ? 'Camera is online' : device.paired ? 'Paired; waiting for broadcast' : 'Pairing required') || (device.online ? 'Camera is online' : device.paired ? 'Paired; waiting for broadcast' : 'Pairing required')}</small>
        </div>
        <div class="camera-device-actions">
          <button class="ghost-button small" type="button" data-device-action="pair" data-device-id="${escapeHTML(device.id)}">${device.paired ? 'Pair again' : device.pairing_expires_at ? 'Show pairing code' : 'Generate pairing code'}</button>
          <button class="ghost-button small" type="button" data-device-action="remove" data-device-id="${escapeHTML(device.id)}">Remove</button>
        </div>
      </article>
    `).join('')
    : `<p class="camera-note">${window.FarmProtectorI18n?.translate('No camera devices registered yet.') || 'No camera devices registered yet.'}</p>`;
  list.querySelectorAll('[data-device-action]').forEach((button) => {
    button.addEventListener('click', () => handleCameraDeviceAction(button.dataset.deviceAction, button.dataset.deviceId));
  });
  updateSelectedCameraStatus();
}

async function loadCameraDevices() {
  const result = await apiRequest('/api/devices');
  if (!Array.isArray(result.devices)) throw new Error('The server returned an invalid camera device list.');
  cameraDevices = result.devices;
  renderCameraDevices();
}

function showCameraPairingCode(code, expiresAt) {
  document.getElementById('cameraPairingCodeValue').textContent = code;
  document.getElementById('cameraPairingExpiry').textContent = `${window.FarmProtectorI18n?.translate('Expires at') || 'Expires at'} ${new Date(expiresAt * 1000).toLocaleTimeString()}`;
  document.querySelector('.camera-pair-link').href = 'camera-device.html';
  document.getElementById('cameraPairingCode').hidden = false;
}

async function createCameraDevice(event) {
  event.preventDefault();
  const form = event.currentTarget;
  const submitButton = form.querySelector('[type="submit"]');
  const values = new FormData(form);
  submitButton.disabled = true;
  try {
    const result = await apiRequest('/api/devices', {
      method: 'POST',
      body: JSON.stringify({
        action: 'create',
        name: values.get('name'),
        farm_name: values.get('farm_name'),
      }),
    });
    showCameraPairingCode(result.pairing_code, result.pairing_expires_at);
    form.reset();
    await loadCameraDevices();
    showToast('Camera device added');
  } catch (error) {
    console.error('Could not register camera device:', error);
    showToast(error.message);
  } finally {
    submitButton.disabled = false;
  }
}

async function handleCameraDeviceAction(action, deviceId) {
  try {
    if (action === 'remove' && !window.confirm('Remove this camera device from your farm account?')) return;
    const body = action === 'remove'
      ? { action, device_id: deviceId }
      : { action: 'pair', device_id: deviceId };
    const result = await apiRequest('/api/devices', {
      method: 'POST',
      body: JSON.stringify(body),
    });
    if (result.pairing_code) showCameraPairingCode(result.pairing_code, result.pairing_expires_at);
    else document.getElementById('cameraPairingCode').hidden = true;
    await loadCameraDevices();
  } catch (error) {
    console.error('Could not update camera device:', error);
    showToast(error.message);
  }
}

function closeCameraPeerConnection() {
  if (cameraPeerConnection) {
    cameraPeerConnection.onicecandidate = null;
    cameraPeerConnection.ontrack = null;
    cameraPeerConnection.onconnectionstatechange = null;
    cameraPeerConnection.close();
    cameraPeerConnection = null;
  }
  cameraRemoteDescriptionSet = false;
  pendingCameraCandidates = [];
  cameraSignalCursor = 0;
}

function stopCameraSignalPolling() {
  if (cameraSignalPollTimer !== null) {
    clearInterval(cameraSignalPollTimer);
    cameraSignalPollTimer = null;
  }
  cameraSignalPollInProgress = false;
}

async function sendCameraSignal(role, type, data) {
  if (!cameraBroadcastSessionId || !cameraCallId) return;
  await apiRequest('/api/camera/signal', {
    method: 'POST',
    body: JSON.stringify({
      session_id: cameraBroadcastSessionId,
      call_id: cameraCallId,
      role,
      type,
      data,
    }),
  });
}

async function addPendingCameraCandidates() {
  if (!cameraPeerConnection || !cameraRemoteDescriptionSet) return;
  const pending = pendingCameraCandidates;
  pendingCameraCandidates = [];
  for (const candidate of pending) {
    try {
      await cameraPeerConnection.addIceCandidate(new RTCIceCandidate(candidate));
    } catch (error) {
      console.error('Could not add a remote camera network candidate:', error);
    }
  }
}

function createCameraPeerConnection(role) {
  if (!window.RTCPeerConnection) throw new Error('Live video is not supported by this browser.');
  cameraPeerConnection = new RTCPeerConnection({ iceServers: cameraIceServers });
  cameraPeerConnection.onicecandidate = (event) => {
    if (!event.candidate) return;
    sendCameraSignal(role, 'candidate', event.candidate.toJSON()).catch((error) => {
      console.error('Could not send live camera network candidate:', error);
      setCameraStatus('cameraViewerStatus', error.message, 'warning');
    });
  };
  cameraPeerConnection.onconnectionstatechange = () => {
    const connectionState = cameraPeerConnection?.connectionState;
    if (connectionState === 'connected') {
      setCameraStatus(role === 'camera' ? 'cameraBroadcastStatus' : 'cameraViewerStatus', 'Live video connected', 'success');
    } else if (connectionState === 'failed') {
      setCameraStatus(role === 'camera' ? 'cameraBroadcastStatus' : 'cameraViewerStatus', 'Video connection failed; check TURN setup', 'warning');
    } else if (connectionState === 'connecting') {
      setCameraStatus(role === 'camera' ? 'cameraBroadcastStatus' : 'cameraViewerStatus', 'Connecting live video…', 'neutral');
    }
  };

  if (role === 'camera') {
    for (const track of cameraStream.getTracks()) {
      const sender = cameraPeerConnection.addTrack(track, cameraStream);
      const parameters = sender.getParameters();
      if (parameters.encodings.length) {
        parameters.encodings[0].maxBitrate = 1200000;
        sender.setParameters(parameters).catch((error) => {
          console.error('Could not limit the live camera video bitrate:', error);
        });
      }
    }
  } else {
    cameraPeerConnection.ontrack = (event) => {
      const video = document.getElementById('cameraViewer');
      video.srcObject = event.streams[0] || new MediaStream([event.track]);
      video.play().catch((error) => {
        console.error('Could not autoplay the incoming crop video:', error);
        setCameraStatus('cameraViewerStatus', 'Tap the video to start playback', 'neutral');
      });
    };
  }
  return cameraPeerConnection;
}

async function processCameraSignals(role) {
  if (!cameraBroadcastSessionId || (role === 'viewer' && !cameraCallId) || cameraSignalPollInProgress) return;
  cameraSignalPollInProgress = true;
  try {
    const query = new URLSearchParams({
      session_id: cameraBroadcastSessionId,
      call_id: cameraCallId || '',
      role,
      after: String(cameraSignalCursor),
    });
    const result = await apiRequest(`/api/camera/signals?${query}`);
    if (role === 'camera' && result.call_id) cameraCallId = result.call_id;
    if (result.waiting) {
      setCameraStatus('cameraBroadcastStatus', 'Camera is online', 'success');
      return;
    }
    if (result.ended) {
      if (role === 'viewer') {
        closeCameraPeerConnection();
        cameraCallId = null;
        stopCameraSignalPolling();
        document.getElementById('cameraViewer').srcObject = null;
        document.getElementById('startCameraViewing').hidden = false;
        document.getElementById('stopCameraViewing').hidden = true;
        setCameraStatus('cameraViewerStatus', 'Ready to connect');
      } else {
        closeCameraPeerConnection();
        cameraCallId = null;
        setCameraStatus('cameraBroadcastStatus', 'Camera is online', 'success');
      }
      return;
    }

    if (role === 'camera' && result.offer && !cameraPeerConnection) {
      setCameraStatus('cameraBroadcastStatus', 'Incoming viewer');
      createCameraPeerConnection('camera');
      await cameraPeerConnection.setRemoteDescription(new RTCSessionDescription(result.offer));
      cameraRemoteDescriptionSet = true;
      await addPendingCameraCandidates();
      const answer = await cameraPeerConnection.createAnswer();
      await cameraPeerConnection.setLocalDescription(answer);
      await sendCameraSignal('camera', 'answer', cameraPeerConnection.localDescription.toJSON());
      setCameraStatus('cameraBroadcastStatus', 'Connecting to remote viewer…');
    } else if (role === 'viewer' && result.answer && cameraPeerConnection && !cameraRemoteDescriptionSet) {
      await cameraPeerConnection.setRemoteDescription(new RTCSessionDescription(result.answer));
      cameraRemoteDescriptionSet = true;
      await addPendingCameraCandidates();
    }

    for (const item of result.candidates) {
      cameraSignalCursor = Math.max(cameraSignalCursor, item.id);
      if (cameraPeerConnection && cameraRemoteDescriptionSet) {
        try {
          await cameraPeerConnection.addIceCandidate(new RTCIceCandidate(item.candidate));
        } catch (error) {
          console.error('Could not add a remote camera network candidate:', error);
        }
      } else {
        pendingCameraCandidates.push(item.candidate);
      }
    }
  } catch (error) {
    console.error(`Live camera ${role} signal exchange failed:`, error);
    setCameraStatus(role === 'camera' ? 'cameraBroadcastStatus' : 'cameraViewerStatus', error.message, 'warning');
    if (error.message.includes('no longer connected') || error.message.includes('session has ended')) {
      if (role === 'viewer') {
        await stopCameraViewing(false);
      } else {
        await stopCameraBroadcast(false);
      }
    }
  } finally {
    cameraSignalPollInProgress = false;
  }
}

function startCameraSignalPolling(role) {
  stopCameraSignalPolling();
  processCameraSignals(role);
  cameraSignalPollTimer = setInterval(() => processCameraSignals(role), 1000);
}

async function startCameraBroadcast() {
  const startButton = document.getElementById('startCameraBroadcast');
  startButton.disabled = true;
  try {
    if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
      throw new Error('Camera access requires HTTPS and a supported browser.');
    }
    cameraStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: {
        facingMode: { ideal: 'environment' },
        width: { ideal: 1280, max: 1920 },
        height: { ideal: 720, max: 1080 },
        frameRate: { ideal: 24, max: 30 },
      },
    });
    if (navigator.wakeLock?.request) {
      try {
        cameraWakeLock = await navigator.wakeLock.request('screen');
      } catch (error) {
        console.warn('Could not keep the farm phone screen awake:', error);
      }
    }
    const result = await apiRequest('/api/camera/broadcast', {
      method: 'POST',
      body: JSON.stringify({ action: 'start' }),
    });
    cameraBroadcastSessionId = result.session_id;
    isCameraBroadcaster = true;
    cameraIceServers = result.ice_servers;
    const preview = document.getElementById('cameraPreview');
    preview.srcObject = cameraStream;
    preview.hidden = false;
    document.getElementById('stopCameraBroadcast').hidden = false;
    startButton.hidden = true;
    setCameraStatus('cameraBroadcastStatus', 'Camera is online', 'healthy');
    cameraHeartbeatTimer = setInterval(async () => {
      try {
        await apiRequest('/api/camera/broadcast', {
          method: 'POST',
          body: JSON.stringify({ action: 'heartbeat', session_id: cameraBroadcastSessionId }),
        });
      } catch (error) {
        console.error('Live camera heartbeat failed:', error);
        setCameraStatus('cameraBroadcastStatus', error.message, 'warning');
      }
    }, 7000);
    startCameraSignalPolling('camera');
  } catch (error) {
    console.error('Could not start the live crop camera:', error);
    await stopCameraBroadcast();
    setCameraStatus('cameraBroadcastStatus', error.message, 'warning');
  } finally {
    startButton.disabled = false;
  }
}

async function stopCameraBroadcast(sendRequest = true) {
  stopCameraSignalPolling();
  if (cameraHeartbeatTimer !== null) {
    clearInterval(cameraHeartbeatTimer);
    cameraHeartbeatTimer = null;
  }
  closeCameraPeerConnection();
  if (cameraStream) cameraStream.getTracks().forEach((track) => track.stop());
  cameraStream = null;
  if (cameraWakeLock) {
    await cameraWakeLock.release().catch((error) => {
      console.error('Could not release the farm camera screen wake lock:', error);
    });
    cameraWakeLock = null;
  }
  document.getElementById('cameraPreview').srcObject = null;
  document.getElementById('cameraPreview').hidden = true;
  document.getElementById('startCameraBroadcast').hidden = false;
  document.getElementById('stopCameraBroadcast').hidden = true;
  if (cameraBroadcastSessionId && sendRequest) {
    try {
      await apiRequest('/api/camera/broadcast', {
        method: 'POST',
        body: JSON.stringify({ action: 'stop', session_id: cameraBroadcastSessionId }),
      });
    } catch (error) {
      console.error('Could not stop the server camera broadcast:', error);
    }
  }
  cameraBroadcastSessionId = null;
  isCameraBroadcaster = false;
  cameraCallId = null;
  setCameraStatus('cameraBroadcastStatus', 'Camera is offline');
  await refreshCameraStatus();
}

async function startCameraViewing() {
  const startButton = document.getElementById('startCameraViewing');
  startButton.disabled = true;
  try {
    const deviceId = document.getElementById('cameraDeviceSelect').value;
    if (!deviceId) throw new Error('Add and pair a farm camera device first.');
    const config = await apiRequest('/api/camera/config');
    cameraIceServers = config.ice_servers;
    const result = await apiRequest('/api/camera/view', {
      method: 'POST',
      body: JSON.stringify({ action: 'start', device_id: deviceId }),
    });
    cameraBroadcastSessionId = result.session_id;
    isCameraBroadcaster = false;
    cameraCallId = result.call_id;
    cameraSignalCursor = 0;
    cameraRemoteDescriptionSet = false;
    createCameraPeerConnection('viewer');
    const offer = await cameraPeerConnection.createOffer();
    await cameraPeerConnection.setLocalDescription(offer);
    await sendCameraSignal('viewer', 'offer', cameraPeerConnection.localDescription.toJSON());
    startButton.hidden = true;
    document.getElementById('stopCameraViewing').hidden = false;
    setCameraStatus('cameraViewerStatus', 'Connecting live video…');
    startCameraSignalPolling('viewer');
  } catch (error) {
    console.error('Could not start live crop viewing:', error);
    await stopCameraViewing();
    setCameraStatus('cameraViewerStatus', error.message, 'warning');
  } finally {
    startButton.disabled = false;
  }
}

async function stopCameraViewing(sendRequest = true) {
  stopCameraSignalPolling();
  if (cameraCallId && sendRequest) {
    try {
      await apiRequest('/api/camera/view', {
        method: 'POST',
        body: JSON.stringify({ action: 'stop', call_id: cameraCallId }),
      });
    } catch (error) {
      console.error('Could not stop the live camera view:', error);
    }
  }
  closeCameraPeerConnection();
  cameraCallId = null;
  cameraBroadcastSessionId = null;
  isCameraBroadcaster = false;
  document.getElementById('cameraViewer').srcObject = null;
  document.getElementById('startCameraViewing').hidden = false;
  document.getElementById('stopCameraViewing').hidden = true;
  setCameraStatus('cameraViewerStatus', 'Ready to connect');
  refreshCameraStatus();
}

function setupLiveCamera() {
  document.getElementById('cameraDeviceForm').addEventListener('submit', createCameraDevice);
  document.getElementById('copyCameraPairingCode').addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(document.getElementById('cameraPairingCodeValue').textContent);
      showToast('Pairing code copied');
    } catch (error) {
      console.error('Could not copy the camera pairing code:', error);
      showToast('Could not copy the pairing code. Select and copy it manually.');
    }
  });
  document.getElementById('startCameraViewing').addEventListener('click', startCameraViewing);
  document.getElementById('stopCameraViewing').addEventListener('click', () => stopCameraViewing());
  document.getElementById('cameraDeviceSelect').addEventListener('change', updateSelectedCameraStatus);
  loadCameraDevices().catch((error) => {
    console.error('Could not load camera devices:', error);
    setCameraStatus('cameraBroadcastStatus', error.message, 'warning');
  });
  cameraStatusTimer = setInterval(refreshCameraStatus, 10000);
  window.addEventListener('pagehide', () => {
    if (cameraStream) cameraStream.getTracks().forEach((track) => track.stop());
    if (cameraWakeLock) cameraWakeLock.release();
    if (cameraBroadcastSessionId && cameraCallId && !isCameraBroadcaster) {
      fetch('/api/camera/view', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        keepalive: true,
        body: JSON.stringify({ action: 'stop', call_id: cameraCallId }),
      }).catch((error) => console.error('Could not end the live view on page exit:', error));
    }
    if (cameraBroadcastSessionId && isCameraBroadcaster) {
      fetch('/api/camera/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        keepalive: true,
        body: JSON.stringify({ action: 'stop', session_id: cameraBroadcastSessionId }),
      }).catch((error) => console.error('Could not stop the live camera on page exit:', error));
    }
    if (cameraStatusTimer !== null) clearInterval(cameraStatusTimer);
  }, { once: true });
}

function renderMetricCards() {
  const container = document.getElementById('dashboardMetrics');
  if (!container) return;

  container.innerHTML = dashboardMetrics
    .map(
      (metric) => `
        <article class="metric-card">
          <div class="metric-top">
            <h3>${metric.title}</h3>
            <span class="metric-trend ${metric.trend}">${metric.change}</span>
          </div>
          <strong>${metric.value}</strong>
          <small>${metric.detail}</small>
        </article>
      `
    )
    .join('');
}

function renderInsightPanel() {
  const container = document.getElementById('insightPanel');
  if (!container) return;

  container.innerHTML = advancedInsights
    .map(
      (insight) => `
        <div class="insight-card">
          <span>${insight.label}</span>
          <strong>${insight.value}</strong>
          <span>${insight.detail}</span>
        </div>
      `
    )
    .join('');
}

function renderArduinoPanel() {
  const container = document.getElementById('arduinoPanel');
  if (!container) return;

  if (!latestTelemetry) {
    container.innerHTML = `
      <article class="device-card">
        <div class="device-head">
          <strong>Sensor device</strong>
          <button class="ghost-button small" type="button" data-open-camera-devices>Add camera device</button>
        </div>
        <div class="device-stats">${escapeHTML(telemetryConnectionMessage)}</div>
      </article>
    `;
    return;
  }

  const device = latestTelemetry;
  container.innerHTML = `
    <article class="device-card">
      <div class="device-head">
        <strong>${escapeHTML(device.device_id)}</strong>
        <div class="farm-header-actions">
          <button class="ghost-button small" type="button" data-open-camera-devices>Add camera device</button>
          <span class="pulse-dot" title="${escapeHTML(device.status)}"></span>
        </div>
      </div>
      <div class="device-stats">
        <div><span>Temperature</span> <strong>${device.temperature.toFixed(1)} °C</strong></div>
        <div><span>Humidity</span> <strong>${device.humidity.toFixed(1)}%</strong></div>
        <div><span>Battery</span> <strong>${device.battery_percent.toFixed(0)}%</strong></div>
        <div><span>Distance</span> <strong>${device.distance_cm.toFixed(1)} cm</strong></div>
        <div><span>GPS</span> <strong>${device.latitude.toFixed(5)}, ${device.longitude.toFixed(5)}</strong></div>
        <div>Status: <strong>${escapeHTML(device.status)}</strong></div>
      </div>
    </article>
  `;
}

function setupDashboardDeviceShortcut() {
  const panel = document.getElementById('arduinoPanel');
  if (!panel || panel.dataset.cameraShortcutReady) return;
  panel.dataset.cameraShortcutReady = 'true';
  panel.addEventListener('click', (event) => {
    if (!(event.target instanceof Element) || !event.target.closest('[data-open-camera-devices]')) return;
    document.querySelector('.nav-item[data-target="live-camera"]')?.click();
    document.querySelector('#cameraDeviceForm [name="name"]')?.focus();
  });
}

function loadTelemetryHistory(accountKey) {
  telemetryHistoryStorageKey = `farm-protector-telemetry-history:${encodeURIComponent(String(accountKey).toLowerCase())}`;
  dashboardRange = { type: 'today', start: null, end: null };
  document.querySelectorAll('.filter-chip[data-range]').forEach((button) => {
    button.classList.toggle('active', button.dataset.range === 'today');
  });
  const customFields = document.getElementById('customRangeFields');
  if (customFields) customFields.hidden = true;
  try {
    const savedHistory = JSON.parse(localStorage.getItem(telemetryHistoryStorageKey) || '[]');
    telemetryHistory = Array.isArray(savedHistory)
      ? savedHistory.filter((sample) =>
        sample &&
        typeof sample.device_id === 'string' &&
        Number.isFinite(sample.timestamp) &&
        ['temperature', 'humidity', 'battery_percent'].every((key) =>
          typeof sample[key] === 'number' && Number.isFinite(sample[key])))
        .sort((first, second) => first.timestamp - second.timestamp)
      : [];
  } catch (error) {
    telemetryHistory = [];
    console.error('Could not load saved sensor history:', error);
  }
}

function recordTelemetrySample(device) {
  const timestamp = Date.parse(device.created_at);
  const sampleInterval = 5 * 60 * 1000;
  const sampleBucket = Math.floor(timestamp / sampleInterval);
  const existingIndex = telemetryHistory.findIndex((sample) =>
    sample.device_id === device.device_id &&
    Math.floor(sample.timestamp / sampleInterval) === sampleBucket);
  const sample = {
    device_id: device.device_id,
    timestamp,
    temperature: device.temperature,
    humidity: device.humidity,
    battery_percent: device.battery_percent,
  };
  if (existingIndex >= 0) telemetryHistory[existingIndex] = sample;
  else telemetryHistory.push(sample);

  const oldestAllowed = Date.now() - 31 * 24 * 60 * 60 * 1000;
  telemetryHistory = telemetryHistory
    .filter((item) => item.timestamp >= oldestAllowed)
    .sort((first, second) => first.timestamp - second.timestamp)
    .slice(-9000);
  try {
    localStorage.setItem(telemetryHistoryStorageKey, JSON.stringify(telemetryHistory));
  } catch (error) {
    if (!telemetryHistoryStorageErrorLogged) {
      console.error('Could not save sensor history in this browser:', error);
      telemetryHistoryStorageErrorLogged = true;
    }
  }
}

function formatDateInput(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function getDashboardRange(now = Date.now()) {
  if (dashboardRange.type === 'custom') {
    return {
      start: dashboardRange.start,
      end: dashboardRange.end,
      label: `${new Date(dashboardRange.start).toLocaleDateString()} – ${new Date(dashboardRange.end).toLocaleDateString()}`,
    };
  }
  if (dashboardRange.type === '7d') {
    return { start: now - 7 * 24 * 60 * 60 * 1000, end: now, label: 'Last 7 days' };
  }
  if (dashboardRange.type === '30d') {
    return { start: now - 30 * 24 * 60 * 60 * 1000, end: now, label: 'Last 30 days' };
  }
  const today = new Date(now);
  today.setHours(0, 0, 0, 0);
  return { start: today.getTime(), end: now, label: 'Today' };
}

function renderTelemetryAnalysis() {
  const translate = (value) => window.FarmProtectorI18n?.translate(value) || value;
  const range = getDashboardRange();
  const samples = telemetryHistory.filter((sample) =>
    sample.timestamp >= range.start && sample.timestamp <= range.end);
  const label = document.getElementById('dashboardAnalysisLabel');
  const summary = document.getElementById('dashboardAnalysisSummary');
  if (label) label.textContent = range.label;

  if (!samples.length) {
    dashboardMetrics.forEach((metric) => {
      metric.value = '—';
      metric.change = 'No readings in range';
      metric.trend = 'warning';
    });
    const host = document.getElementById('growthChart');
    if (host) {
      host.innerHTML = `<p class="analysis-empty">${translate('No sensor readings in this period. Keep the dashboard open to collect data for analysis.')}</p>`;
    }
    if (summary) summary.textContent = translate('No sensor readings in this period. Keep the dashboard open to collect data for analysis.');
    renderMetricCards();
    return;
  }

  const average = (key) => samples.reduce((total, sample) => total + sample[key], 0) / samples.length;
  const devices = new Set(samples.map((sample) => sample.device_id));
  dashboardMetrics[0].value = `${average('temperature').toFixed(1)} °C`;
  dashboardMetrics[0].change = `${translate('Average')} · ${samples.length} ${translate('readings')}`;
  dashboardMetrics[0].trend = 'positive';
  dashboardMetrics[1].value = `${average('humidity').toFixed(1)}%`;
  dashboardMetrics[1].change = `${translate('Average')} · ${samples.length} ${translate('readings')}`;
  dashboardMetrics[1].trend = 'positive';
  dashboardMetrics[2].value = String(devices.size);
  dashboardMetrics[2].change = translate('In selected period');
  dashboardMetrics[2].trend = 'positive';
  dashboardMetrics[3].value = `${average('battery_percent').toFixed(0)}%`;
  dashboardMetrics[3].change = `${translate('Average')} · ${samples.length} ${translate('readings')}`;
  dashboardMetrics[3].trend = 'positive';
  renderMetricCards();

  const dailyBuckets = new Map();
  for (const sample of samples) {
    const date = new Date(sample.timestamp);
    const key = dashboardRange.type === 'today'
      ? `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}-${date.getHours()}`
      : `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    const bucket = dailyBuckets.get(key) || { total: 0, count: 0, timestamp: sample.timestamp };
    bucket.total += sample.temperature;
    bucket.count += 1;
    bucket.timestamp = Math.min(bucket.timestamp, sample.timestamp);
    dailyBuckets.set(key, bucket);
  }
  const trend = [...dailyBuckets.values()].sort((first, second) => first.timestamp - second.timestamp);
  const labels = trend.map((bucket) => {
    const date = new Date(bucket.timestamp);
    return dashboardRange.type === 'today'
      ? date.toLocaleTimeString([], { hour: 'numeric' })
      : date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  });
  const temperatures = trend.map((bucket) => bucket.total / bucket.count);
  renderLineChart('growthChart', labels, temperatures, `Temperature trend · ${range.label}`, '#0d5a42');
  if (summary) {
    summary.textContent = `${samples.length} ${translate('sensor readings')} · ${translate('From')} ${new Date(samples[0].timestamp).toLocaleString()} ${translate('to')} ${new Date(samples[samples.length - 1].timestamp).toLocaleString()}. ${translate('History is saved in this browser for up to 30 days.')}`;
  }
}

function setupDashboardRange() {
  const filter = document.querySelector('.date-filter');
  if (!filter || filter.dataset.rangeReady) return;
  filter.dataset.rangeReady = 'true';
  const buttons = [...document.querySelectorAll('.filter-chip[data-range]')];
  const customFields = document.getElementById('customRangeFields');
  const startInput = document.getElementById('customRangeStart');
  const endInput = document.getElementById('customRangeEnd');
  const applyButton = document.getElementById('applyCustomRange');
  const today = new Date();
  const todayValue = formatDateInput(today);
  const weekAgo = new Date(today);
  weekAgo.setDate(weekAgo.getDate() - 6);
  startInput.max = todayValue;
  endInput.max = todayValue;
  startInput.value = formatDateInput(weekAgo);
  endInput.value = todayValue;

  buttons.forEach((button) => {
    button.addEventListener('click', () => {
      const rangeType = button.dataset.range;
      buttons.forEach((item) => item.classList.toggle('active', item === button));
      customFields.hidden = rangeType !== 'custom';
      if (rangeType === 'custom') {
        applyCustomDashboardRange();
      } else {
        dashboardRange = { type: rangeType, start: null, end: null };
        renderTelemetryAnalysis();
      }
    });
  });

  function applyCustomDashboardRange() {
    const start = new Date(`${startInput.value}T00:00:00`);
    const end = new Date(`${endInput.value}T23:59:59.999`);
    if (!startInput.value || !endInput.value || !Number.isFinite(start.getTime()) ||
        !Number.isFinite(end.getTime()) || start > end || end > new Date(`${todayValue}T23:59:59.999`)) {
      showToast('Choose a valid custom date range');
      return;
    }
    dashboardRange = { type: 'custom', start: start.getTime(), end: end.getTime() };
    renderTelemetryAnalysis();
  }

  applyButton.addEventListener('click', applyCustomDashboardRange);
}

function renderRecentImages() {
  const container = document.getElementById('recentImages');
  if (!container) return;

  container.innerHTML = recentImages
    .map(
      (item) => `
        <div class="image-card">
          <img src="${item.url}" alt="${item.name}" />
          <div class="overlay">
            <span>${item.name}</span>
            <span>${item.date}</span>
          </div>
        </div>
      `
    )
    .join('');
}

function renderAlerts() {
  const container = document.getElementById('recentAlerts');
  if (!container) return;

  container.innerHTML = recentAlerts
    .map(
      (item) => `
        <div class="alert-item">
          <div class="meta">
            <span class="alert-dot ${item.severity}"></span>
            <div class="alert-copy">
              <strong>${item.title}</strong>
              <span>${item.field}</span>
            </div>
          </div>
          <small>${item.time}</small>
        </div>
      `
    )
    .join('');
}

function renderTelemetryTable() {
  const tbody = document.getElementById('telemetryTable');
  if (!tbody) return;

  const updatedAt = document.getElementById('telemetryUpdatedAt');
  if (!telemetryRows.length) {
    tbody.innerHTML = `<tr><td colspan="8">${escapeHTML(telemetryConnectionMessage)}</td></tr>`;
    if (updatedAt) updatedAt.textContent = telemetryConnectionMessage;
    return;
  }

  if (updatedAt && latestTelemetry) {
    updatedAt.textContent = `Last reading ${new Date(latestTelemetry.created_at).toLocaleString()}`;
  }
  tbody.innerHTML = telemetryRows
    .map(
      (row) => `
        <tr>
          <td>${escapeHTML(row.name)}</td>
          <td>${escapeHTML(row.field)}</td>
          <td>${escapeHTML(row.battery)}</td>
          <td>${escapeHTML(row.temp)}</td>
          <td>${escapeHTML(row.humidity)}</td>
          <td>${escapeHTML(row.gps)}</td>
          <td>${escapeHTML(row.distance)}</td>
          <td><span class="status-pill ${escapeHTML(row.status)}">${escapeHTML(row.status)}</span></td>
        </tr>
      `
    )
    .join('');
}

function setTelemetryConnection(state, message) {
  const status = document.getElementById('connectionStatus');
  if (status) {
    status.className = `status-tile ${state}`;
    status.textContent = message;
  }
}

function updateTelemetryDashboard(payload) {
  const device = {
    device_id: payload.device_id.trim(),
    temperature: payload.temperature,
    humidity: payload.humidity,
    distance_cm: payload.distance_cm,
    latitude: payload.latitude,
    longitude: payload.longitude,
    battery_percent: payload.battery_percent,
    status: payload.status.trim().toLowerCase(),
    created_at: payload.created_at,
  };
  if (!['online', 'offline', 'stale'].includes(device.status)) device.status = 'unknown';

  latestTelemetry = device;
  recordTelemetrySample(device);
  telemetryRows.splice(0, telemetryRows.length, {
    name: device.device_id,
    field: 'ESP32 device',
    battery: `${device.battery_percent.toFixed(0)}%`,
    temp: `${device.temperature.toFixed(1)} °C`,
    humidity: `${device.humidity.toFixed(1)}%`,
    gps: `${device.latitude.toFixed(5)}, ${device.longitude.toFixed(5)}`,
    distance: `${device.distance_cm.toFixed(1)} cm`,
    status: device.status,
  });

  telemetryConnectionMessage = `Live readings from ${device.device_id}`;
  setTelemetryConnection(
    'online',
    device.status === 'online' ? 'Sensor API connected' : `API connected · device ${device.status}`
  );
  renderTelemetryAnalysis();
  renderArduinoPanel();
  renderTelemetryTable();
  renderDroneCards();
}

function parseTelemetryPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new Error('Telemetry API returned an unexpected response.');
  }
  const requiredFields = [
    'temperature',
    'humidity',
    'distance_cm',
    'latitude',
    'longitude',
    'battery_percent',
  ];
  if (typeof payload.device_id !== 'string' || !payload.device_id.trim() ||
      typeof payload.status !== 'string' || !payload.status.trim() ||
      typeof payload.created_at !== 'string' || !Number.isFinite(Date.parse(payload.created_at)) ||
      requiredFields.some((field) => typeof payload[field] !== 'number' || !Number.isFinite(payload[field]))) {
    throw new Error('Telemetry API returned missing or invalid sensor fields.');
  }
  if (payload.humidity < 0 || payload.humidity > 100 ||
      payload.battery_percent < 0 || payload.battery_percent > 100 ||
      payload.distance_cm < 0 || payload.latitude < -90 || payload.latitude > 90 ||
      payload.longitude < -180 || payload.longitude > 180) {
    throw new Error('Telemetry API returned sensor values outside their valid ranges.');
  }
  return payload;
}

async function pollLiveTelemetry() {
  if (telemetryPollInProgress || document.hidden) return;
  telemetryPollInProgress = true;
  try {
    const response = await fetch(telemetryEndpoint, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      credentials: 'omit',
    });
    if (!response.ok) {
      let detail = '';
      try {
        const body = await response.json();
        if (typeof body.message === 'string') detail = body.message;
      } catch (error) {
        console.warn('Telemetry API error response was not JSON:', error);
      }
      if (response.status === 401 || response.status === 403) {
        throw new Error(detail || `Telemetry API denied access (HTTP ${response.status}).`);
      }
      throw new Error(detail || `Telemetry API request failed (HTTP ${response.status}).`);
    }

    let payload;
    try {
      payload = parseTelemetryPayload(await response.json());
    } catch (error) {
      throw new Error(`Could not read telemetry response: ${error.message}`);
    }

    lastTelemetryErrorMessage = '';
    updateTelemetryDashboard(payload);
  } catch (error) {
    const requiresLogin = error.message.toLowerCase().includes('login') ||
      error.message.toLowerCase().includes('unauthorized');
    const invalidData = error.message.includes('Telemetry API returned') ||
      error.message.includes('Could not read telemetry response');
    const message = requiresLogin
      ? 'API requires Hatchable login; make the endpoint public'
      : invalidData
        ? 'Sensor API returned invalid telemetry data'
        : 'Sensor API unavailable — check access/CORS';
    telemetryConnectionMessage = message;
    setTelemetryConnection('offline', message);
    if (!latestTelemetry) {
      renderArduinoPanel();
      renderTelemetryTable();
    }
    if (lastTelemetryErrorMessage !== message) {
      console.error('Live sensor telemetry could not be loaded:', error);
      lastTelemetryErrorMessage = message;
    }
  } finally {
    telemetryPollInProgress = false;
  }
}

function renderFarmList() {
  const container = document.getElementById('farmList');
  if (!container) return;

  container.innerHTML = farmRows
    .map(
      (farm) => `
        <article class="farm-card">
          <div class="farm-header">
            <strong>${escapeHTML(farm.name)}</strong>
            <div class="farm-header-actions">
              <span class="tag neutral">${farm.fields} fields</span>
              <button class="ghost-button small farm-details-toggle" type="button" aria-controls="farm-details-${escapeHTML(farm.id)}" aria-expanded="true">Minimize details</button>
            </div>
          </div>
          <div class="farm-meta" id="farm-details-${escapeHTML(farm.id)}">
            <div>${escapeHTML(farm.location)}</div>
            <div>${escapeHTML(farm.crop)}</div>
            <div><strong>Coordinates:</strong> ${farm.latitude.toFixed(4)}, ${farm.longitude.toFixed(4)}</div>
            <div><strong>Status:</strong> ${escapeHTML(farm.status || 'Monitoring')}</div>
          </div>
          <button class="ghost-button small farm-map-link" type="button" data-farm-id="${escapeHTML(farm.id)}">View on map</button>
        </article>
      `
    )
    .join('');

  container.querySelectorAll('.farm-map-link').forEach((button) => {
    button.addEventListener('click', () => focusFarmOnMap(button.dataset.farmId));
  });
  container.querySelectorAll('.farm-details-toggle').forEach((button) => {
    button.addEventListener('click', () => {
      const details = document.getElementById(button.getAttribute('aria-controls'));
      const expanded = button.getAttribute('aria-expanded') === 'true';
      if (!details) return;
      details.hidden = expanded;
      button.setAttribute('aria-expanded', String(!expanded));
      button.textContent = expanded ? 'Maximize details' : 'Minimize details';
    });
  });
}

async function focusFarmOnMap(farmId) {
  const farm = farmRows.find((item) => item.id === farmId);
  if (!farm) return;

  document.querySelectorAll('.page').forEach((page) => page.classList.toggle('active', page.id === 'farm-map'));
  document.querySelectorAll('.nav-item, .mobile-item').forEach((item) => {
    item.classList.toggle('active', item.dataset.target === 'farm-map');
  });
  await initializeFarmMap();
  if (farmMap) {
    if (farmMapProvider === 'google') {
      const marker = farmMarkers.find((item) => item.farmId === farmId);
      if (marker) {
        farmMap.setCenter(marker.getPosition());
        farmMap.setZoom(13);
        marker.infoWindow.open({ map: farmMap, anchor: marker });
      }
    } else {
      farmMap.setView([farm.latitude, farm.longitude], 13);
      farmMarkers?.eachLayer((marker) => {
        if (marker.farmId === farmId) marker.openPopup();
      });
    }
  }
}

function renderFarmMapFallback() {
  const host = document.getElementById('farmMapCanvas');
  if (!host) return;
  farmCoordinateFallback = true;
  const fallbackMessage = window.L
    ? 'Street map tiles are unavailable. Farm locations and GPS coordinates remain available here.'
    : 'Interactive map is unavailable. Farm locations and GPS coordinates remain available here.';
  const locations = farmRows.map((farm) => ({
    id: farm.id,
    name: farm.name,
    latitude: farm.latitude,
    longitude: farm.longitude,
    farm,
  }));
  if (farmFallbackLocation) {
    locations.push({
      id: 'current-location',
      name: 'You are here',
      latitude: farmFallbackLocation.latitude,
      longitude: farmFallbackLocation.longitude,
      farm: null,
    });
  }
  const latitudes = locations.map((location) => location.latitude);
  const longitudes = locations.map((location) => location.longitude);
  const minLat = Math.min(...latitudes);
  const maxLat = Math.max(...latitudes);
  const minLng = Math.min(...longitudes);
  const maxLng = Math.max(...longitudes);
  const latRange = maxLat - minLat;
  const lngRange = maxLng - minLng;
  const mapTitle = farmFallbackLocation && farmRows.length === 0
    ? 'Current location · coordinate view'
    : farmRows.length
      ? 'Farm locations · coordinate view'
      : 'Map unavailable · no farms saved yet';
  const note = farmFallbackLocation
    ? `Current GPS: ${farmFallbackLocation.latitude.toFixed(5)}, ${farmFallbackLocation.longitude.toFixed(5)} (±${Math.round(farmFallbackLocation.accuracy)} m)`
    : farmFallbackLocationError || (!farmRows.length
      ? 'Add a farm location, or find your GPS position to see its coordinates here.'
      : '');

  host.innerHTML = `
    <div class="map-fallback" role="region" aria-label="Farm locations and GPS coordinates">
      <div class="map-fallback-title">${escapeHTML(mapTitle)}</div>
      <span class="map-fallback-note map-fallback-status">${escapeHTML(fallbackMessage)}</span>
      ${note ? `<span class="map-fallback-note map-fallback-location">${escapeHTML(note)}</span>` : ''}
      ${locations.map((location) => {
        const left = 14 + (lngRange ? ((location.longitude - minLng) / lngRange) * 72 : 36);
        const top = 30 + (latRange ? ((maxLat - location.latitude) / latRange) * 48 : 24);
        return `<button class="fallback-map-pin${location.farm ? '' : ' fallback-current-location'}" style="left:${left}%;top:${top}%" type="button" ${location.farm ? `data-farm-id="${escapeHTML(location.farm.id)}"` : 'data-current-location'} title="${escapeHTML(location.name)}">${escapeHTML(location.name)}</button>`;
      }).join('')}
      <div class="map-fallback-actions">
        <button class="ghost-button small map-locate" type="button">◎ Find my location</button>
        <button class="ghost-button small map-retry" type="button">Retry interactive map</button>
      </div>
    </div>
  `;
  host.querySelector('.map-retry').addEventListener('click', retryFarmMap);
  host.querySelector('.map-locate').addEventListener('click', locateOnFallbackMap);
  host.querySelectorAll('.fallback-map-pin').forEach((button) => {
    button.addEventListener('click', () => {
      const farm = farmRows.find((item) => item.id === button.dataset.farmId);
      if (farm) {
        showToast(`${farm.name}: ${farm.latitude.toFixed(5)}, ${farm.longitude.toFixed(5)}`);
      } else if (farmFallbackLocation) {
        showToast(`Your location: ${farmFallbackLocation.latitude.toFixed(5)}, ${farmFallbackLocation.longitude.toFixed(5)}`);
      }
    });
  });
}

function locateOnFallbackMap(event) {
  const button = event.currentTarget;
  if (!navigator.geolocation) {
    farmFallbackLocationError = 'Location services are not supported by this browser.';
    renderFarmMapFallback();
    showToast('Location services are not supported by this browser');
    return;
  }

  button.disabled = true;
  button.textContent = 'Finding location…';
  navigator.geolocation.getCurrentPosition(
    (position) => {
      farmFallbackLocation = {
        latitude: position.coords.latitude,
        longitude: position.coords.longitude,
        accuracy: position.coords.accuracy,
      };
      farmFallbackLocationError = '';
      renderFarmMapFallback();
      showToast(`Your location: ${position.coords.latitude.toFixed(5)}, ${position.coords.longitude.toFixed(5)}`);
    },
    (error) => {
      console.error('Could not get the current location for the fallback map:', error);
      farmFallbackLocationError = getLocationErrorMessage(error);
      renderFarmMapFallback();
      showToast(getLocationErrorMessage(error));
    },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
  );
}

function addFarmTileLayer(map, url, attribution, isBackup = false) {
  const layer = window.L.tileLayer(url, {
    maxZoom: 19,
    attribution,
  });
  let layerErrors = 0;
  layer.on('tileerror', () => {
    if (farmMap !== map) return;
    layerErrors += 1;
    if (!isBackup && layerErrors >= 2 && !usingBackupFarmTiles) {
      usingBackupFarmTiles = true;
      map.removeLayer(layer);
      farmTileLayer = addFarmTileLayer(
        map,
        '/api/map-tiles/carto/{z}/{x}/{y}.png',
        '&copy; OpenStreetMap contributors &copy; CARTO',
        true,
      );
    } else if (isBackup && layerErrors >= 3 && farmFallbackTimer === null) {
      map.stop();
      farmFallbackTimer = window.setTimeout(() => {
        farmFallbackTimer = null;
        if (farmMap !== map) return;
        removeInteractiveFarmMap();
        usingBackupFarmTiles = false;
        renderFarmMapFallback();
      }, 300);
    }
  });
  layer.addTo(map);
  return layer;
}

function removeInteractiveFarmMap() {
  if (farmMap) {
    const map = farmMap;
    farmMap = null;
    if (farmMapProvider === 'google') {
      farmMarkers?.forEach((marker) => marker.setMap(null));
      liveLocationMarker?.setMap(null);
      liveLocationAccuracy?.setMap(null);
    } else {
      map.stop();
      map.remove();
    }
  }
  farmMapProvider = null;
  farmMarkers = null;
  farmTileLayer = null;
  liveLocationMarker = null;
  liveLocationAccuracy = null;
  liveLocationControlButton = null;
}

function retryFarmMap() {
  if (!window.L && !window.google?.maps) {
    showToast('Interactive map is unavailable. Check your internet connection and reload.');
    return;
  }
  if (farmFallbackTimer !== null) {
    clearTimeout(farmFallbackTimer);
    farmFallbackTimer = null;
  }
  removeInteractiveFarmMap();
  usingBackupFarmTiles = false;
  initializeFarmMap();
}

async function loadGoogleMaps() {
  if (googleMapsFailed) return false;
  if (window.google?.maps?.Map) return true;
  if (googleMapsLoadPromise) return googleMapsLoadPromise;

  googleMapsLoadPromise = (async () => {
    const response = await fetch('/api/map-config', { credentials: 'same-origin', cache: 'no-store' });
    if (!response.ok) throw new Error(`Map configuration request failed with status ${response.status}.`);
    const config = await response.json();
    const apiKey = typeof config.google_maps_api_key === 'string' ? config.google_maps_api_key.trim() : '';
    if (!apiKey) return false;

    await new Promise((resolve, reject) => {
      const callbackName = '__farmProtectorGoogleMapsReady';
      const script = document.createElement('script');
      window.gm_authFailure = handleGoogleMapsAuthFailure;
      const timeoutId = window.setTimeout(() => {
        delete window[callbackName];
        script.remove();
        reject(new Error('Google Maps did not finish loading in time.'));
      }, 15000);
      window[callbackName] = () => {
        window.clearTimeout(timeoutId);
        delete window[callbackName];
        resolve();
      };
      script.async = true;
      script.defer = true;
      script.referrerPolicy = 'strict-origin-when-cross-origin';
      script.onerror = () => {
        window.clearTimeout(timeoutId);
        delete window[callbackName];
        script.remove();
        reject(new Error('Google Maps JavaScript API could not be loaded.'));
      };
      script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&loading=async&callback=${callbackName}`;
      document.head.append(script);
    });
    return Boolean(window.google?.maps?.Map);
  })().catch((error) => {
    googleMapsLoadPromise = null;
    throw error;
  });

  return googleMapsLoadPromise;
}

function handleGoogleMapsAuthFailure() {
  if (googleMapsFailed) return;
  googleMapsFailed = true;
  googleMapsLoadPromise = null;
  console.error('Google Maps rejected the configured API key or its website/API restrictions.');
  showToast('Google Maps could not load. Using the backup map instead.');
  if (farmMapProvider !== 'google') return;

  removeInteractiveFarmMap();
  document.getElementById('farmMapCanvas')?.replaceChildren();
  usingBackupFarmTiles = false;
  void initializeFarmMapAsync();
}

function addGoogleFarmMarkers() {
  farmMarkers?.forEach((marker) => marker.setMap(null));
  farmMarkers = [];
  farmRows.forEach((farm) => {
    const marker = new window.google.maps.Marker({
      map: farmMap,
      position: { lat: farm.latitude, lng: farm.longitude },
      title: farm.name,
    });
    marker.farmId = farm.id;
    marker.infoWindow = new window.google.maps.InfoWindow({
      content: `<div class="map-popup"><strong>${escapeHTML(farm.name)}</strong><span>${escapeHTML(farm.location)}</span><span>${escapeHTML(farm.crop)} · ${farm.fields} fields</span><small>${farm.latitude.toFixed(5)}, ${farm.longitude.toFixed(5)}</small></div>`,
    });
    marker.addListener('click', () => marker.infoWindow.open({ map: farmMap, anchor: marker }));
    farmMarkers.push(marker);
  });
}

function fitGoogleFarmLocations() {
  if (!farmRows.length) {
    farmMap.setCenter({ lat: 12.9716, lng: 77.5946 });
    farmMap.setZoom(5);
  } else if (farmRows.length === 1) {
    farmMap.setCenter(farmMarkers[0].getPosition());
    farmMap.setZoom(13);
  } else {
    const bounds = new window.google.maps.LatLngBounds();
    farmMarkers.forEach((marker) => bounds.extend(marker.getPosition()));
    farmMap.fitBounds(bounds, 48);
  }
}

function initializeFarmMap() {
  return initializeFarmMapAsync();
}

async function initializeFarmMapAsync() {
  const host = document.getElementById('farmMapCanvas');
  const count = document.getElementById('mapLocationCount');
  if (!host) return;
  if (farmCoordinateFallback) {
    if (farmMap) removeInteractiveFarmMap();
    host.replaceChildren();
    farmCoordinateFallback = false;
    usingBackupFarmTiles = false;
  }
  if (count) count.textContent = `${farmRows.length} ${farmRows.length === 1 ? 'location' : 'locations'} on the map`;

  if (!farmMap) {
    try {
      await loadGoogleMaps();
    } catch (error) {
      console.error('Google Maps could not be loaded; using the backup map instead:', error);
      showToast('Google Maps could not load. Using the backup map instead.');
    }
  }
  if (!document.getElementById('farm-map')?.classList.contains('active')) return;

  if (!farmMap && (googleMapsFailed || !window.google?.maps?.Map) && !window.L) {
    renderFarmMapFallback();
    return;
  }

  if (!farmMap) {
    if (!googleMapsFailed && window.google?.maps?.Map) {
      farmMapProvider = 'google';
      farmMap = new window.google.maps.Map(host, {
        center: { lat: 12.9716, lng: 77.5946 },
        zoom: 5,
        mapTypeControl: true,
        streetViewControl: true,
        fullscreenControl: false,
        gestureHandling: 'greedy',
      });
      farmMarkers = [];
      const locationControl = document.createElement('button');
      locationControl.className = 'live-location-control';
      locationControl.type = 'button';
      locationControl.setAttribute('aria-label', 'Show live location');
      locationControl.title = 'Show live location';
      locationControl.textContent = '◎ Live location';
      liveLocationControlButton = locationControl;
      locationControl.addEventListener('click', toggleLiveLocationTracking);
      farmMap.controls[window.google.maps.ControlPosition.RIGHT_TOP].push(locationControl);
    } else {
      farmMapProvider = 'leaflet';
      farmMap = window.L.map(host, {
        scrollWheelZoom: false,
        zoomAnimation: false,
        fadeAnimation: false,
        markerZoomAnimation: false,
      });
      farmTileLayer = addFarmTileLayer(
        farmMap,
        '/api/map-tiles/osm/{z}/{x}/{y}.png',
        '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
      );
      farmMarkers = window.L.featureGroup().addTo(farmMap);
      const liveLocationControl = window.L.control({ position: 'topright' });
      liveLocationControl.onAdd = () => {
        const button = window.L.DomUtil.create('button', 'live-location-control');
        button.type = 'button';
        button.setAttribute('aria-label', 'Show live location');
        button.title = 'Show live location';
        button.textContent = '◎ Live location';
        liveLocationControlButton = button;
        window.L.DomEvent.disableClickPropagation(button);
        window.L.DomEvent.on(button, 'click', toggleLiveLocationTracking);
        return button;
      };
      liveLocationControl.addTo(farmMap);
    }
  }

  if (farmMapProvider === 'google') {
    addGoogleFarmMarkers();
    if (liveLocationTracking && liveLocationMarker) {
      farmMap.panTo(liveLocationMarker.getPosition());
    } else {
      fitGoogleFarmLocations();
    }
  } else {
    farmMarkers.clearLayers();
    farmRows.forEach((farm) => {
      const marker = window.L.marker([farm.latitude, farm.longitude], {
        icon: window.L.divIcon({
          className: 'farm-map-pin-wrap',
          html: '<span class="farm-map-pin"></span>',
          iconSize: [28, 36],
          iconAnchor: [14, 34],
        }),
      });
      marker.farmId = farm.id;
      marker.bindPopup(`
        <div class="map-popup">
          <strong>${escapeHTML(farm.name)}</strong>
          <span>${escapeHTML(farm.location)}</span>
          <span>${escapeHTML(farm.crop)} · ${farm.fields} fields</span>
          <small>${farm.latitude.toFixed(5)}, ${farm.longitude.toFixed(5)}</small>
        </div>
      `);
      farmMarkers.addLayer(marker);
    });

    if (liveLocationTracking && liveLocationMarker) {
      farmMap.panTo(liveLocationMarker.getLatLng());
    } else if (farmRows.length) {
      if (farmRows.length === 1) {
        farmMap.setView([farmRows[0].latitude, farmRows[0].longitude], 13);
      } else {
        farmMap.fitBounds(farmMarkers.getBounds().pad(0.18), { maxZoom: 11 });
      }
    } else {
      farmMap.setView([12.9716, 77.5946], 5);
    }
  }
  refreshFarmMapSize();
}

function refreshFarmMapSize() {
  const map = farmMap;
  if (!map) return;
  window.requestAnimationFrame(() => {
    if (farmMap !== map) return;
    if (farmMapProvider === 'google') {
      window.google.maps.event.trigger(map, 'resize');
      return;
    }
    map.invalidateSize({ pan: false });
    window.setTimeout(() => {
      if (farmMap === map) map.invalidateSize({ pan: false });
    }, 300);
  });
}

function showAllFarmLocations() {
  if (!farmMap) {
    stopLiveLocationTracking();
    if (farmCoordinateFallback) renderFarmMapFallback();
    return;
  }
  stopLiveLocationTracking();
  if (farmMapProvider === 'google') {
    liveLocationMarker?.setMap(null);
    liveLocationAccuracy?.setMap(null);
  } else {
    if (liveLocationMarker) farmMap.removeLayer(liveLocationMarker);
    if (liveLocationAccuracy) farmMap.removeLayer(liveLocationAccuracy);
  }
  liveLocationMarker = null;
  liveLocationAccuracy = null;

  if (farmMapProvider === 'google') {
    fitGoogleFarmLocations();
  } else if (farmRows.length === 1) {
    farmMap.setView([farmRows[0].latitude, farmRows[0].longitude], 13);
  } else if (farmRows.length > 1 && farmMarkers?.getBounds().isValid()) {
    farmMap.fitBounds(farmMarkers.getBounds().pad(0.18), { maxZoom: 11 });
  } else {
    farmMap.setView([12.9716, 77.5946], 5);
  }
  refreshFarmMapSize();
}

function setMapMaximized(maximized) {
  const mapCard = document.querySelector('.map-card');
  const button = document.getElementById('toggleMapSizeButton');
  if (!mapCard || !button) return;
  mapCard.classList.toggle('is-maximized', maximized);
  document.body.classList.toggle('map-maximized', maximized);
  button.setAttribute('aria-pressed', String(maximized));
  const label = window.FarmProtectorI18n?.translate(maximized ? 'Minimize map' : 'Maximize map')
    || (maximized ? 'Minimize map' : 'Maximize map');
  button.textContent = label;
  button.setAttribute('aria-label', label);
  button.title = label;
  refreshFarmMapSize();
}

function setLiveLocationControlState(isTracking) {
  if (!liveLocationControlButton) return;
  const label = isTracking ? 'Stop live location' : 'Show live location';
  liveLocationControlButton.textContent = isTracking ? '■ Stop tracking' : '◎ Live location';
  liveLocationControlButton.setAttribute('aria-label', label);
  liveLocationControlButton.title = label;
  liveLocationControlButton.classList.toggle('is-tracking', isTracking);
}

function stopLiveLocationTracking() {
  if (liveLocationWatchId !== null) {
    navigator.geolocation.clearWatch(liveLocationWatchId);
    liveLocationWatchId = null;
  }
  liveLocationTracking = false;
  setLiveLocationControlState(false);
}

function getLocationErrorMessage(error) {
  if (!window.isSecureContext) {
    return 'Location requires HTTPS or localhost. Open this site securely and try again.';
  }
  if (error.code === 1) {
    return 'Location permission is blocked. Allow location access for this site in your browser settings, then retry.';
  }
  if (error.code === 2) {
    return 'Your device could not determine its location. Turn on device location services and check GPS or network access, then retry.';
  }
  if (error.code === 3) {
    return 'Location lookup timed out. Turn on device location services and retry, preferably outdoors.';
  }
  return 'Could not access your location. Check browser location permissions and device location services.';
}

function toggleLiveLocationTracking() {
  if (liveLocationTracking) {
    stopLiveLocationTracking();
    showToast('Live location tracking stopped');
    return;
  }
  if (!navigator.geolocation) {
    showToast('Location services are not supported by this browser');
    return;
  }

  liveLocationTracking = true;
  setLiveLocationControlState(true);
  showToast('Getting your live location…');
  try {
    liveLocationWatchId = navigator.geolocation.watchPosition(
      (position) => {
        if (!liveLocationTracking) return;
        const { latitude, longitude, accuracy } = position.coords;
        const coordinates = farmMapProvider === 'google'
          ? { lat: latitude, lng: longitude }
          : [latitude, longitude];
        if (!liveLocationMarker) {
          if (farmMapProvider === 'google') {
            liveLocationMarker = new window.google.maps.Marker({
              map: farmMap,
              position: coordinates,
              title: 'Your live location',
              icon: {
                path: window.google.maps.SymbolPath.CIRCLE,
                scale: 9,
                fillColor: '#2563eb',
                fillOpacity: 1,
                strokeColor: '#ffffff',
                strokeWeight: 3,
              },
            });
            liveLocationAccuracy = new window.google.maps.Circle({
              map: farmMap,
              center: coordinates,
              radius: accuracy,
              strokeColor: '#2563eb',
              strokeOpacity: 0.8,
              strokeWeight: 1,
              fillColor: '#2563eb',
              fillOpacity: 0.12,
            });
            const infoWindow = new window.google.maps.InfoWindow({ content: 'Your live location' });
            liveLocationMarker.addListener('click', () => infoWindow.open({ map: farmMap, anchor: liveLocationMarker }));
            farmMap.setCenter(coordinates);
            farmMap.setZoom(16);
          } else {
            liveLocationMarker = window.L.circleMarker(coordinates, {
              radius: 9,
              color: '#fff',
              weight: 3,
              fillColor: '#2563eb',
              fillOpacity: 1,
            }).addTo(farmMap).bindPopup('Your live location');
            liveLocationAccuracy = window.L.circle(coordinates, {
              radius: accuracy,
              color: '#2563eb',
              weight: 1,
              fillColor: '#2563eb',
              fillOpacity: 0.12,
            }).addTo(farmMap);
            farmMap.setView(coordinates, 16);
          }
        } else {
          if (farmMapProvider === 'google') {
            liveLocationMarker.setPosition(coordinates);
            liveLocationAccuracy.setCenter(coordinates);
            liveLocationAccuracy.setRadius(accuracy);
          } else {
            liveLocationMarker.setLatLng(coordinates);
            liveLocationAccuracy.setLatLng(coordinates);
            liveLocationAccuracy.setRadius(accuracy);
          }
          farmMap.panTo(coordinates);
        }
      },
      (error) => {
        console.error('Could not track the current location:', error);
        stopLiveLocationTracking();
        showToast(getLocationErrorMessage(error));
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
    );
  } catch (error) {
    console.error('Could not start live location tracking:', error);
    stopLiveLocationTracking();
    showToast('Could not start live location tracking');
  }
}

function setupFarmLocations() {
  const form = document.getElementById('farmLocationForm');
  const addButton = document.getElementById('addLocationButton');
  const addFromListButton = document.getElementById('addFarmFromListButton');
  const closeButton = document.getElementById('closeLocationForm');
  const locationButton = document.getElementById('useCurrentLocation');
  const fitButton = document.getElementById('fitMapButton');
  const mapSizeButton = document.getElementById('toggleMapSizeButton');
  if (!form || !addButton || !closeButton) return;

  const setFormVisible = (visible) => {
    form.hidden = !visible;
    form.closest('.map-layout').classList.toggle('form-open', visible);
    refreshFarmMapSize();
    if (visible) form.elements.name.focus();
  };

  addButton.addEventListener('click', () => setFormVisible(true));
  addFromListButton?.addEventListener('click', () => {
    document.querySelector('.nav-item[data-target="farm-map"]')?.click();
    setFormVisible(true);
  });
  closeButton.addEventListener('click', () => setFormVisible(false));
  fitButton?.addEventListener('click', showAllFarmLocations);
  mapSizeButton?.addEventListener('click', () => {
    setMapMaximized(mapSizeButton.getAttribute('aria-pressed') !== 'true');
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && mapSizeButton?.getAttribute('aria-pressed') === 'true') {
      setMapMaximized(false);
    }
  });

  locationButton?.addEventListener('click', () => {
    if (!navigator.geolocation) {
      showToast('Location services are not supported by this browser');
      return;
    }
    locationButton.disabled = true;
    navigator.geolocation.getCurrentPosition(
      (position) => {
        form.elements.latitude.value = position.coords.latitude.toFixed(6);
        form.elements.longitude.value = position.coords.longitude.toFixed(6);
        locationButton.disabled = false;
        showToast('Current coordinates added to the form');
      },
      (error) => {
        locationButton.disabled = false;
        console.error('Could not get the current location:', error);
        showToast(getLocationErrorMessage(error));
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  });

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const values = new FormData(form);
    const latitude = Number(values.get('latitude'));
    const longitude = Number(values.get('longitude'));
    const fields = Number(values.get('fields'));
    const farm = {
      name: String(values.get('name')).trim(),
      location: String(values.get('location')).trim(),
      latitude,
      longitude,
      fields,
      crop: String(values.get('crop')).trim(),
      status: 'Monitoring',
    };
    if (!farm.name || !farm.location || !farm.crop || !Number.isFinite(latitude) ||
        latitude < -90 || latitude > 90 || !Number.isFinite(longitude) ||
        longitude < -180 || longitude > 180 || !Number.isInteger(fields) || fields < 1) {
      showToast('Enter a valid farm name, crop, field count, and map coordinates');
      return;
    }

    const submitButton = form.querySelector('[type="submit"]');
    submitButton.disabled = true;
    try {
      const result = await apiRequest('/api/farms', {
        method: 'POST',
        body: JSON.stringify(farm),
      });
      farmRows.push(result.farm);
      renderFarmList();
      await initializeFarmMap();
      if (farmMapProvider === 'google') {
        farmMap.setCenter({ lat: result.farm.latitude, lng: result.farm.longitude });
        farmMap.setZoom(13);
      } else {
        farmMap?.setView([result.farm.latitude, result.farm.longitude], 13);
      }
      form.reset();
      setFormVisible(false);
      showToast('Farm location saved and added to the map');
    } catch (error) {
      console.error('Could not save farm location:', error);
      showToast(error.message);
    } finally {
      submitButton.disabled = false;
    }
  });
}

function renderAlertTable() {
  const container = document.getElementById('alertTable');
  if (!container) return;

  container.innerHTML = alertLog
    .map(
      (item) => `
        <div class="alert-row">
          <div><strong>${item.type}</strong></div>
          <div>${item.farm}</div>
          <div>${item.field}</div>
          <div>${item.drone}</div>
          <div>${item.time}</div>
        </div>
      `
    )
    .join('');
}

function renderCalendar() {
  const container = document.getElementById('calendarList');
  if (!container) return;

  container.innerHTML = calendarItems
    .map(
      (item) => `
        <article class="calendar-card">
          <div class="mini-header">
            <strong>${item.date}</strong>
            <span class="tag neutral">Upcoming</span>
          </div>
          <div><strong>${item.title}</strong></div>
          <div class="farm-meta">${item.detail}</div>
        </article>
      `
    )
    .join('');
}

function renderExpenses() {
  const container = document.getElementById('expenseList');
  if (!container) return;

  container.innerHTML = expenseItems
    .map(
      (item) => `
        <article class="expense-card">
          <div class="mini-header">
            <strong>${item.name}</strong>
            <span class="tag neutral">${item.total}</span>
          </div>
          <div class="farm-meta">${item.farm}</div>
        </article>
      `
    )
    .join('');
}

function loadPreviousCropAnalysis() {
  try {
    const savedAnalysis = localStorage.getItem(cropAnalysisStorageKey);
    if (!savedAnalysis) return null;
    const analysis = JSON.parse(savedAnalysis);
    if (typeof analysis.vegetationCoverage !== 'number' ||
        typeof analysis.yellowBrownCoverage !== 'number' ||
        typeof analysis.analyzedAt !== 'string' ||
        analysis.vegetationCoverage < 0 || analysis.vegetationCoverage > 100 ||
        analysis.yellowBrownCoverage < 0 || analysis.yellowBrownCoverage > 100) {
      throw new Error('Saved crop analysis has an invalid format.');
    }
    return analysis;
  } catch (error) {
    console.error('Could not load the previous crop analysis:', error);
    showToast('Previous crop comparison could not be loaded');
    return null;
  }
}

function renderAnalysisSummary() {
  const container = document.getElementById('analysisSummary');
  if (!container) return;

  const status = document.getElementById('analysisStatus');
  if (!cropAnalysis) {
    if (status) {
      status.textContent = 'Waiting for image';
      status.className = 'tag neutral';
    }
    container.innerHTML = '<p class="analysis-empty">No image analyzed yet. Upload a clear crop or field photo to calculate visual percentages.</p>';
    return;
  }

  const vegetation = cropAnalysis.vegetationCoverage;
  const yellowBrown = cropAnalysis.yellowBrownCoverage;
  const other = Math.max(0, 100 - vegetation - yellowBrown);
  const signal = vegetation >= 65
    ? { label: 'Higher green coverage', className: 'success' }
    : vegetation >= 35
      ? { label: 'Mixed green coverage', className: 'warning' }
      : { label: 'Lower green coverage', className: 'warning' };

  if (status) {
    status.textContent = signal.label;
    status.className = `tag ${signal.className}`;
  }

  const comparison = cropAnalysis.previous
    ? `<div class="analysis-stat">
        <strong>Change from previous upload</strong>
        <span>${formatPercentagePointChange(vegetation - cropAnalysis.previous.vegetationCoverage)} green coverage · ${formatPercentagePointChange(yellowBrown - cropAnalysis.previous.yellowBrownCoverage)} yellow/brown pixels</span>
        <small>Previous image analyzed ${new Date(cropAnalysis.previous.analyzedAt).toLocaleString()}</small>
      </div>`
    : '<p class="analysis-empty">Upload another image later to compare its visual coverage with this image.</p>';

  container.innerHTML = `
    <div class="analysis-stat">
      <div class="analysis-stat-heading"><strong>Green vegetation pixels</strong><span>${vegetation.toFixed(1)}%</span></div>
      <div class="analysis-bar" role="img" aria-label="${vegetation.toFixed(1)} percent green vegetation pixels"><span style="width:${vegetation}%"></span></div>
    </div>
    <div class="analysis-stat">
      <div class="analysis-stat-heading"><strong>Yellow/brown pixels</strong><span>${yellowBrown.toFixed(1)}%</span></div>
      <div class="analysis-bar analysis-bar-warn" role="img" aria-label="${yellowBrown.toFixed(1)} percent yellow or brown pixels"><span style="width:${yellowBrown}%"></span></div>
    </div>
    <div class="analysis-stat">
      <strong>Other visible pixels</strong>
      <span>${other.toFixed(1)}%</span>
    </div>
    <div class="analysis-stat">
      <strong>Visual coverage signal</strong>
      <span>${signal.label}</span>
      <small>Based on green-pixel share; lighting, soil, shadows, and non-crop areas affect the estimate.</small>
    </div>
    ${comparison}
    <p class="analysis-sample-count">Calculated from ${cropAnalysis.sampledPixels.toLocaleString()} visible image pixels.</p>
  `;
}

function formatPercentagePointChange(change) {
  const roundedChange = Math.round(change * 10) / 10;
  return `${roundedChange > 0 ? '+' : ''}${roundedChange.toFixed(1)} percentage points`;
}

function analyzeCropImage(image) {
  const maxDimension = 600;
  const scale = Math.min(1, maxDimension / Math.max(image.naturalWidth, image.naturalHeight));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
  canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Image analysis is not available in this browser.');
  context.drawImage(image, 0, 0, canvas.width, canvas.height);

  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let visiblePixels = 0;
  let greenPixels = 0;
  let yellowBrownPixels = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index + 3] < 128) continue;
    visiblePixels += 1;
    const red = pixels[index];
    const green = pixels[index + 1];
    const blue = pixels[index + 2];
    const maximum = Math.max(red, green, blue);
    const minimum = Math.min(red, green, blue);
    const difference = maximum - minimum;
    if (maximum === 0 || difference / maximum < 0.18) continue;

    let hue;
    if (maximum === red) hue = 60 * (((green - blue) / difference) % 6);
    else if (maximum === green) hue = 60 * ((blue - red) / difference + 2);
    else hue = 60 * ((red - green) / difference + 4);
    if (hue < 0) hue += 360;

    if (hue >= 65 && hue <= 170 && green >= red * 0.85 && green >= blue * 0.85) {
      greenPixels += 1;
    } else if (hue >= 15 && hue < 65 && maximum > 45) {
      yellowBrownPixels += 1;
    }
  }
  if (!visiblePixels) throw new Error('The image has no visible pixels to analyze.');

  return {
    vegetationCoverage: greenPixels / visiblePixels * 100,
    yellowBrownCoverage: yellowBrownPixels / visiblePixels * 100,
    sampledPixels: visiblePixels,
    analyzedAt: new Date().toISOString(),
  };
}

function renderChat() {
  const container = document.getElementById('chatMessages');
  if (!container) return;

  container.innerHTML = chatHistory
    .map((entry) => `<div class="bubble ${entry.from}">${entry.text}</div>`)
    .join('');
  container.scrollTop = container.scrollHeight;
}

function renderDroneCards() {
  const container = document.getElementById('droneList');
  if (!container) return;

  if (!telemetryRows.length) {
    container.innerHTML = `<p class="analysis-empty">${escapeHTML(telemetryConnectionMessage)}</p>`;
    return;
  }

  container.innerHTML = telemetryRows
    .map(
      (row) => `
        <article class="drone-card">
          <div class="drone-header">
            <strong>${escapeHTML(row.name)}</strong>
            <span class="status-pill ${escapeHTML(row.status)}">${escapeHTML(row.status)}</span>
          </div>
          <div class="drone-meta">
            <div>Field: ${escapeHTML(row.field)}</div>
            <div>Battery: ${escapeHTML(row.battery)}</div>
            <div>Temp: ${escapeHTML(row.temp)}</div>
            <div>Humidity: ${escapeHTML(row.humidity)}</div>
            <div>GPS: ${escapeHTML(row.gps)}</div>
          </div>
        </article>
      `
    )
    .join('');
}

function setupTelemetryPolling() {
  setTelemetryConnection('connecting', 'Connecting to sensor API…');
  pollLiveTelemetry();
  window.setInterval(pollLiveTelemetry, telemetryPollIntervalMs);
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) pollLiveTelemetry();
  });
}

function renderReportSummary() {
  const container = document.getElementById('reportSummary');
  if (!container) return;

  container.innerHTML = `
    <div><strong>Recent monitoring summary:</strong> 4 fields showed positive crop vigor change during the selected period.</div>
    <div><strong>Growth trends:</strong> Average canopy coverage rose from 68% to 77%.</div>
    <div><strong>Temperature and humidity:</strong> Morning temperatures remained within seasonal range; humidity showed a mild upward trend.</div>
    <div><strong>Drone health:</strong> 19 drones active, 3 offline devices flagged for maintenance review.</div>
    <div><strong>Suggested next inspection:</strong> Check nitrate stress in Field B-3 and confirm missing telemetry for Drone 07.</div>
  `;
}

function renderLineChart(targetId, labels, values, title, color) {
  const host = document.getElementById(targetId);
  if (!host) return;

  const width = 560;
  const height = 220;
  const pad = { top: 18, right: 18, bottom: 28, left: 36 };
  const max = Math.max(...values) + 8;
  const min = Math.min(...values) - 8;
  const range = max - min || 1;
  const stepX = (width - pad.left - pad.right) / (labels.length - 1 || 1);
  const yValue = (value) => pad.top + ((max - value) / range) * (height - pad.top - pad.bottom);
  const pathD = values
    .map((value, index) => `${index === 0 ? 'M' : 'L'} ${pad.left + index * stepX} ${yValue(value)}`)
    .join(' ');
  const areaD = `${pathD} L ${pad.left + (values.length - 1) * stepX} ${height - pad.bottom} L ${pad.left} ${height - pad.bottom} Z`;

  const gridLines = Array.from({ length: 5 }, (_, idx) => {
    const y = pad.top + ((height - pad.top - pad.bottom) / 4) * idx;
    return `<line x1="${pad.left}" y1="${y}" x2="${width - pad.right}" y2="${y}" stroke="rgba(19,54,45,0.12)" stroke-width="1"/>`;
  }).join('');

  const pointMarkup = values
    .map((value, index) => {
      const x = pad.left + index * stepX;
      const y = yValue(value);
      return `<circle cx="${x}" cy="${y}" r="4" fill="${color}"/>`;
    })
    .join('');

  const labelMarkup = labels
    .map((label, index) => {
      const x = pad.left + index * stepX;
      return `<text x="${x}" y="${height - 8}" text-anchor="middle" fill="rgba(19,54,45,0.75)" font-size="10" font-family="Inter, sans-serif">${label}</text>`;
    })
    .join('');

  host.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" width="100%" height="100%" role="img" aria-label="${title}">
      ${gridLines}
      <path d="${areaD}" fill="${color}22"/>
      <path d="${pathD}" fill="none" stroke="${color}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/>
      ${pointMarkup}
      ${labelMarkup}
    </svg>
  `;
}

function renderBarChart(targetId, labels, values, title, colors) {
  const host = document.getElementById(targetId);
  if (!host) return;

  const width = 560;
  const height = 220;
  const pad = { top: 18, right: 18, bottom: 28, left: 32 };
  const max = Math.max(...values) + 10;
  const chartH = height - pad.top - pad.bottom;
  const chartW = width - pad.left - pad.right;
  const barWidth = chartW / labels.length * 0.55;

  const bars = values
    .map((value, index) => {
      const x = pad.left + index * (chartW / labels.length) + (chartW / labels.length - barWidth) / 2;
      const y = pad.top + ((max - value) / max) * chartH;
      const barH = height - pad.bottom - y;
      return `
        <rect x="${x}" y="${y}" width="${barWidth}" height="${barH}" rx="8" fill="${colors[index % colors.length]}"/>
      `;
    })
    .join('');

  const labelMarkup = labels
    .map((label, index) => {
      const x = pad.left + index * (chartW / labels.length) + (chartW / labels.length) / 2;
      return `<text x="${x}" y="${height - 8}" text-anchor="middle" fill="rgba(19,54,45,0.7)" font-size="10" font-family="Inter, sans-serif">${label}</text>`;
    })
    .join('');

  host.innerHTML = `
    <svg viewBox="0 0 ${width} ${height}" width="100%" height="100%" role="img" aria-label="${title}">
      <line x1="${pad.left}" y1="${height - pad.bottom}" x2="${width - pad.right}" y2="${height - pad.bottom}" stroke="rgba(19,54,45,0.2)"/>
      ${bars}
      ${labelMarkup}
    </svg>
  `;
}

function renderDashboardCharts() {
  renderTelemetryAnalysis();
  renderBarChart('fieldComparisonChart', ['Field A', 'Field B', 'Field C', 'Field D'], [74, 81, 69, 88], 'Field comparison', ['#0d5a42', '#75c98b', '#8dbfa2', '#b8d0c0']);
}

function renderAIChart() {
  const chartType = document.getElementById('chartTypeSelect')?.value || 'line';
  const query = document.getElementById('chartQuery')?.value || 'Show crop growth for the last 7 days';
  if (chartType === 'bar') {
    renderBarChart('aiChartCanvas', ['Field A', 'Field B', 'Field C', 'Field D'], [68, 72, 79, 77], query, ['#0d5a42', '#75c98b', '#8dbfa2', '#dfeee7']);
    return;
  }
  if (chartType === 'pie') {
    const host = document.getElementById('aiChartCanvas');
    if (!host) return;
    host.innerHTML = `
      <svg viewBox="0 0 560 220" width="100%" height="100%" role="img" aria-label="${query}">
        <circle cx="170" cy="110" r="66" fill="#0d5a42"/>
        <circle cx="170" cy="110" r="66" fill="transparent" stroke="#75c98b" stroke-width="66" stroke-dasharray="158 236" stroke-dashoffset="0" transform="rotate(-90 170 110)"/>
        <circle cx="170" cy="110" r="66" fill="transparent" stroke="#b7d7be" stroke-width="66" stroke-dasharray="92 302" stroke-dashoffset="-158" transform="rotate(-90 170 110)"/>
        <circle cx="170" cy="110" r="66" fill="transparent" stroke="#dfeee7" stroke-width="66" stroke-dasharray="86 308" stroke-dashoffset="-250" transform="rotate(-90 170 110)"/>
        <text x="170" y="108" text-anchor="middle" fill="#0d5a42" font-size="26" font-weight="700" font-family="Inter, sans-serif">64%</text>
        <text x="170" y="130" text-anchor="middle" fill="#13362d" font-size="10" font-family="Inter, sans-serif">Vegetation</text>
        <rect x="300" y="54" width="14" height="14" rx="5" fill="#0d5a42"/>
        <text x="325" y="66" fill="#13362d" font-size="12" font-family="Inter, sans-serif">Field A</text>
        <rect x="300" y="88" width="14" height="14" rx="5" fill="#75c98b"/>
        <text x="325" y="100" fill="#13362d" font-size="12" font-family="Inter, sans-serif">Field B</text>
        <rect x="300" y="122" width="14" height="14" rx="5" fill="#b7d7be"/>
        <text x="325" y="134" fill="#13362d" font-size="12" font-family="Inter, sans-serif">Field C</text>
        <rect x="300" y="156" width="14" height="14" rx="5" fill="#dfeee7"/>
        <text x="325" y="168" fill="#13362d" font-size="12" font-family="Inter, sans-serif">Field D</text>
      </svg>
    `;
    return;
  }
  if (chartType === 'scatter') {
    const host = document.getElementById('aiChartCanvas');
    if (!host) return;
    const points = [
      { x: 48, y: 150 }, { x: 120, y: 130 }, { x: 180, y: 110 }, { x: 240, y: 94 }, { x: 300, y: 82 }, { x: 380, y: 70 }, { x: 440, y: 45 }
    ];
    const markup = points.map((point) => `<circle cx="${point.x}" cy="${point.y}" r="5" fill="#0d5a42"/>`).join('');
    host.innerHTML = `
      <svg viewBox="0 0 560 220" width="100%" height="100%" role="img" aria-label="${query}">
        <line x1="40" y1="180" x2="520" y2="180" stroke="rgba(19,54,45,0.25)"/>
        <line x1="40" y1="30" x2="40" y2="180" stroke="rgba(19,54,45,0.25)"/>
        ${markup}
        <text x="260" y="205" text-anchor="middle" fill="#13362d" font-size="11" font-family="Inter, sans-serif">Vegetation coverage</text>
        <text x="18" y="105" transform="rotate(-90 18 105)" text-anchor="middle" fill="#13362d" font-size="11" font-family="Inter, sans-serif">Temperature</text>
      </svg>
    `;
    return;
  }
  renderLineChart('aiChartCanvas', ['Day 1', 'Day 2', 'Day 3', 'Day 4', 'Day 5', 'Day 6', 'Day 7'], [61, 66, 70, 74, 78, 82, 85], query, '#75c98b');
}

function handleChatSubmit() {
  const input = document.getElementById('chatInput');
  if (!input) return;

  const value = input.value.trim();
  if (!value) return;

  chatHistory.push({ from: 'user', text: value });

  let response = 'Based on current farm data, most monitored fields are stable. I recommend checking the fields with lower vegetation coverage and recent missing telemetry.';
  if (value.toLowerCase().includes('battery')) {
    response = 'Drone 07 has the lowest battery at 42%. Drone 03 remains online at 88% and should be prioritized for maintenance planning.';
  } else if (value.toLowerCase().includes('field a') || value.toLowerCase().includes('compare')) {
    response = 'Field A and Field B are trending upward. Field A shows 12.8% growth, while Field B shows 9.4% growth, and Field A remains the stronger performer.';
  } else if (value.toLowerCase().includes('kannada')) {
    response = 'ಕನ್ನಡದಲ್ಲಿ: ಈ ವಾರದ ಅಧ್ಯಯನದಲ್ಲಿ, ಮಣ್ಣಿನ ತೇವಾಂಶ ಮತ್ತು ಸಸ್ಯದ ಹೊರೆಯು ಸ್ಥಿತಿಯಲ್ಲಿ ಇದೆ. ಹೆಚ್ಚಿನ ಸಮಸ್ಯೆಗಳನ್ನು ಹೊಂದಿರುವ ಕ್ಷೇತ್ರಗಳನ್ನು ಪರಿಶೀಲಿಸಿ.';
  }

  chatHistory.push({ from: 'ai', text: response });
  renderChat();
  input.value = '';
  showToast('AI response generated');
}

function setupNavigation() {
  document.querySelectorAll('.nav-item, .mobile-item').forEach((button) => {
    button.addEventListener('click', () => {
      const target = button.dataset.target;
      document.querySelectorAll('.page').forEach((page) => page.classList.toggle('active', page.id === target));
      document.querySelectorAll('.nav-item').forEach((nav) => nav.classList.toggle('active', nav.dataset.target === target));
      document.querySelectorAll('.mobile-item').forEach((nav) => nav.classList.toggle('active', nav.dataset.target === target));
      if (target === 'farm-map') {
        initializeFarmMap();
        refreshFarmMapSize();
      } else {
        setMapMaximized(false);
      }
    });
  });

  const themeButton = document.querySelector('.theme-toggle');
  if (themeButton) {
    themeButton.addEventListener('click', () => {
      document.body.classList.toggle('dark');
      showToast(document.body.classList.contains('dark') ? 'Dark mode enabled' : 'Light mode enabled');
    });
  }

  const sidebarToggle = document.querySelector('.sidebar-toggle');
  const sidebar = document.querySelector('.sidebar');
  if (sidebarToggle && sidebar) {
    sidebarToggle.addEventListener('click', () => {
      const current = getComputedStyle(sidebar).display;
      sidebar.style.display = current === 'none' ? 'block' : 'none';
    });
  }
}

function setupChartQuery() {
  const generateButton = document.getElementById('generateChart');
  if (generateButton) {
    generateButton.addEventListener('click', () => {
      const query = document.getElementById('chartQuery')?.value || '';
      if (!query) return;
      const chartTypeSelect = document.getElementById('chartTypeSelect');
      const selectedType = chartTypeSelect?.value || 'line';
      const languageSelect = document.getElementById('languageSelect');
      const selectedLanguage = languageSelect?.value || 'English';
      document.getElementById('chartLanguageLabel').textContent =
        window.FarmProtectorI18n?.translate(selectedLanguage) || selectedLanguage;
      document.getElementById('chartRangeLabel').textContent = query.includes('30') ? 'Last 30 days' : 'Last 7 days';
      showToast('Generating chart from farm database');
      if (selectedType === 'bar') {
        renderBarChart('aiChartCanvas', ['Field A', 'Field B', 'Field C', 'Field D'], [68, 72, 79, 77], query, ['#0d5a42', '#75c98b', '#8dbfa2', '#dfeee7']);
      } else if (selectedType === 'pie') {
        const host = document.getElementById('aiChartCanvas');
        if (!host) return;
        host.innerHTML = `
          <svg viewBox="0 0 560 220" width="100%" height="100%" role="img" aria-label="${query}">
            <circle cx="170" cy="110" r="66" fill="#0d5a42"/>
            <circle cx="170" cy="110" r="66" fill="transparent" stroke="#75c98b" stroke-width="66" stroke-dasharray="158 236" stroke-dashoffset="0" transform="rotate(-90 170 110)"/>
            <circle cx="170" cy="110" r="66" fill="transparent" stroke="#b7d7be" stroke-width="66" stroke-dasharray="92 302" stroke-dashoffset="-158" transform="rotate(-90 170 110)"/>
            <circle cx="170" cy="110" r="66" fill="transparent" stroke="#dfeee7" stroke-width="66" stroke-dasharray="86 308" stroke-dashoffset="-250" transform="rotate(-90 170 110)"/>
            <text x="170" y="108" text-anchor="middle" fill="#0d5a42" font-size="26" font-weight="700" font-family="Inter, sans-serif">64%</text>
            <text x="170" y="130" text-anchor="middle" fill="#13362d" font-size="10" font-family="Inter, sans-serif">Vegetation</text>
            <rect x="300" y="54" width="14" height="14" rx="5" fill="#0d5a42"/>
            <text x="325" y="66" fill="#13362d" font-size="12" font-family="Inter, sans-serif">Field A</text>
            <rect x="300" y="88" width="14" height="14" rx="5" fill="#75c98b"/>
            <text x="325" y="100" fill="#13362d" font-size="12" font-family="Inter, sans-serif">Field B</text>
            <rect x="300" y="122" width="14" height="14" rx="5" fill="#b7d7be"/>
            <text x="325" y="134" fill="#13362d" font-size="12" font-family="Inter, sans-serif">Field C</text>
            <rect x="300" y="156" width="14" height="14" rx="5" fill="#dfeee7"/>
            <text x="325" y="168" fill="#13362d" font-size="12" font-family="Inter, sans-serif">Field D</text>
          </svg>
        `;
      } else if (selectedType === 'scatter') {
        const host = document.getElementById('aiChartCanvas');
        if (!host) return;
        const points = [
          { x: 48, y: 150 }, { x: 120, y: 130 }, { x: 180, y: 110 }, { x: 240, y: 94 }, { x: 300, y: 82 }, { x: 380, y: 70 }, { x: 440, y: 45 }
        ];
        const markup = points.map((point) => `<circle cx="${point.x}" cy="${point.y}" r="5" fill="#0d5a42"/>`).join('');
        host.innerHTML = `
          <svg viewBox="0 0 560 220" width="100%" height="100%" role="img" aria-label="${query}">
            <line x1="40" y1="180" x2="520" y2="180" stroke="rgba(19,54,45,0.25)"/>
            <line x1="40" y1="30" x2="40" y2="180" stroke="rgba(19,54,45,0.25)"/>
            ${markup}
            <text x="260" y="205" text-anchor="middle" fill="#13362d" font-size="11" font-family="Inter, sans-serif">Vegetation coverage</text>
            <text x="18" y="105" transform="rotate(-90 18 105)" text-anchor="middle" fill="#13362d" font-size="11" font-family="Inter, sans-serif">Temperature</text>
          </svg>
        `;
      } else {
        renderLineChart('aiChartCanvas', ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'], [61, 66, 70, 74, 78, 82, 85], query, '#75c98b');
      }
    });
  }

  document.querySelectorAll('.chip-button').forEach((button) => {
    button.addEventListener('click', () => {
      const prompt = button.dataset.prompt;
      const input = document.getElementById('chartQuery');
      const chatInput = document.getElementById('chatInput');
      if (input) input.value = prompt;
      if (chatInput) chatInput.value = prompt;
    });
  });

}

function setupFileUpload() {
  const uploadInput = document.getElementById('imageUpload');
  if (!uploadInput) return;

  const uploadButton = document.getElementById('uploadCropImageButton');
  const uploadBox = uploadInput.closest('.upload-box');
  const analyzeFile = async (file) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      showToast('Choose an image file to analyze');
      return;
    }
    if (file.size > 20 * 1024 * 1024) {
      showToast('Choose an image smaller than 20 MB');
      return;
    }

    uploadInput.disabled = true;
    let imageUrl;
    try {
      imageUrl = URL.createObjectURL(file);
      const image = new Image();
      await new Promise((resolve, reject) => {
        image.onload = resolve;
        image.onerror = () => reject(new Error('The selected image could not be opened.'));
        image.src = imageUrl;
      });
      const analysis = analyzeCropImage(image);
      const preview = document.getElementById('analysisPreview');
      const previewImage = document.createElement('img');
      previewImage.src = imageUrl;
      previewImage.alt = `Uploaded crop field image: ${file.name}`;
      preview.replaceChildren(previewImage);

      if (cropPreviewUrl) URL.revokeObjectURL(cropPreviewUrl);
      cropPreviewUrl = imageUrl;
      analysis.previous = previousCropAnalysis;
      cropAnalysis = analysis;
      const currentBaseline = {
        vegetationCoverage: analysis.vegetationCoverage,
        yellowBrownCoverage: analysis.yellowBrownCoverage,
        analyzedAt: analysis.analyzedAt,
      };
      let baselineSaved = true;
      try {
        localStorage.setItem(cropAnalysisStorageKey, JSON.stringify(currentBaseline));
      } catch (error) {
        console.error('Could not save the crop comparison baseline:', error);
        baselineSaved = false;
      }
      previousCropAnalysis = currentBaseline;
      renderAnalysisSummary();
      showToast(baselineSaved
        ? `Analyzed ${file.name}`
        : 'Image analyzed, but its comparison baseline could not be saved');
    } catch (error) {
      if (imageUrl) URL.revokeObjectURL(imageUrl);
      console.error('Could not analyze the crop image:', error);
      showToast(error.message || 'Could not analyze this image');
    } finally {
      uploadInput.disabled = false;
      uploadInput.value = '';
    }
  };

  uploadButton?.addEventListener('click', () => uploadInput.click());
  uploadInput.addEventListener('change', () => analyzeFile(uploadInput.files[0]));
  if (uploadBox) {
    uploadBox.addEventListener('dragover', (event) => {
      event.preventDefault();
      uploadBox.classList.add('is-dragging');
    });
    uploadBox.addEventListener('dragleave', () => uploadBox.classList.remove('is-dragging'));
    uploadBox.addEventListener('drop', (event) => {
      event.preventDefault();
      uploadBox.classList.remove('is-dragging');
      analyzeFile(event.dataTransfer.files[0]);
    });
  }
}

function setupVoiceInput() {
  const voiceButton = document.getElementById('voiceAssistant');
  if (!voiceButton || !('webkitSpeechRecognition' in window || 'SpeechRecognition' in window)) {
    if (voiceButton) {
      voiceButton.disabled = true;
      voiceButton.title = 'Voice input not supported on this browser';
    }
    return;
  }

  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  const recognition = new SpeechRecognition();
  recognition.lang = 'en-US';
  recognition.interimResults = false;
  recognition.maxAlternatives = 1;

  voiceButton.addEventListener('click', () => {
    recognition.start();
    showToast('Listening for your question...');
  });

  recognition.addEventListener('result', (event) => {
    const transcript = event.results[0][0].transcript;
    const chatInput = document.getElementById('chatInput');
    if (chatInput) chatInput.value = transcript;
    showToast('Voice input captured');
  });
}

function setupReportExports() {
  const csvButton = document.getElementById('exportCsv');
  if (csvButton) {
    csvButton.addEventListener('click', () => {
      const rows = [
        ['Farm', 'Field', 'Crop', 'Temperature', 'Humidity', 'Battery'],
        ['Green Valley Farm', 'Field A-2', 'Rice', '29°C', '62%', '88%'],
        ['Delta Agro Fields', 'Field C-5', 'Cotton', '31°C', '58%', '42%'],
        ['Sunrise Harvest', 'Field D-7', 'Mango', '29°C', '66%', '71%'],
      ];

      const csv = rows.map((row) => row.join(',')).join('\n');
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'farm-monitoring-report.csv';
      a.click();
      URL.revokeObjectURL(url);
      showToast('CSV export ready');
    });
  }

  const pdfButton = document.getElementById('exportPdf');
  if (pdfButton) {
    pdfButton.addEventListener('click', () => {
      window.print();
      showToast('PDF export initiated');
    });
  }
}

function setupSendChat() {
  const sendButton = document.getElementById('sendChat');
  if (sendButton) sendButton.addEventListener('click', handleChatSubmit);

  const chatInput = document.getElementById('chatInput');
  if (chatInput) {
    chatInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        handleChatSubmit();
      }
    });
  }
}

async function init() {
  window.FarmProtectorI18n?.initialize();
  setupAuthentication();
  try {
    const result = await apiRequest('/api/session');
    await activateDashboard(result.user);
  } catch (error) {
    if (error.message === 'Sign in to continue.') return;
    console.error('Could not restore the signed-in session:', error);
    const errorMessage = document.getElementById('authError');
    if (error.message.includes('Failed to fetch')) {
      errorMessage.textContent = 'Could not connect to the farm server. Start it with python server.py and reload.';
      errorMessage.hidden = false;
    } else {
      errorMessage.hidden = true;
    }
  }
}

init();
