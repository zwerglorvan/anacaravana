/**
 * APP.JS - Planificador de Viajes en Autocaravana
 * -----------------------------------------------
 */

// ==========================================
// 1. INICIALIZACIÓN DEL MAPA Y CAPAS
// ==========================================

var osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
});

var satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
});

var terrain = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    attribution: 'Map data: &copy; OpenStreetMap contributors, SRTM | Map style: &copy; OpenTopoMap (CC-BY-SA)'
});

var map = L.map('map', {
    center: [40.416775, -3.703790],
    zoom: 6,
    layers: [osm]
});

var baseMaps = {
    "Carreteras": osm,
    "Satélite": satellite,
    "Relieve": terrain
};
L.control.layers(baseMaps).addTo(map);

var poiLayerGroup = L.layerGroup().addTo(map);

var geocoder = L.Control.Geocoder.nominatim();
L.Control.geocoder({
    geocoder: geocoder,
    defaultMarkGeocode: false,
    placeholder: "Buscar lugar...",
    errorMessage: "No se ha encontrado nada."
})
.on('markgeocode', function(e) {
    var latlng = e.geocode.center;
    var name = e.geocode.name;
    handleMapInteraction(latlng, name);
    map.setView(latlng, 14);
})
.addTo(map);

// ==========================================
// 2. ESTADO DE LA APLICACIÓN
// ==========================================

let appData = {
    stages: [], 
    pois: []    
};

let stageRoutingControls = {}; 
let activeStageId = null; 
let tempClickLocation = null;    
let tempLocationName = "";       

let routingQueue = [];
let isProcessingQueue = false;

// ==========================================
// 3. INTERACCIÓN (CLICS Y MODAL)
// ==========================================

map.on('click', function(e) {
    handleMapInteraction(e.latlng);
});

function handleMapInteraction(latlng, preloadedName = null) {
    tempClickLocation = latlng;
    var modalElement = document.getElementById('clickActionModal');
    var modal = new bootstrap.Modal(modalElement);
    modal.show();

    var previewText = document.getElementById('modal-address-preview');
    
    if (preloadedName) {
        tempLocationName = preloadedName;
        previewText.innerHTML = `<strong>${preloadedName}</strong>`;
    } else {
        tempLocationName = `Coordenadas: ${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}`;
        previewText.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Buscando dirección...';
        
        let geocodeDone = false;
        geocoder.reverse(latlng, map.options.crs.scale(map.getZoom()), function(results) {
            geocodeDone = true;
            if (results && results.length > 0) {
                tempLocationName = results[0].name;
                let currentPreview = document.getElementById('modal-address-preview');
                if(currentPreview) currentPreview.innerHTML = `<strong>${tempLocationName}</strong>`;
            } else {
                let currentPreview = document.getElementById('modal-address-preview');
                if(currentPreview) currentPreview.innerHTML = `<span class="text-muted">${tempLocationName}</span>`;
            }
        });

        setTimeout(() => {
            if (!geocodeDone) {
                let currentPreview = document.getElementById('modal-address-preview');
                if(currentPreview && currentPreview.innerHTML.includes('fa-spinner')) {
                    currentPreview.innerHTML = `<span class="text-muted">${tempLocationName}</span> <br><small class='text-danger'>(Dirección no encontrada)</small>`;
                }
            }
        }, 3000);
    }
}

function addCurrentLocToStage() {
    if (!activeStageId) {
        alert("Selecciona una etapa haciendo clic en su cuerpo o crea una nueva.");
        return;
    }
    const stage = appData.stages.find(s => s.id === activeStageId);
    stage.waypoints.push({ latLng: tempClickLocation, name: tempLocationName });
    stage.visible = true; 
    refreshMapRoute(stage.id); 
    renderSidebar();
    bootstrap.Modal.getInstance(document.getElementById('clickActionModal')).hide();
}

function addCurrentLocAsPOI() {
    const newPoi = { id: Date.now(), latLng: tempClickLocation, name: tempLocationName };
    appData.pois.push(newPoi);
    renderPOIsOnMap();
    bootstrap.Modal.getInstance(document.getElementById('clickActionModal')).hide();
}

// ==========================================
// 4. GESTIÓN DE ETAPAS
// ==========================================

function createNewStage() {
    const id = Date.now();
    const newStage = {
        id: id,
        name: `Etapa ${appData.stages.length + 1}`,
        waypoints: [],
        distance: 0,
        color: getRandomColor(),
        visible: true, 
        isOpen: true   
    };
    appData.stages.push(newStage);
    setActiveStage(id); 
    renderSidebar();
}

function setActiveStage(id) {
    activeStageId = id;
    renderSidebar(); 
}

function toggleStageVisibility(event, id) {
    event.stopPropagation(); 
    const stage = appData.stages.find(s => s.id === id);
    stage.visible = !stage.visible;
    refreshMapRoute(id, true);
    renderSidebar();
}

function updateStageColor(id, newColor) {
    const stage = appData.stages.find(s => s.id === id);
    stage.color = newColor;
    refreshMapRoute(id, true);
}

function updateStageName(id, newName) {
    const stage = appData.stages.find(s => s.id === id);
    if(stage) stage.name = newName;
}

function toggleAccordion(id) {
    const stage = appData.stages.find(s => s.id === id);
    stage.isOpen = !stage.isOpen;
    if (stage.isOpen) activeStageId = id;
    renderSidebar();
}

function deleteStage(id) {
    if(!confirm("¿Borrar etapa y su ruta?")) return;
    if (stageRoutingControls[id]) {
        map.removeControl(stageRoutingControls[id]);
        delete stageRoutingControls[id];
    }
    appData.stages = appData.stages.filter(s => s.id !== id);
    if (activeStageId === id) activeStageId = null;
    renderSidebar();
}

function removeWaypoint(stageId, index) {
    const stage = appData.stages.find(s => s.id === stageId);
    stage.waypoints.splice(index, 1);
    refreshMapRoute(stageId);
    renderSidebar();
}

// ==========================================
// 5. RENDERIZADO DEL SIDEBAR
// ==========================================

function renderSidebar() {
    const container = document.getElementById('stages-list');
    container.innerHTML = '';
    let totalTripKm = 0;

    appData.stages.forEach((stage, index) => {
        if(stage.visible) totalTripKm += stage.distance;
        const isActive = stage.id === activeStageId;
        const isOpen = stage.isOpen; 
        
        let waypointsHtml = '';
        if (stage.waypoints.length === 0) {
            waypointsHtml = '<div class="text-muted small fst-italic p-2">Sin paradas. Clic en mapa.</div>';
        } else {
            stage.waypoints.forEach((wp, idx) => {
                let badgeClass = (idx === 0) ? "bg-success" : (idx === stage.waypoints.length - 1) ? "bg-dark" : "bg-primary";
                let label = (idx === 0) ? "Origen" : (idx === stage.waypoints.length - 1) ? "Destino" : "Parada";
                waypointsHtml += `
                    <div class="waypoint-item small" data-index="${idx}">
                        <div class="d-flex align-items-center overflow-hidden w-100">
                            <span class="badge ${badgeClass} me-2" style="font-size:0.7em; width:50px;">${label}</span>
                            <span class="text-truncate">${wp.name}</span>
                        </div>
                        <button class="btn btn-link text-danger p-0 ms-2" onclick="removeWaypoint(${stage.id}, ${idx})">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>`;
            });
        }

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
                <div class="accordion-button-custom ${isOpen ? '' : 'collapsed'} flex-grow-1" role="button" onclick="toggleAccordion(${stage.id})">
                    <input type="text" class="stage-name-input" value="${stage.name}" onclick="event.stopPropagation()" onchange="updateStageName(${stage.id}, this.value)">
                    <span class="badge bg-secondary ms-auto small" id="km-badge-${stage.id}">${(stage.distance).toFixed(1)} km</span>
                    <i class="fa-solid fa-chevron-down ms-2 transition-icon" style="transform: ${isOpen ? 'rotate(180deg)' : 'rotate(0)'}"></i>
                </div>
            </div>
            <div class="accordion-collapse collapse ${isOpen ? 'show' : ''}">
                <div class="accordion-body p-2 bg-white">
                    <div id="waypoints-list-${stage.id}" class="list-group mb-3">${waypointsHtml}</div>
                    <div class="d-flex justify-content-end">
                        ${!isActive ? `<button class="btn btn-sm btn-outline-primary me-2" onclick="setActiveStage(${stage.id})">Seleccionar</button>` : ''}
                        <button class="btn btn-sm btn-outline-danger" onclick="deleteStage(${stage.id})"><i class="fas fa-trash"></i></button>
                    </div>
                </div>
            </div>`;
        container.appendChild(card);

        if (isOpen && stage.waypoints.length > 0) {
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
// 6. LÓGICA DE RUTAS CON COLA ASÍNCRONA (OPTIMIZADA)
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
    if (!stage) {
        isProcessingQueue = false;
        processRoutingQueue();
        return;
    }

    if (stageRoutingControls[stageId]) { 
        map.removeControl(stageRoutingControls[stageId]); 
        delete stageRoutingControls[stageId]; 
    }

    if (!stage.visible || stage.waypoints.length < 2) {
        if (stage.waypoints.length < 2) stage.distance = 0;
        isProcessingQueue = false;
        processRoutingQueue();
        return;
    }
    
    // Configuración del router de GraphHopper
    const graphHopperRouter = L.Routing.graphHopper(
        '427febfe-98c2-4c69-8601-f1b4fa8ed355', 
        {
            serviceUrl: 'https://graphhopper.com/api/1/route'
        }
    );

    const control = L.Routing.control({
        router: graphHopperRouter,
        waypoints: stage.waypoints.map(w => w.latLng),
        routeWhileDragging: false, show: false, addWaypoints: false,
        createMarker: (i, wp, nWps) => {
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
        lineOptions: { styles: [{color: stage.color, opacity: 0.8, weight: 5}] }
    }).addTo(map);

    stageRoutingControls[stageId] = control;

    control.on('routesfound', (e) => {
        stage.distance = e.routes[0].summary.totalDistance / 1000;
        if (!skipSidebarUpdate) renderSidebar();
        else {
            const badge = document.getElementById(`km-badge-${stage.id}`);
            if(badge) badge.innerText = stage.distance.toFixed(1) + " km";
            document.getElementById('total-km').innerText = appData.stages.reduce((acc, s) => acc + (s.visible ? s.distance : 0), 0).toFixed(1) + " km";
        }
        
        // Retraso optimizado para GraphHopper: 100ms
        setTimeout(() => {
            isProcessingQueue = false;
            processRoutingQueue();
        }, 100); 
    });

    control.on('routingerror', (e) => {
        console.warn(`Error de enrutamiento en etapa ${stageId}. Reintentando...`, e);
        routingQueue.push({ stageId, skipSidebarUpdate });
        isProcessingQueue = false;
        setTimeout(() => processRoutingQueue(), 1000);
    });
}

// ==========================================
// 7. COMPARTIR Y UTILIDADES
// ==========================================

function generateShareLink() {
    const compressed = LZString.compressToEncodedURIComponent(JSON.stringify(appData));
    const url = window.location.origin + window.location.pathname + '#route=' + compressed;
    navigator.clipboard.writeText(url).then(() => alert("✅ ¡Enlace copiado!"));
}

function loadAppData(json) {
    // Limpieza de estados
    Object.values(stageRoutingControls).forEach(c => map.removeControl(c));
    stageRoutingControls = {};
    routingQueue = []; 
    
    appData = json;
    
    // Añadimos a la cola de forma ordenada
    appData.stages.forEach(s => { 
        if(s.visible) refreshMapRoute(s.id); 
    });
    
    renderPOIsOnMap(); 
    renderSidebar();
}

/**
 * CORRECCIÓN DEL BUG: Lee el hash de forma robusta.
 */
function checkForSharedUrl() {
    // 1. Quitar el carácter #
    const hash = window.location.hash.substring(1); 
    
    if (hash.startsWith('route=')) {
        // 2. 'route='.length es 6.
        const compressed = hash.substring(6);
        
        try {
            const jsonString = LZString.decompressFromEncodedURIComponent(compressed);
            
            if (jsonString) {
                loadAppData(JSON.parse(jsonString)); 
                // Limpiar la URL después de la carga exitosa
                history.replaceState(null, null, ' '); 
                alert("📂 ¡Viaje compartido cargado con éxito!");
            }
        } catch (error) {
            console.error("Error al cargar datos del JSON comprimido:", error);
            alert("Error al cargar los datos del mapa desde la URL. El enlace puede estar corrupto.");
        }
    }
}

function renderPOIsOnMap() {
    poiLayerGroup.clearLayers();
    appData.pois.forEach(poi => {
        L.marker(poi.latLng, {
            icon: L.divIcon({ className: 'custom-div-icon', html: `<div class='marker-pin marker-poi'><i class='fa-solid fa-star'></i></div>`, iconSize: [30, 42], iconAnchor: [15, 42] })
        }).addTo(poiLayerGroup).bindPopup(`<h6>${poi.name}</h6><button class="btn btn-sm btn-primary" onclick="convertPoiToStop(${poi.id})">Añadir</button>`);
    });
}

function convertPoiToStop(id) {
    if (!activeStageId) return;
    const poi = appData.pois.find(p => p.id === id);
    appData.stages.find(s => s.id === activeStageId).waypoints.push({ latLng: poi.latLng, name: poi.name });
    refreshMapRoute(activeStageId); renderSidebar(); map.closePopup();
}

function getRandomColor() { return '#' + Math.floor(Math.random()*16777215).toString(16); }

function exportData() {
    const a = document.createElement('a');
    a.href = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(appData));
    a.download = "viaje.json"; a.click();
}

function importData(input) {
    const reader = new FileReader();
    reader.onload = (e) => loadAppData(JSON.parse(e.target.result));
    reader.readAsText(input.files[0]);
}

// Iniciar comprobación de URL compartida al cargar
checkForSharedUrl();