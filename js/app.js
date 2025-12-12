/**
 * APP.JS - Planificador de Viajes en Autocaravana
 * -----------------------------------------------
 * Lógica principal para mapa, rutas, gestión de estados e interacción.
 */

// ==========================================
// 1. INICIALIZACIÓN DEL MAPA Y VARIABLES
// ==========================================

// Inicializar mapa centrado en España
var map = L.map('map').setView([40.416775, -3.703790], 6);

// Capa base (OpenStreetMap)
L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
}).addTo(map);

// Capa para los Puntos de Interés (POIs) independientes
var poiLayerGroup = L.layerGroup().addTo(map);

// Inicializar el Buscador (Geocoder)
var geocoder = L.Control.Geocoder.nominatim();
L.Control.geocoder({
    geocoder: geocoder,
    defaultMarkGeocode: false, // No marcar automáticamente, lo gestionamos nosotros
    placeholder: "Buscar lugar...",
    errorMessage: "No se ha encontrado nada."
})
.on('markgeocode', function(e) {
    // Cuando el buscador encuentra algo, actuamos como si fuera un clic
    var latlng = e.geocode.center;
    var name = e.geocode.name;
    handleMapInteraction(latlng, name);
    map.setView(latlng, 14);
})
.addTo(map);


// ESTADO DE LA APLICACIÓN
let appData = {
    stages: [], // Array de etapas
    pois: []    // Array de puntos de interés sueltos
};

// Variables de control en tiempo de ejecución
let activeRoutingControl = null; // Instancia actual de Leaflet Routing Machine
let activeStageId = null;        // ID de la etapa que se está editando
let tempClickLocation = null;    // Coordenadas temporales al hacer clic
let tempLocationName = "";       // Nombre temporal al hacer clic


// ==========================================
// 2. INTERACCIÓN CON EL MAPA (CLICS Y MODAL)
// ==========================================

// Evento Click en el mapa
map.on('click', function(e) {
    handleMapInteraction(e.latlng);
});

// Función centralizada para manejar nuevas ubicaciones (por clic o buscador)
function handleMapInteraction(latlng, preloadedName = null) {
    tempClickLocation = latlng;
    
    // Abrir el Modal de Bootstrap
    var modalElement = document.getElementById('clickActionModal');
    var modal = new bootstrap.Modal(modalElement);
    modal.show();

    // Referencia al texto del modal
    var previewText = document.getElementById('modal-address-preview');
    
    if (preloadedName) {
        // Si viene del buscador, ya tenemos nombre
        tempLocationName = preloadedName;
        previewText.innerHTML = `<strong>${preloadedName}</strong>`;
    } else {
        // Si es un clic, buscamos la dirección (Reverse Geocoding)
        previewText.innerHTML = '<i class="fas fa-spinner fa-spin"></i> Buscando dirección...';
        
        geocoder.reverse(latlng, map.options.crs.scale(map.getZoom()), function(results) {
            if (results && results.length > 0) {
                tempLocationName = results[0].name;
                previewText.innerHTML = `<strong>${tempLocationName}</strong>`;
            } else {
                tempLocationName = `Coordenadas: ${latlng.lat.toFixed(4)}, ${latlng.lng.toFixed(4)}`;
                previewText.innerHTML = tempLocationName;
            }
        });
    }
}

// Acción Modal 1: Añadir a la etapa activa
function addCurrentLocToStage() {
    if (!activeStageId) {
        alert("¡Ojo! Primero debes crear o seleccionar una etapa en el panel lateral.");
        return;
    }
    
    const stage = appData.stages.find(s => s.id === activeStageId);
    
    // Añadimos el punto con coordenadas y nombre
    stage.waypoints.push({
        latLng: tempClickLocation,
        name: tempLocationName
    });
    
    // Actualizamos todo
    refreshMapRoute(stage);
    renderSidebar();
    
    // Cerrar modal
    var modalEl = document.getElementById('clickActionModal');
    var modal = bootstrap.Modal.getInstance(modalEl);
    modal.hide();
}

// Acción Modal 2: Crear Punto de Interés (POI)
function addCurrentLocAsPOI() {
    const newPoi = {
        id: Date.now(),
        latLng: tempClickLocation,
        name: tempLocationName
    };
    
    appData.pois.push(newPoi);
    renderPOIsOnMap();
    
    // Cerrar modal
    var modalEl = document.getElementById('clickActionModal');
    var modal = bootstrap.Modal.getInstance(modalEl);
    modal.hide();
}


// ==========================================
// 3. GESTIÓN DE ETAPAS (SIDEBAR)
// ==========================================

function createNewStage() {
    const id = Date.now();
    const newStage = {
        id: id,
        name: `Etapa ${appData.stages.length + 1}`,
        waypoints: [],
        distance: 0,
        color: getRandomColor()
    };
    appData.stages.push(newStage);
    editStage(id); // Abrir automáticamente para editar
}

function editStage(id) {
    activeStageId = id;
    const stage = appData.stages.find(s => s.id === id);
    
    // Al editar, dibujamos su ruta y actualizamos el sidebar
    refreshMapRoute(stage);
    renderSidebar();
    // Aseguramos que los POIs sigan visibles
    renderPOIsOnMap();
}

function updateStageName(id, newName) {
    const stage = appData.stages.find(s => s.id === id);
    if(stage) stage.name = newName;
}

function deleteStage(id) {
    if(!confirm("¿Seguro que quieres borrar esta etapa completa?")) return;
    
    appData.stages = appData.stages.filter(s => s.id !== id);
    
    // Si borramos la activa, limpiamos el mapa
    if (activeStageId === id) {
        activeStageId = null;
        if(activeRoutingControl) {
            map.removeControl(activeRoutingControl);
            activeRoutingControl = null;
        }
    }
    renderSidebar();
}

function removeWaypoint(stageId, index) {
    const stage = appData.stages.find(s => s.id === stageId);
    stage.waypoints.splice(index, 1); // Quitar del array
    refreshMapRoute(stage);
    renderSidebar();
}

// Renderizado de la barra lateral (HTML dinámico)
function renderSidebar() {
    const container = document.getElementById('stages-list');
    container.innerHTML = '';
    
    let totalTripKm = 0;

    appData.stages.forEach((stage, index) => {
        totalTripKm += stage.distance;
        const isEditing = stage.id === activeStageId;
        
        // Generar HTML de las paradas
        let waypointsHtml = '';
        if (stage.waypoints.length === 0) {
            waypointsHtml = '<div class="text-muted small fst-italic p-2">Sin paradas. Haz clic en el mapa para añadir.</div>';
        } else {
            stage.waypoints.forEach((wp, idx) => {
                // Definir etiquetas y colores según posición
                let label = "Parada";
                let badgeClass = "bg-primary";
                
                if (idx === 0) { label = "Origen"; badgeClass = "bg-success"; }
                else if (idx === stage.waypoints.length - 1) { label = "Destino"; badgeClass = "bg-dark"; }
                
                waypointsHtml += `
                    <div class="waypoint-item small" data-index="${idx}">
                        <div class="d-flex align-items-center overflow-hidden w-100">
                            <span class="badge ${badgeClass} me-2" style="min-width: 60px;">${label}</span>
                            <span class="text-truncate" title="${wp.name}">${wp.name}</span>
                        </div>
                        <button class="btn btn-link text-danger p-0 ms-2" onclick="removeWaypoint(${stage.id}, ${idx})">
                            <i class="fas fa-times"></i>
                        </button>
                    </div>
                `;
            });
        }

        // Crear la tarjeta (Accordion Item)
        const card = document.createElement('div');
        card.className = 'accordion-item border mb-2 rounded overflow-hidden';
        
        card.innerHTML = `
            <h2 class="accordion-header">
                <button class="accordion-button ${isEditing ? '' : 'collapsed'}" type="button" onclick="editStage(${stage.id})">
                    <span class="badge me-2" style="background-color:${stage.color}; color:#fff; text-shadow:0 0 2px #000;">${index + 1}</span>
                    <span class="flex-grow-1 text-truncate pe-2">${stage.name}</span>
                    <span class="badge bg-secondary ms-2">${(stage.distance).toFixed(1)} km</span>
                </button>
            </h2>
            <div class="accordion-collapse collapse ${isEditing ? 'show' : ''}">
                <div class="accordion-body bg-light p-2">
                    <label class="small text-muted">Nombre de la etapa:</label>
                    <input type="text" class="form-control form-control-sm mb-3 fw-bold" value="${stage.name}" onchange="updateStageName(${stage.id}, this.value)">
                    
                    <div class="d-flex justify-content-between align-items-center mb-1">
                        <span class="small fw-bold">Itinerario:</span>
                        <small class="text-muted" style="font-size: 0.7rem;">(Arrastra para ordenar)</small>
                    </div>
                    
                    <div id="waypoints-list-${stage.id}" class="list-group mb-3">
                        ${waypointsHtml}
                    </div>

                    <div class="d-grid gap-2 d-md-flex justify-content-md-end">
                        <button class="btn btn-sm btn-outline-danger" onclick="deleteStage(${stage.id})">
                            <i class="fas fa-trash"></i> Eliminar Etapa
                        </button>
                    </div>
                </div>
            </div>
        `;
        container.appendChild(card);

        // Habilitar Drag & Drop solo si la etapa está abierta
        if (isEditing) {
            const listContainer = document.getElementById(`waypoints-list-${stage.id}`);
            new Sortable(listContainer, {
                animation: 150,
                handle: '.waypoint-item', // Toda la fila es arrastrable
                onEnd: function (evt) {
                    // Reordenar array
                    const movedItem = stage.waypoints.splice(evt.oldIndex, 1)[0];
                    stage.waypoints.splice(evt.newIndex, 0, movedItem);
                    // Recalcular ruta y vista
                    refreshMapRoute(stage);
                    renderSidebar();
                }
            });
        }
    });

    // Actualizar total global
    document.getElementById('total-km').innerText = totalTripKm.toFixed(1) + " km";
}


// ==========================================
// 4. LÓGICA DE RUTAS (LEAFLET ROUTING)
// ==========================================

function refreshMapRoute(stage) {
    // 1. Limpiar ruta anterior
    if (activeRoutingControl) {
        map.removeControl(activeRoutingControl);
        activeRoutingControl = null;
    }

    // 2. Si no hay puntos o solo 1, no podemos calcular ruta (Leaflet Routing necesita 2)
    if (!stage.waypoints || stage.waypoints.length < 2) {
        return; 
    }

    // 3. Extraer solo coordenadas para el plugin
    const waypointsCoords = stage.waypoints.map(w => w.latLng);

    // 4. Crear control de ruta
    activeRoutingControl = L.Routing.control({
        waypoints: waypointsCoords,
        routeWhileDragging: false, // False mejora rendimiento
        show: false, // Ocultar panel de instrucciones nativo
        addWaypoints: false, // Desactivar añadir puntos arrastrando la línea (mejor usar nuestra UI)
        
        // PERSONALIZACIÓN DE MARCADORES
        createMarker: function(i, wp, nWps) {
            let type = 'stop'; 
            let iconClass = 'fa-map-pin';
            let cssClass = '';

            // Lógica para determinar el icono según posición
            if (i === 0) { 
                type = 'origin'; 
                iconClass = 'fa-flag'; 
                cssClass = 'marker-origin'; // Definido en CSS (Verde)
            } else if (i === nWps - 1) { 
                type = 'dest'; 
                iconClass = 'fa-flag-checkered'; 
                cssClass = 'marker-dest';   // Definido en CSS (Negro)
            }

            const icon = createCustomIcon(iconClass, cssClass);

            const marker = L.marker(wp.latLng, {
                draggable: true,
                icon: icon
            });

            // Popup informativo
            const pointName = stage.waypoints[i].name || "Punto de ruta";
            marker.bindPopup(`<strong>${pointName}</strong><br><small>Arrastra para corregir posición</small>`);

            // Evento: Al soltar marcador arrastrado
            marker.on('dragend', function(e) {
                stage.waypoints[i].latLng = e.target.getLatLng();
                // Importante: Recalcular ruta tras arrastrar
                refreshMapRoute(stage); 
            });

            return marker;
        },
        lineOptions: {
            styles: [{color: stage.color, opacity: 0.8, weight: 5}]
        }
    }).addTo(map);

    // 5. Escuchar resultado del cálculo para actualizar Km
    activeRoutingControl.on('routesfound', function(e) {
        const routes = e.routes;
        const summary = routes[0].summary;
        // Convertir metros a km
        stage.distance = summary.totalDistance / 1000;
        
        // Actualizar solo el texto de km en sidebar sin repintar todo (para evitar bucles)
        renderSidebar(); 
    });
    
    // Manejo de errores de ruta
    activeRoutingControl.on('routingerror', function(e) {
        console.log("Error de ruta:", e);
    });
}


// ==========================================
// 5. GESTIÓN DE PUNTOS DE INTERÉS (POIs)
// ==========================================

function renderPOIsOnMap() {
    poiLayerGroup.clearLayers();
    
    appData.pois.forEach(poi => {
        // Icono estrella amarilla
        const icon = createCustomIcon('fa-star', 'marker-poi');
        
        const marker = L.marker(poi.latLng, { icon: icon }).addTo(poiLayerGroup);
        
        // Contenido del Popup
        const popupContent = `
            <div class="text-center">
                <h6>${poi.name}</h6>
                <div class="d-grid gap-2 mt-2">
                    <button class="btn btn-sm btn-outline-primary" onclick="convertPoiToStop(${poi.id})">
                        <i class="fas fa-plus"></i> Añadir a ruta
                    </button>
                    <button class="btn btn-sm btn-outline-danger" onclick="deletePoi(${poi.id})">
                        <i class="fas fa-trash"></i> Borrar
                    </button>
                </div>
            </div>
        `;
        marker.bindPopup(popupContent);
    });
}

// Convertir un POI en una parada de la etapa activa
function convertPoiToStop(poiId) {
    if (!activeStageId) {
        alert("Selecciona primero una etapa para añadir este punto.");
        return;
    }
    
    const poi = appData.pois.find(p => p.id === poiId);
    const stage = appData.stages.find(s => s.id === activeStageId);
    
    // Añadir a waypoints
    stage.waypoints.push({
        latLng: poi.latLng,
        name: poi.name
    });
    
    map.closePopup();
    refreshMapRoute(stage);
    renderSidebar();
}

function deletePoi(id) {
    if(!confirm("¿Eliminar este marcador?")) return;
    appData.pois = appData.pois.filter(p => p.id !== id);
    renderPOIsOnMap();
}


// ==========================================
// 6. UTILIDADES Y EXPORTACIÓN
// ==========================================

// Helper para crear DivIcons HTML
function createCustomIcon(faIconClass, colorClass) {
    return L.divIcon({
        className: 'custom-div-icon',
        html: `<div class='marker-pin ${colorClass}'><i class='fa-solid ${faIconClass}'></i></div>`,
        iconSize: [30, 42],
        iconAnchor: [15, 42],
        popupAnchor: [0, -38]
    });
}

function getRandomColor() {
    const letters = '0123456789ABCDEF';
    let color = '#';
    for (let i = 0; i < 6; i++) {
        color += letters[Math.floor(Math.random() * 16)];
    }
    return color;
}

// Exportar JSON
function exportData() {
    const dataStr = "data:text/json;charset=utf-8," + encodeURIComponent(JSON.stringify(appData));
    const downloadAnchorNode = document.createElement('a');
    downloadAnchorNode.setAttribute("href", dataStr);
    downloadAnchorNode.setAttribute("download", "viaje_autocaravana.json");
    document.body.appendChild(downloadAnchorNode); 
    downloadAnchorNode.click();
    downloadAnchorNode.remove();
}

// Importar JSON
function importData(input) {
    const file = input.files[0];
    if(!file) return;
    
    const reader = new FileReader();
    reader.onload = function(e) {
        try {
            const json = JSON.parse(e.target.result);
            
            // Validación básica
            if(!json.stages && !json.pois) throw new Error("Formato inválido");
            
            appData = json;
            
            // Resetear estados
            activeStageId = null;
            if(activeRoutingControl) {
                map.removeControl(activeRoutingControl);
                activeRoutingControl = null;
            }
            
            renderSidebar();
            renderPOIsOnMap();
            alert("¡Viaje cargado correctamente!");
            
        } catch(err) {
            console.error(err);
            alert("Error al cargar el archivo. Asegúrate de que es un JSON válido generado por esta web.");
        }
    };
    reader.readAsText(file);
    // Limpiar input para permitir cargar el mismo archivo si se modifica
    input.value = ''; 
}