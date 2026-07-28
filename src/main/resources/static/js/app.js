(function () {
  'use strict';

  let routeData = null;
  let currentGpxText = null;
  let currentUser = null;
  let gpsWatchId = null;
  let isTracking = false;
  let trackStartTime = null;
  let trackStartIdx = 0;
  let elevationCollapsed = false;
  let lastGpsPosition = null;
  let wakeLock = null;
  let voiceEnabled = true;
  try { voiceEnabled = localStorage.getItem('hikerAid_voice') !== '0'; } catch (e) {}
  let lastSpokenCategory = null;
  let lastSpokenOffRoute = false;

  let isRecording = false;
  let recordedPoints = [];
  let recordTotalDistM = 0;
  let recordStartTime = null;
  let recordWatchId = null;
  let recordPolyline = null;
  let recordInterval = null;
  let recordSessionId = null;
  let recordPhotoCount = 0;

  const DB_NAME = 'hikerAidOffline';
  const STORE_NAME = 'pendingActivities';
  const PHOTO_STORE = 'photos';

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 2);
      req.onupgradeneeded = (e) => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        }
        if (!db.objectStoreNames.contains(PHOTO_STORE)) {
          const store = db.createObjectStore(PHOTO_STORE, { keyPath: 'id', autoIncrement: true });
          store.createIndex('activityId', 'activityId', { unique: false });
          store.createIndex('sessionId', 'sessionId', { unique: false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  async function addPhoto(photo) {
    const db = await openDB();
    const tx = db.transaction(PHOTO_STORE, 'readwrite');
    tx.objectStore(PHOTO_STORE).add(photo);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  }

  async function getPhotosBySession(sessionId) {
    const db = await openDB();
    const tx = db.transaction(PHOTO_STORE, 'readonly');
    const idx = tx.objectStore(PHOTO_STORE).index('sessionId');
    const req = idx.getAll(sessionId);
    return new Promise((resolve, reject) => {
      req.onsuccess = () => { db.close(); resolve(req.result); };
      req.onerror = () => { db.close(); reject(req.error); };
    });
  }

  async function getPhotosByActivity(activityId) {
    const db = await openDB();
    const tx = db.transaction(PHOTO_STORE, 'readonly');
    const idx = tx.objectStore(PHOTO_STORE).index('activityId');
    const req = idx.getAll(activityId);
    return new Promise((resolve, reject) => {
      req.onsuccess = () => { db.close(); resolve(req.result); };
      req.onerror = () => { db.close(); reject(req.error); };
    });
  }

  async function deletePhotosBySession(sessionId) {
    const db = await openDB();
    const tx = db.transaction(PHOTO_STORE, 'readwrite');
    const idx = tx.objectStore(PHOTO_STORE).index('sessionId');
    const req = idx.openCursor(sessionId);
    return new Promise((resolve, reject) => {
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) { cursor.delete(); cursor.continue(); }
      };
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  }

  async function linkSessionPhotosToActivity(sessionId, activityId) {
    const db = await openDB();
    const tx = db.transaction(PHOTO_STORE, 'readwrite');
    const store = tx.objectStore(PHOTO_STORE);
    const idx = store.index('sessionId');
    const req = idx.openCursor(sessionId);
    return new Promise((resolve, reject) => {
      req.onsuccess = () => {
        const cursor = req.result;
        if (cursor) {
          const v = cursor.value;
          v.activityId = activityId;
          cursor.update(v);
          cursor.continue();
        }
      };
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  }

  async function addPending(activity) {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).add({ ...activity, savedAt: new Date().toISOString() });
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  }

  async function getAllPending() {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).getAll();
    return new Promise((resolve, reject) => {
      req.onsuccess = () => { db.close(); resolve(req.result); };
      req.onerror = () => { db.close(); reject(req.error); };
    });
  }

  async function deletePending(id) {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readwrite');
    tx.objectStore(STORE_NAME).delete(id);
    return new Promise((resolve, reject) => {
      tx.oncomplete = () => { db.close(); resolve(); };
      tx.onerror = () => { db.close(); reject(tx.error); };
    });
  }

  async function getPendingCount() {
    const db = await openDB();
    const tx = db.transaction(STORE_NAME, 'readonly');
    const req = tx.objectStore(STORE_NAME).count();
    return new Promise((resolve, reject) => {
      req.onsuccess = () => { db.close(); resolve(req.result); };
      req.onerror = () => { db.close(); reject(req.error); };
    });
  }

  async function requestBackgroundSync() {
    try {
      const reg = await navigator.serviceWorker?.ready;
      if (reg && 'sync' in reg) {
        await reg.sync.register('sync-activities');
      }
    } catch (e) {}
  }

  async function updateSyncBadge() {
    try {
      const count = await getPendingCount();
      const btn = document.getElementById('btn-sync');
      const badge = document.getElementById('sync-badge');
      if (count > 0 && currentUser) {
        btn.classList.remove('hidden');
        badge.textContent = count;
      } else {
        btn.classList.add('hidden');
      }
    } catch (e) {}
  }

  async function syncPendingActivities() {
    if (!navigator.onLine || !currentUser) return 0;

    const pending = await getAllPending();
    if (pending.length === 0) return 0;

    const syncBtn = document.getElementById('btn-sync');
    syncBtn.classList.add('syncing');

    let synced = 0;
    for (const activity of pending) {
      try {
        const body = { ...activity };
        delete body.id;
        delete body.savedAt;
        const res = await fetch('/api/activities', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(body)
        });
        if (res.ok) {
          await deletePending(activity.id);
          synced++;
        }
      } catch (e) { break; }
    }

    syncBtn.classList.remove('syncing');
    await updateSyncBadge();
    if (synced > 0) {
      loadActivities();
      showToast(`${synced} ${synced === 1 ? 'activity' : 'activities'} synced`);
    }
    return synced;
  }

  function showToast(msg) {
    const toast = document.createElement('div');
    toast.className = 'app-toast';
    toast.setAttribute('role', 'status');
    toast.setAttribute('aria-live', 'polite');
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }

  function speak(text) {
    if (!voiceEnabled || !text || !('speechSynthesis' in window)) return;
    try {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = 1.0;
      u.pitch = 1.0;
      u.lang = 'en-US';
      window.speechSynthesis.cancel();
      window.speechSynthesis.speak(u);
    } catch (e) {}
  }

  function stopSpeaking() {
    try { if ('speechSynthesis' in window) window.speechSynthesis.cancel(); } catch (e) {}
  }

  async function requestWakeLock() {
    if (!('wakeLock' in navigator)) return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch (e) { wakeLock = null; }
  }

  function releaseWakeLock() {
    if (wakeLock) {
      try { wakeLock.release(); } catch (e) {}
      wakeLock = null;
    }
  }

  function updateVoiceButton() {
    const btn = document.getElementById('btn-voice');
    if (!btn) return;
    const supported = 'speechSynthesis' in window;
    btn.classList.toggle('muted', !voiceEnabled || !supported);
    btn.setAttribute('aria-pressed', String(voiceEnabled && supported));
    btn.title = !supported ? 'Voice guidance not supported on this device'
      : voiceEnabled ? 'Spoken safety guidance: on' : 'Spoken safety guidance: off';
  }

  function applyTheme(theme) {
    if (theme === 'light') document.documentElement.setAttribute('data-theme', 'light');
    else document.documentElement.removeAttribute('data-theme');
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', theme === 'light' ? '#f4f8f2' : '#1a2f1a');
  }
  function toggleTheme() {
    const current = document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    const next = current === 'light' ? 'dark' : 'light';
    applyTheme(next);
    try { localStorage.setItem('hikerAid_theme', next); } catch (e) {}
  }

  const screens = {
    upload:  document.getElementById('upload-screen'),
    loading: document.getElementById('loading-screen'),
    viewer:  document.getElementById('viewer-screen'),
  };

  function showScreen(name) {
    Object.values(screens).forEach(s => s.classList.remove('active'));
    screens[name].classList.add('active');
    if (name === 'viewer') {
      requestAnimationFrame(() => {
        HikerMap.getMap()?.invalidateSize();
      });
    }
  }

  async function checkAuth() {
    try {
      const res = await fetch('/api/user');
      const data = await res.json();
      if (data.loggedIn) {
        currentUser = data;
        document.getElementById('login-btn').classList.add('hidden');
        const panel = document.getElementById('user-panel');
        panel.classList.remove('hidden');
        document.getElementById('user-avatar').src = data.avatar || '';
        document.getElementById('user-name').textContent = data.name || data.email;
        document.getElementById('user-email').textContent = data.email || '';
        if (data.admin) {
          document.getElementById('admin-badge').classList.remove('hidden');
        }
        document.getElementById('btn-save-activity').classList.remove('hidden');
        document.getElementById('user-content').classList.remove('hidden');
        document.getElementById('btn-emergency-fab').classList.remove('hidden');
        loadActivities();
        loadUserStats();
        loadPersonalPace();
        loadFriends();
        updateSyncBadge();
        if (navigator.onLine) syncPendingActivities();
      }
    } catch (e) {}
  }

  async function loadActivities() {
    try {
      let activities = [];
      try {
        const res = await fetch('/api/activities');
        if (res.ok) activities = await res.json();
      } catch (e) {}

      let pending = [];
      try { pending = await getAllPending(); } catch (e) {}

      const list = document.getElementById('activities-list');

      if (activities.length === 0 && pending.length === 0) {
        list.innerHTML = '<p class="uc-empty">No activities yet. Upload or record a hike to get started.</p>';
        return;
      }

      list.innerHTML = '';

      for (const p of pending) {
        const card = document.createElement('div');
        card.className = 'activity-card pending-card';
        const mainRow = document.createElement('div');
        mainRow.className = 'activity-main';
        const nameEl = document.createElement('span');
        nameEl.className = 'activity-name';
        nameEl.textContent = p.name || 'Pending activity';
        const badge = document.createElement('span');
        badge.className = 'pending-badge';
        badge.textContent = navigator.onLine ? 'Will sync' : 'Offline - queued';
        mainRow.append(nameEl, badge);

        const statsRow = document.createElement('div');
        statsRow.className = 'activity-stats-row';
        for (const txt of [`${p.distanceKm || 0} km`, `${p.elevationGainM || 0}m gain`, p.difficulty || '']) {
          if (!txt) continue;
          const sp = document.createElement('span');
          sp.textContent = txt;
          statsRow.appendChild(sp);
        }

        const actions = document.createElement('div');
        actions.className = 'activity-actions';
        const delBtn = document.createElement('button');
        delBtn.className = 'activity-delete-btn';
        delBtn.textContent = 'Discard';
        delBtn.addEventListener('click', async () => {
          if (!confirm('Discard this queued activity? It will not be saved.')) return;
          await deletePending(p.id);
          await updateSyncBadge();
          loadActivities();
        });
        actions.appendChild(delBtn);

        card.append(mainRow, statsRow, actions);
        list.appendChild(card);
      }

      for (const a of activities) {
        const card = document.createElement('div');
        card.className = 'activity-card';
        const timeStr = a.movingTimeMinutes ? formatTime(a.movingTimeMinutes) : '--';

        const mainRow = document.createElement('div');
        mainRow.className = 'activity-main';
        const nameEl = document.createElement('span');
        nameEl.className = 'activity-name';
        nameEl.textContent = a.name;
        const dateEl = document.createElement('span');
        dateEl.className = 'activity-date';
        dateEl.textContent = new Date(a.recordedAt).toLocaleDateString();
        mainRow.append(nameEl, dateEl);

        const statsRow = document.createElement('div');
        statsRow.className = 'activity-stats-row';
        for (const txt of [`${a.distanceKm} km`, timeStr, `${a.elevationGainM}m gain`]) {
          const sp = document.createElement('span');
          sp.textContent = txt;
          statsRow.appendChild(sp);
        }
        const diffSpan = document.createElement('span');
        diffSpan.className = 'activity-diff';
        diffSpan.textContent = a.difficulty;
        statsRow.appendChild(diffSpan);

        const actions = document.createElement('div');
        actions.className = 'activity-actions';
        const viewBtn = document.createElement('button');
        viewBtn.className = 'activity-view-btn';
        viewBtn.textContent = 'View';
        viewBtn.addEventListener('click', () => viewActivity(a.id));
        const shareBtn = document.createElement('button');
        shareBtn.className = 'activity-view-btn';
        shareBtn.textContent = 'Share';
        shareBtn.addEventListener('click', () => shareActivity(a.id));
        const delBtn = document.createElement('button');
        delBtn.className = 'activity-delete-btn';
        delBtn.textContent = 'Delete';
        delBtn.addEventListener('click', () => deleteActivity(a.id));
        actions.append(viewBtn, shareBtn, delBtn);

        card.append(mainRow, statsRow, actions);
        list.appendChild(card);
      }
    } catch (e) {}
  }

  async function viewActivity(id) {
    showScreen('loading');
    try {
      const res = await fetch(`/api/activities/${id}`);
      if (!res.ok) { showScreen('upload'); return; }
      const activity = await res.json();

      const gpxBlob = new Blob([activity.gpxData], { type: 'application/gpx+xml' });
      const form = new FormData();
      form.append('file', gpxBlob, 'activity.gpx');
      form.append('weight', document.getElementById('weight-input').value || '70');
      form.append('height', document.getElementById('height-input').value || '170');
      form.append('pack', document.getElementById('pack-input').value || '0');
      form.append('fitness', document.getElementById('fitness-select').value || '3');
      appendPaceOverride(form);
      const st2 = currentStartTime();
      form.append('startHour', st2.hour);
      form.append('startMinute', st2.minute);

      const analyzeRes = await fetch('/api/analyze', { method: 'POST', body: form });
      const data = await analyzeRes.json();

      if (!analyzeRes.ok) { showScreen('upload'); return; }

      currentGpxText = activity.gpxData;
      routeData = data;
      routeData._activityId = id;
      document.getElementById('btn-download-gpx').classList.remove('hidden');
      renderViewer(data);
      showScreen('viewer');
      loadComparisons(id);
      showPhotosForActivity(id, null);
    } catch (e) {
      showScreen('upload');
    }
  }

  async function loadComparisons(activityId) {
    const card = document.getElementById('card-comparison');
    card.classList.add('hidden');
    try {
      const res = await fetch(`/api/activities/${activityId}/comparisons`);
      if (!res.ok) return;
      const data = await res.json();
      if (routeData?._activityId !== activityId) return;
      if (!data.matchCount || data.matchCount === 0) return;

      card.classList.remove('hidden');
      const val = document.getElementById('stat-comparison');
      card.classList.remove('safety-ok', 'safety-caution', 'safety-card');
      card.classList.add('safety-card');

      if (data.isPersonalBest) {
        val.textContent = 'PR!';
        card.classList.add('safety-ok');
        card.title = `Personal best across ${data.matchCount} attempts on this route`;
      } else {
        const diff = (data.avgMinutes || 0) - (data.currentMinutes || 0);
        const abs = Math.abs(Math.round(diff));
        val.textContent = `${diff >= 0 ? '-' : '+'}${formatTime(abs)}`;
        card.classList.add(diff >= 0 ? 'safety-ok' : 'safety-caution');
        card.title = `vs your average across ${data.matchCount} prior attempts`;
      }
      renderComparisonMatches(data);
    } catch (e) {}
  }

  function renderComparisonMatches(data) {
    const panel = document.getElementById('splits-panel');
    panel.querySelectorAll('.comparisons-banner').forEach(el => el.remove());
    const summary = document.getElementById('splits-summary');
    const banner = document.createElement('div');
    banner.className = 'comparisons-banner';
    const txtStrong = document.createElement('strong');
    if (data.isPersonalBest) {
      banner.classList.add('comparisons-pr');
      txtStrong.textContent = 'Personal Best! ';
      banner.appendChild(txtStrong);
      banner.appendChild(document.createTextNode(`Faster than all ${data.matchCount} of your prior attempts on this route.`));
    } else {
      const diff = (data.avgMinutes || 0) - (data.currentMinutes || 0);
      const sign = diff >= 0 ? 'faster' : 'slower';
      txtStrong.textContent = `${formatTime(Math.abs(Math.round(diff)))} ${sign}`;
      banner.appendChild(txtStrong);
      banner.appendChild(document.createTextNode(` than your average across ${data.matchCount} prior attempt${data.matchCount === 1 ? '' : 's'}.`));
    }
    summary.parentNode.insertBefore(banner, summary);
  }

  let measuredPace = null;

  async function loadPersonalPace() {
    const row = document.getElementById('pace-cal-row');
    try {
      const res = await fetch('/api/user/pace');
      if (!res.ok) { row.classList.add('hidden'); return; }
      const data = await res.json();
      if (data.calibrated && data.paceFactor) {
        measuredPace = data.paceFactor;
        const pct = Math.round((data.paceFactor - 1) * 100);
        const rel = pct === 0 ? 'about average pace'
          : pct > 0 ? `${pct}% faster than the Tobler baseline`
          : `${-pct}% slower than the Tobler baseline`;
        document.getElementById('pace-cal-text').textContent =
          `Use my measured pace (${data.paceFactor.toFixed(2)}×, ${rel}) from ${data.samples} timed hike${data.samples === 1 ? '' : 's'}`;
        row.classList.remove('hidden');
      } else {
        measuredPace = null;
        row.classList.add('hidden');
      }
    } catch (e) { row.classList.add('hidden'); }
  }

  function appendPaceOverride(form) {
    const cb = document.getElementById('use-measured-pace');
    if (measuredPace && cb && cb.checked) form.append('paceFactor', measuredPace);
  }

  async function loadUserStats() {
    try {
      const res = await fetch('/api/user/stats');
      if (!res.ok) return;
      const s = await res.json();
      setText('us-hikes', s.totalActivities || 0);
      setText('us-km', s.totalKm || 0);
      setText('us-gain', s.totalGainM || 0);
      setText('us-cal', s.totalCalories || 0);
    } catch (e) {}
  }

  async function shareActivity(id) {
    try {
      const res = await fetch(`/api/activities/${id}/share`, { method: 'POST' });
      if (!res.ok) { showToast('Could not create share link'); return; }
      const data = await res.json();
      const url = location.origin + data.url;
      try {
        await navigator.clipboard.writeText(url);
        showToast('Public share link copied to clipboard');
      } catch (e) {
        prompt('Public share link:', url);
      }
    } catch (e) { showToast('Could not create share link'); }
  }

  async function loadSharedRoute(token) {
    document.body.classList.add('shared-mode');
    showScreen('loading');
    try {
      const res = await fetch(`/api/public/route/${encodeURIComponent(token)}`);
      if (!res.ok) { showSharedError(); return; }
      const shared = await res.json();
      if (!shared.gpxData) { showSharedError(); return; }

      const form = new FormData();
      form.append('file', new Blob([shared.gpxData], { type: 'application/gpx+xml' }), 'route.gpx');
      const analyzeRes = await fetch('/api/analyze', { method: 'POST', body: form });
      const data = await analyzeRes.json();
      if (!analyzeRes.ok) { showSharedError(); return; }

      currentGpxText = shared.gpxData;
      routeData = data;
      document.getElementById('btn-download-gpx').classList.remove('hidden');
      document.title = (shared.name || 'Shared route') + ' — HikerAid';
      renderViewer(data);
      showScreen('viewer');
    } catch (e) { showSharedError(); }
  }

  function showSharedError() {
    showScreen('upload');
    showError('This shared route link is invalid or has been revoked.');
  }

  let liveViewMarker = null;
  let liveViewCentered = false;
  let liveViewPoll = null;

  function relativeTime(iso) {
    if (!iso) return 'never';
    const then = new Date(iso).getTime();
    if (isNaN(then)) return 'unknown';
    const mins = Math.round((Date.now() - then) / 60000);
    if (mins < 1) return 'just now';
    if (mins < 60) return `${mins} min ago`;
    const h = Math.floor(mins / 60), m = mins % 60;
    return `${h}h ${m}m ago`;
  }

  function loadLiveView(token) {
    document.body.classList.add('shared-mode', 'live-mode');
    document.getElementById('route-name').textContent = 'Live location';
    document.getElementById('live-info').classList.remove('hidden');
    showScreen('viewer');
    const map = HikerMap.getMap();
    if (map) { map.setView([20, 0], 2); requestAnimationFrame(() => map.invalidateSize()); }

    const tick = async () => {
      try {
        const res = await fetch(`/api/public/track/${encodeURIComponent(token)}`);
        if (!res.ok) {
          renderLiveInfo({ error: 'This live link is invalid or has ended.' });
          if (liveViewPoll) { clearInterval(liveViewPoll); liveViewPoll = null; }
          return;
        }
        const data = await res.json();
        renderLiveInfo(data);
        if (!data.active && liveViewPoll) { clearInterval(liveViewPoll); liveViewPoll = null; }
      } catch (e) {
        renderLiveInfo({ error: 'Could not reach the server. Retrying...' });
      }
    };
    tick();
    liveViewPoll = setInterval(tick, 15000);
  }

  function renderLiveInfo(d) {
    const box = document.getElementById('live-info');
    box.innerHTML = '';
    const add = (cls, text) => { const e = document.createElement('div'); e.className = cls; e.textContent = text; box.appendChild(e); return e; };

    if (d.error) { add('li-title', 'Live tracking'); add('li-row', d.error); return; }

    document.getElementById('route-name').textContent = `Live: ${d.hikerName || 'hiker'}`;
    add('li-title', `${d.hikerName || 'A hiker'}${d.routeName ? ' · ' + d.routeName : ''}`);
    add('li-row', d.active ? 'Status: tracking in progress' : 'Status: tracking ended');
    if (d.startedAt) add('li-row', `Started: ${new Date(d.startedAt).toLocaleString()}`);
    if (d.expectedReturn) add('li-row', `Expected back: ${new Date(d.expectedReturn).toLocaleString()}`);

    const map = HikerMap.getMap();
    if (d.hasFix && d.lat != null && d.lon != null) {
      add('li-row', `Last position: ${relativeTime(d.lastUpdate)}${d.accuracy ? ` (±${Math.round(d.accuracy)} m)` : ''}`);
      const link = document.createElement('a');
      link.className = 'li-maps';
      link.href = `https://maps.google.com/?q=${d.lat.toFixed(6)},${d.lon.toFixed(6)}`;
      link.target = '_blank'; link.rel = 'noopener';
      link.textContent = 'Open last position in Google Maps';
      box.appendChild(link);
      if (map) {
        const latlng = [d.lat, d.lon];
        if (!liveViewMarker) {
          liveViewMarker = L.marker(latlng, {
            icon: L.divIcon({ html: '<div class="gps-marker"></div>', className: '', iconSize: [18, 18], iconAnchor: [9, 9] }),
            zIndexOffset: 1000
          }).addTo(map);
        } else {
          liveViewMarker.setLatLng(latlng);
        }
        if (!liveViewCentered) { map.setView(latlng, 14); liveViewCentered = true; }
      }
    } else {
      add('li-row', `Waiting for ${d.hikerName || 'the hiker'}'s first GPS fix...`);
    }
  }

  async function deleteActivity(id) {
    if (!confirm('Delete this activity?')) return;
    try {
      await fetch(`/api/activities/${id}`, { method: 'DELETE' });
      loadActivities();
    } catch (e) {}
  }

  async function saveActivity() {
    if (!routeData || !currentUser || !currentGpxText) return;
    const s = routeData.stats;
    const activityData = {
      name: routeData.name || 'Unnamed route',
      gpxData: currentGpxText,
      distanceKm: s.distanceKm,
      elevationGainM: s.elevationGainM,
      elevationLossM: s.elevationLossM,
      movingTimeMinutes: s.estimatedTimeMinutes,
      totalTimeMinutes: s.totalTimeMinutes,
      calories: s.estimatedCalories,
      difficulty: s.difficulty,
      difficultyScore: s.difficultyScore,
      maxElevationM: s.maxElevationM,
      minElevationM: s.minElevationM,
      avgSpeedKmh: s.avgSpeedKmh
    };

    const saveBtn = document.getElementById('btn-save-activity');

    if (!navigator.onLine) {
      await addPending(activityData);
      await updateSyncBadge();
      requestBackgroundSync();
      loadActivities();
      saveBtn.textContent = 'Saved offline';
      saveBtn.disabled = true;
      setTimeout(() => { saveBtn.innerHTML = saveBtn.dataset.originalHtml; saveBtn.disabled = false; }, 2000);
      return;
    }

    try {
      const res = await fetch('/api/activities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(activityData)
      });
      if (res.ok) {
        const data = await res.json();
        const sessionId = routeData?._sessionId;
        if (sessionId && data.id) {
          try { await linkSessionPhotosToActivity(sessionId, data.id); } catch (e) {}
        }
        saveBtn.textContent = 'Saved';
        saveBtn.disabled = true;
        setTimeout(() => { saveBtn.innerHTML = saveBtn.dataset.originalHtml; saveBtn.disabled = false; }, 2000);
      } else {
        await addPending(activityData);
        await updateSyncBadge();
        requestBackgroundSync();
        loadActivities();
        saveBtn.textContent = 'Saved offline';
        saveBtn.disabled = true;
        setTimeout(() => { saveBtn.innerHTML = saveBtn.dataset.originalHtml; saveBtn.disabled = false; }, 2000);
      }
    } catch (e) {
      await addPending(activityData);
      await updateSyncBadge();
      requestBackgroundSync();
      loadActivities();
      saveBtn.textContent = 'Saved offline';
      saveBtn.disabled = true;
      setTimeout(() => { saveBtn.innerHTML = saveBtn.dataset.originalHtml; saveBtn.disabled = false; }, 2000);
    }
  }

  let hasFriends = false;

  async function loadFriends() {
    if (!currentUser) return;
    try {
      const res = await fetch('/api/friends');
      if (!res.ok) return;
      const data = await res.json();

      const listEl = document.getElementById('friends-list');
      listEl.innerHTML = '';
      hasFriends = data.friends.length > 0;
      setText('us-friends', data.friends.length);

      for (const f of data.friends) {
        const card = document.createElement('div');
        card.className = 'friend-card';
        if (f.avatar) {
          const img = document.createElement('img');
          img.className = 'avatar';
          img.src = f.avatar;
          img.alt = '';
          card.appendChild(img);
        }
        const info = document.createElement('div');
        info.className = 'friend-card-info';
        const nameEl = document.createElement('span');
        nameEl.className = 'friend-card-name';
        nameEl.textContent = f.name;
        const emailEl = document.createElement('span');
        emailEl.className = 'friend-card-email';
        emailEl.textContent = f.email;
        info.append(nameEl, emailEl);
        card.appendChild(info);

        const actions = document.createElement('div');
        actions.className = 'friend-card-actions';
        const removeBtn = document.createElement('button');
        removeBtn.className = 'friend-remove-btn';
        removeBtn.textContent = 'Remove';
        removeBtn.addEventListener('click', () => removeFriend(f.id));
        actions.appendChild(removeBtn);
        card.appendChild(actions);
        listEl.appendChild(card);
      }

      const incomingSection = document.getElementById('friends-incoming');
      const incomingList = document.getElementById('friends-incoming-list');
      incomingList.innerHTML = '';
      if (data.incoming.length > 0) {
        incomingSection.classList.remove('hidden');
        for (const req of data.incoming) {
          const card = document.createElement('div');
          card.className = 'friend-card';
          if (req.avatar) {
            const img = document.createElement('img');
            img.className = 'avatar';
            img.src = req.avatar;
            img.alt = '';
            card.appendChild(img);
          }
          const info = document.createElement('div');
          info.className = 'friend-card-info';
          const nameEl = document.createElement('span');
          nameEl.className = 'friend-card-name';
          nameEl.textContent = req.name;
          const emailEl = document.createElement('span');
          emailEl.className = 'friend-card-email';
          emailEl.textContent = req.email;
          info.append(nameEl, emailEl);
          card.appendChild(info);

          const actions = document.createElement('div');
          actions.className = 'friend-card-actions';
          const acceptBtn = document.createElement('button');
          acceptBtn.className = 'friend-accept-btn';
          acceptBtn.textContent = 'Accept';
          acceptBtn.addEventListener('click', () => acceptFriendRequest(req.id));
          const declineBtn = document.createElement('button');
          declineBtn.className = 'friend-remove-btn';
          declineBtn.textContent = 'Decline';
          declineBtn.addEventListener('click', () => removeFriend(req.id));
          actions.append(acceptBtn, declineBtn);
          card.appendChild(actions);
          incomingList.appendChild(card);
        }
      } else {
        incomingSection.classList.add('hidden');
      }

      const invitesSection = document.getElementById('friends-invites');
      const invitesList = document.getElementById('friends-invites-list');
      invitesList.innerHTML = '';
      if (data.pendingInvites.length > 0) {
        invitesSection.classList.remove('hidden');
        for (const inv of data.pendingInvites) {
          const card = document.createElement('div');
          card.className = 'friend-invite-card';
          const emailSpan = document.createElement('span');
          emailSpan.textContent = inv.email;
          card.appendChild(emailSpan);
          const cancelBtn = document.createElement('button');
          cancelBtn.className = 'friend-remove-btn';
          cancelBtn.textContent = 'Cancel';
          cancelBtn.addEventListener('click', async () => {
            await fetch(`/api/friends/invite/${inv.id}`, { method: 'DELETE' });
            loadFriends();
          });
          card.appendChild(cancelBtn);
          invitesList.appendChild(card);
        }
      } else {
        invitesSection.classList.add('hidden');
      }

      updateEmergencyButton();
    } catch (e) {}
  }

  async function addFriend() {
    const input = document.getElementById('friend-email-input');
    const email = input.value.trim();
    if (!email) return;

    const errEl = document.getElementById('friend-error');
    errEl.classList.add('hidden');

    try {
      const res = await fetch('/api/friends/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email })
      });
      const data = await res.json();
      if (!res.ok) {
        errEl.textContent = data.error || 'Failed to add friend';
        errEl.classList.remove('hidden');
        return;
      }
      input.value = '';
      showToast(data.message);
      loadFriends();
    } catch (e) {
      errEl.textContent = 'Network error';
      errEl.classList.remove('hidden');
    }
  }

  async function acceptFriendRequest(id) {
    try {
      await fetch(`/api/friends/accept/${id}`, { method: 'POST' });
      loadFriends();
    } catch (e) {}
  }

  async function removeFriend(id) {
    if (!confirm('Remove this friend?')) return;
    try {
      await fetch(`/api/friends/${id}`, { method: 'DELETE' });
      loadFriends();
    } catch (e) {}
  }

  function updateEmergencyButton() {
    const btn = document.getElementById('btn-emergency');
    const friendsBtn = document.getElementById('btn-emergency-friends');
    if (hasFriends && currentUser) {
      btn.classList.remove('hidden');
      friendsBtn.classList.remove('hidden');
    } else {
      btn.classList.add('hidden');
      friendsBtn.classList.add('hidden');
    }
  }

  function buildEmergencyMessage(lat, lon, accuracy) {
    const latS = lat.toFixed(6);
    const lonS = lon.toFixed(6);
    const accS = accuracy ? `+/-${Math.round(accuracy)}m` : '';
    const mapsUrl = `https://maps.google.com/?q=${latS},${lonS}`;
    return `EMERGENCY - I need help. My location: ${latS}, ${lonS} ${accS}. Map: ${mapsUrl}`;
  }

  function isCellularDevice() {
    return /Android|iPhone|iPad|iPod|webOS|BlackBerry|IEMobile|Opera Mini/i.test(navigator.userAgent) || ('ontouchstart' in window && window.innerWidth <= 1024);
  }

  function showEmergencyFallback(lat, lon, accuracy, reason, title) {
    const msg = buildEmergencyMessage(lat, lon, accuracy);
    const mapsUrl = `https://maps.google.com/?q=${lat.toFixed(6)},${lon.toFixed(6)}`;
    const isCellular = isCellularDevice();
    const smsBtn = document.getElementById('ef-sms');
    if (!isCellular) {
      document.getElementById('ef-title').textContent = title ? title.replace(/use SMS/gi, 'Emergency Location & Coordinates') : 'Emergency Location & Coordinates';
      document.getElementById('ef-sub').textContent = reason ? reason.replace(/via your phone's SMS app/gi, 'using your device') : 'Copy your location coordinates or message to share.';
      if (smsBtn) smsBtn.style.display = 'none';
    } else {
      document.getElementById('ef-title').textContent = title || 'Send emergency via SMS';
      document.getElementById('ef-sub').textContent = reason || 'Send your location via your phone\'s SMS app instead.';
      if (smsBtn) smsBtn.style.display = '';
    }
    document.getElementById('ef-coords').textContent = `${lat.toFixed(6)}, ${lon.toFixed(6)}` + (accuracy ? ` (accuracy +/-${Math.round(accuracy)}m)` : '');
    document.getElementById('ef-sms').href = `sms:?body=${encodeURIComponent(msg)}`;
    document.getElementById('ef-maps').href = mapsUrl;
    const copyBtn = document.getElementById('ef-copy');
    copyBtn.onclick = async () => {
      try {
        await navigator.clipboard.writeText(msg);
        copyBtn.textContent = 'Copied!';
        setTimeout(() => copyBtn.textContent = 'Copy emergency message', 2000);
      } catch (e) {
        copyBtn.textContent = 'Copy failed';
      }
    };
    document.getElementById('emergency-fallback').classList.remove('hidden');
  }

  document.getElementById('ef-close').addEventListener('click', () => {
    document.getElementById('emergency-fallback').classList.add('hidden');
  });

  function setEmergencyBusy(busy) {
    document.querySelectorAll('.emergency-trigger').forEach(b => {
      b.disabled = busy;
      b.classList.toggle('sending', busy);
    });
  }

  async function sendEmergency() {
    if (!confirm('Send an EMERGENCY alert with your current location to ALL your hiking friends?')) return;

    if (!('geolocation' in navigator)) {
      alert('Geolocation is not available.');
      return;
    }

    setEmergencyBusy(true);

    async function doSend(pos) {
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      const acc = pos.coords.accuracy || 0;

      try {
        const res = await fetch('/api/friends/emergency', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ latitude: lat, longitude: lon, accuracy: acc })
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok) {
          showToast(data.message || 'Emergency alert sent');
        } else {
          const err = (data.error || '').toLowerCase();
          if (err.includes('no friends')) {
            showEmergencyFallback(lat, lon, acc,
              'You have no friends to alert yet. Add emergency contacts in the app, or send your location by SMS now.',
              'No emergency contacts - use SMS');
          } else if (err.includes('not configured')) {
            showEmergencyFallback(lat, lon, acc,
              'Email alerts are unavailable on the server. Send your location by SMS now.',
              'Alerts unavailable - use SMS');
          } else {
            showEmergencyFallback(lat, lon, acc,
              data.error || 'The alert could not be sent. Send your location by SMS now.',
              'Could not send - use SMS');
          }
        }
      } catch (e) {
        const offline = !navigator.onLine;
        showEmergencyFallback(lat, lon, acc,
          offline
            ? 'You appear to be offline. Send your location via your phone\'s SMS app instead.'
            : 'Could not reach the server. Send your location via your phone\'s SMS app instead.',
          offline ? 'No internet - use SMS' : 'Server unreachable - use SMS');
      }
      setEmergencyBusy(false);
    }

    if (lastGpsPosition && (Date.now() - lastGpsPosition.timestamp) < 30000) {
      showToast('Sending alert...');
      await doSend(lastGpsPosition);
    } else {
      showToast('Getting your location...');
      navigator.geolocation.getCurrentPosition(
        async (pos) => { await doSend(pos); },
        (err) => {
          alert('Could not get your location: ' + err.message);
          setEmergencyBusy(false);
        },
        { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
      );
    }
  }

  document.getElementById('btn-add-friend').addEventListener('click', addFriend);
  document.getElementById('friend-email-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') addFriend();
  });
  document.getElementById('btn-emergency').addEventListener('click', sendEmergency);
  document.getElementById('btn-emergency-friends').addEventListener('click', sendEmergency);
  document.getElementById('btn-emergency-fab').addEventListener('click', sendEmergency);

  document.querySelectorAll('.uc-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.uc-tab').forEach(t => {
        t.classList.remove('active');
        t.setAttribute('aria-selected', 'false');
      });
      document.querySelectorAll('.uc-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      tab.setAttribute('aria-selected', 'true');
      document.getElementById('uc-' + tab.dataset.uc).classList.add('active');
    });
  });

  const dropZone   = document.getElementById('drop-zone');
  const fileInput  = document.getElementById('file-input');
  const weightInput = document.getElementById('weight-input');

  dropZone.addEventListener('click', () => fileInput.click());
  dropZone.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') fileInput.click(); });

  dropZone.addEventListener('dragover', e => { e.preventDefault(); dropZone.classList.add('drag-over'); });
  dropZone.addEventListener('dragleave', () => dropZone.classList.remove('drag-over'));
  dropZone.addEventListener('drop', e => {
    e.preventDefault();
    dropZone.classList.remove('drag-over');
    const file = e.dataTransfer.files[0];
    if (file) processFile(file);
  });

  fileInput.addEventListener('change', () => {
    if (fileInput.files[0]) processFile(fileInput.files[0]);
    fileInput.value = '';
  });

  function processFile(file) {
    if (!file.name.toLowerCase().endsWith('.gpx')) {
      showError('Please select a .gpx file');
      return;
    }
    if (file.size > 15 * 1024 * 1024) {
      showError('File is too large — maximum 15 MB');
      return;
    }
    hideError();
    if (!validateBodyInputs()) return;
    uploadFile(file);
  }

  function validateBodyInputs() {
    const w = parseFloat(weightInput.value);
    const h = parseFloat(document.getElementById('height-input').value);
    if (isNaN(w) || w < 30 || w > 250) {
      showError('Weight must be between 30 and 250 kg');
      weightInput.focus();
      return false;
    }
    if (isNaN(h) || h < 120 || h > 220) {
      showError('Height must be between 120 and 220 cm');
      document.getElementById('height-input').focus();
      return false;
    }
    const packEl = document.getElementById('pack-input');
    const pack = parseFloat(packEl.value);
    if (packEl.value !== '' && (isNaN(pack) || pack < 0 || pack > 60)) {
      showError('Pack weight must be between 0 and 60 kg');
      packEl.focus();
      return false;
    }
    return true;
  }

  async function uploadFile(file) {
    showScreen('loading');

    currentGpxText = await file.text();

    const weight = parseFloat(weightInput.value) || 70;
    const height = parseFloat(document.getElementById('height-input').value) || 170;
    const pack = parseFloat(document.getElementById('pack-input').value) || 0;
    const fitness = document.getElementById('fitness-select').value || '3';
    const st = currentStartTime();
    const startHour = st.hour;
    const startMinute = st.minute;

    const form = new FormData();
    form.append('file', file);
    form.append('weight', weight);
    form.append('height', height);
    form.append('pack', pack);
    form.append('fitness', fitness);
    appendPaceOverride(form);
    form.append('startHour', startHour);
    form.append('startMinute', startMinute);

    try {
      const res = await fetch('/api/analyze', { method: 'POST', body: form });
      const data = await res.json();

      if (!res.ok) {
        showScreen('upload');
        showError(data.error || 'Analysis failed — please try another file');
        return;
      }

      routeData = data;
      document.getElementById('btn-download-gpx').classList.remove('hidden');
      renderViewer(data);
      showScreen('viewer');

      try {
        localStorage.setItem('hikerAid_lastRoute', JSON.stringify(data));
      } catch (e) {}

    } catch (err) {
      showScreen('upload');
      showError('Network error — check your connection and try again');
    }
  }

  function renderViewer(data) {
    document.getElementById('route-name').textContent = data.name || 'Route';
    document.getElementById('stats-strip').classList.remove('hidden');

    const s = data.stats;

    setText('stat-distance', s.distanceKm ? `${s.distanceKm} km` : '—');
    setText('stat-time',     s.totalTimeMinutes ? formatTime(s.totalTimeMinutes) : '—');
    setText('stat-ascent',   s.hasElevationData ? `${s.elevationGainM} m` : '—');
    setText('stat-descent',  s.hasElevationData ? `${s.elevationLossM} m` : '—');
    setText('stat-max-ele',  s.hasElevationData ? `${s.maxElevationM} m` : '—');
    setText('stat-min-ele',  s.hasElevationData ? `${s.minElevationM} m` : '—');
    setText('stat-calories', s.estimatedCalories ? `${Math.round(s.estimatedCalories)} kcal` : '—');
    setText('stat-speed',    s.avgSpeedKmh ? `${s.avgSpeedKmh} km/h` : '—');
    setText('stat-vam',      s.vamMetersPerHour ? `${Math.round(s.vamMetersPerHour)} m/h` : '—');
    setText('stat-gap',      s.gradeAdjustedPaceMinPerKm ? formatPace(s.gradeAdjustedPaceMinPerKm) : '—');
    setText('stat-moving',   s.estimatedTimeMinutes ? formatTime(s.estimatedTimeMinutes) : '—');

    const timeCard = document.getElementById('card-time');
    if (timeCard && s.estimatedTimeMinutes && s.totalTimeMinutes > s.estimatedTimeMinutes) {
      timeCard.title = `Moving time: ${formatTime(s.estimatedTimeMinutes)}`;
    }

    const diffEl = document.getElementById('stat-difficulty');
    const diffLabel = s.difficulty || 'Unknown';
    diffEl.textContent = diffLabel;
    diffEl.className = `stat-value difficulty-${diffLabel.toLowerCase().replace(' ', '-')}`;

    if (currentUser) {
      const saveBtn = document.getElementById('btn-save-activity');
      saveBtn.classList.remove('hidden');
      saveBtn.disabled = false;
    }

    HikerMap.renderRoute(data);
    renderSafety(data);
    renderSplits(data);
    renderSurvivalSuite(data);
    weatherCacheKey = null;
    weatherCache = null;
    const cmpCard = document.getElementById('card-comparison');
    cmpCard.classList.add('hidden');
    cmpCard.classList.remove('safety-ok', 'safety-caution', 'safety-danger', 'safety-card');
    document.querySelectorAll('.comparisons-banner').forEach(el => el.remove());
    if (is3dMode && map3d) update3dRoute();

    if (data.elevationProfile && data.elevationProfile.length > 0) {
      document.getElementById('elevation-panel').style.display = '';
      document.getElementById('gradient-legend').style.display = '';
      document.getElementById('viewer-screen').style.setProperty('--elev-h', '150px');
      HikerElevation.build(data.elevationProfile);
      HikerElevation.setHoverCallback((profileIdx, profilePt) => {
        const ratio = data.elevationProfile.length > 1 ? profileIdx / (data.elevationProfile.length - 1) : 0;
        const trackIdx = Math.round(ratio * (data.trackPoints.length - 1));
        HikerMap.showPositionAtIndex(trackIdx);
        HikerElevation.showHoverInfo(profilePt);
      });
    } else {
      document.getElementById('elevation-panel').style.display = 'none';
      document.getElementById('gradient-legend').style.display = 'none';
      document.getElementById('viewer-screen').style.setProperty('--elev-h', '0px');
    }
  }

  function renderSplits(data) {
    const tbody = document.getElementById('splits-tbody');
    const summary = document.getElementById('splits-summary');
    tbody.innerHTML = '';
    summary.innerHTML = '';
    const splits = data.splits || [];
    const s = data.stats;

    if (splits.length === 0) {
      tbody.innerHTML = '<tr><td colspan="6" class="splits-empty">Route is shorter than 1 km — no splits to show</td></tr>';
      return;
    }

    const totalSegMin = splits.reduce((a, b) => a + b.minutes, 0);
    const fastest = splits.reduce((a, b) => b.minutes < a.minutes ? b : a, splits[0]);
    const slowest = splits.reduce((a, b) => b.minutes > a.minutes ? b : a, splits[0]);

    const sumItems = [
      { val: formatPace(s.gradeAdjustedPaceMinPerKm || 0), lbl: 'GAP' },
      { val: `${Math.round(s.vamMetersPerHour || 0)} m/h`, lbl: 'VAM' },
      { val: formatTime(s.estimatedTimeMinutes), lbl: 'Moving' }
    ];
    for (const it of sumItems) {
      const div = document.createElement('div');
      div.className = 'splits-summary-item';
      const v = document.createElement('span'); v.className = 'splits-summary-val'; v.textContent = it.val;
      const l = document.createElement('span'); l.className = 'splits-summary-lbl'; l.textContent = it.lbl;
      div.append(v, l);
      summary.appendChild(div);
    }

    for (const sp of splits) {
      const tr = document.createElement('tr');
      const isFast = sp === fastest && splits.length > 1;
      const isSlow = sp === slowest && splits.length > 1;

      const tdKm = document.createElement('td'); tdKm.textContent = sp.km;
      const tdTime = document.createElement('td'); tdTime.textContent = formatTime(sp.minutes);
      const tdPace = document.createElement('td'); tdPace.textContent = formatPace(sp.minutes);
      if (isFast) tdPace.style.color = 'var(--c-primary-lt)';
      if (isSlow) tdPace.style.color = 'var(--c-warning)';
      const tdGain = document.createElement('td'); tdGain.textContent = `${Math.round(sp.elevationGainM)}m`;
      const tdLoss = document.createElement('td'); tdLoss.textContent = `${Math.round(sp.elevationLossM)}m`;
      const tdGrad = document.createElement('td');
      const g = sp.avgGradientPct;
      tdGrad.textContent = `${g >= 0 ? '+' : ''}${g.toFixed(1)}%`;
      if (g > 1) tdGrad.className = 'splits-grad-up';
      else if (g < -1) tdGrad.className = 'splits-grad-down';

      tr.append(tdKm, tdTime, tdPace, tdGain, tdLoss, tdGrad);
      tbody.appendChild(tr);
    }
  }

  function renderSurvivalSuite(data) {
    const s = data.stats || {};
    const maxAlt = s.maxElevationM || 0;
    const gainM = s.elevationGainM || 0;
    const hours = Math.max(0.5, (s.estimatedTimeMinutes || 60) / 60);

    // 1. AMS & Hypoxia Analyzer
    const highGain = Math.max(0, maxAlt - 2500);
    const spo2 = Math.max(52, Math.round(98 - (maxAlt / 1000) * 3.5));
    const ascentRate = Math.round(gainM / hours);

    setText('ams-max-alt', `${Math.round(maxAlt)} m`);
    setText('ams-high-gain', `${Math.round(highGain)} m`);
    setText('ams-spo2', `${spo2}%`);
    setText('ams-ascent-rate', `${ascentRate} m/h`);

    const badgeEl = document.getElementById('ams-risk-badge');
    const adviceEl = document.getElementById('ams-advice');
    const statAmsEl = document.getElementById('stat-ams');

    if (maxAlt < 2500) {
      if (badgeEl) { badgeEl.textContent = 'LOW RISK / NO HYPOXIA'; badgeEl.className = 'risk-badge badge-safe'; }
      if (adviceEl) adviceEl.textContent = 'This route stays below the usual 2,500 m AMS planning threshold. Individual responses vary; monitor symptoms and seek medical advice when needed.';
      if (statAmsEl) statAmsEl.textContent = 'Low Risk';
    } else if (maxAlt < 3500) {
      if (badgeEl) { badgeEl.textContent = 'MODERATE / AMS CAUTION'; badgeEl.className = 'risk-badge badge-warn'; }
      if (adviceEl) adviceEl.textContent = 'Spend 1 night at ~2,500m before ascending further. Keep hydration elevated (+1 L/day) and watch for early AMS symptoms (headache, fatigue, nausea).';
      if (statAmsEl) statAmsEl.textContent = `Caution / ${(maxAlt/1000).toFixed(1)}k`;
    } else {
      if (badgeEl) { badgeEl.textContent = 'HIGH RISK / HYPOXIA HAZARD'; badgeEl.className = 'risk-badge badge-danger'; }
      if (adviceEl) adviceEl.textContent = 'Ascend no faster than 300-500m per day above 3,000m with rest days every 1,000m. Carry emergency oxygen or Acetazolamide (Diamox) and establish immediate descent protocols.';
      if (statAmsEl) statAmsEl.textContent = `High / ${(maxAlt/1000).toFixed(1)}k`;
    }

    // 2. Dynamic Hydration & Nutrition Resupply
    updateResupplyMetrics(s);

    // 3. Technical Terrain & Avy Matrix
    renderTerrainMatrix(data);

    // 4. Offline SAR Emergency Beacon
    renderSarBeacon(data);
  }

  function updateResupplyMetrics(statsObj) {
    const s = statsObj || routeData?.stats || {};
    const hours = Math.max(0.5, (s.estimatedTimeMinutes || 60) / 60);
    const gainM = s.elevationGainM || 0;
    const temp = parseInt(document.getElementById('resupply-temp')?.value || 20, 10);
    const hum = parseInt(document.getElementById('resupply-hum')?.value || 50, 10);
    const packKg = parseFloat(document.getElementById('pack-input')?.value || 0);

    if (document.getElementById('resupply-temp-val')) document.getElementById('resupply-temp-val').textContent = `${temp}°C`;
    if (document.getElementById('resupply-hum-val')) document.getElementById('resupply-hum-val').textContent = `${hum}%`;

    const tempFactor = Math.max(0, (temp - 15) * 0.03);
    const humFactor = (hum < 30 ? 0.05 : 0);
    const waterHourly = 0.4 + tempFactor + humFactor + (gainM / hours / 1000) * 0.2 + (packKg / 20) * 0.1;
    const waterTotal = (waterHourly * hours).toFixed(1);

    const baseKcal = s.estimatedCalories || (hours * 450);
    const kcalTotal = Math.round(baseKcal * (1 + (temp < 5 ? 0.15 : 0) + (packKg / 50)));
    const sodiumMg = Math.round(waterTotal * 450);

    setText('res-water-total', `${waterTotal} L`);
    setText('res-water-hourly', `${waterHourly.toFixed(2)} L/h`);
    setText('res-kcal', `${kcalTotal} kcal`);
    setText('res-electrolytes', `${sodiumMg} mg Na⁺ / ${Math.round(sodiumMg * 0.4)} mg K⁺`);
    setText('stat-water', `${waterTotal} L (${waterHourly.toFixed(1)} L/h)`);
  }

  function renderTerrainMatrix(data) {
    const pts = data.trackPoints || [];
    const profile = data.elevationProfile || [];
    let dist30 = 0, dist35 = 0, maxSlope = 0;
    const segments = [];

    if (profile.length > 1) {
      for (let i = 0; i < profile.length - 1; i++) {
        const p1 = profile[i], p2 = profile[i + 1];
        const distM = Math.max(0, (p2.distanceKm - p1.distanceKm) * 1000);
        const dEle = Math.abs((p2.elevationM || 0) - (p1.elevationM || 0));
        let slopeDeg = 0;
        if (p2.gradientPct !== undefined && p2.gradientPct !== null) {
          slopeDeg = Math.atan(Math.abs(p2.gradientPct) / 100) * (180 / Math.PI);
        } else if (distM > 0.001) {
          slopeDeg = Math.atan(dEle / distM) * (180 / Math.PI);
        }
        if (slopeDeg > maxSlope) maxSlope = slopeDeg;
        if (slopeDeg >= 30) dist30 += distM;
        if (slopeDeg >= 35) dist35 += distM;
        segments.push({ slope: slopeDeg, dist: distM });
      }
    } else if (pts.length > 1) {
      for (let i = 0; i < pts.length - 1; i++) {
        const p1 = pts[i], p2 = pts[i + 1];
        const dLat = (p2[0] - p1[0]) * 111320;
        const dLon = (p2[1] - p1[1]) * (40075000 * Math.cos(p1[0] * Math.PI / 180) / 360);
        const dist = Math.sqrt(dLat * dLat + dLon * dLon);
        const dEle = Math.abs((p2[2] || 0) - (p1[2] || 0));
        if (dist > 0.5) {
          const slopeDeg = Math.atan(dEle / dist) * (180 / Math.PI);
          if (slopeDeg > maxSlope) maxSlope = slopeDeg;
          if (slopeDeg >= 30) dist30 += dist;
          if (slopeDeg >= 35) dist35 += dist;
          segments.push({ slope: slopeDeg, dist });
        }
      }
    }

    setText('ter-30', `${(dist30 / 1000).toFixed(2)} km`);
    setText('ter-35', `${(dist35 / 1000).toFixed(2)} km`);
    setText('ter-max-slope', `${maxSlope.toFixed(1)}°`);

    let grade = 'Class 1 (Easy Trail)';
    let advice = 'Terrain is predominantly flat or well-graded hiking trail with minimal slip hazard.';
    if (maxSlope >= 35) {
      grade = 'Extreme slope (>45°)';
      advice = '⚠️ CRITICAL: Route enters extreme slope angles (>35°) typical of avalanche starting zones and technical scrambling. Carry avalanche rescue transceiver, shovel, probe, and helmet.';
    } else if (maxSlope >= 30 || dist30 > 100) {
      grade = 'Very steep slope (>35°)';
      advice = '⚠️ WARNING: Contains steep slopes exceeding 30°, the threshold where slab avalanches can initiate in snow conditions. Exercise extreme caution in winter or wet weather.';
    } else if (maxSlope >= 20) {
      grade = 'Class 2 (Steep Hiking)';
      advice = 'Steep incline sections detected. Trekking poles recommended for joint relief and stability.';
    }
    setText('ter-grade', grade);
    const terAdviceEl = document.getElementById('ter-advice');
    if (terAdviceEl) terAdviceEl.textContent = advice;

    const barEl = document.getElementById('terrain-dist-bar');
    const legEl = document.getElementById('terrain-bar-legend');
    if (barEl && legEl) {
      barEl.innerHTML = '';
      legEl.innerHTML = '';
      if (segments.length > 0) {
        let dEasy = 0, dMod = 0, dAvy = 0, totalD = 0;
        for (const seg of segments) {
          totalD += seg.dist;
          if (seg.slope >= 30) dAvy += seg.dist;
          else if (seg.slope >= 15) dMod += seg.dist;
          else dEasy += seg.dist;
        }
        if (totalD <= 0) totalD = 1;
        const pEasy = Math.max(dEasy > 0 ? 5 : 0, Math.round((dEasy / totalD) * 100));
        const pMod = Math.max(dMod > 0 ? 5 : 0, Math.round((dMod / totalD) * 100));
        const pAvy = Math.max(dAvy > 0 ? 5 : 0, Math.round((dAvy / totalD) * 100));

        barEl.innerHTML = `
          <span style="width:${pEasy}%;background:#52B788;display:block;height:100%;" title="Easy (<15°)"></span>
          <span style="width:${pMod}%;background:#F9C74F;display:block;height:100%;" title="Moderate (15°-30°)"></span>
          <span style="width:${pAvy}%;background:#E76F51;display:block;height:100%;" title="Steep (>30°)"></span>
        `;
        legEl.innerHTML = `
          <span><i style="background:#52B788"></i> Easy (<15°): ${((dEasy/1000).toFixed(1))} km</span>
          <span><i style="background:#F9C74F"></i> Moderate (15°-30°): ${((dMod/1000).toFixed(1))} km</span>
          <span><i style="background:#E76F51"></i> Steep (&gt;30°): ${((dAvy/1000).toFixed(1))} km</span>
        `;
      }
    }
  }

  function renderSarBeacon(data) {
    const s = data.stats || {};
    const lat = data.trackPoints?.[0]?.[0]?.toFixed(5) || 'N/A';
    const lon = data.trackPoints?.[0]?.[1]?.toFixed(5) || 'N/A';
    const payload = `SOS|HikerAid|ROUTE:${s.routeName||'Hike'}|DIST:${s.totalDistanceKm||0}km|MAXALT:${s.maxElevationM||0}m|TIME:${formatTime(s.estimatedTimeMinutes)}|LAT:${lat}|LON:${lon}|BAT:${navigator.getBattery ? 'CHK' : 'N/A'}`;

    const txtEl = document.getElementById('sar-payload-text');
    if (txtEl) txtEl.value = payload;

    const canvas = document.getElementById('sar-qr-canvas');
    if (canvas && canvas.getContext) {
      const ctx = canvas.getContext('2d');
      ctx.fillStyle = '#000000';
      ctx.fillRect(0, 0, 200, 200);
      ctx.fillStyle = '#FFFFFF';
      ctx.fillRect(10, 10, 180, 180);
      ctx.fillStyle = '#E76F51';
      ctx.fillRect(20, 20, 160, 40);
      ctx.fillStyle = '#FFFFFF';
      ctx.font = 'bold 22px monospace';
      ctx.textAlign = 'center';
      ctx.fillText('SOS BEACON', 100, 46);

      ctx.fillStyle = '#000000';
      ctx.font = 'bold 13px monospace';
      ctx.fillText(`LAT: ${lat}`, 100, 90);
      ctx.fillText(`LON: ${lon}`, 100, 110);
      ctx.fillText(`ALT: ${s.maxElevationM||0} m`, 100, 130);

      for (let i = 0; i < 8; i++) {
        ctx.fillStyle = (i % 2 === 0) ? '#000000' : '#E76F51';
        ctx.fillRect(25 + i * 18, 150, 16, 25);
      }
    }
  }

  document.getElementById('btn-multiday').addEventListener('click', () => {
    const panel = document.getElementById('multiday-panel');
    const show = panel.classList.contains('hidden');
    panel.classList.toggle('hidden');
    if (show) renderMultiday();
  });
  document.getElementById('btn-close-multiday').addEventListener('click', () => {
    document.getElementById('multiday-panel').classList.add('hidden');
  });
  document.getElementById('multiday-hours').addEventListener('change', renderMultiday);

  function buildStages(splits, budgetMin) {
    const stages = [];
    let cur = null;
    for (const sp of splits) {
      if (cur && cur.minutes > 0 && cur.minutes + sp.minutes > budgetMin) {
        stages.push(cur);
        cur = null;
      }
      if (!cur) cur = { fromKm: sp.km - 1, toKm: sp.km, km: 0, minutes: 0, gain: 0, loss: 0 };
      cur.toKm = sp.km;
      cur.km += 1;
      cur.minutes += sp.minutes;
      cur.gain += sp.elevationGainM;
      cur.loss += sp.elevationLossM;
    }
    if (cur && cur.minutes > 0) stages.push(cur);
    return stages;
  }

  function renderMultiday() {
    const tbody = document.getElementById('multiday-tbody');
    const note = document.getElementById('multiday-note');
    tbody.innerHTML = '';
    note.textContent = '';
    const splits = routeData?.splits || [];
    if (splits.length < 2) {
      tbody.innerHTML = '<tr><td colspan="6" class="splits-empty">Route is too short to split into days.</td></tr>';
      return;
    }
    let hours = parseFloat(document.getElementById('multiday-hours').value);
    if (isNaN(hours) || hours < 2) hours = 6;
    const stages = buildStages(splits, hours * 60);

    stages.forEach((st, i) => {
      const tr = document.createElement('tr');
      const cells = [
        `Day ${i + 1}`,
        `${st.fromKm}–${st.toKm}`,
        `${st.km} km`,
        formatTime(Math.round(st.minutes)),
        `${Math.round(st.gain)}m`,
        `${Math.round(st.loss)}m`
      ];
      for (const c of cells) { const td = document.createElement('td'); td.textContent = c; tr.appendChild(td); }
      tbody.appendChild(tr);
    });

    const totalKm = routeData?.stats?.distanceKm;
    note.textContent = `${stages.length} day${stages.length === 1 ? '' : 's'} at up to ${hours}h moving time each` +
      (totalKm ? ` · ${totalKm} km total. Whole-km stages; start each day at first light and check the daylight margin on the Safety card.` : '.');
  }

  function formatPace(minPerKm) {
    if (!minPerKm || minPerKm <= 0) return '—';
    const m = Math.floor(minPerKm);
    const s = Math.round((minPerKm - m) * 60);
    return `${m}:${String(s).padStart(2, '0')}/km`;
  }

  function renderSafety(data) {
    const sf = data.safety;
    if (!sf) {
      document.getElementById('card-daylight').style.display = 'none';
      document.getElementById('card-sunset').style.display = 'none';
      document.getElementById('card-turnaround').style.display = 'none';
      return;
    }

    document.getElementById('card-daylight').style.display = '';
    document.getElementById('card-sunset').style.display = '';
    document.getElementById('card-turnaround').style.display = '';

    const daylightEl = document.getElementById('card-daylight');
    const marginAbs = Math.abs(sf.marginMinutes);
    if (sf.daylightSufficient && sf.marginMinutes > 60) {
      setText('stat-daylight', `+${formatTime(sf.marginMinutes)}`);
      daylightEl.className = 'stat-card safety-card safety-ok';
    } else if (sf.daylightSufficient) {
      setText('stat-daylight', `+${formatTime(sf.marginMinutes)}`);
      daylightEl.className = 'stat-card safety-card safety-caution';
    } else {
      setText('stat-daylight', `-${formatTime(marginAbs)}`);
      daylightEl.className = 'stat-card safety-card safety-danger';
    }

    setText('stat-sunset', `~${sf.sunsetEstimate}`);
    setText('stat-turnaround', `${sf.turnaroundDistanceKm} km`);

    HikerMap.showSafetyMarkers(data.trackPoints, sf);
  }

  document.getElementById('btn-record').addEventListener('click', startRecording);
  document.getElementById('btn-rec-stop').addEventListener('click', stopRecording);
  document.getElementById('btn-rec-analyze').addEventListener('click', analyzeRecording);
  document.getElementById('btn-rec-download-gpx').addEventListener('click', downloadRecordedGpx);
  document.getElementById('btn-rec-discard').addEventListener('click', discardRecording);

  function startRecording() {
    if (!('geolocation' in navigator)) {
      alert('Geolocation is not available in your browser.');
      return;
    }

    isRecording = true;
    recordedPoints = [];
    recordTotalDistM = 0;
    recordStartTime = Date.now();
    recordSessionId = recordStartTime;
    recordPhotoCount = 0;
    setText('rec-photos-count', '0 photos');

    showScreen('viewer');
    document.getElementById('recording-overlay').classList.remove('hidden');
    document.getElementById('rec-complete').classList.add('hidden');
    document.getElementById('stats-strip').classList.add('hidden');
    document.getElementById('elevation-panel').style.display = 'none';
    document.getElementById('gradient-legend').style.display = 'none';
    document.getElementById('viewer-screen').style.setProperty('--elev-h', '0px');
    document.getElementById('route-name').textContent = 'Recording...';

    if (recordPolyline) { recordPolyline.remove(); recordPolyline = null; }

    recordWatchId = navigator.geolocation.watchPosition(
      onRecordPosition,
      err => console.warn('GPS error:', err.message),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
    );

    requestWakeLock();
    recordInterval = setInterval(updateRecordTimer, 1000);
  }

  function onRecordPosition(pos) {
    lastGpsPosition = pos;
    const pt = {
      lat: pos.coords.latitude,
      lon: pos.coords.longitude,
      ele: pos.coords.altitude,
      time: new Date().toISOString()
    };
    recordedPoints.push(pt);

    const latlng = [pt.lat, pt.lon];
    if (!recordPolyline) {
      recordPolyline = L.polyline([latlng], { color: '#52b788', weight: 4 }).addTo(HikerMap.getMap());
      HikerMap.getMap()?.setView(latlng, 16);
    } else {
      recordPolyline.addLatLng(latlng);
    }
    HikerMap.getMap()?.panTo(latlng, { animate: true });

    if (recordedPoints.length > 1) {
      const prev = recordedPoints[recordedPoints.length - 2];
      recordTotalDistM += haversine(prev.lat, prev.lon, pt.lat, pt.lon);
    }
    setText('rec-distance', (recordTotalDistM / 1000).toFixed(2));
    setText('rec-points', `${recordedPoints.length} pts`);
    if (pt.ele != null) setText('rec-ele', `${Math.round(pt.ele)}m`);

    const elapsedMin = (Date.now() - recordStartTime) / 60000;
    if (elapsedMin > 0.5 && recordTotalDistM > 10) {
      const paceMinPerKm = elapsedMin / (recordTotalDistM / 1000);
      const pM = Math.floor(paceMinPerKm);
      const pS = Math.round((paceMinPerKm - pM) * 60);
      setText('rec-pace', `${pM}:${String(pS).padStart(2, '0')}`);
    }
  }

  function updateRecordTimer() {
    if (!recordStartTime) return;
    const elapsed = Math.floor((Date.now() - recordStartTime) / 1000);
    const h = Math.floor(elapsed / 3600);
    const m = Math.floor((elapsed % 3600) / 60);
    const s = elapsed % 60;
    setText('rec-time', h > 0
      ? `${h}:${String(m).padStart(2,'0')}:${String(s).padStart(2,'0')}`
      : `${m}:${String(s).padStart(2,'0')}`);
  }

  function stopRecording() {
    if (recordWatchId !== null) { navigator.geolocation.clearWatch(recordWatchId); recordWatchId = null; }
    if (recordInterval) { clearInterval(recordInterval); recordInterval = null; }
    isRecording = false;
    releaseWakeLock();

    document.getElementById('recording-overlay').classList.add('hidden');

    if (recordedPoints.length < 2) {
      alert('Not enough points recorded.');
      showScreen('upload');
      return;
    }

    const elapsedMin = Math.floor((Date.now() - recordStartTime) / 60000);

    document.getElementById('rec-complete-summary').textContent =
      `${(recordTotalDistM / 1000).toFixed(1)} km · ${formatTime(elapsedMin)} · ${recordedPoints.length} points`;
    document.getElementById('rec-complete').classList.remove('hidden');
  }

  function generateGpx(points) {
    let gpx = '<?xml version="1.0" encoding="UTF-8"?>\n';
    gpx += '<gpx version="1.1" creator="HikerAid" xmlns="http://www.topografix.com/GPX/1/1">\n';
    gpx += '  <trk>\n    <name>Recorded hike</name>\n    <trkseg>\n';
    for (const p of points) {
      gpx += `      <trkpt lat="${p.lat.toFixed(7)}" lon="${p.lon.toFixed(7)}">`;
      if (p.ele != null) gpx += `<ele>${p.ele.toFixed(1)}</ele>`;
      if (p.time) gpx += `<time>${p.time}</time>`;
      gpx += '</trkpt>\n';
    }
    gpx += '    </trkseg>\n  </trk>\n</gpx>';
    return gpx;
  }

  async function analyzeRecording() {
    document.getElementById('rec-complete').classList.add('hidden');

    const gpxText = generateGpx(recordedPoints);
    currentGpxText = gpxText;

    showScreen('loading');

    const gpxBlob = new Blob([gpxText], { type: 'application/gpx+xml' });
    const form = new FormData();
    form.append('file', gpxBlob, 'recording.gpx');
    form.append('weight', document.getElementById('weight-input').value || '70');
    form.append('height', document.getElementById('height-input').value || '170');
    form.append('pack', document.getElementById('pack-input').value || '0');
    form.append('fitness', document.getElementById('fitness-select').value || '3');
    appendPaceOverride(form);
    const st3 = currentStartTime();
    form.append('startHour', st3.hour);
    form.append('startMinute', st3.minute);

    try {
      const res = await fetch('/api/analyze', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) { showScreen('upload'); return; }

      routeData = data;
      routeData._sessionId = recordSessionId;
      if (recordPolyline) { recordPolyline.remove(); recordPolyline = null; }
      document.getElementById('btn-download-gpx').classList.remove('hidden');
      renderViewer(data);
      showScreen('viewer');
      if (recordSessionId) showPhotosForActivity(null, recordSessionId);
    } catch (e) {
      showScreen('upload');
    }
  }

  function downloadRecordedGpx() {
    const gpx = currentGpxText || generateGpx(recordedPoints);
    if (!gpx) return;
    const blob = new Blob([gpx], { type: 'application/gpx+xml' });
    const name = (routeData?.name || 'hikeraid_' + new Date().toISOString().slice(0,10)).replace(/[^a-z0-9]/gi, '_');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${name}.gpx`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  function discardRecording() {
    document.getElementById('rec-complete').classList.add('hidden');
    if (recordPolyline) { recordPolyline.remove(); recordPolyline = null; }
    if (recordSessionId) deletePhotosBySession(recordSessionId).catch(() => {});
    recordedPoints = [];
    recordSessionId = null;
    recordPhotoCount = 0;
    showScreen('upload');
  }

  const MAX_PHOTO_DIM = 1280;
  const PHOTO_QUALITY = 0.78;

  document.getElementById('btn-rec-photo').addEventListener('click', () => {
    if (!isRecording) return;
    document.getElementById('photo-input').click();
  });

  document.getElementById('photo-input').addEventListener('change', async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (!isRecording || !recordSessionId) return;

    try {
      const dataUrl = await compressImageToDataUrl(file, MAX_PHOTO_DIM, PHOTO_QUALITY);
      const STALE_MS = 30000;
      const freshGps = lastGpsPosition && (Date.now() - lastGpsPosition.timestamp) < STALE_MS;
      const pt = freshGps ? {
        lat: lastGpsPosition.coords.latitude,
        lon: lastGpsPosition.coords.longitude
      } : (recordedPoints.length > 0 ? {
        lat: recordedPoints[recordedPoints.length - 1].lat,
        lon: recordedPoints[recordedPoints.length - 1].lon
      } : null);

      if (!pt) {
        alert('No fresh GPS fix yet - take a moment for your location to lock in.');
        return;
      }

      await addPhoto({
        sessionId: recordSessionId,
        activityId: null,
        timestamp: new Date().toISOString(),
        lat: pt.lat,
        lon: pt.lon,
        dataUrl: dataUrl
      });

      recordPhotoCount++;
      setText('rec-photos-count', `${recordPhotoCount} photo${recordPhotoCount === 1 ? '' : 's'}`);

      const map = HikerMap.getMap();
      if (map) {
        L.marker([pt.lat, pt.lon], {
          icon: L.divIcon({
            html: '<div class="photo-marker">&#128247;</div>',
            className: '', iconSize: [28, 28], iconAnchor: [14, 14]
          })
        }).addTo(map);
      }
      showToast('Photo saved at this point');
    } catch (err) {
      alert('Could not save photo: ' + err.message);
    }
  });

  function compressImageToDataUrl(file, maxDim, quality) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = e => {
        const img = new Image();
        img.onload = () => {
          let w = img.width, h = img.height;
          if (w > h && w > maxDim) { h = Math.round(h * (maxDim / w)); w = maxDim; }
          else if (h > maxDim) { w = Math.round(w * (maxDim / h)); h = maxDim; }
          const canvas = document.createElement('canvas');
          canvas.width = w; canvas.height = h;
          canvas.getContext('2d').drawImage(img, 0, 0, w, h);
          resolve(canvas.toDataURL('image/jpeg', quality));
        };
        img.onerror = () => reject(new Error('Image decode failed'));
        img.src = e.target.result;
      };
      reader.onerror = () => reject(reader.error || new Error('File read failed'));
      reader.readAsDataURL(file);
    });
  }

  function openPhotoModal(photo) {
    document.getElementById('photo-modal-img').src = photo.dataUrl;
    const meta = document.getElementById('photo-modal-meta');
    const date = new Date(photo.timestamp).toLocaleString();
    meta.textContent = `${photo.lat.toFixed(5)}, ${photo.lon.toFixed(5)}  -  ${date}`;
    document.getElementById('photo-modal').classList.remove('hidden');
  }

  document.getElementById('photo-modal-close').addEventListener('click', () => {
    document.getElementById('photo-modal').classList.add('hidden');
  });
  document.getElementById('photo-modal').addEventListener('click', e => {
    if (e.target.id === 'photo-modal') document.getElementById('photo-modal').classList.add('hidden');
  });

  async function showPhotosForActivity(activityId, sessionId) {
    let photos = [];
    try {
      if (activityId) photos = await getPhotosByActivity(activityId);
      if ((!photos || photos.length === 0) && sessionId) photos = await getPhotosBySession(sessionId);
    } catch (e) { return; }
    if (!photos || photos.length === 0) return;
    HikerMap.showPhotoMarkers(photos, openPhotoModal);
  }

  document.getElementById('btn-back').addEventListener('click', () => {
    exitPlanner();
    stopTracking();
    stopPlayback();
    playbackPos = 0;
    if (recordPolyline) { recordPolyline.remove(); recordPolyline = null; }
    HikerMap.clearPhotoMarkers();
    if (is3dMode) toggle3dMode();
    document.getElementById('recording-overlay').classList.add('hidden');
    document.getElementById('rec-complete').classList.add('hidden');
    document.getElementById('btn-download-gpx').classList.add('hidden');
    showScreen('upload');
  });

  const saveBtn = document.getElementById('btn-save-activity');
  saveBtn.dataset.originalHtml = saveBtn.innerHTML;
  saveBtn.addEventListener('click', saveActivity);

  document.getElementById('btn-sync').addEventListener('click', syncPendingActivities);

  window.addEventListener('online', () => {
    document.getElementById('offline-banner').classList.add('hidden');
    if (currentUser) syncPendingActivities();
  });
  window.addEventListener('offline', () => {
    document.getElementById('offline-banner').classList.remove('hidden');
  });

  document.getElementById('btn-download-gpx').addEventListener('click', downloadRecordedGpx);

  document.getElementById('elevation-toggle').addEventListener('click', toggleElevation);
  document.getElementById('elevation-toggle').addEventListener('keydown', e => {
    if (e.key === 'Enter' || e.key === ' ') toggleElevation();
  });

  function toggleElevation() {
    const panel = document.getElementById('elevation-panel');
    elevationCollapsed = !elevationCollapsed;
    panel.classList.toggle('collapsed', elevationCollapsed);
    panel.querySelector('#elevation-toggle').setAttribute('aria-expanded', !elevationCollapsed);

    document.getElementById('viewer-screen').style.setProperty('--elev-h', elevationCollapsed ? '36px' : '150px');
    setTimeout(() => HikerMap.getMap()?.invalidateSize(), 250);
  }

  document.getElementById('btn-layers').addEventListener('click', () => {
    document.getElementById('layer-panel').classList.toggle('hidden');
  });
  document.getElementById('btn-close-layers').addEventListener('click', () => {
    document.getElementById('layer-panel').classList.add('hidden');
  });

  document.querySelectorAll('.layer-option').forEach(opt => {
    opt.addEventListener('click', () => {
      const name = opt.dataset.layer;
      HikerMap.setLayer(name);
      document.querySelectorAll('.layer-option').forEach(o => o.classList.remove('active'));
      opt.classList.add('active');
      document.getElementById('layer-panel').classList.add('hidden');
    });
  });

  let map3d = null;
  let map3dLoaded = false;
  let is3dMode = false;
  let map3dLoading = false;

  function load3dAssets() {
    return new Promise((resolve, reject) => {
      if (window.maplibregl) { resolve(); return; }
      if (!document.querySelector('link[data-maplibre]')) {
        const css = document.createElement('link');
        css.rel = 'stylesheet';
        css.href = 'https://unpkg.com/maplibre-gl@5.1.0/dist/maplibre-gl.css';
        css.dataset.maplibre = '1';
        document.head.appendChild(css);
      }
      const existing = document.querySelector('script[data-maplibre]');
      if (existing) {
        existing.addEventListener('load', () => resolve());
        existing.addEventListener('error', () => reject(new Error('Failed to load MapLibre')));
        return;
      }
      const script = document.createElement('script');
      script.src = 'https://unpkg.com/maplibre-gl@5.1.0/dist/maplibre-gl.js';
      script.dataset.maplibre = '1';
      script.onload = () => resolve();
      script.onerror = () => { script.remove(); reject(new Error('Failed to load MapLibre')); };
      document.head.appendChild(script);
    });
  }

  function init3dMap() {
    if (map3d || !window.maplibregl) return;
    const pts = routeData?.trackPoints || [];
    if (pts.length === 0) return;

    const startLon = pts[0][1], startLat = pts[0][0];

    map3d = new maplibregl.Map({
      container: 'map3d',
      style: {
        version: 8,
        sources: {
          'osm-raster': {
            type: 'raster',
            tiles: ['https://a.tile.openstreetmap.org/{z}/{x}/{y}.png','https://b.tile.openstreetmap.org/{z}/{x}/{y}.png','https://c.tile.openstreetmap.org/{z}/{x}/{y}.png'],
            tileSize: 256,
            attribution: '&copy; OpenStreetMap contributors',
            maxzoom: 19
          },
          'terrain-dem': {
            type: 'raster-dem',
            tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
            tileSize: 256,
            encoding: 'terrarium',
            maxzoom: 14,
            attribution: 'DEM: Mapzen'
          }
        },
        layers: [
          { id: 'osm-layer', type: 'raster', source: 'osm-raster' },
          { id: 'hillshade', type: 'hillshade', source: 'terrain-dem',
            paint: { 'hillshade-shadow-color': '#473B24', 'hillshade-exaggeration': 0.45 } }
        ],
        terrain: { source: 'terrain-dem', exaggeration: 1.5 }
      },
      center: [startLon, startLat],
      zoom: 13,
      pitch: 60,
      bearing: 0,
      maxPitch: 80
    });
    map3d.addControl(new maplibregl.NavigationControl({ visualizePitch: true }));
    map3d.on('load', () => {
      const avyToggle = document.getElementById('avy-hazard-toggle');
      const isAvyEnabled = avyToggle ? avyToggle.checked : true;

      map3d.addSource('route-line', {
        type: 'geojson',
        data: routeLineGeoJson(pts)
      });
      map3d.addLayer({
        id: 'route-line-layer',
        type: 'line',
        source: 'route-line',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: {
          'line-color': isAvyEnabled ? ['get', 'color'] : '#E76F51',
          'line-width': 5
        }
      });
      const startEnd = {
        type: 'FeatureCollection',
        features: [
          { type: 'Feature', properties: { kind: 'start' }, geometry: { type: 'Point', coordinates: [pts[0][1], pts[0][0]] }},
          { type: 'Feature', properties: { kind: 'end' },   geometry: { type: 'Point', coordinates: [pts[pts.length-1][1], pts[pts.length-1][0]] }}
        ]
      };
      map3d.addSource('route-ends', { type: 'geojson', data: startEnd });
      map3d.addLayer({
        id: 'route-ends-layer',
        type: 'circle',
        source: 'route-ends',
        paint: {
          'circle-radius': 8,
          'circle-color': ['match', ['get', 'kind'], 'start', '#52b788', 'end', '#E76F51', '#fff'],
          'circle-stroke-width': 2,
          'circle-stroke-color': '#fff'
        }
      });
      const bounds = new maplibregl.LngLatBounds();
      for (const p of pts) bounds.extend([p[1], p[0]]);
      map3d.fitBounds(bounds, { padding: 60, pitch: 60, bearing: 0, duration: 800 });
    });

    const avyToggle = document.getElementById('avy-hazard-toggle');
    if (avyToggle) {
      avyToggle.addEventListener('change', (e) => {
        if (!map3d) return;
        const enabled = e.target.checked;
        if (map3d.getLayer('route-line-layer')) {
          map3d.setPaintProperty('route-line-layer', 'line-color', enabled ? ['get', 'color'] : '#E76F51');
        }
      });
    }

    map3dLoaded = true;
  }

  function routeLineGeoJson(pts) {
    if (!pts || pts.length < 2) {
      return { type: 'FeatureCollection', features: [] };
    }
    const features = [];
    const profile = routeData?.elevationProfile || [];
    const hasProfile = profile.length > 1;

    for (let i = 0; i < pts.length - 1; i++) {
      const p1 = pts[i];
      const p2 = pts[i + 1];
      const lat1 = p1[0], lon1 = p1[1];
      const lat2 = p2[0], lon2 = p2[1];

      let ele1 = p1[2] || 0;
      let ele2 = p2[2] || 0;

      if (hasProfile) {
        const ratio1 = i / (pts.length - 1);
        const ratio2 = (i + 1) / (pts.length - 1);
        const idx1 = Math.min(profile.length - 1, Math.floor(ratio1 * profile.length));
        const idx2 = Math.min(profile.length - 1, Math.floor(ratio2 * profile.length));
        ele1 = profile[idx1]?.elevationM ?? ele1;
        ele2 = profile[idx2]?.elevationM ?? ele2;
      }

      const dLat = (lat2 - lat1) * 111320;
      const dLon = (lon2 - lon1) * (40075000 * Math.cos(lat1 * Math.PI / 180) / 360);
      const dist = Math.sqrt(dLat * dLat + dLon * dLon);
      const eleDiff = Math.abs(ele2 - ele1);

      let slopeDeg = 0;
      if (dist > 0.001) {
        slopeDeg = Math.atan2(eleDiff, dist) * (180 / Math.PI);
      } else if (hasProfile) {
        const ratio2 = (i + 1) / (pts.length - 1);
        const idx2 = Math.min(profile.length - 1, Math.floor(ratio2 * profile.length));
        const grad = Math.abs(profile[idx2]?.gradientPct || 0);
        slopeDeg = Math.atan(grad / 100) * (180 / Math.PI);
      }

      let color = '#2EC4B6'; // < 15° Low Risk Green
      if (slopeDeg > 30) {
        color = '#E76F51'; // > 30° Avalanche Hazard Red
      } else if (slopeDeg >= 15) {
        color = '#FF9F1C'; // 15°–30° Moderate Orange/Yellow
      }

      features.push({
        type: 'Feature',
        properties: {
          slope: slopeDeg,
          color: color
        },
        geometry: {
          type: 'LineString',
          coordinates: [[lon1, lat1], [lon2, lat2]]
        }
      });
    }
    return {
      type: 'FeatureCollection',
      features: features
    };
  }

  function update3dRoute() {
    if (!map3d || !routeData?.trackPoints?.length) return;
    const pts = routeData.trackPoints;
    const src = map3d.getSource('route-line');
    if (src) src.setData(routeLineGeoJson(pts));
    const endsSrc = map3d.getSource('route-ends');
    if (endsSrc) endsSrc.setData({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', properties: { kind: 'start' }, geometry: { type: 'Point', coordinates: [pts[0][1], pts[0][0]] }},
        { type: 'Feature', properties: { kind: 'end' },   geometry: { type: 'Point', coordinates: [pts[pts.length-1][1], pts[pts.length-1][0]] }}
      ]
    });
    if (window.maplibregl) {
      const bounds = new maplibregl.LngLatBounds();
      for (const p of pts) bounds.extend([p[1], p[0]]);
      map3d.fitBounds(bounds, { padding: 60, pitch: 60, bearing: 0, duration: 600 });
    }
  }

  async function toggle3dMode() {
    if (!routeData?.trackPoints?.length) {
      alert('Open a route first.');
      return;
    }
    const btn = document.getElementById('btn-3d');
    if (!is3dMode) {
      if (map3dLoading) return;
      map3dLoading = true;
      try {
        await load3dAssets();
      } catch (e) {
        map3dLoading = false;
        alert('Could not load 3D map. Check your connection.');
        return;
      }
      map3dLoading = false;

      document.getElementById('map').style.display = 'none';
      const container3d = document.getElementById('map-3d-container');
      if (container3d) container3d.classList.remove('hidden');
      document.getElementById('map3d').classList.remove('hidden');
      document.getElementById('gradient-legend').style.display = 'none';
      btn.classList.add('active');
      is3dMode = true;

      if (!map3d) init3dMap();
      else { update3dRoute(); setTimeout(() => map3d.resize(), 50); }
    } else {
      const container3d = document.getElementById('map-3d-container');
      if (container3d) container3d.classList.add('hidden');
      document.getElementById('map3d').classList.add('hidden');
      document.getElementById('map').style.display = '';
      if (routeData?.elevationProfile?.length > 0) {
        document.getElementById('gradient-legend').style.display = '';
      }
      btn.classList.remove('active');
      is3dMode = false;
      setTimeout(() => HikerMap.getMap()?.invalidateSize(), 50);
    }
  }

  document.getElementById('btn-3d').addEventListener('click', toggle3dMode);

  const OFFLINE_ZOOMS = [11, 12, 13, 14, 15];
  const OFFLINE_MAX_TILES = 2500;
  const OFFLINE_CONCURRENCY = 8;
  let offlineCancelled = false;
  let offlineInProgress = false;

  function lonToTileX(lon, z) {
    return Math.floor((lon + 180) / 360 * Math.pow(2, z));
  }
  function latToTileY(lat, z) {
    const r = lat * Math.PI / 180;
    return Math.floor((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2 * Math.pow(2, z));
  }

  function routeBounds() {
    const pts = routeData?.trackPoints;
    if (!pts || pts.length === 0) return null;
    let minLat = pts[0][0], maxLat = pts[0][0];
    let minLon = pts[0][1], maxLon = pts[0][1];
    for (const p of pts) {
      if (p[0] < minLat) minLat = p[0];
      if (p[0] > maxLat) maxLat = p[0];
      if (p[1] < minLon) minLon = p[1];
      if (p[1] > maxLon) maxLon = p[1];
    }
    const padLat = (maxLat - minLat) * 0.10 + 0.005;
    const padLon = (maxLon - minLon) * 0.10 + 0.005;
    return {
      minLat: minLat - padLat, maxLat: maxLat + padLat,
      minLon: minLon - padLon, maxLon: maxLon + padLon
    };
  }

  function enumerateTiles(bounds, zooms) {
    const tiles = [];
    for (const z of zooms) {
      const xMin = lonToTileX(bounds.minLon, z);
      const xMax = lonToTileX(bounds.maxLon, z);
      const yMin = latToTileY(bounds.maxLat, z);
      const yMax = latToTileY(bounds.minLat, z);
      for (let x = xMin; x <= xMax; x++) {
        for (let y = yMin; y <= yMax; y++) {
          tiles.push([z, x, y]);
          if (tiles.length >= OFFLINE_MAX_TILES) return tiles;
        }
      }
    }
    return tiles;
  }

  function tileUrl(layer, z, x, y) {
    const sub = ['a','b','c'][(x + y) % 3];
    switch (layer) {
      case 'topo':      return `https://${sub}.tile.opentopomap.org/${z}/${x}/${y}.png`;
      case 'satellite': return `https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/${z}/${y}/${x}`;
      case 'dark':      return `https://${sub}.basemaps.cartocdn.com/dark_all/${z}/${x}/${y}.png`;
      default:          return `https://${sub}.tile.openstreetmap.org/${z}/${x}/${y}.png`;
    }
  }

  function getCurrentLayer() {
    const active = document.querySelector('.layer-option.active');
    return active?.dataset?.layer || 'osm';
  }

  async function downloadOfflineTiles() {
    if (offlineInProgress) return;
    if (!routeData?.trackPoints?.length) {
      alert('Open a route first.');
      return;
    }
    const bounds = routeBounds();
    if (!bounds) return;
    const layer = getCurrentLayer();
    const tiles = enumerateTiles(bounds, OFFLINE_ZOOMS);
    if (tiles.length === 0) return;

    const estMB = Math.round(tiles.length * 20 / 1024);
    if (tiles.length >= OFFLINE_MAX_TILES) {
      if (!confirm(`Route is large. Will download the maximum ${OFFLINE_MAX_TILES} tiles (~${estMB} MB) at zoom levels ${OFFLINE_ZOOMS[0]}-${OFFLINE_ZOOMS[OFFLINE_ZOOMS.length-1]}. Proceed?`)) return;
    } else {
      if (!confirm(`Download ${tiles.length} tiles (~${estMB} MB) for the "${layer}" map at zoom ${OFFLINE_ZOOMS[0]}-${OFFLINE_ZOOMS[OFFLINE_ZOOMS.length-1]}? This will use mobile data once.`)) return;
    }

    if (navigator.storage?.estimate) {
      const est = await navigator.storage.estimate();
      const availableMB = (est.quota - est.usage) / 1024 / 1024;
      if (availableMB < estMB * 1.5) {
        alert(`Not enough storage. Available: ${Math.round(availableMB)} MB, needed: ${estMB} MB.`);
        return;
      }
    }

    offlineCancelled = false;
    offlineInProgress = true;
    const progressEl = document.getElementById('offline-tiles-progress');
    const fillEl = document.getElementById('offline-progress-fill');
    const textEl = document.getElementById('offline-progress-text');
    const downloadBtn = document.getElementById('btn-offline-download');
    const cancelBtn = document.getElementById('btn-offline-cancel');
    progressEl.classList.remove('hidden');
    cancelBtn.classList.remove('hidden');
    downloadBtn.disabled = true;
    downloadBtn.textContent = 'Downloading...';

    let completed = 0;
    let errors = 0;
    const total = tiles.length;
    const downloadStartTime = Date.now();

    const updateProgress = () => {
      const pct = Math.round((completed / total) * 100);
      fillEl.style.width = pct + '%';
      const elapsedSec = (Date.now() - downloadStartTime) / 1000;
      const speed = completed > 0 && elapsedSec > 0 ? completed / elapsedSec : 0;
      const remainingTiles = total - completed;
      const etaSec = speed > 0 ? Math.ceil(remainingTiles / speed) : 0;
      const mbDownloaded = (completed * 20 / 1024).toFixed(1);
      const etaStr = etaSec > 0 && completed < total ? ` · ~${etaSec}s left` : '';
      textEl.textContent = `${completed}/${total} tiles (${pct}%) · ${mbDownloaded} MB${etaStr}`;
    };
    updateProgress();

    let next = 0;
    async function worker() {
      while (next < tiles.length && !offlineCancelled) {
        const idx = next++;
        const [z, x, y] = tiles[idx];
        const url = tileUrl(layer, z, x, y);
        try {
          await fetch(url, { mode: 'cors', credentials: 'omit' });
        } catch { errors++; }
        completed++;
        updateProgress();
      }
    }
    const workers = Array.from({ length: OFFLINE_CONCURRENCY }, worker);
    await Promise.all(workers);

    offlineInProgress = false;
    downloadBtn.disabled = false;
    cancelBtn.classList.add('hidden');
    downloadBtn.textContent = 'Download for offline';
    if (offlineCancelled) {
      textEl.textContent = `Cancelled at ${completed}/${total} tiles`;
    } else {
      textEl.textContent = `Done. ${completed - errors}/${total} tiles cached.`;
      showToast(`Offline maps saved for this route`);
    }
    await refreshTileCacheInfo();
    setTimeout(() => progressEl.classList.add('hidden'), 4000);
  }

  function cancelOfflineDownload() {
    offlineCancelled = true;
  }

  function swRequest(message) {
    return new Promise((resolve, reject) => {
      if (!navigator.serviceWorker?.controller) {
        reject(new Error('Service worker not ready'));
        return;
      }
      const channel = new MessageChannel();
      const timeoutId = setTimeout(() => reject(new Error('Service worker timeout')), 8000);
      channel.port1.onmessage = e => {
        clearTimeout(timeoutId);
        resolve(e.data);
      };
      navigator.serviceWorker.controller.postMessage(message, [channel.port2]);
    });
  }

  async function clearTileCache() {
    if (!confirm('Clear all cached offline tiles?')) return;
    try {
      await swRequest({ type: 'CLEAR_TILE_CACHE' });
      showToast('Offline tiles cleared');
      await refreshTileCacheInfo();
    } catch (e) {
      alert('Could not clear cache: ' + e.message);
    }
  }

  async function refreshTileCacheInfo() {
    const info = document.getElementById('offline-tiles-info');
    if (!info) return;
    try {
      const result = await swRequest({ type: 'TILE_CACHE_SIZE' });
      const bytes = result?.bytes || 0;
      const mb = (bytes / 1024 / 1024).toFixed(1);
      info.textContent = bytes === 0
        ? 'No tiles cached yet.'
        : `~${mb} MB cached for offline use`;
    } catch (e) {
      info.textContent = 'Reload page to enable offline.';
    }
  }

  document.getElementById('btn-offline-download').addEventListener('click', downloadOfflineTiles);
  document.getElementById('btn-offline-cancel').addEventListener('click', cancelOfflineDownload);
  document.getElementById('btn-offline-clear').addEventListener('click', clearTileCache);

  document.getElementById('btn-layers').addEventListener('click', () => {
    setTimeout(refreshTileCacheInfo, 0);
  });

  async function loadAiTip() {
    try {
      const res = await fetch('/api/ai-tip');
      const data = await res.json();
      const card = document.getElementById('ai-tip-card');
      if (data.available && data.tip) {
        document.getElementById('ai-tip-text').textContent = data.tip;
        card.classList.remove('hidden');
        document.getElementById('btn-ai').classList.remove('hidden');
      }
    } catch (e) {}
  }

  let playbackRaf = null;
  let playbackStart = 0;
  let playbackElapsedAtStart = 0;
  let playbackPos = 0;
  let playbackSpeed = 1;
  const PLAYBACK_BASE_DURATION_MS = 30000;

  function isPlaying() { return playbackRaf !== null; }

  function setPlaybackSpeed(spd) {
    if (isPlaying()) {
      playbackElapsedAtStart = playbackPos * (PLAYBACK_BASE_DURATION_MS / playbackSpeed);
      playbackStart = performance.now();
    }
    playbackSpeed = spd;
    const btn = document.getElementById('btn-playback-speed');
    if (btn) btn.textContent = spd + 'x';
  }

  function playbackTick(now) {
    const pts = routeData?.trackPoints;
    if (!pts || pts.length === 0) { stopPlayback(); return; }
    const profileLen = HikerElevation.getProfileLength();

    const elapsed = (now - playbackStart) + playbackElapsedAtStart;
    const totalDuration = PLAYBACK_BASE_DURATION_MS / playbackSpeed;
    playbackPos = Math.min(1, elapsed / totalDuration);

    const trackIdx = Math.min(pts.length - 1, Math.floor(playbackPos * (pts.length - 1)));
    HikerMap.showPositionAtIndex(trackIdx);

    if (profileLen > 0) {
      const profileIdx = Math.min(profileLen - 1, Math.floor(playbackPos * (profileLen - 1)));
      HikerElevation.highlightIndex(profileIdx);
      const profilePt = routeData.elevationProfile?.[profileIdx];
      if (profilePt) HikerElevation.showHoverInfo(profilePt);
    }

    if (playbackPos >= 1) { stopPlayback(); return; }
    playbackRaf = requestAnimationFrame(playbackTick);
  }

  function startPlayback() {
    if (!routeData?.trackPoints?.length) return;
    if (playbackPos >= 1) playbackPos = 0;
    playbackElapsedAtStart = playbackPos * (PLAYBACK_BASE_DURATION_MS / playbackSpeed);
    playbackStart = performance.now();
    playbackRaf = requestAnimationFrame(playbackTick);
    document.getElementById('btn-playback').classList.add('playing');
  }

  function stopPlayback() {
    if (playbackRaf !== null) cancelAnimationFrame(playbackRaf);
    playbackRaf = null;
    document.getElementById('btn-playback').classList.remove('playing');
    HikerElevation.clearHighlight();
  }

  function togglePlayback() {
    if (isPlaying()) stopPlayback();
    else startPlayback();
  }

  document.getElementById('btn-playback').addEventListener('click', e => {
    e.stopPropagation();
    togglePlayback();
  });
  document.getElementById('btn-playback-speed').addEventListener('click', e => {
    e.stopPropagation();
    const next = playbackSpeed === 1 ? 2 : playbackSpeed === 2 ? 4 : 1;
    setPlaybackSpeed(next);
  });

  document.getElementById('btn-splits').addEventListener('click', () => {
    document.getElementById('splits-panel').classList.toggle('hidden');
  });
  document.getElementById('btn-close-splits').addEventListener('click', () => {
    document.getElementById('splits-panel').classList.add('hidden');
  });

  // Survival toolkit listeners
  const survivalPanel = document.getElementById('survival-panel');
  const selectSurvivalTab = (tabId) => {
    document.querySelectorAll('.survival-tab').forEach(btn => {
      const selected = btn.getAttribute('data-tab') === tabId;
      btn.classList.toggle('active', selected);
      btn.setAttribute('aria-selected', String(selected));
      btn.tabIndex = selected ? 0 : -1;
    });
    document.querySelectorAll('.survival-tab-pane').forEach(pane => {
      pane.classList.toggle('active', pane.id === `stab-${tabId}`);
    });
  };
  const openSurvival = (tabId) => {
    if (survivalPanel) {
      survivalPanel.classList.remove('hidden');
      if (tabId) selectSurvivalTab(tabId);
      document.getElementById('btn-close-survival')?.focus();
    }
  };
  document.getElementById('btn-survival')?.addEventListener('click', () => {
    if (survivalPanel?.classList.contains('hidden')) openSurvival();
    else survivalPanel?.classList.add('hidden');
  });
  document.getElementById('btn-close-survival')?.addEventListener('click', () => {
    survivalPanel?.classList.add('hidden');
  });
  document.getElementById('card-ams')?.addEventListener('click', () => openSurvival('ams'));
  document.getElementById('card-water')?.addEventListener('click', () => openSurvival('resupply'));
  ['card-ams', 'card-water'].forEach(id => {
    document.getElementById(id)?.addEventListener('keydown', event => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        openSurvival(id === 'card-ams' ? 'ams' : 'resupply');
      }
    });
  });

  document.querySelectorAll('.survival-tab').forEach(btn => {
    btn.addEventListener('click', () => {
      const tab = btn.getAttribute('data-tab');
      selectSurvivalTab(tab);
    });
    btn.addEventListener('keydown', event => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      const tabs = [...document.querySelectorAll('.survival-tab')];
      const delta = event.key === 'ArrowRight' ? 1 : -1;
      const next = tabs[(tabs.indexOf(btn) + delta + tabs.length) % tabs.length];
      selectSurvivalTab(next.getAttribute('data-tab'));
      next.focus();
    });
  });
  selectSurvivalTab('ams');

  document.getElementById('resupply-temp')?.addEventListener('input', () => updateResupplyMetrics());
  document.getElementById('resupply-hum')?.addEventListener('input', () => updateResupplyMetrics());

  document.getElementById('btn-sar-copy')?.addEventListener('click', () => {
    const txt = document.getElementById('sar-payload-text')?.value || '';
    if (navigator.clipboard && txt) {
      navigator.clipboard.writeText(txt);
      showToast('SAR emergency payload copied to clipboard!');
    }
  });

  let weatherCacheKey = null;
  let weatherCache = null;

  document.getElementById('btn-weather').addEventListener('click', toggleWeatherPanel);
  document.getElementById('btn-close-weather').addEventListener('click', () => {
    document.getElementById('weather-panel').classList.add('hidden');
  });

  async function toggleWeatherPanel() {
    const panel = document.getElementById('weather-panel');
    if (!panel.classList.contains('hidden')) {
      panel.classList.add('hidden');
      return;
    }
    panel.classList.remove('hidden');
    await loadWeatherForRoute();
  }

  async function loadWeatherForRoute() {
    const content = document.getElementById('weather-content');
    if (!routeData?.trackPoints?.length) {
      content.innerHTML = '<p class="splits-empty">No route loaded.</p>';
      return;
    }
    const start = routeData.trackPoints[0];
    const key = `${start[0].toFixed(2)},${start[1].toFixed(2)}`;

    if (weatherCacheKey === key && weatherCache) {
      renderWeather(weatherCache);
      return;
    }

    content.innerHTML = '<div class="ai-loading"><div class="spinner"></div><p>Loading forecast...</p></div>';
    try {
      const res = await fetch(`/api/weather?lat=${start[0]}&lon=${start[1]}`);
      if (!res.ok) {
        content.innerHTML = '<p style="color:var(--c-text-muted);text-align:center;padding:20px">Weather service unavailable.</p>';
        return;
      }
      const data = await res.json();
      weatherCacheKey = key;
      weatherCache = data;
      renderWeather(data);
    } catch (e) {
      content.innerHTML = '<p style="color:var(--c-danger);text-align:center;padding:20px">Could not load weather. Check your connection.</p>';
    }
  }

  function renderWeather(data) {
    const content = document.getElementById('weather-content');
    content.innerHTML = '';

    const risk = data.risk || { level: 'OK', summary: '' };
    const riskClass = risk.level === 'DANGER' ? 'weather-risk-danger' : risk.level === 'CAUTION' ? 'weather-risk-caution' : 'weather-risk-ok';
    const riskBox = document.createElement('div');
    riskBox.className = `weather-risk ${riskClass}`;
    const lbl = document.createElement('span'); lbl.className = 'wr-label'; lbl.textContent = risk.level;
    riskBox.appendChild(lbl);
    riskBox.appendChild(document.createTextNode(risk.summary || ''));
    content.appendChild(riskBox);

    if (data.current) {
      const now = document.createElement('div');
      now.className = 'weather-now';
      const desc = document.createElement('span');
      desc.className = 'weather-now-desc';
      desc.textContent = data.current.description;
      const time = document.createElement('span');
      time.className = 'weather-now-time';
      time.textContent = 'now';
      now.append(desc, time);
      content.appendChild(now);

      const grid = document.createElement('div');
      grid.className = 'weather-current';
      const cur = data.current;
      const items = [
        { val: `${Math.round(cur.tempC)}°C`, lbl: 'Temp' },
        { val: `${cur.precipMm.toFixed(1)} mm`, lbl: 'Precip' },
        { val: `${Math.round(cur.windKmh)} km/h`, lbl: 'Wind' }
      ];
      for (const it of items) {
        const card = document.createElement('div');
        card.className = 'weather-cur-card';
        const v = document.createElement('span'); v.className = 'weather-cur-val'; v.textContent = it.val;
        const l = document.createElement('span'); l.className = 'weather-cur-lbl'; l.textContent = it.lbl;
        card.append(v, l);
        grid.appendChild(card);
      }
      content.appendChild(grid);
    }

    if (data.hourly && data.hourly.length > 0) {
      const title = document.createElement('div');
      title.className = 'weather-hours-title';
      title.textContent = `Next ${Math.min(data.hourly.length, 12)} hours`;
      content.appendChild(title);

      const row = document.createElement('div');
      row.className = 'weather-hours';
      for (const h of data.hourly.slice(0, 12)) {
        const card = document.createElement('div');
        card.className = 'weather-hour';
        card.title = h.description;

        const t = document.createElement('span');
        t.className = 'weather-hour-time';
        const hourStr = h.time.slice(11, 13);
        t.textContent = `${hourStr}:00`;

        const tp = document.createElement('span');
        tp.className = 'weather-hour-temp';
        tp.textContent = `${Math.round(h.tempC)}°`;

        const pp = document.createElement('span');
        pp.className = 'weather-hour-precip' + (h.precipMm < 0.1 ? ' weather-dry' : '');
        pp.textContent = `${h.precipMm.toFixed(1)}mm`;

        const wd = document.createElement('span');
        wd.className = 'weather-hour-wind';
        wd.textContent = `${Math.round(h.windKmh)}km/h`;

        card.append(t, tp, pp, wd);
        row.appendChild(card);
      }
      content.appendChild(row);
    }
  }

  document.getElementById('btn-ai').addEventListener('click', requestAiAnalysis);
  document.getElementById('btn-close-ai').addEventListener('click', () => {
    document.getElementById('ai-panel').classList.add('hidden');
  });

  async function requestAiAnalysis() {
    if (!routeData) return;
    const panel = document.getElementById('ai-panel');
    const content = document.getElementById('ai-content');

    panel.classList.remove('hidden');
    content.innerHTML = '<div class="ai-loading"><div class="spinner"></div><p>Analyzing your route...</p></div>';

    try {
      const res = await fetch('/api/ai-analysis', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: routeData.name,
          stats: routeData.stats,
          safety: routeData.safety
        })
      });
      const data = await res.json();

      if (data.available && data.analysis) {
        content.innerHTML = markdownToHtml(data.analysis);
      } else {
        content.innerHTML = '<p style="color:var(--c-text-muted)">AI analysis is not available at this time.</p>';
      }
    } catch (e) {
      content.innerHTML = '<p style="color:var(--c-danger)">Could not reach AI service. Check your connection.</p>';
    }
  }

  function markdownToHtml(md) {
    return md
      .replace(/^### (.+)$/gm, '<h3>$1</h3>')
      .replace(/^## (.+)$/gm, '<h2>$1</h2>')
      .replace(/^# (.+)$/gm, '<h1>$1</h1>')
      .replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>')
      .replace(/\*(.+?)\*/g, '<em>$1</em>')
      .replace(/^- (.+)$/gm, '<li>$1</li>')
      .replace(/^(\d+)\. (.+)$/gm, '<li>$2</li>')
      .replace(/(<li>.*<\/li>\n?)+/g, m => {
        const tag = m.trim().startsWith('<li>1') ? 'ol' : 'ul';
        return `<${tag}>${m}</${tag}>`;
      })
      .replace(/\n\n/g, '</p><p>')
      .replace(/^(?!<[hulo])(.+)$/gm, '<p>$1</p>')
      .replace(/<p><\/p>/g, '');
  }

  document.getElementById('btn-export').addEventListener('click', exportSummary);
  document.getElementById('btn-print').addEventListener('click', () => {
    buildPrintCard();
    window.print();
  });

  function pcEl(tag, cls, text) {
    const e = document.createElement(tag);
    e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }
  function pcItem(label, value) {
    const d = pcEl('div', 'pc-item');
    d.append(pcEl('span', 'pc-k', label), pcEl('span', 'pc-v', value));
    return d;
  }

  function buildPrintCard() {
    if (!routeData) return;
    const s = routeData.stats;
    const sf = routeData.safety;
    const card = document.getElementById('print-card');
    card.innerHTML = '';

    card.append(pcEl('h1', 'pc-title', routeData.name || 'Route'));
    card.append(pcEl('div', 'pc-sub', 'HikerAid safety card · ' + new Date().toLocaleString()));

    const grid = pcEl('div', 'pc-grid');
    const fmt = m => (m ? formatTime(m) : '—');
    [
      ['Distance', s.distanceKm != null ? s.distanceKm + ' km' : '—'],
      ['Moving time', fmt(s.estimatedTimeMinutes)],
      ['Total time (with breaks)', fmt(s.totalTimeMinutes)],
      ['Elevation gain', s.hasElevationData ? s.elevationGainM + ' m' : '—'],
      ['Elevation loss', s.hasElevationData ? s.elevationLossM + ' m' : '—'],
      ['Max gradient', s.maxGradientPct != null ? s.maxGradientPct + '%' : '—'],
      ['Difficulty', (s.difficulty || '—') + ' (' + (s.difficultyScore != null ? s.difficultyScore : '—') + '/100)'],
      ['Calories', s.estimatedCalories ? Math.round(s.estimatedCalories) + ' kcal' : '—'],
    ].forEach(([k, v]) => grid.append(pcItem(k, v)));
    card.append(grid);

    if (sf) {
      card.append(pcEl('h2', 'pc-h2', 'Safety'));
      const sgrid = pcEl('div', 'pc-grid');
      const margin = sf.marginMinutes;
      const marginStr = (margin >= 0 ? '+' : '-') + formatTime(Math.abs(margin)) + (margin < 0 ? ' (INSUFFICIENT)' : '');
      [
        ['Sunset (est.)', '~' + (sf.sunsetEstimate || '—')],
        ['Daylight margin', marginStr],
        ['Turn back at', sf.turnaroundDistanceKm + ' km'],
        ['Point of no return', sf.pointOfNoReturnKm + ' km'],
        ['Pace basis', sf.fitnessLabel + ' (' + sf.paceFactor + '× pace)'],
      ].forEach(([k, v]) => sgrid.append(pcItem(k, v)));
      card.append(sgrid);
    }

    const pts = routeData.trackPoints;
    if (pts && pts.length > 1) {
      card.append(pcEl('h2', 'pc-h2', 'Endpoints'));
      const cg = pcEl('div', 'pc-grid');
      cg.append(pcItem('Start', pts[0][0].toFixed(5) + ', ' + pts[0][1].toFixed(5)));
      cg.append(pcItem('Finish', pts[pts.length - 1][0].toFixed(5) + ', ' + pts[pts.length - 1][1].toFixed(5)));
      card.append(cg);
    }

    card.append(pcEl('div', 'pc-foot',
      'Carry a paper map and compass. Times are estimates — turn back early if you fall behind schedule.  hikeraid.onrender.com'));
  }

  function exportSummary() {
    if (!routeData) return;
    const s = routeData.stats;
    const lines = [
      `Route: ${routeData.name || 'Unnamed'}`,
      ``,
      `Distance:       ${s.distanceKm} km`,
      `Moving time:    ${formatTime(s.estimatedTimeMinutes)}`,
      `Total time:     ${formatTime(s.totalTimeMinutes)}`,
      `Elevation gain: ${s.elevationGainM} m`,
      `Elevation loss: ${s.elevationLossM} m`,
      `Max elevation:  ${s.maxElevationM} m`,
      `Min elevation:  ${s.minElevationM} m`,
      `Max gradient:   ${s.maxGradientPct}%`,
      `Avg speed:      ${s.avgSpeedKmh} km/h`,
      `Calories:       ${Math.round(s.estimatedCalories)} kcal`,
      `Difficulty:     ${s.difficulty} (${s.difficultyScore}/100)`,
    ];
    const sf = routeData.safety;
    if (sf) {
      lines.push('');
      lines.push('--- Safety analysis ---');
      lines.push(`Fitness:        ${sf.fitnessLabel} (${sf.paceFactor}x pace)`);
      lines.push(`Sunset:         ~${sf.sunsetEstimate}`);
      lines.push(`Daylight margin: ${sf.marginMinutes >= 0 ? '+' : ''}${formatTime(Math.abs(sf.marginMinutes))}${sf.marginMinutes < 0 ? ' (INSUFFICIENT)' : ''}`);
      lines.push(`Turn back at:   ${sf.turnaroundDistanceKm} km`);
      lines.push(`Point of no return: ${sf.pointOfNoReturnKm} km`);
    }
    lines.push('', 'Analyzed by HikerAid');

    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(routeData.name || 'route').replace(/[^a-z0-9]/gi, '_')}_summary.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  document.getElementById('btn-track').addEventListener('click', toggleTracking);
  document.getElementById('btn-stop-track').addEventListener('click', stopTracking);

  document.getElementById('btn-voice')?.addEventListener('click', () => {
    voiceEnabled = !voiceEnabled;
    try { localStorage.setItem('hikerAid_voice', voiceEnabled ? '1' : '0'); } catch (e) {}
    updateVoiceButton();
    if (voiceEnabled) speak('Voice guidance on'); else stopSpeaking();
  });
  updateVoiceButton();

  function maybeSpeakTurn(category, phrase) {
    if (category === lastSpokenCategory) return;
    lastSpokenCategory = category;
    speak(phrase);
  }

  function toggleTracking() {
    if (isTracking) stopTracking();
    else startTracking();
  }

  function startTracking() {
    if (!('geolocation' in navigator)) {
      alert('Geolocation is not available in your browser.');
      return;
    }
    if (!routeData || !routeData.trackPoints || routeData.trackPoints.length === 0) return;

    isTracking = true;
    trackStartTime = null;
    lastSpokenCategory = null;
    lastSpokenOffRoute = false;
    document.getElementById('btn-track').classList.add('active');
    document.getElementById('tracking-panel').classList.remove('hidden');
    requestWakeLock();
    speak('Tracking started. I will warn you about turn-back time and going off route.');

    gpsWatchId = navigator.geolocation.watchPosition(
      pos => {
        lastGpsPosition = pos;
        onGpsUpdate(pos.coords.latitude, pos.coords.longitude, pos.coords.altitude);
      },
      err => { console.warn('GPS error:', err.message); },
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 10000 }
    );
  }

  function onGpsUpdate(lat, lon, altM) {
    HikerMap.updateGpsPosition(lat, lon);

    const pts = routeData.trackPoints;
    const nearestIdx = HikerMap.nearestPointIndex(lat, lon);

    if (trackStartTime === null) { trackStartTime = Date.now(); trackStartIdx = nearestIdx; }

    const progressPct = pts.length > 1 ? Math.round((nearestIdx / (pts.length - 1)) * 100) : 0;

    const remainingPts = pts.slice(nearestIdx);
    let remainDist = 0;
    for (let i = 1; i < remainingPts.length; i++) {
      remainDist += haversine(remainingPts[i-1][0], remainingPts[i-1][1], remainingPts[i][0], remainingPts[i][1]);
    }
    const remainKm = remainDist / 1000;
    const avgSpeedKmh = routeData.stats.avgSpeedKmh || 3.5;
    const remainMinutes = Math.round((remainKm / avgSpeedKmh) * 60);

    setText('t-progress', `${progressPct}%`);
    setText('t-remaining-dist', `${remainKm.toFixed(1)} km`);
    setText('t-remaining-time', formatTime(remainMinutes));
    setText('t-current-ele', altM != null ? `${Math.round(altM)} m` : '—');

    updateTurnBack(nearestIdx);
    updateDeviation(lat, lon);
    if (liveShareToken) {
      const acc = (lastGpsPosition && lastGpsPosition.coords && lastGpsPosition.coords.accuracy) || 0;
      pingLive(lat, lon, acc);
    }
  }

  function updateDeviation(lat, lon) {
    const el = document.getElementById('t-offroute-banner');
    if (!el) return;
    const d = HikerMap.distanceToRouteMeters(lat, lon);
    if (!isFinite(d)) { el.classList.add('hidden'); return; }
    const acc = (lastGpsPosition && lastGpsPosition.coords && lastGpsPosition.coords.accuracy) || 0;
    const threshold = Math.max(75, acc * 1.5);
    if (d > threshold) {
      el.textContent = `Off route — ${Math.round(d)} m from the planned path. Check your map and rejoin the track.`;
      el.classList.remove('hidden');
      if (!lastSpokenOffRoute) {
        lastSpokenOffRoute = true;
        speak(`Off route. You are ${Math.round(d)} meters from the planned path.`);
      }
    } else {
      el.classList.add('hidden');
      if (lastSpokenOffRoute) {
        lastSpokenOffRoute = false;
        speak('Back on the planned route.');
      }
    }
  }

  function livePaceFactor(fwd, nearestIdx) {
    if (trackStartTime === null) return 1;
    const elapsedMin = (Date.now() - trackStartTime) / 60000;
    const plannedSpan = fwd[nearestIdx] - (fwd[trackStartIdx] || 0);
    if (plannedSpan <= 3 || elapsedMin <= 1) return 1;
    return Math.max(0.5, Math.min(3, elapsedMin / plannedSpan));
  }

  function clockFromNow(minFromNow) {
    const d = new Date(Date.now() + minFromNow * 60000);
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }

  function updateTurnBack(nearestIdx) {
    const banner = document.getElementById('t-turnback-banner');
    const sf = routeData && routeData.safety;
    const fwd = sf && sf.cumForwardMinutes;
    const ret = sf && sf.cumReturnMinutes;
    if (!sf || !fwd || !ret || sf.sunsetMinutes == null || nearestIdx < 0 || nearestIdx >= fwd.length) {
      banner.classList.add('hidden');
      setText('t-daylight', '—');
      setText('t-turnback', '—');
      lastSpokenCategory = null;
      return;
    }

    const n = fwd.length;
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes() + now.getSeconds() / 60;
    const cutoff = sf.sunsetMinutes - (sf.safetyBufferMinutes || 30);
    const daylightLeft = cutoff - nowMin;

    const live = livePaceFactor(fwd, nearestIdx);
    const timeToFinish = (fwd[n - 1] - fwd[nearestIdx]) * live;
    const timeToReturn = ret[nearestIdx] * live;

    setText('t-remaining-time', formatTime(Math.round(timeToFinish)));
    setText('t-daylight', daylightLeft > 0 ? formatTime(Math.round(daylightLeft)) : '0m');

    banner.classList.remove('hidden', 'safety-ok', 'safety-caution', 'safety-danger');

    if (daylightLeft <= 0) {
      banner.classList.add('safety-danger');
      banner.textContent = 'Past the safe daylight cutoff. Use a headlamp and descend the fastest safe way.';
      setText('t-turnback', 'now');
      maybeSpeakTurn('past-cutoff', 'Past the safe daylight cutoff. Use a headlamp and descend the fastest safe way.');
      return;
    }

    if (timeToFinish <= daylightLeft) {
      banner.classList.add('safety-ok');
      banner.textContent = `On track to finish with ${formatTime(Math.round(daylightLeft - timeToFinish))} of daylight to spare.`;
      setText('t-turnback', 'not needed');
      const wasWarned = lastSpokenCategory && lastSpokenCategory !== 'ok';
      maybeSpeakTurn('ok', wasWarned ? 'You are back on track to finish before dark.' : null);
      return;
    }

    if (timeToReturn > daylightLeft) {
      banner.classList.add('safety-danger');
      banner.textContent = 'Not enough daylight to return to the start. Descend now or call for help.';
      setText('t-turnback', 'now');
      maybeSpeakTurn('return-danger', 'Warning. Not enough daylight to return to the start. Descend now or call for help.');
      return;
    }

    let lastSafe = nearestIdx;
    for (let j = nearestIdx; j < n; j++) {
      const cost = (fwd[j] - fwd[nearestIdx]) * live + ret[j] * live;
      if (cost <= daylightLeft) lastSafe = j; else break;
    }
    const minsToTurn = Math.max(0, (fwd[lastSafe] - fwd[nearestIdx]) * live);

    if (minsToTurn < 2) {
      banner.classList.add('safety-danger');
      banner.textContent = 'Turn back now to reach the start before dark.';
      setText('t-turnback', 'now');
      maybeSpeakTurn('turn-now', 'Turn back now to reach the start before dark.');
    } else {
      banner.classList.add('safety-caution');
      banner.textContent = `Turn back by ${clockFromNow(minsToTurn)} to reach the start before dark.`;
      setText('t-turnback', `by ${clockFromNow(minsToTurn)}`);
      maybeSpeakTurn('turn-soon', `Plan to turn back by ${clockFromNow(minsToTurn)} to reach the start before dark.`);
    }
  }

  function stopTracking() {
    if (gpsWatchId !== null) navigator.geolocation.clearWatch(gpsWatchId);
    gpsWatchId = null;
    isTracking = false;
    trackStartTime = null;
    lastGpsPosition = null;
    lastSpokenCategory = null;
    lastSpokenOffRoute = false;
    releaseWakeLock();
    stopSpeaking();
    HikerMap.clearGpsMarker();
    if (liveShareToken) stopLiveShare();
    document.getElementById('btn-track').classList.remove('active');
    document.getElementById('tracking-panel').classList.add('hidden');
    document.getElementById('t-turnback-banner').classList.add('hidden');
    document.getElementById('t-offroute-banner').classList.add('hidden');
  }

  let liveShareToken = null;
  let liveShareUrl = null;

  function checkinIsoFromInput() {
    const v = document.getElementById('checkin-time').value;
    if (!v) return null;
    const [hh, mm] = v.split(':').map(Number);
    if (isNaN(hh) || isNaN(mm)) return null;
    const now = new Date();
    const target = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hh, mm, 0);
    if (target.getTime() <= now.getTime()) target.setDate(target.getDate() + 1);
    return target.toISOString();
  }

  async function startLiveShare() {
    if (!isTracking) { alert('Start tracking first so HikerAid can share your live position.'); return; }
    const btn = document.getElementById('btn-live-share');
    btn.disabled = true;
    try {
      const res = await fetch('/api/track/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ routeName: routeData?.name || null, expectedReturn: checkinIsoFromInput() })
      });
      if (!res.ok) { showToast('Could not start live sharing'); btn.disabled = false; return; }
      const data = await res.json();
      liveShareToken = data.token;
      liveShareUrl = location.origin + data.url;
      btn.classList.add('hidden');
      document.getElementById('live-share-active').classList.remove('hidden');
      const hasCheckin = !!document.getElementById('checkin-time').value;
      document.getElementById('live-share-status').textContent = hasCheckin
        ? 'Live sharing on · friends auto-alerted if you are not back in time'
        : 'Live sharing on';
      if (lastGpsPosition) pingLive(lastGpsPosition.coords.latitude, lastGpsPosition.coords.longitude, lastGpsPosition.coords.accuracy || 0);
      try { await navigator.clipboard.writeText(liveShareUrl); showToast('Live link copied to clipboard'); } catch (e) {}
    } catch (e) {
      showToast('Could not start live sharing');
      btn.disabled = false;
    }
  }

  function pingLive(lat, lon, acc) {
    if (!liveShareToken) return;
    fetch(`/api/track/${liveShareToken}/ping`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ latitude: lat, longitude: lon, accuracy: acc || 0 })
    }).catch(() => {});
  }

  async function stopLiveShare() {
    const token = liveShareToken;
    liveShareToken = null;
    liveShareUrl = null;
    document.getElementById('live-share-active').classList.add('hidden');
    const btn = document.getElementById('btn-live-share');
    btn.classList.remove('hidden');
    btn.disabled = false;
    if (token) {
      try { await fetch(`/api/track/${token}/stop`, { method: 'POST' }); } catch (e) {}
    }
  }

  document.getElementById('btn-live-share').addEventListener('click', startLiveShare);
  document.getElementById('btn-live-stop').addEventListener('click', () => { stopLiveShare(); showToast('Live sharing stopped'); });
  document.getElementById('btn-live-copy').addEventListener('click', async () => {
    if (!liveShareUrl) return;
    try { await navigator.clipboard.writeText(liveShareUrl); showToast('Live link copied'); }
    catch (e) { prompt('Live link:', liveShareUrl); }
  });

  let plannerActive = false;
  let plannerWaypoints = [];
  let plannerMarkers = [];
  let plannerRouteLayer = null;
  let plannerGpx = null;
  let plannerMode = 'hike';
  let plannerReqSeq = 0;

  document.getElementById('btn-plan').addEventListener('click', enterPlanner);
  document.getElementById('btn-planner-exit').addEventListener('click', () => { exitPlanner(); showScreen('upload'); });
  document.getElementById('btn-plan-undo').addEventListener('click', plannerUndo);
  document.getElementById('btn-plan-clear').addEventListener('click', plannerClear);
  document.getElementById('btn-plan-analyze').addEventListener('click', plannerAnalyze);
  document.querySelectorAll('input[name="planmode"]').forEach(r => {
    r.addEventListener('change', () => { plannerMode = r.value; refreshPlannedRoute(); });
  });

  function enterPlanner() {
    if (!validateBodyInputs()) return;
    plannerActive = true;
    plannerWaypoints = [];
    plannerMarkers = [];
    plannerGpx = null;
    if (plannerRouteLayer) { plannerRouteLayer.remove(); plannerRouteLayer = null; }
    routeData = null;
    currentGpxText = null;

    document.body.classList.add('planner-mode');
    document.getElementById('planner-panel').classList.remove('hidden');
    document.getElementById('route-name').textContent = 'Plan a route';
    hidePlannerError();
    updatePlannerStats();
    setText('planner-dist', '');

    showScreen('viewer');
    HikerMap.clearRoute();
    const map = HikerMap.getMap();
    if (!map) return;
    map.on('click', onPlannerClick);
    requestAnimationFrame(() => map.invalidateSize());
    try { map.getCenter(); } catch (e) { map.setView([20, 0], 2); }
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        pos => { if (plannerActive) map.setView([pos.coords.latitude, pos.coords.longitude], 14); },
        () => {},
        { enableHighAccuracy: false, timeout: 6000, maximumAge: 600000 }
      );
    }
  }

  function exitPlanner() {
    plannerActive = false;
    const map = HikerMap.getMap();
    if (map) map.off('click', onPlannerClick);
    plannerMarkers.forEach(m => m.remove());
    plannerMarkers = [];
    if (plannerRouteLayer) { plannerRouteLayer.remove(); plannerRouteLayer = null; }
    document.body.classList.remove('planner-mode');
    document.getElementById('planner-panel').classList.add('hidden');
  }

  function onPlannerClick(e) {
    if (!plannerActive) return;
    plannerWaypoints.push([e.latlng.lat, e.latlng.lng]);
    addPlannerMarker(e.latlng, plannerWaypoints.length);
    refreshPlannedRoute();
  }

  function addPlannerMarker(latlng, num) {
    const map = HikerMap.getMap();
    const m = L.marker(latlng, {
      icon: L.divIcon({ html: `<div class="plan-marker">${num}</div>`, className: '', iconSize: [22, 22], iconAnchor: [11, 11] }),
      zIndexOffset: 1000
    }).addTo(map);
    plannerMarkers.push(m);
  }

  function updatePlannerStats() {
    setText('planner-points', `${plannerWaypoints.length} point${plannerWaypoints.length === 1 ? '' : 's'}`);
  }

  async function refreshPlannedRoute() {
    updatePlannerStats();
    hidePlannerError();
    const map = HikerMap.getMap();
    if (plannerWaypoints.length < 2) {
      if (plannerRouteLayer) { plannerRouteLayer.remove(); plannerRouteLayer = null; }
      plannerGpx = null;
      setText('planner-dist', '');
      return;
    }
    const seq = ++plannerReqSeq;
    try {
      const res = await fetch('/api/route/plan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ points: plannerWaypoints, mode: plannerMode })
      });
      if (seq !== plannerReqSeq || !plannerActive) return;
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.gpx) { showPlannerError(data.error || 'Could not route those points.'); return; }
      plannerGpx = data.gpx;
      const latlngs = parseGpxLatLngs(data.gpx);
      if (latlngs.length < 2) { showPlannerError('Route had no usable points.'); return; }
      if (plannerRouteLayer) plannerRouteLayer.setLatLngs(latlngs);
      else plannerRouteLayer = L.polyline(latlngs, { color: '#E76F51', weight: 4, opacity: 0.9 }).addTo(map);
      let dist = 0;
      for (let i = 1; i < latlngs.length; i++) dist += haversine(latlngs[i - 1][0], latlngs[i - 1][1], latlngs[i][0], latlngs[i][1]);
      setText('planner-dist', `${(dist / 1000).toFixed(1)} km`);
    } catch (e) {
      if (seq === plannerReqSeq) showPlannerError('Routing service unreachable.');
    }
  }

  function parseGpxLatLngs(gpx) {
    const out = [];
    try {
      const doc = new DOMParser().parseFromString(gpx, 'application/xml');
      const pts = doc.getElementsByTagName('trkpt');
      for (let i = 0; i < pts.length; i++) {
        const lat = parseFloat(pts[i].getAttribute('lat'));
        const lon = parseFloat(pts[i].getAttribute('lon'));
        if (!isNaN(lat) && !isNaN(lon)) out.push([lat, lon]);
      }
    } catch (e) {}
    return out;
  }

  function plannerUndo() {
    if (plannerWaypoints.length === 0) return;
    plannerWaypoints.pop();
    const m = plannerMarkers.pop();
    if (m) m.remove();
    refreshPlannedRoute();
  }

  function plannerClear() {
    plannerWaypoints = [];
    plannerMarkers.forEach(m => m.remove());
    plannerMarkers = [];
    if (plannerRouteLayer) { plannerRouteLayer.remove(); plannerRouteLayer = null; }
    plannerGpx = null;
    refreshPlannedRoute();
  }

  async function plannerAnalyze() {
    if (!plannerGpx) { showPlannerError('Add at least 2 points to create a route first.'); return; }
    const gpx = plannerGpx;
    exitPlanner();
    currentGpxText = gpx;
    showScreen('loading');
    const form = new FormData();
    form.append('file', new Blob([gpx], { type: 'application/gpx+xml' }), 'planned.gpx');
    form.append('weight', weightInput.value || '70');
    form.append('height', document.getElementById('height-input').value || '170');
    form.append('pack', document.getElementById('pack-input').value || '0');
    form.append('fitness', document.getElementById('fitness-select').value || '3');
    appendPaceOverride(form);
    const st = currentStartTime();
    form.append('startHour', st.hour);
    form.append('startMinute', st.minute);
    try {
      const res = await fetch('/api/analyze', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) { showScreen('upload'); showError(data.error || 'Could not analyze the planned route.'); return; }
      routeData = data;
      document.getElementById('btn-download-gpx').classList.remove('hidden');
      renderViewer(data);
      showScreen('viewer');
    } catch (e) { showScreen('upload'); showError('Network error analyzing the route.'); }
  }

  function showPlannerError(msg) {
    const e = document.getElementById('planner-error');
    e.textContent = msg;
    e.classList.remove('hidden');
  }
  function hidePlannerError() {
    document.getElementById('planner-error').classList.add('hidden');
  }

  function setText(id, value) {
    const el = document.getElementById(id);
    if (el) el.textContent = value;
  }

  function formatTime(minutes) {
    if (minutes == null || minutes === '') return '—';
    const h = Math.floor(Math.abs(minutes) / 60);
    const m = Math.abs(minutes) % 60;
    return h > 0 ? `${h}h ${m.toString().padStart(2, '0')}m` : `${m}m`;
  }

  function showError(msg) {
    const el = document.getElementById('upload-error');
    el.textContent = msg;
    el.classList.remove('hidden');
  }

  function hideError() {
    document.getElementById('upload-error').classList.add('hidden');
  }

  function currentStartTime() {
    const now = new Date();
    return { hour: now.getHours(), minute: now.getMinutes() };
  }

  function haversine(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLon = (lon2 - lon1) * Math.PI / 180;
    const a = Math.sin(dLat/2)**2 + Math.cos(lat1*Math.PI/180) * Math.cos(lat2*Math.PI/180) * Math.sin(dLon/2)**2;
    return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
  }

  document.getElementById('btn-theme-floating')?.addEventListener('click', toggleTheme);
  document.getElementById('btn-theme-viewer')?.addEventListener('click', toggleTheme);

  if (!navigator.onLine) document.getElementById('offline-banner').classList.remove('hidden');

  HikerMap.init();
  applyTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark');
  checkAuth();
  updateSyncBadge();
  loadAiTip();

  const sharedMatch = location.pathname.match(/^\/route\/([A-Za-z0-9_-]+)$/);
  const liveMatch = location.pathname.match(/^\/live\/([A-Za-z0-9_-]+)$/);
  const cached = (sharedMatch || liveMatch) ? null : localStorage.getItem('hikerAid_lastRoute');
  if (sharedMatch) {
    loadSharedRoute(sharedMatch[1]);
  } else if (liveMatch) {
    loadLiveView(liveMatch[1]);
  }
  if (cached) {
    try {
      const data = JSON.parse(cached);
      const banner = document.createElement('div');
      banner.className = 'app-toast clickable';
      banner.textContent = `Load "${data.name || 'last route'}"`;
      banner.addEventListener('click', () => {
        banner.remove();
        routeData = data;
        renderViewer(data);
        showScreen('viewer');
      });
      document.body.appendChild(banner);
      setTimeout(() => banner.remove(), 6000);
    } catch (e) { localStorage.removeItem('hikerAid_lastRoute'); }
  }

  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js').catch(() => {});
    navigator.serviceWorker.addEventListener('message', e => {
      if (e.data?.type === 'SYNC_ACTIVITIES' && currentUser) syncPendingActivities();
    });
  }
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      if ((isTracking || isRecording) && !wakeLock) requestWakeLock();
      if (navigator.onLine && currentUser) syncPendingActivities();
    }
  });
})();
