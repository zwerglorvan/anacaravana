/**
 * APP.JS - Planificador de Viajes en Autocaravana (Refactorizado)
 */

// ==========================================
// 1. CONFIGURACIÓN E INICIALIZACIÓN
// ==========================================

// IMPORTANTE: Pon aquí tu API KEY real de OpenRouteService (cadena de texto normal)
// La que tenías oculta en el Base64 parecía ser esta: "5b3ce3597851110001cf6248"
// Si no funciona, regístrate en openrouteservice.org y genera una nueva "Standard Key".
const ORS_API_KEY = "5b3ce3597851110001cf6248"; 

const map = L.map('map', {
    center: [40.416775, -3.703790],
    zoom: 6
});

// Capas base
const baseLayers = {
    "Carreteras": L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenStreetMap'
    }).addTo(map),
    "Satélite": L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
        attribution: 'Tiles &copy; Esri'
    }),
    "Relieve": L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
        attribution: '© OpenTopoMap'
    })
};
L.control.layers(baseLayers).addTo(map);

const poiLayerGroup = L.layerGroup().addTo(map);

// Geocoder
const geocoder = L.Control.Geocoder.nominatim();
L.Control.geocoder({
    geocoder: geocoder,
    defaultMarkGeocode: false,
    placeholder: "Buscar lugar...",
    errorMessage: "No encontrado."
})
.on('markgeocode', e => {
    handleMapInteraction(e.geocode.center, e.geocode.name);
    map.setView(e.geocode.center, 14);
})
.addTo(map);

// ==========================================
// 2. ESTADO DE LA APLICACIÓN
// ==========================================

let appData = { stages: [], pois: [] };
let stageRoutingControls = {}; 
let activeStageId = null; 

// Variables temporales para interacción
let tempClickLocation = null;    
let tempLocationName = "";       

// Cola de enrutamiento para no saturar la API
let routingQueue = [];
let isProcessingQueue = false;

// ==========================================
// 3. INTERACCIÓN (CLICS Y MODAL)
// ==========================================

map.on('click', e => handleMapInteraction(e.latlng));

function handleMapInteraction(latlng, preloadedName = null) {
    tempClickLocation = latlng;
    const modal = new bootstrap.Modal(document.getElementById('clickActionModal'));
    modal.show();

    const previewText = document.getElementById('modal-address-preview');
    
    if (preloadedName) {
        tempLocationName = preloadedName;
        previewText.innerHTML = `<strong>${preloadedName}</strong>`;
    } else {
        tempLocationName = `${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}`;
        previewText.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Buscando dirección...';
        
        geocoder.reverse(latlng, map.options.crs.scale(map.getZoom()), results => {
            if (results && results.length > 0) {
                tempLocationName = results[0].name;
                // Verificar si el elemento aún existe en el DOM por si cerraron el modal
                if(document.getElementById('modal-address-preview')) {
                    document.getElementById('modal-address-preview').innerHTML = `<strong>${tempLocationName}</strong>`;
                }
            } else {
                if(document.getElementById('modal-address-preview')) {
                    document.getElementById('modal-address-preview').innerText = tempLocationName;
                }
            }
        });
    }
}

// Funciones expuestas al HTML (window)
window.addCurrentLocToStage = function() {
    if (!activeStageId) {
        alert("Selecciona o crea una etapa primero.");
        return;
    }
    const stage = appData.stages.find(s => s.id === activeStageId);
    if(stage) {
        stage.waypoints.push({ latLng: tempClickLocation, name: tempLocationName });
        stage.visible = true; 
        refreshMapRoute(stage.id); 
        renderSidebar();
    }
    bootstrap.Modal.getInstance(document.getElementById('clickActionModal')).hide();
};

window.addCurrentLocAsPOI = function() {
    const newPoi = { id: Date.now(), latLng: tempClickLocation, name: tempLocationName };
    appData.pois.push(newPoi);
    renderPOIsOnMap();
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
    setActiveStage(id); 
    renderSidebar();
};

window.setActiveStage = function(id) {
    activeStageId = id;
    renderSidebar(); 
};

window.toggleStageVisibility = function(event, id) {
    event.stopPropagation(); 
    const stage = appData.stages.find(s => s.id === id);
    if(stage) {
        stage.visible = !stage.visible;
        refreshMapRoute(id, true);
        renderSidebar();
    }
};

window.updateStageColor = function(id, newColor) {
    const stage = appData.stages.find(s => s.id === id);
    if(stage) {
        stage.color = newColor;
        refreshMapRoute(id, true);
    }
};

window.updateStageName = function(id, newName) {
    const stage = appData.stages.find(s => s.id === id);
    if(stage) stage.name = newName;
};

window.toggleAccordion = function(id) {
    const stage = appData.stages.find(s => s.id === id);
    if(stage) {
        stage.isOpen = !stage.isOpen;
        if (stage.isOpen) activeStageId = id;
        renderSidebar();
    }
};

window.deleteStage = function(id) {
    if(!confirm("¿Borrar etapa?")) return;
    if (stageRoutingControls[id]) {
        map.removeControl(stageRoutingControls[id]);
        delete stageRoutingControls[id];
    }
    appData.stages = appData.stages.filter(s => s.id !== id);
    if (activeStageId === id) activeStageId = null;
    renderSidebar();
};

window.removeWaypoint = function(stageId, index) {
    const stage = appData.stages.find(s => s.id === stageId);
    if(stage) {
        stage.waypoints.splice(index, 1);
        refreshMapRoute(stageId);
        renderSidebar();
    }
};

// ==========================================
// 5. RENDERIZADO DEL SIDEBAR
// ==========================================

function renderSidebar() {
    const container = document.getElementById('stages-list');
    container.innerHTML = '';
    let totalTripKm = 0;

    appData.stages.forEach((stage) => {
        if(stage.visible) totalTripKm += stage.distance;
        const isActive = stage.id === activeStageId;
        
        // Generar HTML de waypoints
        let waypointsHtml = stage.waypoints.length === 0 
            ? '<div class="text-muted small fst-italic p-2">Sin paradas.</div>'
            : stage.waypoints.map((wp, idx) => {
                let badgeClass = (idx === 0) ? "bg-success" : (idx === stage.waypoints.length - 1) ? "bg-dark" : "bg-primary";
                let label = (idx === 0) ? "Origen" : (idx === stage.waypoints.length - 1) ? "Destino" : "Parada";
                return `
                    <div class="waypoint-item small" data-index="${idx}">
                        <div class="d-flex align-items-center overflow-hidden w-100">
                            <span class="badge ${badgeClass} me-2" style="min-width:50px;">${label}</span>
                            <span class="text-truncate">${wp.name}</span>
                        </div>
                        <button class="btn btn-link text-danger p-0 ms-2" onclick="removeWaypoint(${stage.id}, ${idx})">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>`;
            }).join('');

        const card = document.createElement('div');
        card.className = `accordion-item mb-2 rounded overflow-hidden border ${isActive ? 'border-primary shadow-sm' : ''}`;
        card.innerHTML = `
            <div class="accordion-header d-flex align-items-center border-bottom bg-light">
                <button class="btn-visibility ms-2 ${stage.visible ? 'active' : ''}" onclick="toggleStageVisibility(event, ${stage.id})">
                    <i class="fa-solid ${stage.visible ? 'fa-eye' : 'fa-eye-slash'}"></i>
                </button>
                <div class="color-picker-wrapper ms-2">
                    <input type="color" class="color-picker-input" value="${stage.color}" oninput="updateStageColor(${stage.id}, this.value)">
                </div>
                <div class="accordion-button-custom ${stage.isOpen ? '' : 'collapsed'} flex-grow-1" role="button" onclick="toggleAccordion(${stage.id})">
                    <input type="text" class="stage-name-input" value="${stage.name}" onclick="event.stopPropagation()" onchange="updateStageName(${stage.id}, this.value)">
                    <span class="badge bg-secondary ms-auto small" id="km-badge-${stage.id}">${(stage.distance).toFixed(1)} km</span>
                    <i class="fa-solid fa-chevron-down ms-2 transition-icon" style="transform: ${stage.isOpen ? 'rotate(180deg)' : 'rotate(0)'}"></i>
                </div>
            </div>
            <div class="accordion-collapse collapse ${stage.isOpen ? 'show' : ''}">
                <div class="accordion-body p-2 bg-white">
                    <div id="waypoints-list-${stage.id}" class="list-group mb-3">${waypointsHtml}</div>
                    <div class="d-flex justify-content-end">
                        ${!isActive ? `<button class="btn btn-sm btn-outline-primary me-2" onclick="setActiveStage(${stage.id})">Seleccionar</button>` : ''}
                        <button class="btn btn-sm btn-outline-danger" onclick="deleteStage(${stage.id})"><i class="fas fa-trash"></i></button>
                    </div>
                </div>
            </div>`;
        container.appendChild(card);

        // Activar Drag & Drop si está abierto
        if (stage.isOpen && stage.waypoints.length > 0) {
            new Sortable(document.getElementById(`waypoints-list-${stage.id}`), {
                animation: 150,
                onEnd: function (evt) {
                    const movedItem = stage.waypoints.splice(evt.oldIndex, 1)[0];
                    stage.waypoints.splice(evt.newIndex, 0, movedItem);
                    refreshMapRoute(stage.id);
                    renderSidebar();
                }
            });
        }
    });
    document.getElementById('total-km').innerText = totalTripKm.toFixed(1) + " km";
}

// ==========================================
// 6. LÓGICA DE RUTAS (CONECTADO AL NUEVO ADAPTER)
// ==========================================

function refreshMapRoute(stageId, skipSidebarUpdate = false) {
    if (!routingQueue.some(item => item.stageId === stageId)) {
        routingQueue.push({ stageId, skipSidebarUpdate });
    }
    processRoutingQueue();
}

async function processRoutingQueue() {
    if (isProcessingQueue || routingQueue.length === 0) return;

    isProcessingQueue = true;
    const { stageId, skipSidebarUpdate } = routingQueue.shift();
    const stage = appData.stages.find(s => s.id === stageId);

    // Limpieza de control anterior si existe
    if (stageRoutingControls[stageId]) { 
        map.removeControl(stageRoutingControls[stageId]); 
        delete stageRoutingControls[stageId]; 
    }

    // Validaciones básicas
    if (!stage || !stage.visible || stage.waypoints.length < 2) {
        if (stage && stage.waypoints.length < 2) stage.distance = 0;
        if (!skipSidebarUpdate) renderSidebar();
        isProcessingQueue = false;
        processRoutingQueue(); // Siguiente en la cola
        return;
    }
    
    // Instanciar el nuevo router (sin base64, usando la Key directa)
    const ORSRouter = new L.Routing.openrouteserviceV2(ORS_API_KEY, {
        profile: 'driving-car'
    });

    const control = L.Routing.control({
        router: ORSRouter,
        waypoints: stage.waypoints.map(w => w.latLng),
        routeWhileDragging: false, 
        show: false, 
        addWaypoints: false,
        createMarker: (i, wp, nWps) => {
            // Personalización de marcadores
            let iconClass = i === 0 ? 'fa-flag' : i === nWps - 1 ? 'fa-flag-checkered' : 'fa-map-pin';
            return L.marker(wp.latLng, {
                draggable: true,
                icon: L.divIcon({
                    className: 'custom-div-icon',
                    html: `<div class='marker-pin' style='background-color: ${stage.color};'><i class='fa-solid ${iconClass}'></i></div>`,
                    iconSize: [30, 42], iconAnchor: [15, 42], popupAnchor: [0, -38]
                })
            }).on('dragend', (e) => { 
                stage.waypoints[i].latLng = e.target.getLatLng(); 
                refreshMapRoute(stage.id); 
            });
        },
        lineOptions: { 
            styles: [{color: stage.color, opacity: 0.8, weight: 5}],
            addWaypoints: false 
        }
    }).addTo(map);

    stageRoutingControls[stageId] = control;

    control.on('routesfound', (e) => {
        // En ORS V2 distance viene en metros
        stage.distance = e.routes[0].summary.totalDistance / 1000;
        
        if (!skipSidebarUpdate) {
            renderSidebar();
        } else {
            // Actualización ligera del DOM
            const badge = document.getElementById(`km-badge-${stage.id}`);
            if(badge) badge.innerText = stage.distance.toFixed(1) + " km";
            
            const totalKm = appData.stages.reduce((acc, s) => acc + (s.visible ? s.distance : 0), 0);
            document.getElementById('total-km').innerText = totalKm.toFixed(1) + " km";
        }
        
        // Dar un respiro a la API
        setTimeout(() => {
            isProcessingQueue = false;
            processRoutingQueue();
        }, 200); 
    });

    control.on('routingerror', (e) => {
        console.warn(`Error routing etapa ${stageId}:`, e);
        // No reintentamos infinitamente para evitar bucles si la API key falla
        isProcessingQueue = false;
        processRoutingQueue();
    });
}

// ==========================================
// 7. COMPARTIR, EXPORTAR E IMPORTAR
// ==========================================

window.generateShareLink = function() {
    const compressed = LZString.compressToEncodedURIComponent(JSON.stringify(appData));
    const url = window.location.origin + window.location.pathname + '#route=' + compressed;
    navigator.clipboard.writeText(url).then(() => alert("✅ ¡Enlace copiado!"));
};

window.exportData = function() {
    const a = document.createElement('a');
    a.href = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(appData));
    a.download = "viaje.json"; a.click();
};

window.importData = function(input) {
    if(!input.files[0]) return;
    const reader = new FileReader();
    reader.onload = (e) => loadAppData(JSON.parse(e.target.result));
    reader.readAsText(input.files[0]);
};

window.convertPoiToStop = function(id) {
    if (!activeStageId) {
        alert("Selecciona una etapa activa primero.");
        return;
    }
    const poi = appData.pois.find(p => p.id === id);
    const stage = appData.stages.find(s => s.id === activeStageId);
    if(poi && stage) {
        stage.waypoints.push({ latLng: poi.latLng, name: poi.name });
        refreshMapRoute(activeStageId); 
        renderSidebar(); 
        map.closePopup();
    }
};

function loadAppData(json) {
    // Limpieza total
    Object.values(stageRoutingControls).forEach(c => map.removeControl(c));
    stageRoutingControls = {};
    routingQueue = []; 
    isProcessingQueue = false;
    
    appData = json;
    
    // Restaurar POIs
    renderPOIsOnMap(); 
    
    // Restaurar rutas visibles
    appData.stages.forEach(s => { 
        if(s.visible && s.waypoints.length >= 2) refreshMapRoute(s.id); 
    });
    
    renderSidebar();
}

function renderPOIsOnMap() {
    poiLayerGroup.clearLayers();
    appData.pois.forEach(poi => {
        L.marker(poi.latLng, {
            icon: L.divIcon({ className: 'custom-div-icon', html: `<div class='marker-pin marker-poi'><i class='fa-solid fa-star'></i></div>`, iconSize: [30, 42], iconAnchor: [15, 42] })
        }).addTo(poiLayerGroup).bindPopup(`<h6>${poi.name}</h6><button class="btn btn-sm btn-primary" onclick="convertPoiToStop(${poi.id})">Añadir a Etapa</button>`);
    });
}

function getRandomColor() { return '#' + Math.floor(Math.random()*16777215).toString(16); }

// Carga inicial desde URL si existe
function checkForSharedUrl() {
    const hash = window.location.hash.substring(1); 
    if (hash.startsWith('route=')) {
        try {
            const compressed = hash.substring(6);
            const jsonString = LZString.decompressFromEncodedURIComponent(compressed);
            if (jsonString) {
                loadAppData(JSON.parse(jsonString)); 
                history.replaceState(null, null, ' '); 
            }
        } catch (error) {
            console.error("Error al cargar URL compartida:", error);
        }
    }
}

// Iniciar
checkForSharedUrl();