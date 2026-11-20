(() => {
  const form = document.getElementById('devicePairForm');
  const errorMessage = document.getElementById('cameraDeviceError');
  const pairButton = document.getElementById('pairCameraButton');
  const pairedControls = document.getElementById('pairedCameraControls');
  const startButton = document.getElementById('startPairedCamera');
  const stopButton = document.getElementById('stopPairedCamera');
  const status = document.getElementById('pairedCameraStatus');
  const preview = document.getElementById('pairedCameraPreview');
  let device = null;
  let stream = null;
  let sessionId = null;
  let callId = null;
  let peerConnection = null;
  let wakeLock = null;
  let signalCursor = 0;
  let signalTimer = null;
  let heartbeatTimer = null;
  let signaling = false;
  let remoteDescriptionSet = false;
  let pendingCandidates = [];
  let iceServers = [];
  let stopping = false;

  window.FarmProtectorI18n?.initialize();

  async function request(path, options = {}) {
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

  function setStatus(message, className = 'neutral') {
    status.textContent = window.FarmProtectorI18n?.translate(message) || message;
    status.className = `tag ${className}`;
  }

  function showPairedDevice(pairedDevice) {
    device = pairedDevice;
    document.getElementById('cameraDeviceTitle').textContent = 'Farm camera ready';
    document.getElementById('cameraDeviceDescription').textContent = 'This phone is paired. Start the broadcast to let your farm account view the live camera.';
    document.getElementById('pairedCameraName').textContent = `${pairedDevice.name} - ${pairedDevice.farm_name}`;
    form.hidden = true;
    pairedControls.hidden = false;
    pairButton.disabled = false;
  }

  async function loadPairedDevice() {
    try {
      const result = await request('/api/device/session');
      showPairedDevice(result.device);
    } catch (error) {
      if (error.message !== 'Pair this phone with your farm account first.') {
        console.error('Could not load the paired camera device:', error);
        errorMessage.textContent = error.message;
        errorMessage.hidden = false;
      }
    }
  }

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    pairButton.disabled = true;
    errorMessage.hidden = true;
    try {
      const result = await request('/api/device/pair', {
        method: 'POST',
        body: JSON.stringify({ code: form.elements.code.value.trim().toUpperCase() }),
      });
      showPairedDevice(result.device);
    } catch (error) {
      console.error('Could not pair this farm camera:', error);
      errorMessage.textContent = error.message;
      errorMessage.hidden = false;
    } finally {
      pairButton.disabled = false;
    }
  });

  async function sendSignal(type, data) {
    if (!sessionId || !callId) return;
    await request('/api/camera/signal', {
      method: 'POST',
      body: JSON.stringify({
        session_id: sessionId,
        call_id: callId,
        role: 'camera',
        type,
        data,
      }),
    });
  }

  async function addPendingCandidates() {
    if (!peerConnection || !remoteDescriptionSet) return;
    const candidates = pendingCandidates;
    pendingCandidates = [];
    for (const candidate of candidates) {
      try {
        await peerConnection.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (error) {
        console.error('Could not add the viewer network candidate:', error);
      }
    }
  }

  function closePeerConnection() {
    if (peerConnection) {
      peerConnection.onicecandidate = null;
      peerConnection.onconnectionstatechange = null;
      peerConnection.close();
      peerConnection = null;
    }
    remoteDescriptionSet = false;
    pendingCandidates = [];
    callId = null;
    signalCursor = 0;
  }

  async function processSignals() {
    if (!sessionId || signaling || stopping) return;
    signaling = true;
    try {
      const query = new URLSearchParams({
        session_id: sessionId,
        call_id: callId || '',
        role: 'camera',
        after: String(signalCursor),
      });
      const result = await request(`/api/camera/signals?${query}`);
      if (result.waiting) {
        setStatus('Camera is online', 'success');
        return;
      }
      if (result.ended) {
        closePeerConnection();
        setStatus('Camera is online', 'success');
        return;
      }
      if (result.call_id) callId = result.call_id;
      if (result.offer && !peerConnection) {
        setStatus('Incoming viewer');
        peerConnection = new RTCPeerConnection({ iceServers });
        for (const track of stream.getTracks()) {
          const sender = peerConnection.addTrack(track, stream);
          const parameters = sender.getParameters();
          if (parameters.encodings.length) {
            parameters.encodings[0].maxBitrate = 1200000;
            sender.setParameters(parameters).catch((error) => {
              console.error('Could not limit the camera video bitrate:', error);
            });
          }
        }
        peerConnection.onicecandidate = (candidateEvent) => {
          if (!candidateEvent.candidate) return;
          sendSignal('candidate', candidateEvent.candidate.toJSON()).catch((error) => {
            console.error('Could not send the camera network candidate:', error);
            setStatus(error.message, 'warning');
          });
        };
        peerConnection.onconnectionstatechange = () => {
          if (peerConnection?.connectionState === 'connected') {
            setStatus('Live video connected', 'success');
          } else if (peerConnection?.connectionState === 'failed') {
            setStatus('Video connection failed; check TURN setup', 'warning');
          }
        };
        await peerConnection.setRemoteDescription(new RTCSessionDescription(result.offer));
        remoteDescriptionSet = true;
        await addPendingCandidates();
        const answer = await peerConnection.createAnswer();
        await peerConnection.setLocalDescription(answer);
        await sendSignal('answer', peerConnection.localDescription.toJSON());
        setStatus('Connecting to remote viewer…');
      }
      for (const item of result.candidates || []) {
        signalCursor = Math.max(signalCursor, item.id);
        if (peerConnection && remoteDescriptionSet) {
          try {
            await peerConnection.addIceCandidate(new RTCIceCandidate(item.candidate));
          } catch (error) {
            console.error('Could not add the viewer network candidate:', error);
          }
        } else {
          pendingCandidates.push(item.candidate);
        }
      }
    } catch (error) {
      console.error('Farm camera signal exchange failed:', error);
      setStatus(error.message, 'warning');
      if (error.message.includes('no longer connected') || error.message.includes('session has ended')) {
        await stopBroadcast(false);
      }
    } finally {
      signaling = false;
    }
  }

  async function stopBroadcast(sendRequest = true) {
    stopping = true;
    if (signalTimer !== null) clearInterval(signalTimer);
    if (heartbeatTimer !== null) clearInterval(heartbeatTimer);
    signalTimer = null;
    heartbeatTimer = null;
    closePeerConnection();
    if (stream) stream.getTracks().forEach((track) => track.stop());
    stream = null;
    preview.srcObject = null;
    preview.hidden = true;
    startButton.hidden = false;
    stopButton.hidden = true;
    if (wakeLock) {
      try {
        await wakeLock.release();
      } catch (error) {
        console.error('Could not release the camera screen wake lock:', error);
      }
      wakeLock = null;
    }
    if (sessionId && sendRequest) {
      try {
        await request('/api/camera/broadcast', {
          method: 'POST',
          body: JSON.stringify({ action: 'stop', session_id: sessionId }),
        });
      } catch (error) {
        console.error('Could not stop the farm camera broadcast:', error);
      }
    }
    sessionId = null;
    setStatus('Camera is offline');
    stopping = false;
  }

  startButton.addEventListener('click', async () => {
    startButton.disabled = true;
    try {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) {
        throw new Error('Camera access requires HTTPS and a supported browser.');
      }
      const config = await request('/api/camera/config');
      iceServers = config.ice_servers;
      stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: {
          facingMode: { ideal: 'environment' },
          width: { ideal: 1280, max: 1920 },
          height: { ideal: 720, max: 1080 },
          frameRate: { ideal: 24, max: 30 },
        },
      });
      try {
        if (navigator.wakeLock?.request) wakeLock = await navigator.wakeLock.request('screen');
      } catch (error) {
        console.warn('Could not keep the farm camera screen awake:', error);
      }
      const result = await request('/api/camera/broadcast', {
        method: 'POST',
        body: JSON.stringify({ action: 'start' }),
      });
      sessionId = result.session_id;
      preview.srcObject = stream;
      preview.hidden = false;
      startButton.hidden = true;
      stopButton.hidden = false;
      setStatus('Camera is online', 'success');
      heartbeatTimer = setInterval(async () => {
        try {
          await request('/api/camera/broadcast', {
            method: 'POST',
            body: JSON.stringify({ action: 'heartbeat', session_id: sessionId }),
          });
        } catch (error) {
          console.error('Farm camera heartbeat failed:', error);
          setStatus(error.message, 'warning');
        }
      }, 7000);
      signalTimer = setInterval(processSignals, 1000);
      processSignals();
    } catch (error) {
      console.error('Could not start the farm camera:', error);
      await stopBroadcast();
      setStatus(error.message, 'warning');
    } finally {
      startButton.disabled = false;
    }
  });

  stopButton.addEventListener('click', () => stopBroadcast());

  document.getElementById('signOutPairedCamera').addEventListener('click', async () => {
    await stopBroadcast();
    try {
      await request('/api/device/logout', { method: 'POST', body: '{}' });
      window.location.reload();
    } catch (error) {
      console.error('Could not unpair the farm camera:', error);
      setStatus(error.message, 'warning');
    }
  });

  window.addEventListener('pagehide', () => {
    if (stream) stream.getTracks().forEach((track) => track.stop());
    if (wakeLock) wakeLock.release();
    if (sessionId) {
      fetch('/api/camera/broadcast', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'same-origin',
        keepalive: true,
        body: JSON.stringify({ action: 'stop', session_id: sessionId }),
      }).catch((error) => console.error('Could not stop the farm camera during page exit:', error));
    }
  }, { once: true });

  loadPairedDevice();
})();
