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
  shops: {},
  activeShopId: null,
  lastPosition: null,
};

/* Pré-remplit la Discothèque avec quelques disques de démonstration au
   tout premier lancement, pour ne pas arriver sur un écran vide. Ne se
   déclenche qu'une fois (même si l'utilisateur vide ensuite sa vraie
   collection). */
const DEMO_SEED_FLAG = 'diamant.demoSeeded.v1';

function seedDemoCollectionIfNeeded() {
  if (localStorage.getItem(DEMO_SEED_FLAG)) return;
  localStorage.setItem(DEMO_SEED_FLAG, '1');
  if (state.collection.length > 0) return;

  const colors = ['red', '', 'mustard', '', 'green', ''];
  state.collection = DEMO_CATALOG.slice(0, 6).map((v, i) => ({
    id: crypto.randomUUID ? crypto.randomUUID() : `demo-${i}`,
    artist: v.artist,
    title: v.title,
    year: v.year,
    genre: v.genre,
    color: colors[i] || '',
    cover: null,
    addedAt: Date.now() - i * 1000,
  }));
  saveCollection();
}

/* =========================================================
   Navigation
   ========================================================= */
const panels = document.querySelectorAll('[data-panel]');
const navButtons = document.querySelectorAll('.navbtn');

navButtons.forEach((btn) => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.panelTarget;
    const isScanAction = btn.dataset.action === 'scan';
    panels.forEach((p) => { p.hidden = p.id !== target; });
    navButtons.forEach((b) => {
      b.classList.toggle('is-active', b.dataset.panelTarget === target && b.dataset.action !== 'scan');
    });
    if (target === 'panel-collection') renderCollection();
    if (isScanAction) startScanFlow();
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

const SOURCE_LABELS = { discogs: 'Discogs', leboncoin: 'Leboncoin', fnac: 'Fnac' };
/* Icônes des sites récupérées via le service de favicons de Google plutôt
   que d'héberger nous-mêmes les logos de marque de ces sociétés. */
const SOURCE_FAVICONS = {
  discogs: 'https://www.google.com/s2/favicons?sz=64&domain=discogs.com',
  leboncoin: 'https://www.google.com/s2/favicons?sz=64&domain=leboncoin.fr',
  fnac: 'https://www.google.com/s2/favicons?sz=64&domain=fnac.com',
};

function openExternalSearch(source, query) {
  const q = (query || '').trim();
  if (!q) return;
  const urlBuilder = EXTERNAL_SEARCH_URLS[source];
  if (urlBuilder) window.open(urlBuilder(q), '_blank', 'noopener');
}

/* Catalogue de démonstration — illustre le flux de recherche (prix,
   distance, disponibilité par plateforme) sans prétendre représenter
   un vrai stock ou de vrais prix. Sert aussi de base aux suggestions
   du scanner. À remplacer par une vraie source de données (ex. API
   Discogs) le jour où c'est possible. */
const DEMO_CATALOG = [
  { artist: 'Nina Simone', title: 'Wild Is the Wind', year: 1966, genre: 'Jazz', price: '22 €', nearestShopKm: 1.2, sources: { discogs: true, leboncoin: true, fnac: false }, swatch: 'var(--dot-red)' },
  { artist: 'Fleetwood Mac', title: 'Rumours', year: 1977, genre: 'Rock', price: '15 €', nearestShopKm: 2.6, sources: { discogs: true, leboncoin: true, fnac: true }, swatch: 'var(--dot-mustard)' },
  { artist: 'Miles Davis', title: 'Kind of Blue', year: 1959, genre: 'Jazz', price: '28 €', nearestShopKm: 0.8, sources: { discogs: true, leboncoin: false, fnac: true }, swatch: 'var(--dot-green)' },
  { artist: 'Daft Punk', title: 'Discovery', year: 2001, genre: 'Electro', price: '19 €', nearestShopKm: 3.4, sources: { discogs: true, leboncoin: true, fnac: true }, swatch: 'var(--dot-blue)' },
  { artist: 'Serge Gainsbourg', title: 'Melody Nelson', year: 1971, genre: 'Chanson', price: '35 €', nearestShopKm: 4.1, sources: { discogs: true, leboncoin: false, fnac: false }, swatch: 'var(--dot-plum)' },
  { artist: 'Amy Winehouse', title: 'Back to Black', year: 2006, genre: 'Soul', price: '24 €', nearestShopKm: 1.9, sources: { discogs: true, leboncoin: true, fnac: true }, swatch: 'var(--dot-terracotta)' },
  { artist: 'Radiohead', title: 'In Rainbows', year: 2007, genre: 'Rock', price: '27 €', nearestShopKm: 5.2, sources: { discogs: true, leboncoin: true, fnac: false }, swatch: 'var(--dot-red)' },
  { artist: 'Herbie Hancock', title: 'Head Hunters', year: 1973, genre: 'Jazz-Funk', price: '30 €', nearestShopKm: 2.1, sources: { discogs: true, leboncoin: false, fnac: false }, swatch: 'var(--dot-mustard)' },
  { artist: 'Air', title: 'Moon Safari', year: 1998, genre: 'Electro', price: '21 €', nearestShopKm: 0.5, sources: { discogs: true, leboncoin: true, fnac: true }, swatch: 'var(--dot-green)' },
  { artist: 'Étienne Daho', title: 'Pop Satori', year: 1986, genre: 'Pop', price: '18 €', nearestShopKm: 3.0, sources: { discogs: true, leboncoin: true, fnac: false }, swatch: 'var(--dot-blue)' },
];

const topSearchForm = document.getElementById('top-search-form');
const topSearchInput = document.getElementById('top-search-input');
const rechercheHome = document.getElementById('recherche-home');
const rechercheResults = document.getElementById('recherche-results');
const resultsTitle = document.getElementById('results-title');
const resultList = document.getElementById('result-list');
const resultEmpty = document.getElementById('result-empty');

topSearchForm.addEventListener('submit', (e) => {
  e.preventDefault();
  const query = topSearchInput.value.trim();
  if (query) showResults(query);
});

document.getElementById('btn-results-back').addEventListener('click', () => {
  rechercheResults.hidden = true;
  rechercheHome.hidden = false;
});

function showResults(query) {
  rechercheHome.hidden = true;
  rechercheResults.hidden = false;
  resultsTitle.textContent = `Résultats pour « ${query} »`;

  const term = query.toLowerCase();
  const matches = DEMO_CATALOG.filter((v) =>
    `${v.artist} ${v.title}`.toLowerCase().includes(term)
  );

  resultEmpty.hidden = matches.length > 0;
  resultEmpty.textContent = `Aucun résultat dans notre catalogue de démonstration pour « ${query} ». Ce catalogue n'illustre que quelques disques, en attendant une vraie source de données.`;

  resultList.innerHTML = matches.map((v, i) => `
    <li class="result-item" data-index="${i}">
      <div class="result-cover" style="background:${v.swatch}">${vinylPlaceholderSvg()}</div>
      <div class="result-info">
        <p class="result-artist">${escapeHtml(v.artist)}</p>
        <p class="result-title">${escapeHtml(v.title)}</p>
        <p class="result-year">${v.year}${v.genre ? ' · ' + escapeHtml(v.genre) : ''}</p>
      </div>
      <div class="result-side">
        <span class="result-price">${escapeHtml(v.price)}</span>
        <span class="result-distance">${v.nearestShopKm} km</span>
        <span class="source-dots">
          <span class="source-dot${v.sources.discogs ? ' is-available' : ''}" title="Discogs"></span>
          <span class="source-dot${v.sources.leboncoin ? ' is-available' : ''}" title="Leboncoin"></span>
          <span class="source-dot${v.sources.fnac ? ' is-available' : ''}" title="Fnac"></span>
        </span>
      </div>
    </li>
  `).join('');

  resultList.querySelectorAll('.result-item').forEach((li) => {
    li.addEventListener('click', () => openVinylModal(matches[Number(li.dataset.index)]));
  });
}

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

function locateAndFindShops() {
  if (!('geolocation' in navigator)) {
    locateStatus.textContent = "La géolocalisation n'est pas disponible sur cet appareil.";
    return;
  }
  locateStatus.textContent = 'Localisation en cours…';
  navigator.geolocation.getCurrentPosition(
    (pos) => {
      const { latitude, longitude } = pos.coords;
      state.lastPosition = { lat: latitude, lon: longitude };
      initMapIfNeeded();
      map.setView([latitude, longitude], 14);
      markersLayer.clearLayers();
      L.marker([latitude, longitude]).addTo(markersLayer).bindPopup('Vous êtes ici');
      findNearbyRecordShops(latitude, longitude);
    },
    (err) => {
      locateStatus.textContent = "Localisation refusée ou indisponible. Autorisez l'accès à la position pour voir les disquaires proches.";
      console.warn(err);
    },
    { enableHighAccuracy: true, timeout: 10000 }
  );
}

btnLocate.addEventListener('click', locateAndFindShops);

async function findNearbyRecordShops(lat, lon) {
  locateStatus.textContent = 'Recherche des disquaires à proximité…';
  shopList.innerHTML = '';
  state.shops = {};
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
    const elements = (data.elements || []).filter((el) => el.lat && el.lon);

    if (!elements.length) {
      locateStatus.textContent = 'Aucun disquaire référencé sur OpenStreetMap dans un rayon de 5 km.';
      return;
    }
    locateStatus.textContent = `${elements.length} disquaire(s) trouvé(s) dans un rayon de 5 km.`;

    elements.forEach((el) => {
      const tags = el.tags || {};
      const name = tags.name || 'Disquaire';
      const addr = [tags['addr:housenumber'], tags['addr:street'], tags['addr:postcode'], tags['addr:city']]
        .filter(Boolean).join(' ');
      const distance = haversineKm(lat, lon, el.lat, el.lon).toFixed(1);

      const shop = {
        id: 'osm-' + el.id,
        name,
        address: addr,
        phone: tags['contact:phone'] || tags.phone || '',
        website: tags['contact:website'] || tags.website || '',
        distance,
        lat: el.lat,
        lon: el.lon,
        inventory: [],
      };
      state.shops[shop.id] = shop;

      const marker = L.marker([el.lat, el.lon]).addTo(markersLayer);
      marker.bindPopup(`<strong>${escapeHtml(name)}</strong><br>${escapeHtml(addr || '')}`);
      marker.on('click', () => openShopModal(shop.id));

      const li = document.createElement('li');
      li.dataset.shopId = shop.id;
      const dirUrl = `https://www.openstreetmap.org/directions?from=${lat}%2C${lon}&to=${el.lat}%2C${el.lon}`;
      li.innerHTML = `
        <span class="shop-name">${escapeHtml(name)}</span>
        <span class="shop-meta">${escapeHtml(addr || 'Adresse non renseignée')} · ${distance} km</span><br>
        <a href="${dirUrl}" target="_blank" rel="noopener" data-no-modal>Itinéraire →</a>
      `;
      li.addEventListener('click', (e) => {
        if (e.target.closest('[data-no-modal]')) return;
        openShopModal(shop.id);
      });
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
   Fiche discaire
   ========================================================= */
const shopModalBackdrop = document.getElementById('shop-modal-backdrop');
const shopModalTitle = document.getElementById('shop-modal-title');
const shopModalMeta = document.getElementById('shop-modal-meta');
const shopInventoryFilter = document.getElementById('shop-inventory-filter');
const shopInventoryList = document.getElementById('shop-inventory-list');
const shopInventoryFallback = document.getElementById('shop-inventory-fallback');

function locationIconSvg() {
  return '<svg viewBox="0 0 24 24" class="icon"><path d="M12 2a7 7 0 0 0-7 7c0 5.25 7 13 7 13s7-7.75 7-13a7 7 0 0 0-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z"/></svg>';
}
function phoneIconSvg() {
  return '<svg viewBox="0 0 24 24" class="icon"><path d="M6.6 10.8c1.4 2.8 3.8 5.2 6.6 6.6l2.2-2.2c.3-.3.7-.4 1-.2 1.1.4 2.3.6 3.6.6.6 0 1 .4 1 1V20c0 .6-.4 1-1 1C10.6 21 3 13.4 3 4c0-.6.4-1 1-1h3.5c.6 0 1 .4 1 1 0 1.3.2 2.5.6 3.6.1.4 0 .8-.2 1L6.6 10.8z"/></svg>';
}
function webIconSvg() {
  return '<svg viewBox="0 0 24 24" class="icon"><path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm6.93 6h-2.95c-.32-1.25-.78-2.45-1.38-3.56 1.84.63 3.37 1.9 4.33 3.56zM12 4.04c.83 1.2 1.48 2.53 1.91 3.96h-3.82c.43-1.43 1.08-2.76 1.91-3.96zM4.26 14C4.1 13.36 4 12.69 4 12s.1-1.36.26-2h3.38c-.08.66-.14 1.32-.14 2s.06 1.34.14 2H4.26zm.82 2h2.95c.32 1.25.78 2.45 1.38 3.56-1.84-.63-3.37-1.9-4.33-3.56zm2.95-8H5.08c.96-1.66 2.49-2.93 4.33-3.56C8.81 5.55 8.35 6.75 8.03 8zM12 19.96c-.83-1.2-1.48-2.53-1.91-3.96h3.82c-.43 1.43-1.08 2.76-1.91 3.96zM14.34 14H9.66c-.09-.66-.16-1.32-.16-2s.07-1.35.16-2h4.68c.09.65.16 1.32.16 2s-.07 1.34-.16 2zm.25 5.56c.6-1.11 1.06-2.31 1.38-3.56h2.95c-.96 1.65-2.49 2.93-4.33 3.56zM16.36 14c.08-.66.14-1.32.14-2s-.06-1.34-.14-2h3.38c.16.64.26 1.31.26 2s-.1 1.36-.26 2h-3.38z"/></svg>';
}

function buildShopFallbackChips(shop) {
  const query = shop.name;
  return ['discogs', 'leboncoin', 'fnac'].map((source) => {
    const label = source[0].toUpperCase() + source.slice(1);
    return `<button type="button" class="chip" data-source="${source}">${label}</button>`;
  }).join('');
}

function renderShopInventory(shop) {
  const term = shopInventoryFilter.value.trim().toLowerCase();
  const items = (shop.inventory || []).filter((v) =>
    !term || `${v.artist} ${v.title}`.toLowerCase().includes(term)
  );

  shopInventoryList.innerHTML = items.map((v) => `
    <li>
      <span class="inv-title">${escapeHtml(v.artist)} — ${escapeHtml(v.title)}</span>
      <span class="inv-meta">${v.year || '—'}${v.genre ? ' · ' + escapeHtml(v.genre) : ''}${v.price ? ' · ' + escapeHtml(v.price) : ''}</span>
    </li>
  `).join('');

  shopInventoryList.hidden = items.length === 0;
  shopInventoryFallback.hidden = (shop.inventory || []).length > 0;
}

function openShopModal(shopId) {
  const shop = state.shops[shopId];
  if (!shop) return;
  state.activeShopId = shopId;

  shopModalTitle.textContent = shop.name;

  const metaRows = [];
  metaRows.push(`<li>${locationIconSvg()}<span>${escapeHtml(shop.address || 'Adresse non renseignée')} · ${shop.distance} km</span></li>`);
  metaRows.push(shop.phone
    ? `<li>${phoneIconSvg()}<a href="tel:${escapeHtml(shop.phone)}">${escapeHtml(shop.phone)}</a></li>`
    : `<li>${phoneIconSvg()}<span>Téléphone non renseigné</span></li>`);
  metaRows.push(shop.website
    ? `<li>${webIconSvg()}<a href="${escapeHtml(shop.website)}" target="_blank" rel="noopener">${escapeHtml(shop.website.replace(/^https?:\/\//, ''))}</a></li>`
    : `<li>${webIconSvg()}<span>Site web non renseigné</span></li>`);
  shopModalMeta.innerHTML = metaRows.join('');

  shopInventoryFilter.value = '';
  const chipsWrap = shopInventoryFallback.querySelector('[data-chips="shop"]');
  chipsWrap.innerHTML = buildShopFallbackChips(shop);
  chipsWrap.querySelectorAll('.chip').forEach((chip) => {
    chip.addEventListener('click', () => {
      const filterTerm = shopInventoryFilter.value.trim();
      openExternalSearch(chip.dataset.source, filterTerm ? `${shop.name} ${filterTerm}` : shop.name);
    });
  });

  renderShopInventory(shop);
  shopModalBackdrop.hidden = false;
}

function closeShopModal() {
  shopModalBackdrop.hidden = true;
  state.activeShopId = null;
}

document.getElementById('shop-modal-close').addEventListener('click', closeShopModal);
shopModalBackdrop.addEventListener('click', (e) => {
  if (e.target === shopModalBackdrop) closeShopModal();
});
shopInventoryFilter.addEventListener('input', () => {
  const shop = state.shops[state.activeShopId];
  if (shop) renderShopInventory(shop);
});

/* =========================================================
   Fiche vinyle (résultat de recherche)
   ========================================================= */
const vinylModalBackdrop = document.getElementById('vinyl-modal-backdrop');
const vinylModalTitle = document.getElementById('vinyl-modal-title');
const vinylShopList = document.getElementById('vinyl-shop-list');
const vinylLinks = document.getElementById('vinyl-links');

let vinylMap = null;
let vinylMarkersLayer = null;

function initVinylMapIfNeeded() {
  if (vinylMap) return;
  vinylMap = L.map('vinyl-map', { zoomControl: false, attributionControl: false });
  L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { maxZoom: 19 }).addTo(vinylMap);
  vinylMarkersLayer = L.layerGroup().addTo(vinylMap);
}

/* Noms de disquaires fictifs, pour ne jamais laisser croire qu'un vrai
   magasin a ce disque en stock tant qu'aucune source de données réelle
   n'est branchée. */
const DEMO_SHOP_NAMES = ['Le Sillon Perdu', 'Microsillon Café', 'Bac à Vinyles'];

function openVinylModal(vinyl) {
  vinylModalTitle.textContent = `${vinyl.artist} — ${vinyl.title} (${vinyl.year})`;

  const center = state.lastPosition || { lat: 48.8566, lon: 2.3522 };
  const offsets = [[0.01, 0.015], [-0.012, 0.008], [0.006, -0.014]];
  const demoShops = offsets.map((off, i) => ({
    name: DEMO_SHOP_NAMES[i],
    lat: center.lat + off[0],
    lon: center.lon + off[1],
    km: (vinyl.nearestShopKm + i * 1.4).toFixed(1),
  }));

  vinylShopList.innerHTML = demoShops.map((s) => `
    <li>
      <span class="shop-name">${escapeHtml(s.name)}</span>
      <span class="shop-meta">${s.km} km · disponibilité fictive (démo)</span>
    </li>
  `).join('');

  const query = `${vinyl.artist} ${vinyl.title}`;
  vinylLinks.innerHTML = ['leboncoin', 'discogs', 'fnac'].map((source) => `
    <a href="${EXTERNAL_SEARCH_URLS[source](query)}" target="_blank" rel="noopener">
      <img src="${SOURCE_FAVICONS[source]}" alt="" class="source-favicon" onerror="this.remove()">
      Voir sur ${SOURCE_LABELS[source]}
    </a>
  `).join('');

  vinylModalBackdrop.hidden = false;

  requestAnimationFrame(() => {
    initVinylMapIfNeeded();
    vinylMap.invalidateSize();
    vinylMap.setView([center.lat, center.lon], 13);
    vinylMarkersLayer.clearLayers();
    demoShops.forEach((s) => {
      L.marker([s.lat, s.lon]).addTo(vinylMarkersLayer).bindPopup(`<strong>${escapeHtml(s.name)}</strong> (démo)`);
    });
  });
}

document.getElementById('vinyl-modal-close').addEventListener('click', () => { vinylModalBackdrop.hidden = true; });
vinylModalBackdrop.addEventListener('click', (e) => {
  if (e.target === vinylModalBackdrop) vinylModalBackdrop.hidden = true;
});

function pickDemoSuggestion() {
  return DEMO_CATALOG[Math.floor(Math.random() * DEMO_CATALOG.length)];
}

document.getElementById('btn-add-manual').addEventListener('click', () => {
  openRecordModal({ cover: null, artist: '', title: '', year: '', genre: '', color: '' }, { isNew: true });
});

/* =========================================================
   Modal fiche disque (ajout / édition / scan)
   ========================================================= */
const modalBackdrop = document.getElementById('modal-backdrop');
const modalCoverStatic = document.getElementById('modal-cover-static');
const modalCameraVideo = document.getElementById('modal-camera-video');
const btnModalCapture = document.getElementById('btn-modal-capture');
const modalSpinner = document.getElementById('modal-spinner');
const modalCameraStatus = document.getElementById('modal-camera-status');
const captureCanvas = document.getElementById('capture-canvas');
const demoBadge = document.getElementById('demo-badge');
const recordForm = document.getElementById('record-form');
const dotPicker = document.getElementById('dot-picker');
const btnDelete = document.getElementById('btn-delete-record');

let cameraStream = null;

function stopCamera() {
  if (cameraStream) {
    cameraStream.getTracks().forEach((t) => t.stop());
    cameraStream = null;
  }
  modalCameraVideo.hidden = true;
  btnModalCapture.hidden = true;
}

async function startModalCamera() {
  modalCameraStatus.textContent = '';
  if (!navigator.mediaDevices?.getUserMedia) {
    modalCameraStatus.textContent = "La caméra n'est pas disponible — renseignez les informations manuellement.";
    return;
  }
  try {
    cameraStream = await navigator.mediaDevices.getUserMedia({
      video: { facingMode: 'environment' },
      audio: false,
    });
    modalCameraVideo.srcObject = cameraStream;
    modalCoverStatic.hidden = true;
    modalCameraVideo.hidden = false;
    btnModalCapture.hidden = false;
  } catch (err) {
    modalCameraStatus.textContent = "Accès à la caméra refusé — renseignez les informations manuellement.";
    console.warn(err);
  }
}

function captureModalPhoto() {
  const w = modalCameraVideo.videoWidth;
  const h = modalCameraVideo.videoHeight;
  if (!w || !h) return;
  captureCanvas.width = w;
  captureCanvas.height = h;
  captureCanvas.getContext('2d').drawImage(modalCameraVideo, 0, 0, w, h);
  const dataUrl = captureCanvas.toDataURL('image/jpeg', 0.85);

  stopCamera();
  state.pendingCover = dataUrl;
  modalCoverStatic.hidden = false;
  modalCoverStatic.innerHTML = `<img src="${dataUrl}" alt="Pochette">`;
  modalSpinner.hidden = false;

  setTimeout(() => {
    modalSpinner.hidden = true;
    const suggestion = pickDemoSuggestion();
    recordForm.artist.value = suggestion.artist;
    recordForm.title.value = suggestion.title;
    recordForm.year.value = suggestion.year;
    recordForm.genre.value = suggestion.genre;
    demoBadge.hidden = false;
    updateGenreSuggestions();
  }, 900);
}

btnModalCapture.addEventListener('click', captureModalPhoto);

function startScanFlow() {
  openRecordModal({ cover: null, artist: '', title: '', year: '', genre: '', color: '' }, { isNew: true });
  startModalCamera();
}

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

  stopCamera();
  modalCameraStatus.textContent = '';
  modalSpinner.hidden = true;
  modalCoverStatic.hidden = false;
  modalCoverStatic.innerHTML = record.cover
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
  stopCamera();
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
seedDemoCollectionIfNeeded();
renderCollection();
locateAndFindShops();
