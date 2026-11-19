/* SafeWatch: child-safety awareness using public sex-offender registry data.
 *
 * Data sources:
 *  - "demo": fictional records generated from map coordinates so the app can be
 *    tried anywhere without showing real people. Clearly labeled everywhere.
 *  - "csv":  records the user loads from an official registry export or a licensed
 *            provider. Kept only in this browser (localStorage).
 *
 * The app intentionally does NOT track anyone's live location, accept
 * user-submitted "suspects", or let users publish or share records.
 */
(() => {
  'use strict';

  const MI_PER_DEG_LAT = 69.0;
  const store = {
    get(k, d) { try { const v = localStorage.getItem('sw.' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
    set(k, v) { try { localStorage.setItem('sw.' + k, JSON.stringify(v)); } catch { /* storage unavailable */ } },
  };
  const $ = (s) => document.querySelector(s);
  const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function distanceMi(a, b) {
    const R = 3958.8, toRad = (d) => d * Math.PI / 180;
    const dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  /* ---------- Data providers ---------- */
  function seeded(seed) { // mulberry32
    return () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed);
      t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
  }
  const DEMO_OFFENSES = ['Demo offense category A', 'Demo offense category B', 'Demo offense category C'];
  const CELL = 0.02; // degrees

  const demoProvider = {
    label: 'Demo data',
    near(center, radiusMi) {
      const dLat = radiusMi / MI_PER_DEG_LAT;
      const dLng = radiusMi / (MI_PER_DEG_LAT * Math.cos(center.lat * Math.PI / 180));
      const out = [];
      for (let ci = Math.floor((center.lat - dLat) / CELL); ci <= Math.floor((center.lat + dLat) / CELL); ci++) {
        for (let cj = Math.floor((center.lng - dLng) / CELL); cj <= Math.floor((center.lng + dLng) / CELL); cj++) {
          const rnd = seeded(ci * 73856093 ^ cj * 19349663);
          const n = Math.floor(rnd() * 3);
          for (let k = 0; k < n; k++) {
            const r = { id: `demo-${ci}-${cj}-${k}`, lat: (ci + rnd()) * CELL, lng: (cj + rnd()) * CELL,
              name: `DEMO RECORD ${Math.abs(ci * 31 + cj * 17 + k) % 9000 + 1000}`,
              address: 'Fictional location, not a real person',
              offense: DEMO_OFFENSES[Math.floor(rnd() * 3)], tier: 1 + Math.floor(rnd() * 3),
              registry_url: 'https://www.nsopw.gov/', last_verified: 'n/a (demo)', demo: true };
            if (distanceMi(center, r) <= radiusMi) out.push(r);
          }
        }
      }
      return out;
    },
  };

  const csvProvider = {
    label: 'Loaded registry file',
    records: store.get('records', []),
    near(center, radiusMi) { return this.records.filter((r) => distanceMi(center, r) <= radiusMi); },
  };

  let provider = store.get('source', 'demo') === 'csv' && csvProvider.records.length ? csvProvider : demoProvider;

  function parseCSV(text) {
    const rows = []; let row = [], field = '', q = false;
    for (let i = 0; i < text.length; i++) {
      const c = text[i];
      if (q) { if (c === '"' && text[i + 1] === '"') { field += '"'; i++; } else if (c === '"') q = false; else field += c; }
      else if (c === '"') q = true;
      else if (c === ',') { row.push(field); field = ''; }
      else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(field); rows.push(row); row = []; field = ''; }
      else field += c;
    }
    if (field || row.length) { row.push(field); rows.push(row); }
    const head = rows.shift().map((h) => h.trim().toLowerCase());
    return rows.filter((r) => r.length > 1).map((r, i) => {
      const o = Object.fromEntries(head.map((h, j) => [h, (r[j] ?? '').trim()]));
      o.lat = parseFloat(o.lat); o.lng = parseFloat(o.lng); o.id = o.id || `row-${i}`;
      return o;
    }).filter((o) => Number.isFinite(o.lat) && Number.isFinite(o.lng));
  }

  /* ---------- Geocoding (OpenStreetMap Nominatim) ---------- */
  async function geocode(q) {
    const url = 'https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=' + encodeURIComponent(q);
    const res = await fetch(url, { headers: { Accept: 'application/json' } });
    if (!res.ok) throw new Error('Address lookup failed');
    const [hit] = await res.json();
    if (!hit) throw new Error('Address not found');
    return { lat: +hit.lat, lng: +hit.lon, label: hit.display_name };
  }

  /* ---------- Tabs ---------- */
  document.querySelectorAll('.tabs button').forEach((b) => b.addEventListener('click', () => {
    document.querySelectorAll('.tabs button').forEach((x) => x.setAttribute('aria-selected', x === b));
    document.querySelectorAll('.panel').forEach((p) => p.classList.toggle('active', p.id === 'tab-' + b.dataset.tab));
    if (b.dataset.tab === 'map') setTimeout(() => map.invalidateSize(), 0);
  }));

  /* ---------- Consent ---------- */
  if (!store.get('consent', false)) $('#consent').hidden = false;
  $('#consent-ok').addEventListener('click', () => { store.set('consent', true); $('#consent').hidden = true; });

  /* ---------- Map ---------- */
  let center = store.get('center', { lat: 39.8283, lng: -98.5795 });
  const map = L.map('map').setView([center.lat, center.lng], store.get('center', null) ? 14 : 4);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    maxZoom: 19, attribution: '&copy; OpenStreetMap contributors' }).addTo(map);
  const layer = L.layerGroup().addTo(map);

  function updateNotice() {
    $('#data-notice').innerHTML = provider === demoProvider
      ? '<strong>Demo mode:</strong> records are fictional and generated for testing. For real information, use the <a href="https://www.nsopw.gov/" target="_blank" rel="noopener">official NSOPW registry</a> or load an official export in the Data tab.'
      : `<strong>Source:</strong> registry file you loaded (${csvProvider.records.length} records). Confirm every record on the official registry before acting on it.`;
  }

  function recordCard(r, ctr) {
    const d = distanceMi(ctr, r).toFixed(2);
    return `<h3>${esc(r.name)} ${r.demo ? '<span class="badge">demo</span>' : ''}</h3>
      <p class="small">${esc(r.address)}</p>
      <p class="small">${esc(r.offense)}${r.tier ? ` · Tier ${esc(r.tier)}` : ''} · ${d} mi away</p>
      <p class="small muted">Last verified: ${esc(r.last_verified || 'unknown')}</p>
      <p class="small"><a href="${esc(r.registry_url || 'https://www.nsopw.gov/')}" target="_blank" rel="noopener">Verify on official registry</a></p>`;
  }

  function render() {
    const radius = +$('#radius').value;
    const recs = provider.near(center, radius).sort((a, b) => distanceMi(center, a) - distanceMi(center, b));
    layer.clearLayers();
    L.circle([center.lat, center.lng], { radius: radius * 1609.34, color: '#1f5fbf', weight: 1, fillOpacity: 0.06 }).addTo(layer);
    L.circleMarker([center.lat, center.lng], { radius: 6, color: '#1f5fbf', fillOpacity: 1 }).addTo(layer).bindPopup('Search location');
    for (const z of store.get('zones', [])) {
      L.circle([z.lat, z.lng], { radius: z.radius * 1609.34, color: '#2a9d8f', weight: 1, dashArray: '4', fillOpacity: 0.04 })
        .addTo(layer).bindTooltip(z.name);
    }
    recs.forEach((r) => L.circleMarker([r.lat, r.lng], { radius: 7, color: '#c0262d', fillOpacity: 0.8 })
      .addTo(layer).bindPopup(recordCard(r, center)));
    $('#result-count').textContent = `${recs.length} record${recs.length === 1 ? '' : 's'} within ${radius} mi`;
    $('#results').innerHTML = recs.map((r) => `<li class="card">${recordCard(r, center)}</li>`).join('');
    updateNotice();
  }

  function setCenter(c, zoom = 14) {
    center = { lat: c.lat, lng: c.lng }; store.set('center', center);
    map.setView([center.lat, center.lng], zoom); render();
  }

  $('#search').addEventListener('submit', async (e) => {
    e.preventDefault();
    const q = $('#search-input').value.trim(); if (!q) return;
    try { setCenter(await geocode(q)); } catch (err) { alert(err.message); }
  });
  $('#locate').addEventListener('click', () => {
    if (!navigator.geolocation) return alert('Location is not available in this browser.');
    navigator.geolocation.getCurrentPosition((p) => setCenter({ lat: p.coords.latitude, lng: p.coords.longitude }),
      () => alert('Could not get your location.'));
  });
  $('#radius').addEventListener('change', render);
  map.on('click', (e) => setCenter(e.latlng, map.getZoom()));

  /* ---------- Watch zones ---------- */
  function renderZones(results = {}) {
    const zones = store.get('zones', []);
    $('#zone-list').innerHTML = zones.length ? zones.map((z) => {
      const r = results[z.id];
      const status = r ? `${r.total} record${r.total === 1 ? '' : 's'} in zone${r.fresh.length ? ` · <span class="badge new">${r.fresh.length} new</span>` : ''}` : '';
      const fresh = r && r.fresh.length ? `<ul class="small">${r.fresh.map((x) => `<li>${esc(x.name)} (${distanceMi(z, x).toFixed(2)} mi)</li>`).join('')}</ul>` : '';
      return `<li class="card"><h3>${esc(z.name)}</h3><p class="small muted">${esc(z.addr)} · ${z.radius} mi</p>
        <p class="small">${status}</p>${fresh}
        <div class="row"><button class="secondary" data-view="${z.id}">View on map</button>
        <button class="secondary" data-del="${z.id}">Remove</button></div></li>`;
    }).join('') : '<li class="muted">No zones yet.</li>';
  }

  function checkZones({ notify = false } = {}) {
    const zones = store.get('zones', []); const results = {};
    for (const z of zones) {
      const recs = provider.near(z, z.radius);
      const seen = new Set(z.seen || []);
      const fresh = z.seen ? recs.filter((r) => !seen.has(r.id)) : [];
      z.seen = recs.map((r) => r.id);
      results[z.id] = { total: recs.length, fresh };
      if (notify && fresh.length && 'Notification' in window && Notification.permission === 'granted') {
        new Notification('SafeWatch', { body: `${fresh.length} new registry record(s) near ${z.name}. Verify on the official registry.` });
      }
    }
    store.set('zones', zones); store.set('lastCheck', Date.now());
    renderZones(results);
  }

  $('#zone-form').addEventListener('submit', async (e) => {
    e.preventDefault();
    try {
      const g = await geocode($('#zone-addr').value.trim());
      const zones = store.get('zones', []);
      zones.push({ id: 'z' + Date.now(), name: $('#zone-name').value.trim(), addr: $('#zone-addr').value.trim(),
        lat: g.lat, lng: g.lng, radius: +$('#zone-radius').value });
      store.set('zones', zones); e.target.reset(); checkZones(); render();
    } catch (err) { alert(err.message); }
  });
  $('#zone-list').addEventListener('click', (e) => {
    const zones = store.get('zones', []);
    if (e.target.dataset.del) { store.set('zones', zones.filter((z) => z.id !== e.target.dataset.del)); renderZones(); render(); }
    if (e.target.dataset.view) {
      const z = zones.find((x) => x.id === e.target.dataset.view);
      document.querySelector('[data-tab="map"]').click(); $('#radius').value = String(Math.max(0.5, z.radius)); setCenter(z, 15);
    }
  });
  $('#check-zones').addEventListener('click', () => checkZones({ notify: true }));
  $('#enable-notify').addEventListener('click', async () => {
    if (!('Notification' in window)) return alert('Notifications are not supported in this browser.');
    const p = await Notification.requestPermission();
    alert(p === 'granted' ? 'Alerts on. SafeWatch checks your zones each time you open it.' : 'Alerts were not enabled.');
  });

  /* ---------- Incident notes ---------- */
  function renderNotes() {
    const notes = store.get('notes', []);
    $('#note-list').innerHTML = notes.map((n, i) => `<li class="card"><p class="small muted">${esc(n.when || 'No time given')}</p>
      <p>${esc(n.text).replace(/\n/g, '<br>')}</p><button class="secondary" data-note="${i}">Delete</button></li>`).join('');
  }
  $('#note-form').addEventListener('submit', (e) => {
    e.preventDefault(); const text = $('#note-text').value.trim(); if (!text) return;
    const notes = store.get('notes', []); notes.unshift({ when: $('#note-when').value, text, saved: new Date().toISOString() });
    store.set('notes', notes); e.target.reset(); renderNotes();
  });
  $('#note-list').addEventListener('click', (e) => {
    if (e.target.dataset.note === undefined || !confirm('Delete this note?')) return;
    const notes = store.get('notes', []); notes.splice(+e.target.dataset.note, 1); store.set('notes', notes); renderNotes();
  });
  $('#export-notes').addEventListener('click', () => {
    const notes = store.get('notes', []);
    const txt = 'SafeWatch incident notes, exported ' + new Date().toString() + '\n\n' +
      notes.map((n) => `When: ${n.when || 'not given'}\nRecorded: ${n.saved}\n${n.text}\n`).join('\n---\n\n');
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([txt], { type: 'text/plain' })); a.download = 'incident-notes.txt'; a.click();
  });

  /* ---------- Data tab ---------- */
  $('#csv-file').addEventListener('change', async (e) => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const recs = parseCSV(await f.text());
      if (!recs.length) throw new Error('No valid rows found. Each row needs lat and lng columns.');
      csvProvider.records = recs; store.set('records', recs); store.set('source', 'csv'); provider = csvProvider;
      resetSeen(); alert(`Loaded ${recs.length} records.`); render();
    } catch (err) { alert('Could not load file: ' + err.message); }
  });
  $('#use-demo').addEventListener('click', () => { provider = demoProvider; store.set('source', 'demo'); resetSeen(); render(); });
  $('#clear-data').addEventListener('click', () => {
    csvProvider.records = []; store.set('records', []); store.set('source', 'demo'); provider = demoProvider; resetSeen(); render();
  });
  function resetSeen() { const z = store.get('zones', []); z.forEach((x) => delete x.seen); store.set('zones', z); renderZones(); }

  /* ---------- Init ---------- */
  render(); renderNotes();
  if (store.get('zones', []).length) checkZones({ notify: true }); else renderZones();
})();
