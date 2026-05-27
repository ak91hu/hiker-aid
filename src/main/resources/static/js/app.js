/* HikerAid — Main application controller */

(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────────────────────
  let routeData = null;
  let currentGpxText = null;
  let currentUser = null;
  let gpsWatchId = null;
  let isTracking = false;
  let elevationCollapsed = false;
  let lastGpsPosition = null;

  // Recording state
  let isRecording = false;
  let recordedPoints = [];
  let recordTotalDistM = 0;
  let recordStartTime = null;
  let recordWatchId = null;
  let recordPolyline = null;
  let recordInterval = null;

  // ── Offline Queue (IndexedDB) ───────────────────────────────────────
  const DB_NAME = 'hikerAidOffline';
  const STORE_NAME = 'pendingActivities';

  function openDB() {
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        if (!req.result.objectStoreNames.contains(STORE_NAME)) {
          req.result.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
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
    } catch (e) { /* IndexedDB unavailable */ }
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
    toast.style.cssText = 'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);background:#1e2d1e;border:1px solid rgba(116,198,157,0.3);border-radius:10px;padding:10px 16px;font-size:0.8rem;color:#74C69D;z-index:9999;white-space:nowrap;box-shadow:0 4px 20px rgba(0,0,0,0.5)';
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }

  // ── DOM refs ──────────────────────────────────────────────────────────
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

  // ── Auth ───────────────────────────────────────────────────────────────
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
          const badge = document.getElementById('admin-badge');
          badge.classList.remove('hidden');
          badge.addEventListener('click', () => { window.location.href = '/admin'; });
        }
        document.getElementById('btn-save-activity').classList.remove('hidden');
        document.getElementById('user-content').classList.remove('hidden');
        loadActivities();
        loadUserStats();
        loadFriends();
        updateSyncBadge();
        if (navigator.onLine) syncPendingActivities();
      }
    } catch (e) { /* offline or error — ignore */ }
  }

  // ── Activities ─────────────────────────────────────────────────────────
  async function loadActivities() {
    try {
      const res = await fetch('/api/activities');
      if (!res.ok) return;
      const activities = await res.json();
      const list = document.getElementById('activities-list');

      if (activities.length === 0) {
        list.innerHTML = '<p class="uc-empty">No activities yet. Upload or record a hike to get started.</p>';
        return;
      }

      list.innerHTML = '';
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
        const delBtn = document.createElement('button');
        delBtn.className = 'activity-delete-btn';
        delBtn.textContent = 'Delete';
        delBtn.addEventListener('click', () => deleteActivity(a.id));
        actions.append(viewBtn, delBtn);

        card.append(mainRow, statsRow, actions);
        list.appendChild(card);
      }
    } catch (e) { /* ignore */ }
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
      form.append('fitness', document.getElementById('fitness-select').value || '3');
      const st2 = currentStartTime();
      form.append('startHour', st2.hour);
      form.append('startMinute', st2.minute);

      const analyzeRes = await fetch('/api/analyze', { method: 'POST', body: form });
      const data = await analyzeRes.json();

      if (!analyzeRes.ok) { showScreen('upload'); return; }

      currentGpxText = activity.gpxData;
      routeData = data;
      renderViewer(data);
      showScreen('viewer');
    } catch (e) {
      showScreen('upload');
    }
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
    } catch (e) { /* ignore */ }
  }

  async function deleteActivity(id) {
    if (!confirm('Delete this activity?')) return;
    try {
      await fetch(`/api/activities/${id}`, { method: 'DELETE' });
      loadActivities();
    } catch (e) { /* ignore */ }
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
        saveBtn.textContent = 'Saved';
        saveBtn.disabled = true;
        setTimeout(() => { saveBtn.innerHTML = saveBtn.dataset.originalHtml; saveBtn.disabled = false; }, 2000);
      } else {
        await addPending(activityData);
        await updateSyncBadge();
        saveBtn.textContent = 'Saved offline';
        saveBtn.disabled = true;
        setTimeout(() => { saveBtn.innerHTML = saveBtn.dataset.originalHtml; saveBtn.disabled = false; }, 2000);
      }
    } catch (e) {
      await addPending(activityData);
      await updateSyncBadge();
      saveBtn.textContent = 'Saved offline';
      saveBtn.disabled = true;
      setTimeout(() => { saveBtn.innerHTML = saveBtn.dataset.originalHtml; saveBtn.disabled = false; }, 2000);
    }
  }

  // ── Friends ────────────────────────────────────────────────────────────
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
          invitesList.appendChild(card);
        }
      } else {
        invitesSection.classList.add('hidden');
      }

      updateEmergencyButton();
    } catch (e) { /* ignore */ }
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
    } catch (e) { /* ignore */ }
  }

  async function removeFriend(id) {
    if (!confirm('Remove this friend?')) return;
    try {
      await fetch(`/api/friends/${id}`, { method: 'DELETE' });
      loadFriends();
    } catch (e) { /* ignore */ }
  }

  function updateEmergencyButton() {
    const btn = document.getElementById('btn-emergency');
    if (hasFriends && currentUser) {
      btn.classList.remove('hidden');
    } else {
      btn.classList.add('hidden');
    }
  }

  async function sendEmergency() {
    if (!confirm('Send an EMERGENCY alert with your current location to ALL your hiking friends?')) return;

    if (!('geolocation' in navigator)) {
      alert('Geolocation is not available.');
      return;
    }

    const btn = document.getElementById('btn-emergency');
    btn.disabled = true;

    async function doSend(pos) {
      btn.querySelector('span').textContent = 'Sending alerts...';
      try {
        const res = await fetch('/api/friends/emergency', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            latitude: pos.coords.latitude,
            longitude: pos.coords.longitude,
            accuracy: pos.coords.accuracy || 0
          })
        });
        const data = await res.json();
        if (res.ok) {
          showToast(data.message);
        } else {
          alert(data.error || 'Failed to send alerts');
        }
      } catch (e) {
        alert('Network error - could not send emergency alert');
      }
      btn.disabled = false;
      btn.querySelector('span').textContent = 'Emergency - Alert Friends';
    }

    if (lastGpsPosition && (Date.now() - lastGpsPosition.timestamp) < 30000) {
      await doSend(lastGpsPosition);
    } else {
      btn.querySelector('span').textContent = 'Getting location...';
      navigator.geolocation.getCurrentPosition(
        async (pos) => { await doSend(pos); },
        (err) => {
          alert('Could not get your location: ' + err.message);
          btn.disabled = false;
          btn.querySelector('span').textContent = 'Emergency - Alert Friends';
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

  // ── User content tabs ─────────────────────────────────────────────────
  document.querySelectorAll('.uc-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.uc-tab').forEach(t => t.classList.remove('active'));
      document.querySelectorAll('.uc-panel').forEach(p => p.classList.remove('active'));
      tab.classList.add('active');
      document.getElementById('uc-' + tab.dataset.uc).classList.add('active');
    });
  });

  // ── File upload ────────────────────────────────────────────────────────
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
    return true;
  }

  async function uploadFile(file) {
    showScreen('loading');

    currentGpxText = await file.text();

    const weight = parseFloat(weightInput.value) || 70;
    const height = parseFloat(document.getElementById('height-input').value) || 170;
    const fitness = document.getElementById('fitness-select').value || '3';
    const st = currentStartTime();
    const startHour = st.hour;
    const startMinute = st.minute;

    const form = new FormData();
    form.append('file', file);
    form.append('weight', weight);
    form.append('height', height);
    form.append('fitness', fitness);
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
      } catch (e) { /* quota exceeded */ }

    } catch (err) {
      showScreen('upload');
      showError('Network error — check your connection and try again');
    }
  }

  // ── Viewer rendering ───────────────────────────────────────────────────
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

  // ── Safety rendering ────────────────────────────────────────────────────
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

  // ── Recording ──────────────────────────────────────────────────────────
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
    form.append('fitness', document.getElementById('fitness-select').value || '3');
    const st3 = currentStartTime();
    form.append('startHour', st3.hour);
    form.append('startMinute', st3.minute);

    try {
      const res = await fetch('/api/analyze', { method: 'POST', body: form });
      const data = await res.json();
      if (!res.ok) { showScreen('upload'); return; }

      routeData = data;
      if (recordPolyline) { recordPolyline.remove(); recordPolyline = null; }
      document.getElementById('btn-download-gpx').classList.remove('hidden');
      renderViewer(data);
      showScreen('viewer');
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
    recordedPoints = [];
    showScreen('upload');
  }

  // ── Back button ────────────────────────────────────────────────────────
  document.getElementById('btn-back').addEventListener('click', () => {
    stopTracking();
    if (recordPolyline) { recordPolyline.remove(); recordPolyline = null; }
    document.getElementById('recording-overlay').classList.add('hidden');
    document.getElementById('rec-complete').classList.add('hidden');
    document.getElementById('btn-download-gpx').classList.add('hidden');
    showScreen('upload');
  });

  // ── Save activity ─────────────────────────────────────────────────────
  const saveBtn = document.getElementById('btn-save-activity');
  saveBtn.dataset.originalHtml = saveBtn.innerHTML;
  saveBtn.addEventListener('click', saveActivity);

  // ── Sync ───────────────────────────────────────────────────────────────
  document.getElementById('btn-sync').addEventListener('click', syncPendingActivities);

  window.addEventListener('online', () => {
    document.getElementById('offline-banner').classList.add('hidden');
    if (currentUser) syncPendingActivities();
  });
  window.addEventListener('offline', () => {
    document.getElementById('offline-banner').classList.remove('hidden');
  });

  // ── Download GPX ──────────────────────────────────────────────────────
  document.getElementById('btn-download-gpx').addEventListener('click', downloadRecordedGpx);

  // ── Elevation panel toggle ─────────────────────────────────────────────
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

  // ── Layer switcher ─────────────────────────────────────────────────────
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

  // ── AI Tip (homepage) ──────────────────────────────────────────────────
  async function loadAiTip() {
    try {
      const res = await fetch('/api/ai-tip');
      const data = await res.json();
      const card = document.getElementById('ai-tip-card');
      if (data.available && data.tip) {
        document.getElementById('ai-tip-text').textContent = data.tip;
        card.classList.remove('hidden');
      } else if (data.available === false) {
        const msg = data.reason === 'no-key'
          ? 'AI tips require a Gemini API key. Set GEMINI_API_KEY to enable.'
          : 'AI tips temporarily unavailable. Please try again later.';
        document.getElementById('ai-tip-text').textContent = msg;
        card.classList.remove('hidden');
      }
    } catch (e) { /* offline */ }
  }

  // ── AI Analysis ────────────────────────────────────────────────────────
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

  // ── Export / download ──────────────────────────────────────────────────
  document.getElementById('btn-export').addEventListener('click', exportSummary);

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
      lines.push('--- Safety Analysis ---');
      lines.push(`Fitness:        ${sf.fitnessLabel} (${sf.paceFactor}x pace)`);
      lines.push(`Sunset:         ~${sf.sunsetEstimate}`);
      lines.push(`Daylight margin: ${sf.marginMinutes >= 0 ? '+' : ''}${formatTime(Math.abs(sf.marginMinutes))}${sf.marginMinutes < 0 ? ' (INSUFFICIENT)' : ''}`);
      lines.push(`Turn back at:   ${sf.turnaroundDistanceKm} km`);
      lines.push(`Point of no return: ${sf.pointOfNoReturnKm} km`);
    }
    lines.push('', 'Analysed by HikerAid');

    const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `${(routeData.name || 'route').replace(/[^a-z0-9]/gi, '_')}_summary.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  // ── GPS Live Tracking ──────────────────────────────────────────────────
  document.getElementById('btn-track').addEventListener('click', toggleTracking);
  document.getElementById('btn-stop-track').addEventListener('click', stopTracking);

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
    document.getElementById('btn-track').classList.add('active');
    document.getElementById('tracking-panel').classList.remove('hidden');

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
  }

  function stopTracking() {
    if (gpsWatchId !== null) navigator.geolocation.clearWatch(gpsWatchId);
    gpsWatchId = null;
    isTracking = false;
    lastGpsPosition = null;
    HikerMap.clearGpsMarker();
    document.getElementById('btn-track').classList.remove('active');
    document.getElementById('tracking-panel').classList.add('hidden');
  }

  // ── Helpers ────────────────────────────────────────────────────────────
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

  // ── Init ───────────────────────────────────────────────────────────────
  if (!navigator.onLine) document.getElementById('offline-banner').classList.remove('hidden');

  HikerMap.init();
  checkAuth();
  updateSyncBadge();
  loadAiTip();

  const cached = localStorage.getItem('hikerAid_lastRoute');
  if (cached) {
    try {
      const data = JSON.parse(cached);
      const banner = document.createElement('div');
      banner.style.cssText = 'position:fixed;bottom:16px;left:50%;transform:translateX(-50%);background:#1e2d1e;border:1px solid rgba(116,198,157,0.3);border-radius:10px;padding:10px 16px;font-size:0.8rem;color:#74C69D;cursor:pointer;z-index:9999;white-space:nowrap;box-shadow:0 4px 20px rgba(0,0,0,0.5)';
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
  }
})();
