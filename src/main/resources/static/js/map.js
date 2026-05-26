/* HikerAid — Leaflet map module */

const HikerMap = (() => {
  let map, gradientLayer, waypointLayer, gpsMarker, routeOutline;
  let trackPoints = [];

  const tileLayers = {
    osm: L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>',
      maxZoom: 19
    }),
    topo: L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
      attribution: '© <a href="https://opentopomap.org">OpenTopoMap</a>',
      maxZoom: 17
    }),
    satellite: L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
      attribution: '© Esri',
      maxZoom: 19
    }),
    dark: L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
      attribution: '© <a href="https://carto.com/">CARTO</a>',
      maxZoom: 19
    })
  };

  let currentLayer = 'osm';

  function gradientColor(pct) {
    if (pct < -15) return '#0077B6';
    if (pct < -8)  return '#00B4D8';
    if (pct < -2)  return '#90E0EF';
    if (pct <  2)  return '#74C69D';
    if (pct <  8)  return '#B7E4C7';
    if (pct < 15)  return '#F9C74F';
    if (pct < 25)  return '#F4A261';
    return '#E76F51';
  }

  function waypointIcon(symbol) {
    const icons = {
      'Summit':    '⛰',
      'Waypoint':  '📍',
      'Water':     '💧',
      'Shelter':   '🏕',
      'Parking':   '🅿',
      'Trailhead': '🥾',
      'Campsite':  '⛺',
      'Viewpoint': '👁',
      'Caution':   '⚠',
      'Food':      '🍽',
    };
    const char = icons[symbol] || '📍';
    return L.divIcon({
      html: `<div style="font-size:20px;line-height:1;text-shadow:0 1px 3px #000">${char}</div>`,
      className: '',
      iconSize: [24, 24],
      iconAnchor: [12, 12],
      popupAnchor: [0, -14]
    });
  }

  function init() {
    map = L.map('map', {
      zoomControl: true,
      attributionControl: true,
      renderer: L.canvas({ padding: 0.5 }) // canvas renderer — much faster for many polylines
    });

    tileLayers.osm.addTo(map);

    gradientLayer = L.layerGroup().addTo(map);
    waypointLayer = L.layerGroup().addTo(map);
  }

  function renderRoute(result) {
    gradientLayer.clearLayers();
    waypointLayer.clearLayers();

    trackPoints = result.trackPoints;

    // Draw thin route outline for non-coloured fallback
    if (result.trackPoints.length > 1) {
      routeOutline = L.polyline(result.trackPoints, {
        color: 'rgba(0,0,0,0.3)',
        weight: 6,
        lineCap: 'round',
        lineJoin: 'round',
        interactive: false
      }).addTo(gradientLayer);
    }

    // Draw gradient-coloured segments
    if (result.gradientSegments && result.gradientSegments.length > 0) {
      result.gradientSegments.forEach(seg => {
        const [lat1, lon1, lat2, lon2, gradient] = seg;
        L.polyline([[lat1, lon1], [lat2, lon2]], {
          color: gradientColor(gradient),
          weight: 4,
          lineCap: 'round',
          lineJoin: 'round',
          interactive: false
        }).addTo(gradientLayer);
      });
    }

    // Start / end markers
    if (result.trackPoints.length > 0) {
      const start = result.trackPoints[0];
      const end   = result.trackPoints[result.trackPoints.length - 1];

      L.marker(start, {
        icon: L.divIcon({
          html: '<div style="background:#52b788;color:#fff;border-radius:50%;width:22px;height:22px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;border:2px solid #fff;box-shadow:0 2px 6px #000">S</div>',
          className: '', iconSize: [22, 22], iconAnchor: [11, 11]
        })
      }).bindPopup('<strong>Start</strong>').addTo(waypointLayer);

      L.marker(end, {
        icon: L.divIcon({
          html: '<div style="background:#e76f51;color:#fff;border-radius:50%;width:22px;height:22px;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:700;border:2px solid #fff;box-shadow:0 2px 6px #000">F</div>',
          className: '', iconSize: [22, 22], iconAnchor: [11, 11]
        })
      }).bindPopup('<strong>Finish</strong>').addTo(waypointLayer);
    }

    // Waypoint markers
    if (result.waypoints) {
      result.waypoints.forEach(wpt => {
        if (!wpt.name && !wpt.description) return;
        const popup = document.createElement('div');
        const nameDiv = document.createElement('div');
        nameDiv.className = 'waypoint-popup-name';
        nameDiv.textContent = wpt.name || 'Waypoint';
        popup.appendChild(nameDiv);
        if (wpt.description) {
          const descDiv = document.createElement('div');
          descDiv.className = 'waypoint-popup-desc';
          descDiv.textContent = wpt.description;
          popup.appendChild(descDiv);
        }
        if (wpt.symbol) {
          const symDiv = document.createElement('div');
          symDiv.style.cssText = 'font-size:0.7rem;color:#8aab8a;margin-top:2px';
          symDiv.textContent = wpt.symbol;
          popup.appendChild(symDiv);
        }
        L.marker([wpt.lat, wpt.lon], { icon: waypointIcon(wpt.symbol) })
          .bindPopup(popup)
          .addTo(waypointLayer);
      });
    }

    fitBounds();
  }

  function fitBounds() {
    if (trackPoints.length === 0) return;
    try {
      map.fitBounds(L.latLngBounds(trackPoints), { padding: [24, 24], maxZoom: 16 });
    } catch (e) { /* empty bounds */ }
  }

  function setLayer(name) {
    if (!tileLayers[name] || name === currentLayer) return;
    tileLayers[currentLayer].remove();
    tileLayers[name].addTo(map);
    map.getPane('tilePane').style.zIndex = 200;
    currentLayer = name;
  }

  // Highlight a position on the map given a track point index
  function showPositionAtIndex(idx) {
    const pt = trackPoints[idx];
    if (!pt) return;
    if (!gpsMarker) {
      gpsMarker = L.marker(pt, {
        icon: L.divIcon({ html: '<div class="gps-marker"></div>', className: '', iconSize: [18, 18], iconAnchor: [9, 9] }),
        zIndexOffset: 1000
      }).addTo(map);
    } else {
      gpsMarker.setLatLng(pt);
    }
  }

  // Live GPS tracking
  function updateGpsPosition(lat, lon) {
    const latlng = [lat, lon];
    if (!gpsMarker) {
      gpsMarker = L.marker(latlng, {
        icon: L.divIcon({ html: '<div class="gps-marker"></div>', className: '', iconSize: [18, 18], iconAnchor: [9, 9] }),
        zIndexOffset: 1000
      }).addTo(map);
    } else {
      gpsMarker.setLatLng(latlng);
    }
    map.panTo(latlng, { animate: true, duration: 0.5 });
  }

  function clearGpsMarker() {
    if (gpsMarker) { gpsMarker.remove(); gpsMarker = null; }
  }

  // Find nearest track point index to given lat/lon (simple O(n) scan)
  function nearestPointIndex(lat, lon) {
    let best = 0, bestDist = Infinity;
    for (let i = 0; i < trackPoints.length; i++) {
      const dlat = trackPoints[i][0] - lat;
      const dlon = trackPoints[i][1] - lon;
      const d = dlat * dlat + dlon * dlon;
      if (d < bestDist) { bestDist = d; best = i; }
    }
    return best;
  }

  let safetyLayer;

  function showSafetyMarkers(pts, safety) {
    if (!safetyLayer) safetyLayer = L.layerGroup().addTo(map);
    safetyLayer.clearLayers();

    if (!safety || !pts || pts.length === 0) return;

    const turnaroundPt = pts[safety.turnaroundTrackIndex];
    if (turnaroundPt && safety.turnaroundTrackIndex > 0 && safety.turnaroundTrackIndex < pts.length - 1) {
      L.marker(turnaroundPt, {
        icon: L.divIcon({
          html: '<div style="background:#F9C74F;color:#000;border-radius:4px;width:24px;height:24px;display:flex;align-items:center;justify-content:center;font-size:13px;font-weight:700;border:2px solid #fff;box-shadow:0 2px 6px #000">&#8617;</div>',
          className: '', iconSize: [24, 24], iconAnchor: [12, 12]
        }),
        zIndexOffset: 900
      }).bindPopup(`<strong>Turnaround point</strong><br>${safety.turnaroundDistanceKm} km from start`).addTo(safetyLayer);
    }

    const pnrPt = pts[safety.pointOfNoReturnTrackIndex];
    if (pnrPt && safety.pointOfNoReturnTrackIndex > 0 && safety.pointOfNoReturnTrackIndex < pts.length - 1) {
      L.marker(pnrPt, {
        icon: L.divIcon({
          html: '<div style="background:#E76F51;color:#fff;border-radius:50%;width:22px;height:22px;display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:700;border:2px solid #fff;box-shadow:0 2px 6px #000">!</div>',
          className: '', iconSize: [22, 22], iconAnchor: [11, 11]
        }),
        zIndexOffset: 800
      }).bindPopup(`<strong>Point of no return</strong><br>${safety.pointOfNoReturnKm} km — faster to finish than go back`).addTo(safetyLayer);
    }
  }

  function getTrackPoints() { return trackPoints; }
  function getMap() { return map; }

  return { init, renderRoute, setLayer, updateGpsPosition, clearGpsMarker,
           nearestPointIndex, showPositionAtIndex, showSafetyMarkers, getTrackPoints, getMap };
})();
