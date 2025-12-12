/**
 * APP.JS - Planificador de Viajes en Autocaravana (Versión Final)
 */

// ==========================================
// 1. CONFIGURACIÓN E INICIALIZACIÓN
// ==========================================

const ORS_API_KEY = "eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6IjRhMjZhM2EzOTYyYzQ3YjhiYzJmNzE5MjFmMDdiMjM2IiwiaCI6Im11cm11cjY0In0="; 

const map = L.map('map', { center: [40.4167, -3.7037], zoom: 6 });

const baseLayers = {
    "Carreteras": L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OSM' }).addTo(map),
    "Satélite": L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: '© Esri' }),
    "Relieve": L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { attribution: '© OpenTopoMap' })
};
L.control.layers(baseLayers).addTo(map);

const poiLayerGroup = L.layerGroup().addTo(map);

const geocoder = L.Control.Geocoder.nominatim();
L.Control.geocoder({ geocoder, defaultMarkGeocode: false, placeholder: "Buscar...", errorMessage: "Nada encontrado" })
.on('markgeocode', e => { handleMapInteraction(e.geocode.center, e.geocode.name); map.setView(e.geocode.center, 14); })
.addTo(map);

// ==========================================
// 2. ESTADO Y PERSISTENCIA
// ==========================================

let appData = { stages: [], pois: [] };
let stageRoutingControls = {}; 
let activeStageId = null; 
let tempClickLocation = null;    
let tempLocationName = "";
let currentPoiEditId = null; 
let routingQueue = [];
let isProcessingQueue = false;

// Guardar en LocalStorage
function saveData() {
    localStorage.setItem('camperViaje', JSON.stringify(appData));
}

// Cargar datos
function initApp() {
    const hash = window.location.hash.substring(1); 
    if (hash.startsWith('route=')) {
        try {
            const compressed = hash.substring(6);
            const json = JSON.parse(LZString.decompressFromEncodedURIComponent(compressed));
            if(json) {
                loadAppData(json);
                window.history.replaceState(null, null, ' '); 
                return;
            }
        } catch (e) { console.error("Error loading URL", e); }
    }

    const local = localStorage.getItem('camperViaje');
    if (local) {
        loadAppData(JSON.parse(local));
    }
}

// ==========================================
// 3. INTERACCIÓN MAPA
// ==========================================

map.on('click', e => handleMapInteraction(e.latlng));

function handleMapInteraction(latlng, name = null) {
    tempClickLocation = latlng;
    const modal = new bootstrap.Modal(document.getElementById('clickActionModal'));
    modal.show();

    const preview = document.getElementById('modal-address-preview');
    if (name) {
        tempLocationName = name;
        preview.innerHTML = `<strong>${name}</strong>`;
    } else {
        tempLocationName = `${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}`;
        preview.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Buscando dirección...';
        
        geocoder.reverse(latlng, map.options.crs.scale(map.getZoom()), res => {
            if (res && res.length > 0) {
                tempLocationName = res[0].name;
                if(document.getElementById('modal-address-preview'))
                    document.getElementById('modal-address-preview').innerHTML = `<strong>${tempLocationName}</strong>`;
            } else {
                if(document.getElementById('modal-address-preview'))
                    document.getElementById('modal-address-preview').innerText = tempLocationName;
            }
        });
    }
}

window.addCurrentLocToStage = function() {
    if (!activeStageId) createNewStage();
    const stage = appData.stages.find(s => s.id === activeStageId);
    stage.waypoints.push({ latLng: tempClickLocation, name: tempLocationName });
    stage.visible = true;
    refreshMapRoute(stage.id); 
    renderSidebar();
    saveData();
    bootstrap.Modal.getInstance(document.getElementById('clickActionModal')).hide();
};

window.addCurrentLocAsPOI = function() {
    const newPoi = { id: Date.now(), latLng: tempClickLocation, name: tempLocationName, icon: "⭐" };
    appData.pois.push(newPoi);
    renderPOIsOnMap();
    renderPoiSidebar();
    saveData();
    bootstrap.Modal.getInstance(document.getElementById('clickActionModal')).hide();
};

// ==========================================
// 4. GESTIÓN DE ETAPAS
// ==========================================

window.createNewStage = function() {
    const id = Date.now();
    appData.stages.push({
        id: id,
        name: `Etapa ${appData.stages.length + 1}`,
        waypoints: [],
        distance: 0,
        color: getRandomColor(),
        visible: true, 
        isOpen: true   
    });
    activeStageId = id;
    renderSidebar(); 
    saveData();
};

window.setActiveStage = function(id) {
    if (activeStageId === id) return;
    activeStageId = id;
    highlightActiveStageCard(id); 
    saveData();
};

function highlightActiveStageCard(id) {
    document.querySelectorAll('.accordion-item').forEach(el => {
        el.classList.remove('border-primary', 'shadow-sm');
        el.classList.add('border');
    });
    const activeCard = document.getElementById(`stage-card-${id}`);
    if(activeCard) {
        activeCard.classList.remove('border');
        activeCard.classList.add('border-primary', 'shadow-sm');
    }
}

window.toggleStageVisibility = function(e, id) {
    e.stopPropagation();
    const stage = appData.stages.find(s => s.id === id);
    stage.visible = !stage.visible;
    refreshMapRoute(id, true);
    renderSidebar(); 
    saveData();
};

window.updateStageName = function(id, name) {
    appData.stages.find(s => s.id === id).name = name;
    saveData();
};

window.updateStageColor = function(id, color) {
    appData.stages.find(s => s.id === id).color = color;
    refreshMapRoute(id, true);
    saveData();
};

window.deleteStage = function(id) {
    if(!confirm("¿Borrar esta etapa?")) return;
    if (stageRoutingControls[id]) { map.removeControl(stageRoutingControls[id]); delete stageRoutingControls[id]; }
    appData.stages = appData.stages.filter(s => s.id !== id);
    if (activeStageId === id) activeStageId = null;
    renderSidebar();
    saveData();
};

window.removeWaypoint = function(stageId, idx) {
    const stage = appData.stages.find(s => s.id === stageId);
    stage.waypoints.splice(idx, 1);
    refreshMapRoute(stageId);
    renderSidebar();
    saveData();
};

// ==========================================
// 5. RENDERIZADO SIDEBAR (Etapas)
// ==========================================

function renderSidebar() {
    const container = document.getElementById('stages-list');
    
    const scrollTop = container.parentElement ? container.parentElement.scrollTop : 0;
    
    container.innerHTML = '';
    let totalTripKm = 0;

    appData.stages.forEach((stage) => {
        if(stage.visible) totalTripKm += stage.distance;
        const isActive = stage.id === activeStageId;
        const collapseId = `collapse-${stage.id}`; 
        
        let waypointsHtml = stage.waypoints.length === 0 
            ? '<div class="text-muted small fst-italic p-2">Sin paradas.</div>'
            : stage.waypoints.map((wp, idx) => `
                <div class="waypoint-item small" data-index="${idx}">
                    <span class="badge ${idx===0?'bg-success':idx===stage.waypoints.length-1?'bg-dark':'bg-secondary'} me-2">
                        ${idx===0?'Inicio':idx===stage.waypoints.length-1?'Fin':idx}
                    </span>
                    <span class="text-truncate flex-grow-1 cursor-zoom" 
                          onclick="map.setView([${wp.latLng.lat}, ${wp.latLng.lng}], 16)" 
                          title="Ver en mapa">
                        ${wp.name}
                    </span>
                    <button class="btn btn-link text-danger p-0 ms-2" onclick="removeWaypoint(${stage.id}, ${idx})"><i class="fas fa-times"></i></button>
                </div>`).join('');

        const card = document.createElement('div');
        card.id = `stage-card-${stage.id}`;
        card.className = `accordion-item mb-2 border ${isActive ? 'border-primary shadow-sm' : ''}`;
        
        card.innerHTML = `
            <div class="accordion-header d-flex align-items-center border-bottom bg-light p-1" 
                 onclick="setActiveStage(${stage.id})" 
                 style="cursor: pointer;">
                 
                <button class="btn btn-sm text-secondary" onclick="toggleStageVisibility(event, ${stage.id})">
                    <i class="fa-solid ${stage.visible ? 'fa-eye text-success' : 'fa-eye-slash'}"></i>
                </button>
                
                <div class="color-picker-wrapper ms-2" onclick="event.stopPropagation()">
                    <input type="color" class="color-picker-input" value="${stage.color}" oninput="updateStageColor(${stage.id}, this.value)">
                </div>
                
                <div class="flex-grow-1 ms-2">
                    <input type="text" class="form-control form-control-sm fw-bold border-0 bg-transparent p-0" 
                           value="${stage.name}" 
                           onclick="setActiveStage(${stage.id})" 
                           onchange="updateStageName(${stage.id}, this.value)">
                </div>
                
                <span class="badge bg-light text-dark border ms-2">${stage.distance.toFixed(1)} km</span>
                
                <button class="btn btn-link text-dark p-0 ms-2 me-2 accordion-button-custom ${stage.isOpen ? '' : 'collapsed'}" 
                        type="button"
                        data-bs-toggle="collapse" 
                        data-bs-target="#${collapseId}"
                        onclick="event.stopPropagation()">
                    <i class="fa-solid fa-chevron-down transition-icon"></i>
                </button>
            </div>
            
            <div id="${collapseId}" class="accordion-collapse collapse ${stage.isOpen ? 'show' : ''}">
                <div class="accordion-body p-2 bg-white">
                    <div id="wp-list-${stage.id}" class="list-group mb-2">${waypointsHtml}</div>
                    <div class="d-flex justify-content-end gap-2">
                         <button class="btn btn-sm btn-outline-danger" onclick="deleteStage(${stage.id})"><i class="fas fa-trash"></i></button>
                    </div>
                </div>
            </div>`;
        container.appendChild(card);

        // Listeners para sincronizar estado sin repintar
        const collapseElement = document.getElementById(collapseId);
        
        collapseElement.addEventListener('show.bs.collapse', () => {
            stage.isOpen = true;
            activeStageId = stage.id;
            highlightActiveStageCard(stage.id);
            saveData();
        });
        
        collapseElement.addEventListener('hide.bs.collapse', () => {
            stage.isOpen = false;
            saveData();
        });

        if (stage.waypoints.length > 0) {
            new Sortable(document.getElementById(`wp-list-${stage.id}`), {
                animation: 150,
                onEnd: function (evt) {
                    const movedItem = stage.waypoints.splice(evt.oldIndex, 1)[0];
                    stage.waypoints.splice(evt.newIndex, 0, movedItem);
                    refreshMapRoute(stage.id);
                    renderSidebar();
                    saveData();
                }
            });
        }
    });
    
    document.getElementById('total-km').innerText = totalTripKm.toFixed(1) + " km";
    if(container.parentElement) container.parentElement.scrollTop = scrollTop;
}

// ==========================================
// 6. GESTIÓN DE POIS (IMÁGENES Y EMOJIS)
// ==========================================

// Helper: Distingue si es Emoji (texto) o Ruta de Archivo/URL
function getIconHtml(icon) {
    // Si la cadena contiene un punto (.), una barra (/), o es muy larga, asumimos que es una ruta/URL
    if (icon && (icon.includes('.') || icon.includes('/'))) {
        return `<img src="${icon}" class="poi-sticker-img" alt="POI">`;
    } else {
        // De lo contrario, lo tratamos como un emoji de texto
        return `<span class="poi-sticker-text">${icon || '⭐'}</span>`;
    }
}

function renderPoiSidebar() {
    const container = document.getElementById('pois-sidebar-list');
    const msg = document.getElementById('no-pois-msg');
    container.innerHTML = '';
    
    if (appData.pois.length === 0) {
        msg.classList.remove('d-none');
    } else {
        msg.classList.add('d-none');
        appData.pois.forEach(poi => {
            const item = document.createElement('div');
            item.className = 'list-group-item list-group-item-action d-flex align-items-center justify-content-between p-2';
            
            item.innerHTML = `
                <div class="d-flex align-items-center flex-grow-1 overflow-hidden me-2">
                    <span class="fs-4 me-2" style="cursor:pointer;" onclick="focusOnPoi(${poi.id})">
                        ${getIconHtml(poi.icon)}
                    </span>
                    
                    <input type="text" class="poi-name-input" 
                           value="${poi.name}" 
                           onchange="updatePoiName(${poi.id}, this.value)"
                           onclick="event.stopPropagation()">
                </div>
                
                <div class="d-flex align-items-center">
                    <button class="btn btn-sm btn-light text-primary me-1" title="Cambiar Icono" onclick="openStickerSelector(${poi.id})">
                        <i class="fa-solid fa-icons"></i>
                    </button>
                    <button class="btn btn-sm btn-light text-danger" title="Borrar" onclick="deletePoi(${poi.id})">
                        <i class="fa-solid fa-times"></i>
                    </button>
                </div>
            `;
            
            item.addEventListener('mouseenter', () => highlightMarker(poi.id, true));
            item.addEventListener('mouseleave', () => highlightMarker(poi.id, false));
            container.appendChild(item);
        });
    }
}

window.updatePoiName = function(id, newName) {
    const poi = appData.pois.find(p => p.id === id);
    if(poi) {
        poi.name = newName;
        saveData();
        renderPOIsOnMap(); 
    }
};

function renderPOIsOnMap() {
    poiLayerGroup.clearLayers();
    appData.pois.forEach(poi => {
        const iconHtmlContent = getIconHtml(poi.icon);

        const marker = L.marker(poi.latLng, {
            icon: L.divIcon({
                className: 'custom-poi-icon',
                html: `<div class="poi-sticker shadow-sm">${iconHtmlContent}</div>`,
                iconSize: [40, 40],
                iconAnchor: [20, 40],
                popupAnchor: [0, -40]
            })
        });

        marker.on('click', () => {
            map.setView(poi.latLng, 16); 
        });
        marker.on('mouseover', function() { this._icon.classList.add('marker-hover'); });
        marker.on('mouseout', function() { this._icon.classList.remove('marker-hover'); });

        marker.bindPopup(`
            <div class="text-center">
                <h6>${poi.name}</h6>
                <div class="btn-group btn-group-sm">
                    <button class="btn btn-primary" onclick="convertPoiToStop(${poi.id})">Añadir a Ruta</button>
                    <button class="btn btn-outline-secondary" onclick="openStickerSelector(${poi.id})">Icono</button>
                </div>
            </div>
        `);

        marker.poiId = poi.id; 
        marker.addTo(poiLayerGroup);
    });
}

window.focusOnPoi = function(id) {
    const poi = appData.pois.find(p => p.id === id);
    if(poi) {
        map.setView(poi.latLng, 16);
        poiLayerGroup.eachLayer(layer => {
            if(layer.poiId === id) layer.openPopup();
        });
    }
};

window.deletePoi = function(id) {
    if(!confirm("¿Eliminar este punto?")) return;
    appData.pois = appData.pois.filter(p => p.id !== id);
    renderPOIsOnMap();
    renderPoiSidebar();
    saveData();
};

window.openStickerSelector = function(id) {
    currentPoiEditId = id;
    const grid = document.getElementById('sticker-grid');
    if (typeof STICKERS === 'undefined') {
        console.error("Falta js/stickers.js");
        grid.innerHTML = "<p class='text-danger'>Error: stickers.js no cargado</p>";
        return;
    }

    grid.innerHTML = STICKERS.map(s => {
        const content = getIconHtml(s);
        return `<button class="btn btn-outline-light border shadow-sm fs-4 p-2" onclick="selectSticker('${s}')" style="line-height:1; min-height:50px; min-width:50px;">${content}</button>`;
    }).join('');
    new bootstrap.Modal(document.getElementById('stickerModal')).show();
};

window.selectSticker = function(sticker) {
    if(currentPoiEditId) {
        const poi = appData.pois.find(p => p.id === currentPoiEditId);
        if(poi) {
            poi.icon = sticker;
            renderPOIsOnMap();
            renderPoiSidebar();
            saveData();
        }
    }
    bootstrap.Modal.getInstance(document.getElementById('stickerModal')).hide();
};

// ==========================================
// 7. UTILIDADES
// ==========================================

function highlightMarker(id, isActive) {
    poiLayerGroup.eachLayer(layer => {
        if(layer.poiId === id) {
            if(isActive) layer._icon.classList.add('marker-hover');
            else layer._icon.classList.remove('marker-hover');
        }
    });
}

window.convertPoiToStop = function(id) {
    if (!activeStageId) { alert("Selecciona una etapa primero"); return; }
    const poi = appData.pois.find(p => p.id === id);
    const stage = appData.stages.find(s => s.id === activeStageId);
    stage.waypoints.push({ latLng: poi.latLng, name: poi.name });
    refreshMapRoute(activeStageId); 
    renderSidebar();
    saveData();
    map.closePopup();
};

window.resetAllData = function() {
    if(confirm("¿Estás seguro de BORRAR TODO el viaje? No se puede deshacer.")) {
        localStorage.removeItem('camperViaje');
        location.reload();
    }
};

window.generateShareLink = function() {
    const compressed = LZString.compressToEncodedURIComponent(JSON.stringify(appData));
    const url = window.location.origin + window.location.pathname + '#route=' + compressed;
    navigator.clipboard.writeText(url).then(() => alert("✅ ¡Enlace copiado! Puedes compartirlo."));
};

function loadAppData(json) {
    Object.values(stageRoutingControls).forEach(c => map.removeControl(c));
    stageRoutingControls = {};
    routingQueue = []; 
    
    appData = json;
    renderPOIsOnMap(); 
    renderPoiSidebar(); 
    appData.stages.forEach(s => { 
        if(s.visible && s.waypoints.length >= 2) refreshMapRoute(s.id); 
    });
    renderSidebar();
}

function getRandomColor() { return '#' + Math.floor(Math.random()*16777215).toString(16); }

// ==========================================
// 8. RUTAS (MOTOR DE ENRUTAMIENTO)
// ==========================================

function refreshMapRoute(stageId, skipSidebar = false) {
    if (!routingQueue.some(item => item.stageId === stageId)) {
        routingQueue.push({ stageId, skipSidebar });
    }
    processRoutingQueue();
}

async function processRoutingQueue() {
    if (isProcessingQueue || routingQueue.length === 0) return;
    isProcessingQueue = true;
    const { stageId, skipSidebar } = routingQueue.shift();
    const stage = appData.stages.find(s => s.id === stageId);

    if (stageRoutingControls[stageId]) { 
        map.removeControl(stageRoutingControls[stageId]); 
        delete stageRoutingControls[stageId]; 
    }

    if (!stage || !stage.visible || stage.waypoints.length < 2) {
        if (stage && stage.waypoints.length < 2) stage.distance = 0;
        if (!skipSidebar) renderSidebar();
        saveData();
        isProcessingQueue = false;
        processRoutingQueue();
        return;
    }
    
    const ORSRouter = new L.Routing.openrouteserviceV2(ORS_API_KEY, { profile: 'driving-car' });

    const control = L.Routing.control({
        router: ORSRouter,
        waypoints: stage.waypoints.map(w => w.latLng),
        routeWhileDragging: false, 
        show: false, 
        addWaypoints: true,
        createMarker: (i, wp, nWps) => {
            let iconClass = i === 0 ? 'fa-flag' : i === nWps - 1 ? 'fa-flag-checkered' : 'fa-map-pin';
            const m = L.marker(wp.latLng, {
                draggable: true,
                icon: L.divIcon({
                    className: 'custom-div-icon',
                    html: `<div class='marker-pin' style='background-color: ${stage.color};'><i class='fa-solid ${iconClass}'></i></div>`,
                    iconSize: [30, 42], iconAnchor: [15, 42], popupAnchor: [0, -38]
                })
            });
            
            m.on('dragend', (e) => { 
                stage.waypoints[i].latLng = e.target.getLatLng(); 
                refreshMapRoute(stage.id); 
            });
            
            m.bindPopup(`<div class="text-center fw-bold">${stage.waypoints[i].name}</div>`);
            
            m.on('mouseover', function() { this._icon.classList.add('marker-hover'); });
            m.on('mouseout', function() { this._icon.classList.remove('marker-hover'); });

            return m;
        },
        lineOptions: { styles: [{color: stage.color, opacity: 0.8, weight: 5}], addWaypoints: false }
    }).addTo(map);

    stageRoutingControls[stageId] = control;

    control.on('routesfound', (e) => {
        stage.distance = e.routes[0].summary.totalDistance / 1000;
        saveData();
        if (!skipSidebar) renderSidebar();
        else {
            const badge = document.getElementById(`km-badge-${stage.id}`);
            if(badge) badge.innerText = stage.distance.toFixed(1) + " km";
            const totalKm = appData.stages.reduce((acc, s) => acc + (s.visible ? s.distance : 0), 0);
            document.getElementById('total-km').innerText = totalKm.toFixed(1) + " km";
        }
        setTimeout(() => { isProcessingQueue = false; processRoutingQueue(); }, 200); 
    });

    control.on('routingerror', (e) => {
        console.warn(`Error ruta ${stageId}`, e);
        isProcessingQueue = false;
        processRoutingQueue();
    });
}

// INICIAR
initApp();