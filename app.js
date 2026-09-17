'use strict';

/* =========================================================
   Diamant — état & persistance
   ========================================================= */
const STORAGE_KEY = 'diamant.collection.v1';

const DOT_COLORS = [
  { key: 'red', label: 'Coup de cœur', var: '--dot-red' },
  { key: 'mustard', label: 'À écouter', var: '--dot-mustard' },
  { key: 'green', label: 'Complet', var: '--dot-green' },
  { key: 'blue', label: 'Prêté', var: '--dot-blue' },
  { key: 'plum', label: 'À vendre', var: '--dot-plum' },
  { key: 'terracotta', label: 'Rare', var: '--dot-terracotta' },
];

function loadCollection() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    console.warn('Lecture collection impossible', e);
    return [];
  }
}

function saveCollection() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state.collection));
  } catch (e) {
    console.warn('Sauvegarde collection impossible', e);
  }
}

const state = {
  collection: loadCollection(),
  editingId: null,
  pendingCover: null,
  filters: { yearMin: '', yearMax: '', genre: '', color: '' },
};

/* =========================================================
   Navigation
   ========================================================= */
const panels = document.querySelectorAll('[data-panel]');
const navButtons = document.querySelectorAll('.navbtn');

navButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.panelTarget;
    panels.forEach((p) => { p.hidden = p.id !== target; });
    navButtons.forEach((b) => b.classList.toggle('is-active', b === btn));
    if (target === 'panel-collection') renderCollection();
  });
});

document.querySelectorAll('.subtab').forEach((tab) => {
  tab.addEventListener('click', () => {
    const group = tab.closest('.subtabs');
    const panel = tab.closest('.panel');
    group.querySelectorAll('.subtab').forEach((t) => t.classList.toggle('is-active', t === tab));
    panel.querySelectorAll('.subpanel').forEach((sp) => {
      sp.classList.toggle('is-active', sp.dataset.subpanel === tab.dataset.subtab);
    });
  });
});

/* =========================================================
   Recherche externe (Discogs / Leboncoin / Fnac)
   ========================================================= */
const EXTERNAL_SEARCH_URLS = {
  discogs: (q) => `https://www.discogs.com/search/?q=${encodeURIComponent(q)}&type=release&format_exact=Vinyl`,
  leboncoin: (q) => `https://www.leboncoin.fr/recherche?category=15&text=${encodeURIComponent(q)}`,
  fnac: (q) => `https://www.fnac.com/SearchResult/ResultList.aspx?Search=${encodeURIComponent(q + ' vinyle')}`,
};

document.querySelectorAll('.search-form').forEach((form) => {
  form.addEventListener('submit', (e) => {
    e.preventDefault();
    const source = form.dataset.external;
    const query = form.querySelector('input').value.trim();
    if (!query) return;
    const urlBuilder = EXTERNAL_SEARCH_URLS[source];
    if (urlBuilder) window.open(urlBuilder(query), '_blank', 'noopener');
  });
});

/* =========================================================
   Carte — géolocalisation + disquaires (OpenStreetMap Overpass)
   ========================================================= */
let map = null;
let markersLayer = null;

function initMapIfNeeded() {
  if (map) return;
  map = L.map('map', { zoomControl: false }).setView([48.8566, 2.3522], 12);
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '&copy; OpenStreetMap contributors',
    maxZoom: 19,
  }).addTo(map);
  markersLayer = L.layerGroup().addTo(map);
}

const btnLocate = document.getElementById('btn-locate');
const locateStatus = document.getElementById('locate-status');
const shopList = document.getElementById('shop-list');

btnLocate.addEventListener('click', () => {
  if (!('geolocation' in navigator)) {
    locateStatus.textContent = "La géolocalisation n'est pas disponible sur cet appareil.";
    return;
  }
  locateStatus.textContent = 'Localisation en cours…';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      initMapIfNeeded();
      map.setView([latitude, longitude], 14);
      L.marker([latitude, longitude]).addTo(markersLayer).bindPopup('Vous êtes ici').openPopup();
      findNearbyRecordShops(latitude, longitude);
    },
    (err) => {
      locateStatus.textContent = "Localisation refusée ou indisponible. Autorisez l'accès à la position pour voir les disquaires proches.";
      console.warn(err);
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
});

async function findNearbyRecordShops(lat, lon) {
  locateStatus.textContent = 'Recherche des disquaires à proximité…';
  shopList.innerHTML = '';
  const radius = 5000;
  const query = `[out:json][timeout:15];(node["shop"="music"](around:${radius},${lat},${lon});node["shop"="records"](around:${radius},${lat},${lon}););out body;`;
  try {
    const res = await fetch('https://overpass-api.de/api/interpreter', {
      method: 'POST',
      body: 'data=' + encodeURIComponent(query),
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    });
    if (!res.ok) throw new Error('Overpass ' + res.status);
    const data = await res.json();
    const shops = (data.elements || []).filter((el) => el.lat && el.lon);

    if (!shops.length) {
      locateStatus.textContent = 'Aucun disquaire référencé sur OpenStreetMap dans un rayon de 5 km.';
      return;
    }
    locateStatus.textContent = `${shops.length} disquaire(s) trouvé(s) dans un rayon de 5 km.`;

    shops.forEach((shop) => {
      const name = shop.tags?.name || 'Disquaire';
      const addr = [shop.tags?.['addr:housenumber'], shop.tags?.['addr:street'], shop.tags?.['addr:city']]
        .filter(Boolean).join(' ');
      const distance = haversineKm(lat, lon, shop.lat, shop.lon).toFixed(1);

      const marker = L.marker([shop.lat, shop.lon]).addTo(markersLayer);
      marker.bindPopup(`<strong>${escapeHtml(name)}</strong><br>${escapeHtml(addr || '')}`);

      const li = document.createElement('li');
      const dirUrl = `https://www.openstreetmap.org/directions?from=${lat}%2C${lon}&to=${shop.lat}%2C${shop.lon}`;
      li.innerHTML = `
        <span class="shop-name">${escapeHtml(name)}</span>
        <span class="shop-meta">${escapeHtml(addr || 'Adresse non renseignée')} · ${distance} km</span><br>
        <a href="${dirUrl}" target="_blank" rel="noopener">Itinéraire →</a>
      `;
      shopList.appendChild(li);
    });
  } catch (err) {
    console.warn(err);
    locateStatus.textContent = "Impossible de contacter le service de cartographie pour le moment.";
  }
}

function haversineKm(lat1, lon1, lat2, lon2) {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLon = ((lon2 - lon1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return R * (2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a)));
}

/* =========================================================
   Scanner — caméra + capture + fiche à valider
   ========================================================= */
const scanIdle = document.getElementById('scan-idle');
const cameraWrap = document.getElementById('camera-wrap');
const cameraVideo = document.getElementById('camera-video');
const cameraStatus = document.getElementById('camera-status');
const analyzingCard = document.getElementById('analyzing-card');
const captureCanvas = document.getElementById('capture-canvas');

let cameraStream = null;

document.getElementById('btn-open-camera').addEventListener('click', async () => {
  if (!navigator.mediaDevices?.getUserMedia) {
    cameraStatus.textContent = "La caméra n'est pas disponible dans ce navigateur.";
    return;
  }
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false,
    });
    cameraVideo.srcObject = cameraStream;
    scanIdle.hidden = true;
    cameraWrap.hidden = false;
  } catch (err) {
    cameraStatus.textContent = "Accès à la caméra refusé ou indisponible.";
    console.warn(err);
  }
});

function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach((t) => t.stop());
    cameraStream = null;
  }
  cameraWrap.hidden = true;
  scanIdle.hidden = false;
}

document.getElementById('btn-close-camera').addEventListener('click', stopCamera);

document.getElementById('btn-capture').addEventListener('click', () => {
  const w = cameraVideo.videoWidth;
  const h = cameraVideo.videoHeight;
  if (!w || !h) return;
  captureCanvas.width = w;
  captureCanvas.height = h;
  captureCanvas.getContext('2d').drawImage(cameraVideo, 0, 0, w, h);
  const dataUrl = captureCanvas.toDataURL('image/jpeg', 0.85);

  stopCamera();
  cameraWrap.hidden = true;
  analyzingCard.hidden = false;

  setTimeout(() => {
    analyzingCard.hidden = true;
    scanIdle.hidden = false;
    const suggestion = pickDemoSuggestion();
    openRecordModal({
      cover: dataUrl,
      artist: suggestion?.artist || '',
      title: suggestion?.title || '',
      year: suggestion?.year || '',
      genre: suggestion?.genre || '',
      color: '',
    }, { isNew: true, showDemoBadge: !!suggestion });
  }, 900);
});

/* Petit jeu de données "démo" — illustre le flux de reconnaissance
   sans prétendre reconnaître réellement la pochette scannée.
   À remplacer par un vrai service de vision (ex. API Discogs + image
   recognition, Google Vision…) le jour où une clé API est disponible. */
const DEMO_DATASET = [
  { artist: 'Nina Simone', title: 'Wild Is the Wind', year: 1966, genre: 'Jazz' },
  { artist: 'Fleetwood Mac', title: 'Rumours', year: 1977, genre: 'Rock' },
  { artist: 'Miles Davis', title: 'Kind of Blue', year: 1959, genre: 'Jazz' },
  { artist: 'Daft Punk', title: 'Discovery', year: 2001, genre: 'Electro' },
  { artist: 'Serge Gainsbourg', title: 'Melody Nelson', year: 1971, genre: 'Chanson' },
];

function pickDemoSuggestion() {
  return DEMO_DATASET[Math.floor(Math.random() * DEMO_DATASET.length)];
}

document.getElementById('btn-add-manual').addEventListener('click', () => {
  openRecordModal({ cover: null, artist: '', title: '', year: '', genre: '', color: '' }, { isNew: true });
});

/* =========================================================
   Modal fiche disque (ajout / édition)
   ========================================================= */
const modalBackdrop = document.getElementById('modal-backdrop');
const modalCover = document.getElementById('modal-cover');
const demoBadge = document.getElementById('demo-badge');
const recordForm = document.getElementById('record-form');
const dotPicker = document.getElementById('dot-picker');
const btnDelete = document.getElementById('btn-delete-record');

function vinylPlaceholderSvg() {
  return `<svg viewBox="0 0 100 100"><circle cx="50" cy="50" r="46" fill="none" stroke="#e8dcc3" stroke-width="3"/><circle cx="50" cy="50" r="14" fill="#e8dcc3"/></svg>`;
}

function buildDotPicker(selected) {
  dotPicker.innerHTML = '';
  const noneBtn = document.createElement('button');
  noneBtn.type = 'button';
  noneBtn.className = 'dot' + (!selected ? ' is-selected' : '');
  noneBtn.dataset.color = 'none';
  noneBtn.title = 'Aucune';
  noneBtn.addEventListener('click', () => selectDot(''));
  dotPicker.appendChild(noneBtn);

  DOT_COLORS.forEach((c) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'dot' + (selected === c.key ? ' is-selected' : '');
    b.style.background = `var(${c.var})`;
    b.dataset.color = c.key;
    b.title = c.label;
    b.addEventListener('click', () => selectDot(c.key));
    dotPicker.appendChild(b);
  });
}

function selectDot(key) {
  recordForm.dataset.selectedColor = key;
  dotPicker.querySelectorAll('.dot').forEach((d) => {
    d.classList.toggle('is-selected', d.dataset.color === (key || 'none'));
  });
}

function openRecordModal(record, { isNew, showDemoBadge } = {}) {
  state.editingId = isNew ? null : record.id;
  state.pendingCover = record.cover || null;

  modalCover.innerHTML = record.cover
    ? `<img src="${record.cover}" alt="Pochette">`
    : vinylPlaceholderSvg();

  demoBadge.hidden = !showDemoBadge;

  recordForm.artist.value = record.artist || '';
  recordForm.title.value = record.title || '';
  recordForm.year.value = record.year || '';
  recordForm.genre.value = record.genre || '';

  buildDotPicker(record.color || '');
  selectDot(record.color || '');

  btnDelete.hidden = isNew;

  updateGenreSuggestions();
  modalBackdrop.hidden = false;
}

function closeModal() {
  modalBackdrop.hidden = true;
  state.editingId = null;
  state.pendingCover = null;
  recordForm.reset();
}

document.getElementById('modal-close').addEventListener('click', closeModal);
modalBackdrop.addEventListener('click', (e) => {
  if (e.target === modalBackdrop) closeModal();
});

recordForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const fd = new FormData(recordForm);
  const record = {
    id: state.editingId || (crypto.randomUUID ? crypto.randomUUID() : String(Date.now())),
    artist: fd.get('artist').toString().trim(),
    title: fd.get('title').toString().trim(),
    year: fd.get('year') ? Number(fd.get('year')) : null,
    genre: fd.get('genre').toString().trim(),
    color: recordForm.dataset.selectedColor || '',
    cover: state.pendingCover,
    addedAt: Date.now(),
  };

  const idx = state.collection.findIndex((r) => r.id === record.id);
  if (idx >= 0) {
    record.addedAt = state.collection[idx].addedAt;
    state.collection[idx] = record;
  } else {
    state.collection.unshift(record);
  }
  saveCollection();
  closeModal();
  renderCollection();
});

btnDelete.addEventListener('click', () => {
  if (!state.editingId) return;
  state.collection = state.collection.filter((r) => r.id !== state.editingId);
  saveCollection();
  closeModal();
  renderCollection();
});

/* =========================================================
   Collection — rendu, filtres
   ========================================================= */
const recordGrid = document.getElementById('record-grid');
const collectionEmpty = document.getElementById('collection-empty');
const filterYearMin = document.getElementById('filter-year-min');
const filterYearMax = document.getElementById('filter-year-max');
const filterGenre = document.getElementById('filter-genre');
const dotFilters = document.getElementById('dot-filters');

function updateGenreSuggestions() {
  const genres = [...new Set(state.collection.map((r) => r.genre).filter(Boolean))].sort();
  const datalist = document.getElementById('genre-suggestions');
  datalist.innerHTML = genres.map((g) => `<option value="${escapeHtml(g)}">`).join('');

  const current = filterGenre.value;
  filterGenre.innerHTML = '<option value="">Tous les styles</option>' +
    genres.map((g) => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('');
  filterGenre.value = genres.includes(current) ? current : '';
}

function buildDotFilters() {
  dotFilters.innerHTML = '';
  const allBtn = document.createElement('button');
  allBtn.type = 'button';
  allBtn.className = 'dot' + (state.filters.color === '' ? ' is-selected' : '');
  allBtn.dataset.color = 'none';
  allBtn.title = 'Toutes';
  allBtn.addEventListener('click', () => { state.filters.color = ''; buildDotFilters(); renderCollection(); });
  dotFilters.appendChild(allBtn);

  DOT_COLORS.forEach((c) => {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'dot' + (state.filters.color === c.key ? ' is-selected' : '');
    b.style.background = `var(${c.var})`;
    b.title = c.label;
    b.addEventListener('click', () => {
      state.filters.color = state.filters.color === c.key ? '' : c.key;
      buildDotFilters();
      renderCollection();
    });
    dotFilters.appendChild(b);
  });
}

[filterYearMin, filterYearMax].forEach((input) => {
  input.addEventListener('input', () => {
    state.filters.yearMin = filterYearMin.value;
    state.filters.yearMax = filterYearMax.value;
    renderCollection();
  });
});
filterGenre.addEventListener('change', () => {
  state.filters.genre = filterGenre.value;
  renderCollection();
});

function renderCollection() {
  updateGenreSuggestions();
  buildDotFilters();

  const { yearMin, yearMax, genre, color } = state.filters;
  const filtered = state.collection.filter((r) => {
    if (yearMin && (!r.year || r.year < Number(yearMin))) return false;
    if (yearMax && (!r.year || r.year > Number(yearMax))) return false;
    if (genre && r.genre !== genre) return false;
    if (color && r.color !== color) return false;
    return true;
  });

  collectionEmpty.hidden = state.collection.length > 0;
  recordGrid.innerHTML = '';

  filtered.forEach((record) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'record-card';

    const dotColorVar = DOT_COLORS.find((c) => c.key === record.color)?.var;

    card.innerHTML = `
      <div class="record-cover">
        ${record.cover ? `<img src="${record.cover}" alt="">` : vinylPlaceholderSvg()}
        ${dotColorVar ? `<span class="record-dot" style="background:var(${dotColorVar})"></span>` : ''}
      </div>
      <div class="record-info">
        <p class="record-artist">${escapeHtml(record.artist || 'Artiste inconnu')}</p>
        <p class="record-title">${escapeHtml(record.title || 'Sans titre')}</p>
        <p class="record-meta">${record.year || '—'}${record.genre ? ' · ' + escapeHtml(record.genre) : ''}</p>
      </div>
    `;
    card.addEventListener('click', () => openRecordModal(record, { isNew: false }));
    recordGrid.appendChild(card);
  });
}

/* =========================================================
   Utils
   ========================================================= */
function escapeHtml(str) {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/* =========================================================
   Init
   ========================================================= */
renderCollection();
