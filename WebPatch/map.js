// ─────────────────────────────────────
var current_latitude = 0;
var current_longitude = 0;
var patchIsOpen = false;
let CENTER_MAP = [-46.725513951680966, -23.558790769911838];
const CENTER_RECT_X_METERS = 400;
const CENTER_RECT_Y_METERS = 300;
let geolocationWatchId = null;
let currentCompassHeading = 0;

const audios = [];
const places = [
    { id: 1, name: "Place 1", x: -120, y: 70, z: 0 },
    { id: 2, name: "Place 2", x: 95, y: -55, z: 0 },
    { id: 3, name: "Place 3", x: -35, y: -105, z: 0 },
    { id: 4, name: "Place 4", x: 145, y: 85, z: 0 },
    { id: 5, name: "Place 5", x: 15, y: 20, z: 0 },
];
const placeColors = {
    1: "#d7263d",
    2: "#1b998b",
    3: "#f46036",
    4: "#2e294e",
    5: "#f3a712",
};
var compassActive = false;
const map = new maplibregl.Map({
    container: "map",
    style: "https://tiles.openfreemap.org/styles/liberty",
    center: CENTER_MAP,
    zoom: 16,
});

// ───────────────────────────────────────
function isSmartphone() {
    const coarsePointer = window.matchMedia?.("(pointer: coarse)")?.matches;
    const narrowScreen = window.matchMedia?.("(max-width: 900px)")?.matches;
    return coarsePointer && narrowScreen && navigator.maxTouchPoints > 0;
}

// ───────────────────────────────────────
function getRectAroundCenter([lng, lat], widthMeters, heightMeters) {
    const metersPerDegreeLat = 111320;
    const metersPerDegreeLng = metersPerDegreeLat * Math.cos((lat * Math.PI) / 180);
    const halfLng = widthMeters / 2 / metersPerDegreeLng;
    const halfLat = heightMeters / 2 / metersPerDegreeLat;

    return [
        [lng - halfLng, lat + halfLat],
        [lng + halfLng, lat + halfLat],
        [lng + halfLng, lat - halfLat],
        [lng - halfLng, lat - halfLat],
        [lng - halfLng, lat + halfLat],
    ];
}

// ───────────────────────────────────────
function geoToRoomCoordinates([lng, lat], [centerLng, centerLat] = CENTER_MAP) {
    const metersPerDegreeLat = 111320;
    const metersPerDegreeLng = metersPerDegreeLat * Math.cos((centerLat * Math.PI) / 180);
    const x = (lng - centerLng) * metersPerDegreeLng;
    const y = -(lat - centerLat) * metersPerDegreeLat;

    return {
        x,
        y,
        inside:
            x >= -CENTER_RECT_X_METERS / 2 &&
            x <= CENTER_RECT_X_METERS / 2 &&
            y >= -CENTER_RECT_Y_METERS / 2 &&
            y <= CENTER_RECT_Y_METERS / 2,
    };
}

// ───────────────────────────────────────
function roomToGeoCoordinates({ x, y }, [centerLng, centerLat] = CENTER_MAP) {
    const metersPerDegreeLat = 111320;
    const metersPerDegreeLng = metersPerDegreeLat * Math.cos((centerLat * Math.PI) / 180);
    const lng = centerLng + x / metersPerDegreeLng;
    const lat = centerLat - y / metersPerDegreeLat;
    return [lng, lat];
}

// ───────────────────────────────────────
function distanceRoomMeters(positionA, positionB) {
    const dx = positionA.x - positionB.x;
    const dy = positionA.y - positionB.y;
    return Math.sqrt(dx * dx + dy * dy);
}

// ───────────────────────────────────────
function compassAzimuthBetween(fromLng, fromLat, toLng, toLat) {
    const toRad = (deg) => (deg * Math.PI) / 180;
    const toDeg = (rad) => (rad * 180) / Math.PI;
    const startLat = toRad(fromLat);
    const endLat = toRad(toLat);
    const deltaLng = toRad(toLng - fromLng);
    const y = Math.sin(deltaLng) * Math.cos(endLat);
    const x = Math.cos(startLat) * Math.sin(endLat) - Math.sin(startLat) * Math.cos(endLat) * Math.cos(deltaLng);
    return normalize(toDeg(Math.atan2(y, x)));
}

// ───────────────────────────────────────
function getCenterRectData() {
    return {
        type: "Feature",
        properties: {},
        geometry: {
            type: "LineString",
            coordinates: getRectAroundCenter(CENTER_MAP, CENTER_RECT_X_METERS, CENTER_RECT_Y_METERS),
        },
    };
}

// ───────────────────────────────────────
function addCenterRect() {
    map.addSource("center-map-rect", {
        type: "geojson",
        data: getCenterRectData(),
    });

    map.addLayer({
        id: "center-map-rect-outline",
        type: "line",
        source: "center-map-rect",
        paint: {
            "line-color": "#ff0000",
            "line-width": 2,
        },
    });
}

// ───────────────────────────────────────
function updateCenterRect() {
    const source = map.getSource("center-map-rect");
    if (source) source.setData(getCenterRectData());
}

// ───────────────────────────────────────
function addPlaceMarkers() {
    places.forEach((place) => {
        const markerColor = placeColors[place.id];

        new maplibregl.Marker({ color: markerColor })
            .setLngLat(roomToGeoCoordinates(place))
            .setPopup(
                new maplibregl.Popup({ offset: 25 }).setHTML(`
                    <b>${place.name}</b><br>
                    Source: ${place.id}<br>
                    X: ${place.x}<br>
                    Y: ${place.y}<br>
                    Z: ${place.z}
                `),
            )
            .addTo(map);
    });
}

// ───────────────────────────────────────
function addNewAudio() {
    document.getElementById("audioOverlay").style.display = "flex";
    document.getElementById("latitude").value = current_latitude;
    document.getElementById("longitude").value = current_longitude;
}

// ───────────────────────────────────────
function closeAudioModal() {
    document.getElementById("audioOverlay").style.display = "none";
    document.getElementById("audioFile").value = "";
    document.getElementById("audioName").value = "";
    document.getElementById("latitude").value = "";
    document.getElementById("longitude").value = "";
    document.getElementById("sourceNumber").value = "";
}

// ───────────────────────────────────────
function getExtension(file) {
    const nameExt = file.name?.split(".").pop()?.toLowerCase();
    if (nameExt && nameExt.length <= 5) return nameExt;
    switch (file.type) {
        case "audio/mpeg":
            return "mp3";
        case "audio/wav":
            return "wav";
        case "audio/x-wav":
            return "wav";
        case "audio/ogg":
            return "ogg";
        default:
            return "bin";
    }
}

// ───────────────────────────────────────
async function saveAudio() {
    const file = document.getElementById("audioFile").files[0];
    const audioData = {
        file,
        name: document.getElementById("audioName").value,
        latitude: parseFloat(document.getElementById("latitude").value),
        longitude: parseFloat(document.getElementById("longitude").value),
        sourceNumber: parseInt(document.getElementById("sourceNumber").value, 10),
    };
    audios.push(audioData);
    const randomColor =
        "#" +
        Math.floor(Math.random() * 16777215)
            .toString(16)
            .padStart(6, "0");

    new maplibregl.Marker({
        color: randomColor,
    })
        .setLngLat([audioData.longitude, audioData.latitude])
        .setPopup(
            new maplibregl.Popup({ offset: 25 }).setHTML(`
                        <b>${audioData.name}</b><br>
                        Source: ${audioData.sourceNumber}<br>
                        Lat: ${audioData.latitude.toFixed(6)}<br>
                        Lon: ${audioData.longitude.toFixed(6)}
                    `),
        )
        .addTo(map);
    closeAudioModal();

    // send audio to Pd
    const arrayBuffer = await audioData.file.arrayBuffer();
    const ext = getExtension(audioData.file);
    const filename = `audio${audioData.sourceNumber}.${ext}`;
    // let pos = geoToLocal(audioData.longitude, audioData.latitude);

    Pd4Web.sendFile(arrayBuffer, "/" + filename);
    sendSourceAzimuth(audioData.sourceNumber, audioData.longitude, audioData.latitude);
    sendSourceGain(audioData.sourceNumber, 1);
    Pd4Web.sendSymbol(`source${audioData.sourceNumber}-file`, `audio${audioData.sourceNumber}.${ext}`);
}

// ───────────────────────────────────────
function addLine(x1, y1, x2, y2) {
    let lineStr = `${x1}-${y1}-${x2}-${y2}`;
    map.addSource(lineStr, {
        type: "geojson",
        data: {
            type: "Feature",
            geometry: {
                type: "LineString",
                coordinates: [
                    [x1, y1],
                    [x2, y2],
                ],
            },
        },
    });
    map.addLayer({
        id: lineStr,
        type: "line",
        source: lineStr,
        paint: {
            "line-color": "#ff0000dd",
            "line-width": 1,
        },
    });
}

// ───────────────────────────────────────
function geoToLocal(lon, lat) {
    const nx = (lon - minLon) / (maxLon - minLon);
    const ny = (lat - minLat) / (maxLat - minLat);
    const x = nx * 10 - 5;
    const y = ny * 10 - 5;
    return { x, y };
}

// ─────────────────────────────────────
// distancia da fonte
function distanceMeters(lat1, lon1, lat2, lon2) {
    const R = 6371000;
    const toRad = (deg) => (deg * Math.PI) / 180;
    const dLat = toRad(lat2 - lat1);
    const dLon = toRad(lon2 - lon1);
    const a =
        Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);

    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));

    return R * c;
}

// ─────────────────────────────────────
// Gabriel's math
function attenuation(distanceMeters) {
    const halfDistance = 20;
    const alpha = Math.log(0.5) / halfDistance;
    let gain = Math.exp(alpha * distanceMeters);
    gain = Math.min(1, Math.max(0, gain));
    //console.log(distanceMeters, gain);
    return gain;
}

// ─────────────────────────────────────
function sendSourceAzimuth(sourceNumber, sourceLng, sourceLat) {
    if (!Pd4Web) return;
    const compassAzimuth = compassAzimuthBetween(current_longitude, current_latitude, sourceLng, sourceLat);
    const azimuth = normalize(compassAzimuth - currentCompassHeading);
    Pd4Web.sendFloat(`source${sourceNumber}-azi`, azimuth);
}

// ─────────────────────────────────────
function sendSourceGain(sourceNumber, gain) {
    if (!Pd4Web) return;
    Pd4Web.sendFloat(`source${sourceNumber}-gain`, gain);
    Pd4Web.sendFloat(`gain${sourceNumber}`, gain);
}

// ─────────────────────────────────────
function sendCurrentSourceSpatialData() {
    if (!Pd4Web) return;
    const roomPosition = geoToRoomCoordinates([current_longitude, current_latitude]);

    places.forEach((place) => {
        const [sourceLng, sourceLat] = roomToGeoCoordinates(place);
        const dist = distanceRoomMeters(roomPosition, place);
        sendSourceAzimuth(place.id, sourceLng, sourceLat);
        sendSourceGain(place.id, attenuation(dist));
    });

    audios.forEach((audio) => {
        const dist = distanceMeters(audio.latitude, audio.longitude, current_latitude, current_longitude);
        sendSourceAzimuth(audio.sourceNumber, audio.longitude, audio.latitude);
        sendSourceGain(audio.sourceNumber, attenuation(dist));
    });
}

//╭─────────────────────────────────────╮
//│               Compass               │
//╰─────────────────────────────────────╯
function normalize(angle) {
    angle = angle % 360;
    if (angle < 0) angle += 360;
    return angle;
}

// ─────────────────────────────────────
function getAbsoluteNorth(event) {
    const ua = navigator.userAgent || navigator.vendor || window.opera;
    const isIOS = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    const isAndroid = /Android/.test(ua);
    let screenAngle = 0;
    if (screen.orientation && typeof screen.orientation.angle === "number") {
        screenAngle = screen.orientation.angle;
    } else if (typeof window.orientation === "number") {
        screenAngle = window.orientation;
    }
    screenAngle = normalize(screenAngle);
    if (isIOS && typeof event.webkitCompassHeading === "number") {
        let heading = event.webkitCompassHeading;
        if (isNaN(heading)) {
            return null;
        }
        heading += screenAngle;
        return normalize(heading);
    }

    if (isAndroid && event.alpha != null) {
        let heading = event.alpha;
        if (isNaN(heading)) {
            return null;
        }
        heading = 360 - heading;
        heading += screenAngle;
        return normalize(heading);
    }

    if (event.absolute === true && event.alpha != null) {
        let heading = event.alpha;
        if (isNaN(heading)) {
            return null;
        }
        heading = 360 - heading;
        heading += screenAngle;
        return normalize(heading);
    }
    return null;
}

// ─────────────────────────────────────
let smoothedHeading = null;
const SMOOTHING = 0.08;
const MAX_STEP = 2.5;

// ─────────────────────────────────────
function shortestAngleDelta(from, to) {
    return ((to - from + 540) % 360) - 180;
}

// ─────────────────────────────────────
function smoothCompassHeading(targetHeading) {
    if (smoothedHeading === null) {
        smoothedHeading = targetHeading;
        return smoothedHeading;
    }

    let delta = shortestAngleDelta(smoothedHeading, targetHeading);
    delta = Math.max(-MAX_STEP, Math.min(MAX_STEP, delta));
    smoothedHeading += delta * SMOOTHING;
    smoothedHeading = (smoothedHeading + 360) % 360;
    return smoothedHeading;
}

// ─────────────────────────────────────
function onDeviceOrientation(event) {
    const rawHeading = getAbsoluteNorth(event);
    if (rawHeading === null) return;
    const heading = smoothCompassHeading(rawHeading);
    currentCompassHeading = heading;
    map.setBearing(heading);
    sendCurrentSourceSpatialData();
}

// ─────────────────────────────────────
function startListening() {
    if ("ondeviceorientationabsolute" in window) {
        console.log("activating compass");
        window.addEventListener("deviceorientationabsolute", onDeviceOrientation, true);
    } else {
        console.log("activating compass");
        window.addEventListener("deviceorientation", onDeviceOrientation, true);
    }
}

// ─────────────────────────────────────
async function fileToArrayBuffer(audioFile) {
    const response = await fetch(audioFile);
    if (!response.ok) {
        throw new Error(`HTTP error! Status: ${response.status}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    Pd4Web.sendFile(arrayBuffer, audioFile.split("/").pop());
}

// ─────────────────────────────────────
// Map listener
// ─────────────────────────────────────
const marker = new maplibregl.Marker();

// ─────────────────────────────────────
function moveNorth([lng, lat], meters) {
    const metersPerDegreeLat = 111320; // approximate
    const newLat = lat + meters / metersPerDegreeLat;
    return [lng, newLat];
}

// ─────────────────────────────────────
function updateListenerPosition(lng, lat, options = {}) {
    current_latitude = lat;
    current_longitude = lng;
    marker.setLngLat([lng, lat]);

    if (options.centerMap) {
        map.easeTo({ center: [lng, lat], duration: 500 });
    }

    if (Pd4Web) {
        sendCurrentSourceSpatialData();
    }
}

// ─────────────────────────────────────
function startGeolocationTracking() {
    if (!isSmartphone() || geolocationWatchId !== null) return;

    if (!navigator.geolocation) {
        console.warn("Geolocation is not available in this browser.");
        return;
    }

    const options = {
        enableHighAccuracy: true,
        maximumAge: 1000,
        timeout: 10000,
    };

    const onPosition = (position) => {
        updateListenerPosition(position.coords.longitude, position.coords.latitude, {
            centerMap: true,
        });
    };

    const onError = (error) => {
        console.warn("Unable to read smartphone location:", error.message);
    };

    navigator.geolocation.getCurrentPosition(onPosition, onError, options);
    geolocationWatchId = navigator.geolocation.watchPosition(onPosition, onError, options);
}

// ─────────────────────────────────────
map.on("load", () => {
    const newmarker = new maplibregl.Marker();
    marker.setLngLat(map.getCenter()).addTo(map);

    const soundPosition = moveNorth(CENTER_MAP, 50);
    new maplibregl.Marker().setLngLat(soundPosition).addTo(map);
    addPlaceMarkers();
    addCenterRect();
    startGeolocationTracking();
});

// native compass
map.addControl(new maplibregl.NavigationControl(), "top-right");

// ─────────────────────────────────────
map.on("mousemove", (e) => {
    if (isSmartphone()) return;
    updateListenerPosition(e.lngLat.lng, e.lngLat.lat);
});

// ─────────────────────────────────────
map.on("rotate", () => {
    const bearing = (map.getBearing() + 360) % 360;
    currentCompassHeading = bearing;
    sendCurrentSourceSpatialData();
});

// ─────────────────────────────────────
async function sendFiles() {
    Pd4Web.openPatch("index.pd", {
        projectName: "MyProject",
        sampleRate: 48000,
        renderGui: false,
        requestMidi: false,
        fps: 0,
    });

    // Init
    Pd4Web.init();

    sendCurrentSourceSpatialData();
}

// ─────────────────────────────────────
map.on("click", (e) => {
    current_latitude = e.lngLat.lat;
    current_longitude = e.lngLat.lng;
    const roomPosition = geoToRoomCoordinates([current_longitude, current_latitude]);

    console.log("Clicked position:", {
        x: Number(roomPosition.x.toFixed(3)),
        y: Number(roomPosition.y.toFixed(3)),
        longitude: current_longitude,
        latitude: current_latitude,
        lngLat: [current_longitude, current_latitude],
        room: {
            x: Number(roomPosition.x.toFixed(3)),
            y: Number(roomPosition.y.toFixed(3)),
            inside: roomPosition.inside,
        },
    });
    startListening();
    startGeolocationTracking();

    if (!patchIsOpen) {
        sendFiles();
        patchIsOpen = true;
    }
});
