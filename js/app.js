/**
 * APP.JS - Planificador de Viajes en Autocaravana (Versión Sofisticada)
 * -----------------------------------------------
 */

// ==========================================
// 1. INICIALIZACIÓN
// ==========================================

var map = L.map('map').setView([40.416775, -3.703790], 6);

L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
    attribution: '© OpenStreetMap contributors'
}).addTo(map);

var poiLayerGroup = L.layerGroup().addTo(map);

// Buscador
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


// ESTADO DE LA APLICACIÓN
let appData = {
    stages: [], 
    pois: []    
};

// **CAMBIO IMPORTANTE**: Diccionario para guardar los controles de ruta de cada etapa individualmente
let stageRoutingControls = {}; 

let activeStageId = null; // ID de la etapa "seleccionada" para añadir puntos
let tempClickLocation = null;    
let tempLocationName = "";       


// ==========================================
// 2. INTERACCIÓN (CLICS Y MODAL)
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

function addCurrentLocToStage() {
    if (!activeStageId) {
        alert("Selecciona una etapa haciendo clic en su cuerpo o crea una nueva.");
        return;
    }
    const stage = appData.stages.find(s => s.id === activeStageId);
    stage.waypoints.push({ latLng: tempClickLocation, name: tempLocationName });
    
    // Aseguramos que sea visible si añadimos puntos
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
// 3. GESTIÓN DE ETAPAS (SIDEBAR SOFISTICADO)
// ==========================================

function createNewStage() {
    const id = Date.now();
    const newStage = {
        id: id,
        name: `Etapa ${appData.stages.length + 1}`,
        waypoints: [],
        distance: 0,
        color: getRandomColor(),
        visible: true, // Por defecto visible
        isOpen: true   // Por defecto desplegada en el acordeón
    };
    appData.stages.push(newStage);
    setActiveStage(id); // La marcamos como activa para trabajar
    renderSidebar();
}

// Función para establecer qué etapa recibe los nuevos puntos (borde azul)
function setActiveStage(id) {
    activeStageId = id;
    renderSidebar(); // Re-render para actualizar bordes y estilos
}

// Alternar visibilidad en el mapa (OJO)
function toggleStageVisibility(event, id) {
    event.stopPropagation(); // Evitar que se cierre el acordeón
    const stage = appData.stages.find(s => s.id === id);
    stage.visible = !stage.visible;
    refreshMapRoute(id); // Actualizar solo mapa
    renderSidebar();     // Actualizar icono ojo
}

// Actualizar color
function updateStageColor(id, newColor) {
    const stage = appData.stages.find(s => s.id === id);
    stage.color = newColor;
    refreshMapRoute(id); // Repintar ruta con nuevo color
}

// Actualizar nombre
function updateStageName(id, newName) {
    const stage = appData.stages.find(s => s.id === id);
    stage.name = newName;
    // No hace falta repintar mapa, solo actualizar datos. 
    // Como es un input, el valor ya se ve en pantalla.
}

// Controlar apertura/cierre acordeón para guardar estado
function toggleAccordion(id) {
    const stage = appData.stages.find(s => s.id === id);
    stage.isOpen = !stage.isOpen;
    // Si abrimos el acordeón, también la hacemos la etapa "activa" para editar
    if (stage.isOpen) {
        activeStageId = id;
    }
    renderSidebar();
}


function deleteStage(id) {
    if(!confirm("¿Borrar etapa y su ruta?")) return;
    
    // 1. Eliminar del mapa
    if (stageRoutingControls[id]) {
        map.removeControl(stageRoutingControls[id]);
        delete stageRoutingControls[id];
    }

    // 2. Eliminar de datos
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

// RENDERIZADO DEL SIDEBAR
function renderSidebar() {
    const container = document.getElementById('stages-list');
    container.innerHTML = '';
    
    let totalTripKm = 0;

    appData.stages.forEach((stage, index) => {
        if(stage.visible) totalTripKm += stage.distance;
        
        const isActive = stage.id === activeStageId;
        const isOpen = stage.isOpen; // Usamos propiedad interna, no ID única
        
        // Generar lista de paradas
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
        // Si es la activa, añadimos clase de borde
        card.className = `accordion-item mb-2 rounded overflow-hidden border ${isActive ? 'border-primary' : ''}`;
        
        // HTML DE LA CABECERA (Aquí están los inputs, color y ojo)
        // Nota: onclick="toggleAccordion" gestiona el despliegue manualmente para evitar conflictos de Bootstrap
        card.innerHTML = `
            <div class="accordion-header d-flex align-items-center border-bottom bg-light">
                
                <button class="btn-visibility ms-2 ${stage.visible ? 'active' : ''}" 
                        onclick="toggleStageVisibility(event, ${stage.id})" 
                        title="${stage.visible ? 'Ocultar ruta' : 'Mostrar ruta'}">
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
                    
                    <span class="badge bg-secondary ms-auto small">${(stage.distance).toFixed(1)} km</span>
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
                         ${!isActive ? `<button class="btn btn-sm btn-outline-primary me-2" onclick="setActiveStage(${stage.id})">Seleccionar para editar</button>` : ''}
                        <button class="btn btn-sm btn-outline-danger" onclick="deleteStage(${stage.id})">
                            <i class="fas fa-trash"></i>
                        </button>
                    </div>
                </div>
            </div>
        `;
        container.appendChild(card);

        // Drag & Drop
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
// 4. LÓGICA DE RUTAS (MÚLTIPLES INSTANCIAS)
// ==========================================

function refreshMapRoute(stageId) {
    const stage = appData.stages.find(s => s.id === stageId);
    if (!stage) return;

    // 1. Si ya existe un control para esta etapa, lo quitamos para repintar
    if (stageRoutingControls[stageId]) {
        map.removeControl(stageRoutingControls[stageId]);
        delete stageRoutingControls[stageId];
    }

    // 2. Si la etapa está marcada como invisible, o tiene < 2 puntos, terminamos aquí
    if (!stage.visible || !stage.waypoints || stage.waypoints.length < 2) {
        // Si acabamos de borrar puntos y nos quedamos con <2, distancia es 0
        if (stage.waypoints.length < 2) stage.distance = 0;
        return; 
    }

    // 3. Crear control nuevo específico para esta etapa
    const waypointsCoords = stage.waypoints.map(w => w.latLng);

    const control = L.Routing.control({
        waypoints: waypointsCoords,
        routeWhileDragging: false,
        show: false,
        addWaypoints: false,
        
        createMarker: function(i, wp, nWps) {
            // Personalización de marcadores (igual que antes pero con soporte de color dinámico si quisiéramos)
            let iconClass = 'fa-map-pin';
            let cssClass = '';
            
            if (i === 0) { iconClass = 'fa-flag'; cssClass = 'marker-origin'; }
            else if (i === nWps - 1) { iconClass = 'fa-flag-checkered'; cssClass = 'marker-dest'; }
            else { 
                // Podríamos usar el color de la etapa para el pin intermedio
                // cssClass = 'marker-poi'; 
            }

            // Usamos un estilo especial para los pines intermedios basado en el color de la etapa?
            // De momento mantengo tu estilo original para no complicar el CSS dinámico,
            // pero el borde del marker se podría pintar con stage.color.
            const icon = L.divIcon({
                className: 'custom-div-icon',
                html: `<div class='marker-pin ${cssClass}' style='${!cssClass ? "background:"+stage.color : ""}'><i class='fa-solid ${iconClass}'></i></div>`,
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

    // Guardar referencia en el diccionario
    stageRoutingControls[stageId] = control;

    control.on('routesfound', function(e) {
        const routes = e.routes;
        const summary = routes[0].summary;
        stage.distance = summary.totalDistance / 1000;
        
        // Actualizar texto Km sin redibujar todo el sidebar para evitar perder foco si estamos editando
        // (Aunque renderSidebar es rápido, podemos optimizar si fuera necesario)
        renderSidebar(); 
    });
    
    control.on('routingerror', function(e) {
        console.log("Error routing stage " + stageId, e);
    });
}


// ==========================================
// 5. POIS Y UTILIDADES
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
            
            // Limpiar mapa viejo
            Object.values(stageRoutingControls).forEach(c => map.removeControl(c));
            stageRoutingControls = {};
            activeStageId = null;

            // Restaurar rutas visibles
            appData.stages.forEach(s => {
                if(s.visible === undefined) s.visible = true; // compatibilidad
                if(s.visible) refreshMapRoute(s.id);
            });
            renderPOIsOnMap();
            renderSidebar();
        } catch(err) { console.error(err); alert("Error al importar"); }
    };
    reader.readAsText(file);
    input.value = ''; 
}