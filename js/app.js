/**
 * APP.JS - Anacaravana (Versión Synthwave Refined)
 */

// ==========================================
// 1. CONFIGURACIÓN E INICIALIZACIÓN
// ==========================================

const ORS_API_KEY = "eyJvcmciOiI1YjNjZTM1OTc4NTExMTAwMDFjZjYyNDgiLCJpZCI6IjRhMjZhM2EzOTYyYzQ3YjhiYzJmNzE5MjFmMDdiMjM2IiwiaCI6Im11cm11cjY0In0="; 

const map = L.map('map', { center: [40.4167, -3.7037], zoom: 6, zoomControl: false });
L.control.zoom({ position: 'topright' }).addTo(map);

const baseLayers = {
    "Carreteras (Retro)": L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', { attribution: '© OSM' }).addTo(map),
    "Satélite": L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', { attribution: '© Esri' }),
    "Relieve": L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', { attribution: '© OpenTopoMap' })
};
L.control.layers(baseLayers).addTo(map);

const poiLayerGroup = L.layerGroup().addTo(map);

const geocoder = L.Control.Geocoder.nominatim();
L.Control.geocoder({ geocoder, defaultMarkGeocode: false, placeholder: "Buscar destino...", errorMessage: "ERROR 404" })
.on('markgeocode', e => { handleMapInteraction(e.geocode.center, e.geocode.name); map.setView(e.geocode.center, 14); })
.addTo(map);

// ==========================================
// 2. ESTADO Y PERSISTENCIA
// ==========================================

let appData = { stages: [], pois: [] };
let stageRoutingControls = {}; 
let stageMarkers = {}; // Almacena referencias a los marcadores de mapa para efectos visuales
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
        preview.innerHTML = '<i class="fas fa-spinner fa-spin"></i> ESCANEANDO SECTOR...';
        
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
        name: `MISION ${appData.stages.length + 1}`,
        waypoints: [],
        distance: 0,
        color: getRandomNeonColor(),
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
        el.classList.remove('border-neon-active');
        el.style.borderColor = 'rgba(255, 0, 255, 0.3)';
    });
    const activeCard = document.getElementById(`stage-card-${id}`);
    if(activeCard) {
        activeCard.style.borderColor = '#00ffff';
        activeCard.style.boxShadow = '0 0 10px rgba(0, 255, 255, 0.2)';
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
    if(!confirm("¿ABORTAR MISIÓN? Esta etapa se perderá.")) return;
    if (stageRoutingControls[id]) { map.removeControl(stageRoutingControls[id]); delete stageRoutingControls[id]; }
    delete stageMarkers[id]; // Limpiar referencias de marcadores
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
            ? '<div class="text-muted small fst-italic p-2">>> SIN WAYPOINTS</div>'
            : stage.waypoints.map((wp, idx) => `
                <div class="waypoint-item small" data-index="${idx}" 
                     onmouseenter="highlightWaypoint(${stage.id}, ${idx}, true)" 
                     onmouseleave="highlightWaypoint(${stage.id}, ${idx}, false)">
                    <span class="badge ${idx===0?'bg-success':idx===stage.waypoints.length-1?'bg-danger':'bg-secondary'} me-2 border border-white">
                        ${idx===0?'START':idx===stage.waypoints.length-1?'END':idx}
                    </span>
                    <span class="text-truncate flex-grow-1 cursor-zoom" 
                          onclick="map.setView([${wp.latLng.lat}, ${wp.latLng.lng}], 16)" 
                          title="Zoom">
                        ${wp.name}
                    </span>
                    <button class="btn btn-link text-danger p-0 ms-2" onclick="removeWaypoint(${stage.id}, ${idx})"><i class="fas fa-times"></i></button>
                </div>`).join('');

        const card = document.createElement('div');
        card.id = `stage-card-${stage.id}`;
        const borderStyle = isActive ? 'border-color: #00ffff; box-shadow: 0 0 8px rgba(0,255,255,0.4);' : '';
        card.className = `accordion-item mb-2`;
        card.style.cssText = borderStyle;
        
        card.innerHTML = `
            <div class="accordion-header d-flex align-items-center p-1" 
                 onclick="setActiveStage(${stage.id})" 
                 style="cursor: pointer;">
                 
                <button class="btn btn-sm" onclick="toggleStageVisibility(event, ${stage.id})">
                    <i class="fa-solid ${stage.visible ? 'fa-eye text-neon-pink' : 'fa-eye-slash text-muted'}"></i>
                </button>
                
                <div class="color-picker-wrapper ms-2" onclick="event.stopPropagation()" style="border-color: #fff;">
                    <input type="color" class="color-picker-input" value="${stage.color}" oninput="updateStageColor(${stage.id}, this.value)">
                </div>
                
                <div class="flex-grow-1 ms-2">
                    <input type="text" class="form-control form-control-sm fw-bold p-0 orbitron-font" 
                           style="color: ${isActive ? '#00ffff' : '#fff'} !important;"
                           value="${stage.name}" 
                           onclick="setActiveStage(${stage.id})" 
                           onchange="updateStageName(${stage.id}, this.value)">
                </div>
                
                <span class="badge bg-transparent border border-secondary text-light ms-2">${stage.distance.toFixed(1)} km</span>
                
                <button class="btn btn-link text-light p-0 ms-2 me-2 accordion-button-custom ${stage.isOpen ? '' : 'collapsed'}" 
                        type="button"
                        data-bs-toggle="collapse" 
                        data-bs-target="#${collapseId}"
                        onclick="event.stopPropagation()">
                    <i class="fa-solid fa-chevron-down transition-icon"></i>
                </button>
            </div>
            
            <div id="${collapseId}" class="accordion-collapse collapse ${stage.isOpen ? 'show' : ''}">
                <div class="accordion-body p-2">
                    <div id="wp-list-${stage.id}" class="list-group mb-2">${waypointsHtml}</div>
                    <div class="d-flex justify-content-end gap-2">
                         <button class="btn btn-sm btn-outline-danger" onclick="deleteStage(${stage.id})"><i class="fas fa-trash"></i> ELIMINAR</button>
                    </div>
                </div>
            </div>`;
        container.appendChild(card);

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

function getIconHtml(icon) {
    if (icon && (icon.includes('.') || icon.includes('/'))) {
        return `<img src="${icon}" class="poi-sticker-img" alt="POI">`;
    } else {
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
            
            // Añadidos eventos de mouse para el efecto pulsatil
            item.addEventListener('mouseenter', () => highlightMarker(poi.id, true));
            item.addEventListener('mouseleave', () => highlightMarker(poi.id, false));

            item.innerHTML = `
                <div class="d-flex align-items-center flex-grow-1 overflow-hidden me-2">
                    <span class="fs-4 me-2" style="cursor:pointer;" onclick="focusOnPoi(${poi.id})">
                        ${getIconHtml(poi.icon)}
                    </span>
                    
                    <input type="text" class="poi-name-input bg-transparent border-0" 
                           value="${poi.name}" 
                           onchange="updatePoiName(${poi.id}, this.value)"
                           onclick="event.stopPropagation()">
                </div>
                
                <div class="d-flex align-items-center">
                    <button class="btn btn-sm btn-outline-cyan me-1" title="Cambiar Icono" onclick="openStickerSelector(${poi.id})">
                        <i class="fa-solid fa-icons"></i>
                    </button>
                    <button class="btn btn-sm btn-outline-danger" title="Borrar" onclick="deletePoi(${poi.id})">
                        <i class="fa-solid fa-times"></i>
                    </button>
                </div>
            `;
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
                html: `<div class="poi-sticker">${iconHtmlContent}</div>`,
                iconSize: [40, 40],
                iconAnchor: [20, 40],
                popupAnchor: [0, -40]
            })
        });

        // Solo mostrar popup con nombre, sin botones, y sin zoom automático
        marker.bindPopup(`
            <div class="text-center orbitron-font" style="color: #000; font-size: 1.1em; font-weight: bold;">
                ${poi.name}
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
        grid.innerHTML = "<p class='text-danger'>Error: stickers.js no cargado</p>";
        return;
    }

    grid.innerHTML = STICKERS.map(s => {
        const content = getIconHtml(s);
        return `<button class="btn btn-outline-light border border-secondary shadow-sm fs-4 p-2" onclick="selectSticker('${s}')" style="line-height:1; min-height:50px; min-width:50px; background: rgba(0,0,0,0.5);">${content}</button>`;
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
// 7. UTILIDADES VISUALES (EFECTO NEÓN)
// ==========================================

// Para POIs
function highlightMarker(id, isActive) {
    poiLayerGroup.eachLayer(layer => {
        if(layer.poiId === id) {
            if(isActive) layer._icon.classList.add('marker-pulse');
            else layer._icon.classList.remove('marker-pulse');
        }
    });
}

// Para Waypoints (NUEVO)
window.highlightWaypoint = function(stageId, index, isActive) {
    if (stageMarkers[stageId] && stageMarkers[stageId][index]) {
        const marker = stageMarkers[stageId][index];
        if (marker._icon) {
            if (isActive) marker._icon.classList.add('marker-pulse');
            else marker._icon.classList.remove('marker-pulse');
        }
    }
};

window.convertPoiToStop = function(id) {
    // Vestigio de funcionalidad anterior, mantenemos por compatibilidad si se reactiva,
    // pero ya no se llama desde el popup.
};

window.resetAllData = function() {
    if(confirm("⚠ PELIGRO: ¿BORRAR TODA LA INFORMACIÓN?")) {
        localStorage.removeItem('camperViaje');
        location.reload();
    }
};

window.generateShareLink = function() {
    const compressed = LZString.compressToEncodedURIComponent(JSON.stringify(appData));
    const url = window.location.origin + window.location.pathname + '#route=' + compressed;
    navigator.clipboard.writeText(url).then(() => alert("✅ Enlace copiado al portapapeles"));
};

function loadAppData(json) {
    Object.values(stageRoutingControls).forEach(c => map.removeControl(c));
    stageRoutingControls = {};
    stageMarkers = {}; // Reset markers
    routingQueue = []; 
    
    appData = json;
    renderPOIsOnMap(); 
    renderPoiSidebar(); 
    appData.stages.forEach(s => { 
        if(s.visible && s.waypoints.length >= 2) refreshMapRoute(s.id); 
    });
    renderSidebar();
}

function getRandomNeonColor() { 
    const neonColors = ['#ff00ff', '#00ffff', '#ffff00', '#ff0099', '#39ff14', '#bc13fe'];
    return neonColors[Math.floor(Math.random() * neonColors.length)];
}

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
        delete stageMarkers[stageId];
    }

    if (!stage || !stage.visible || stage.waypoints.length < 2) {
        if (stage && stage.waypoints.length < 2) stage.distance = 0;
        if (!skipSidebar) renderSidebar();
        saveData();
        isProcessingQueue = false;
        processRoutingQueue();
        return;
    }
    
    // Inicializar array de marcadores para esta etapa
    stageMarkers[stageId] = [];

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
                    html: `<div class='marker-pin' style='background-color: ${stage.color}; box-shadow: 0 0 10px ${stage.color};'><i class='fa-solid ${iconClass}'></i></div>`,
                    iconSize: [30, 42], iconAnchor: [15, 42], popupAnchor: [0, -38]
                })
            });
            
            m.on('dragend', (e) => { 
                stage.waypoints[i].latLng = e.target.getLatLng(); 
                refreshMapRoute(stage.id); 
            });
            
            // --- CAMBIO AQUÍ: Tipografía Orbitron para el popup de la ruta ---
            m.bindPopup(`
                <div class="text-center orbitron-font" style="color: #000; font-size: 1.1em; font-weight: bold;">
                    ${stage.waypoints[i].name}
                </div>
            `);
            
            stageMarkers[stageId][i] = m;

            return m;
        },
        lineOptions: { styles: [{color: stage.color, opacity: 0.9, weight: 6, className: 'neon-path'}], addWaypoints: false }
    }).addTo(map);

    stageRoutingControls[stageId] = control;

    control.on('routesfound', (e) => {
        stage.distance = e.routes[0].summary.totalDistance / 1000;
        saveData();
        if (!skipSidebar) renderSidebar();
        else {
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

initApp();