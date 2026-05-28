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
  let recordSessionId = null;
  let recordPhotoCount = 0;

  // ── Offline Queue (IndexedDB) ───────────────────────────────────────
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
    } catch (e) { /* not supported - rely on online event */ }
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
    toast.className = 'app-toast';
    toast.textContent = msg;
    document.body.appendChild(toast);
    setTimeout(() => toast.remove(), 3000);
  }

  // ── Theme toggle ──────────────────────────────────────────────────────
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
    try { localStorage.setItem('hikerAid_theme', next); } catch (e) { /* ignore */ }
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
          document.getElementById('admin-badge').classList.remove('hidden');
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
      let activities = [];
      try {
        const res = await fetch('/api/activities');
        if (res.ok) activities = await res.json();
      } catch (e) { /* offline - rely on pending only */ }

      let pending = [];
      try { pending = await getAllPending(); } catch (e) { /* IndexedDB unavailable */ }

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
      routeData._activityId = id;
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
      // Bail if the user has switched to a different route since this fetch began
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
    } catch (e) { /* ignore */ }
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

  function showEmergencyFallback(lat, lon, accuracy, reason) {
    const msg = buildEmergencyMessage(lat, lon, accuracy);
    const mapsUrl = `https://maps.google.com/?q=${lat.toFixed(6)},${lon.toFixed(6)}`;
    document.getElementById('ef-sub').textContent = reason
      || 'Server unreachable. Send your location via your phone\'s SMS app instead.';
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
      const lat = pos.coords.latitude;
      const lon = pos.coords.longitude;
      const acc = pos.coords.accuracy || 0;

      if (!navigator.onLine) {
        showEmergencyFallback(lat, lon, acc, 'You are offline. Send your location via SMS instead.');
        btn.disabled = false;
        btn.querySelector('span').textContent = 'Emergency - Alert Friends';
        return;
      }

      try {
        const res = await fetch('/api/friends/emergency', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ latitude: lat, longitude: lon, accuracy: acc })
        });
        const data = await res.json();
        if (res.ok) {
          showToast(data.message);
        } else {
          showEmergencyFallback(lat, lon, acc, data.error || 'Server rejected the alert. Send via SMS instead.');
        }
      } catch (e) {
        showEmergencyFallback(lat, lon, acc, 'Could not reach the server. Send your location via SMS instead.');
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
  document.getElementById('btn-emergency-friends').addEventListener('click', sendEmergency);

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

  // ── Splits rendering ───────────────────────────────────────────────────
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

  function formatPace(minPerKm) {
    if (!minPerKm || minPerKm <= 0) return '—';
    const m = Math.floor(minPerKm);
    const s = Math.round((minPerKm - m) * 60);
    return `${m}:${String(s).padStart(2, '0')}/km`;
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

  // ── Photo capture ──────────────────────────────────────────────────────
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

  // ── Back button ────────────────────────────────────────────────────────
  document.getElementById('btn-back').addEventListener('click', () => {
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

  // ── 3D terrain (MapLibre) ──────────────────────────────────────────────
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
        css.href = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.css';
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
      script.src = 'https://unpkg.com/maplibre-gl@4.7.1/dist/maplibre-gl.js';
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
      map3d.addSource('route-line', {
        type: 'geojson',
        data: routeLineGeoJson(pts)
      });
      map3d.addLayer({
        id: 'route-line-layer',
        type: 'line',
        source: 'route-line',
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': '#E76F51', 'line-width': 4 }
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
      // Fit to bounds
      const bounds = new maplibregl.LngLatBounds();
      for (const p of pts) bounds.extend([p[1], p[0]]);
      map3d.fitBounds(bounds, { padding: 60, pitch: 60, bearing: 0, duration: 800 });
    });
    map3dLoaded = true;
  }

  function routeLineGeoJson(pts) {
    return {
      type: 'Feature',
      properties: {},
      geometry: {
        type: 'LineString',
        coordinates: pts.map(p => [p[1], p[0]])
      }
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
      document.getElementById('map3d').classList.remove('hidden');
      document.getElementById('gradient-legend').style.display = 'none';
      btn.classList.add('active');
      is3dMode = true;

      if (!map3d) init3dMap();
      else { update3dRoute(); setTimeout(() => map3d.resize(), 50); }
    } else {
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

  // ── Offline tile downloader ────────────────────────────────────────────
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

    // Storage quota check
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
    const updateProgress = () => {
      const pct = Math.round(completed / total * 100);
      fillEl.style.width = pct + '%';
      textEl.textContent = `${completed} / ${total} tiles (${pct}%)`;
    };
    updateProgress();

    // Worker pool
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
        if (completed % 5 === 0 || completed === total) updateProgress();
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

  // Refresh cache info on any layer-panel button click (cheap)
  document.getElementById('btn-layers').addEventListener('click', () => {
    setTimeout(refreshTileCacheInfo, 0);
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
        document.getElementById('btn-ai').classList.remove('hidden');
      }
    } catch (e) { /* offline */ }
  }

  // ── Route playback ─────────────────────────────────────────────────────
  let playbackRaf = null;
  let playbackStart = 0;
  let playbackElapsedAtStart = 0;
  let playbackPos = 0; // 0..1
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

  // ── Splits panel ───────────────────────────────────────────────────────
  document.getElementById('btn-splits').addEventListener('click', () => {
    document.getElementById('splits-panel').classList.toggle('hidden');
  });
  document.getElementById('btn-close-splits').addEventListener('click', () => {
    document.getElementById('splits-panel').classList.add('hidden');
  });

  // ── Weather panel ──────────────────────────────────────────────────────
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

  // ── Theme toggle wiring ──────────────────────────────────────────────
  document.getElementById('btn-theme-floating')?.addEventListener('click', toggleTheme);
  document.getElementById('btn-theme-viewer')?.addEventListener('click', toggleTheme);

  // ── Init ───────────────────────────────────────────────────────────────
  if (!navigator.onLine) document.getElementById('offline-banner').classList.remove('hidden');

  HikerMap.init();
  applyTheme(document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark');
  checkAuth();
  updateSyncBadge();
  loadAiTip();

  const cached = localStorage.getItem('hikerAid_lastRoute');
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
  // Poll fallback: when document becomes visible (iOS lacks background sync)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible' && navigator.onLine && currentUser) {
      syncPendingActivities();
    }
  });
})();
