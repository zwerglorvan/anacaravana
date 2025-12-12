(function () {
    'use strict';

    L.Routing = L.Routing || {};

    L.Routing.OpenRouteServiceV2 = L.Class.extend({
        options: {
            serviceUrl: 'https://api.openrouteservice.org/v2/directions/',
            timeout: 30 * 1000,
            urlParameters: {}
        },

        initialize: function (apiKey, orsOptions, options) {
            this._apiKey = apiKey;
            this._orsOptions = orsOptions || {};
            L.Util.setOptions(this, options);
        },

        route: function (waypoints, callback, context) {
            // Abortar si no hay suficientes puntos
            if (waypoints.length < 2) {
                return this;
            }

            // ORS espera [longitud, latitud]
            const coordinates = waypoints.map(function (wp) {
                return [wp.latLng.lng, wp.latLng.lat];
            });

            // Preparar el cuerpo de la petición
            const body = {
                coordinates: coordinates,
                ...this._orsOptions 
            };
            
            // Limpieza de parámetros internos
            delete body.serviceUrl;

            // Construir URL (perfil por defecto: driving-car)
            const url = this.options.serviceUrl + (this._orsOptions.profile || 'driving-car') + '/json';

            fetch(url, {
                method: 'POST',
                headers: {
                    'Accept': 'application/json, application/geo+json, application/gpx+xml, img/png; charset=utf-8',
                    'Content-Type': 'application/json',
                    'Authorization': this._apiKey
                },
                body: JSON.stringify(body)
            })
            .then(response => {
                if (!response.ok) {
                    return response.json().then(err => { throw err; });
                }
                return response.json();
            })
            .then(data => {
                this._routeDone(data, waypoints, callback, context);
            })
            .catch(err => {
                console.error('Error ORS:', err);
                callback.call(context, {
                    status: -1,
                    message: err.error ? err.error.message : 'Error HTTP'
                });
            });

            return this;
        },

        _routeDone: function (response, inputWaypoints, callback, context) {
            context = context || callback;

            if (!response.routes || response.routes.length === 0) {
                callback.call(context, {
                    status: 0,
                    message: "No se encontraron rutas"
                });
                return;
            }

            const alts = response.routes.map(route => {
                // Decodificar geometría devolviendo objetos L.latLng
                const coordinates = this._decodePolyline(route.geometry);
                
                // Procesar instrucciones
                const instructions = [];
                if(route.segments) {
                    route.segments.forEach(segment => {
                        if(segment.steps) {
                            segment.steps.forEach(step => {
                                instructions.push({
                                    text: step.instruction,
                                    distance: step.distance,
                                    time: step.duration,
                                    type: step.type 
                                });
                            });
                        }
                    });
                }

                return {
                    name: 'Ruta Óptima',
                    coordinates: coordinates, // Aquí está la clave para que se dibuje
                    instructions: instructions,
                    summary: {
                        totalDistance: route.summary.distance,
                        totalTime: route.summary.duration
                    },
                    inputWaypoints: inputWaypoints,
                    waypoints: inputWaypoints
                };
            });

            callback.call(context, null, alts);
        },

        // CORRECCIÓN IMPORTANTE EN ESTA FUNCIÓN
        _decodePolyline: function (str, precision) {
            let index = 0,
                lat = 0,
                lng = 0,
                coordinates = [],
                shift = 0,
                result = 0,
                byte = null,
                latitude_change,
                longitude_change,
                factor = Math.pow(10, precision || 5);

            while (index < str.length) {
                byte = null;
                shift = 0;
                result = 0;
                do {
                    byte = str.charCodeAt(index++) - 63;
                    result |= (byte & 0x1f) << shift;
                    shift += 5;
                } while (byte >= 0x20);
                latitude_change = ((result & 1) ? ~(result >> 1) : (result >> 1));
                shift = result = 0;
                do {
                    byte = str.charCodeAt(index++) - 63;
                    result |= (byte & 0x1f) << shift;
                    shift += 5;
                } while (byte >= 0x20);
                longitude_change = ((result & 1) ? ~(result >> 1) : (result >> 1));
                lat += latitude_change;
                lng += longitude_change;
                
                coordinates.push(L.latLng(lat / factor, lng / factor));
            }
            return coordinates;
        }
    });

    L.Routing.openrouteserviceV2 = function (apiKey, orsOptions, options) {
        return new L.Routing.OpenRouteServiceV2(apiKey, orsOptions, options);
    };

})();