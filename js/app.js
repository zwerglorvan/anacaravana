/**
 * APP.JS - Planificador de Viajes en Autocaravana
 * -----------------------------------------------
 */

// ==========================================
// 1. INICIALIZACIÓN DEL MAPA Y CAPAS
// ==========================================

// Definición de capas base (Mapas)
var osm = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
});

var satellite = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
    attribution: 'Tiles &copy; Esri &mdash; Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community'
});

var terrain = L.tileLayer('https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', {
    attribution: 'Map data: &copy; OpenStreetMap contributors, SRTM | Map style: &copy; OpenTopoMap (CC-BY-SA)'
});

// Inicializar el mapa con la capa de carreteras por defecto
var map = L.map('map', {
    center: [40.416775, -3.703790],
    zoom: 6,
    layers: [osm] // Capa inicial
});

// Crear selector de capas
var baseMaps = {
    "Carreteras": osm,
    "Satélite": satellite,
    "Relieve": terrain
};
L.control.layers(baseMaps).addTo(map);


// Capa para los Puntos de Interés (POIs) independientes
var poiLayerGroup = L.layerGroup().addTo(map);

// Inicializar el Buscador (Geocoder)
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

// Diccionario para controlar las rutas de cada etapa independientemente
let stageRoutingControls = {}; 

let activeStageId = null; // ID de la etapa seleccionada para añadir puntos
let tempClickLocation = null;    
let tempLocationName = "";       


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
        // Asignar nombre por defecto inmediatamente (Coordenadas)
        tempLocationName = `Coordenadas: ${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}`;
        previewText.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Buscando dirección...';
        
        let geocodeDone = false;

        // Búsqueda inversa estándar (usando el zoom actual como referencia)
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

        // Timeout de seguridad: Si en 3 seg no responde, nos quedamos con las coordenadas
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
    
    var modalEl = document.getElementById('clickActionModal');
    var modal = bootstrap.Modal.getInstance(modalEl);
    modal.hide();
}

function addCurrentLocAsPOI() {
    const newPoi = { id: Date.now(), latLng: tempClickLocation, name: tempLocationName };
    appData.pois.push(newPoi);
    renderPOIsOnMap();
    var modalEl = document.getElementById('clickActionModal');
    var modal = bootstrap.Modal.getInstance(modalEl);
    modal.hide();
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
    refreshMapRoute(id, true); // true = No redibujar sidebar completo
    
    // Actualizar icono visualmente
    const btn = event.currentTarget;
    if(stage.visible) {
        btn.classList.add('active');
        btn.innerHTML = '<i class="fa-solid fa-eye"></i>';
    } else {
        btn.classList.remove('active');
        btn.innerHTML = '<i class="fa-solid fa-eye-slash"></i>';
    }
}

function updateStageColor(id, newColor) {
    const stage = appData.stages.find(s => s.id === id);
    stage.color = newColor;
    refreshMapRoute(id, true); // true = No redibujar sidebar para no cerrar el picker
}

function updateStageName(id, newName) {
    const stage = appData.stages.find(s => s.id === id);
    stage.name = newName;
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
        
        // HTML de waypoints
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
                    </div>
                `;
            });
        }

        const card = document.createElement('div');
        card.className = `accordion-item mb-2 rounded overflow-hidden border ${isActive ? 'border-primary' : ''}`;
        
        card.innerHTML = `
            <div class="accordion-header d-flex align-items-center border-bottom bg-light">
                
                <button class="btn-visibility ms-2 ${stage.visible ? 'active' : ''}" 
                        onclick="toggleStageVisibility(event, ${stage.id})" 
                        title="Ocultar/Mostrar">
                    <i class="fa-solid ${stage.visible ? 'fa-eye' : 'fa-eye-slash'}"></i>
                </button>

                <div class="color-picker-wrapper ms-2" title="Cambiar color" onclick="event.stopPropagation()">
                    <input type="color" class="color-picker-input" value="${stage.color}" 
                           oninput="updateStageColor(${stage.id}, this.value)">
                </div>

                <div class="accordion-button-custom ${isOpen ? '' : 'collapsed'} flex-grow-1" 
                     role="button" onclick="toggleAccordion(${stage.id})">
                    
                    <input type="text" class="stage-name-input" value="${stage.name}" 
                           onclick="event.stopPropagation()"
                           onchange="updateStageName(${stage.id}, this.value)">
                    
                    <span class="badge bg-secondary ms-auto small" id="km-badge-${stage.id}">${(stage.distance).toFixed(1)} km</span>
                    <i class="fa-solid fa-chevron-down ms-2 transition-icon" style="transform: ${isOpen ? 'rotate(180deg)' : 'rotate(0)'}"></i>
                </div>
            </div>

            <div class="accordion-collapse collapse ${isOpen ? 'show' : ''}">
                <div class="accordion-body p-2 bg-white">
                    <div class="d-flex justify-content-between align-items-center mb-1">
                        <small class="text-muted fw-bold">Itinerario:</small>
                        <small class="text-muted" style="font-size: 0.7rem;">(Arrastra para ordenar)</small>
                    </div>
                    
                    <div id="waypoints-list-${stage.id}" class="list-group mb-3">
                        ${waypointsHtml}
                    </div>

                    <div class="d-flex justify-content-end">
                         ${!isActive ? `<button class="btn btn-sm btn-outline-primary me-2" onclick="setActiveStage(${stage.id})">Seleccionar</button>` : ''}
                        <button class="btn btn-sm btn-outline-danger" onclick="deleteStage(${stage.id})">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;
        container.appendChild(card);

        if (isOpen) {
            const listContainer = document.getElementById(`waypoints-list-${stage.id}`);
            if(listContainer) {
                new Sortable(listContainer, {
                    animation: 150,
                    handle: '.waypoint-item',
                    onEnd: function (evt) {
                        const movedItem = stage.waypoints.splice(evt.oldIndex, 1)[0];
                        stage.waypoints.splice(evt.newIndex, 0, movedItem);
                        refreshMapRoute(stage.id);
                        renderSidebar();
                    }
                });
            }
        }
    });

    document.getElementById('total-km').innerText = totalTripKm.toFixed(1) + " km";
}


// ==========================================
// 6. LÓGICA DE RUTAS Y MARCADORES
// ==========================================

function refreshMapRoute(stageId, skipSidebarUpdate = false) {
    const stage = appData.stages.find(s => s.id === stageId);
    if (!stage) return;

    if (stageRoutingControls[stageId]) {
        map.removeControl(stageRoutingControls[stageId]);
        delete stageRoutingControls[stageId];
    }

    if (!stage.visible || !stage.waypoints || stage.waypoints.length < 2) {
        if (stage.waypoints.length < 2) stage.distance = 0;
        return; 
    }

    const waypointsCoords = stage.waypoints.map(w => w.latLng);

    const control = L.Routing.control({
        waypoints: waypointsCoords,
        routeWhileDragging: false,
        show: false,
        addWaypoints: false,
        
        createMarker: function(i, wp, nWps) {
            let iconClass = 'fa-map-pin';
            if (i === 0) iconClass = 'fa-flag'; 
            else if (i === nWps - 1) iconClass = 'fa-flag-checkered'; 
            
            // Inyectamos el color de la etapa en el estilo del marcador
            const icon = L.divIcon({
                className: 'custom-div-icon',
                html: `<div class='marker-pin' style='background-color: ${stage.color};'><i class='fa-solid ${iconClass}'></i></div>`,
                iconSize: [30, 42],
                iconAnchor: [15, 42],
                popupAnchor: [0, -38]
            });

            const marker = L.marker(wp.latLng, { draggable: true, icon: icon });
            marker.bindPopup(`<strong>${stage.waypoints[i].name}</strong>`);
            
            marker.on('dragend', function(e) {
                stage.waypoints[i].latLng = e.target.getLatLng();
                refreshMapRoute(stage.id); 
            });
            return marker;
        },
        lineOptions: {
            styles: [{color: stage.color, opacity: 0.8, weight: 5}]
        }
    }).addTo(map);

    stageRoutingControls[stageId] = control;

    control.on('routesfound', function(e) {
        const routes = e.routes;
        const summary = routes[0].summary;
        stage.distance = summary.totalDistance / 1000;
        
        if (!skipSidebarUpdate) {
            renderSidebar(); 
        } else {
            // Actualización ligera si estamos editando color/visibilidad
            let kmBadge = document.getElementById(`km-badge-${stage.id}`);
            if(kmBadge) kmBadge.innerText = stage.distance.toFixed(1) + " km";
            
            let total = appData.stages.reduce((acc, s) => acc + (s.visible ? s.distance : 0), 0);
            document.getElementById('total-km').innerText = total.toFixed(1) + " km";
        }
    });
    
    control.on('routingerror', function(e) {
        console.log("Error routing stage " + stageId, e);
    });
}


// ==========================================
// 7. POIS Y UTILIDADES
// ==========================================

function renderPOIsOnMap() {
    poiLayerGroup.clearLayers();
    appData.pois.forEach(poi => {
        const icon = L.divIcon({
            className: 'custom-div-icon',
            html: `<div class='marker-pin marker-poi'><i class='fa-solid fa-star'></i></div>`,
            iconSize: [30, 42],
            iconAnchor: [15, 42],
            popupAnchor: [0, -38]
        });
        
        const marker = L.marker(poi.latLng, { icon: icon }).addTo(poiLayerGroup);
        marker.bindPopup(`
            <div class="text-center"><h6>${poi.name}</h6>
            <button class="btn btn-sm btn-outline-primary" onclick="convertPoiToStop(${poi.id})">Añadir a etapa activa</button>
            <button class="btn btn-sm btn-outline-danger" onclick="deletePoi(${poi.id})">Borrar</button></div>
        `);
    });
}

function convertPoiToStop(poiId) {
    if (!activeStageId) { alert("Selecciona etapa activa primero"); return; }
    const poi = appData.pois.find(p => p.id === poiId);
    const stage = appData.stages.find(s => s.id === activeStageId);
    stage.waypoints.push({ latLng: poi.latLng, name: poi.name });
    refreshMapRoute(stage.id);
    renderSidebar();
    map.closePopup();
}

function deletePoi(id) {
    appData.pois = appData.pois.filter(p => p.id !== id);
    renderPOIsOnMap();
}

function getRandomColor() {
    const letters = '0123456789ABCDEF';
    let color = '#';
    for (let i = 0; i < 6; i++) { color += letters[Math.floor(Math.random() * 16)]; }
    return color;
}

function exportData() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(appData));
    const a = document.createElement('a');
    a.href = dataStr; a.download = "viaje_autocaravana.json";
    a.click();
}

function importData(input) {
    const file = input.files[0];
    if(!file) return;
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            appData = JSON.parse(e.target.result);
            Object.values(stageRoutingControls).forEach(c => map.removeControl(c));
            stageRoutingControls = {};
            activeStageId = null;
            appData.stages.forEach(s => {
                if(s.visible === undefined) s.visible = true; 
                if(s.visible) refreshMapRoute(s.id);
            });
            renderPOIsOnMap();
            renderSidebar();
        } catch(err) { console.error(err); alert("Error al importar"); }
    };
    reader.readAsText(file);
    input.value = ''; 
}