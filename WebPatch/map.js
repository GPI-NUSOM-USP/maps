// ─────────────────────────────────────
var current_latitude = 0;
var current_longitude = 0;
var patchIsOpen = false;
let CENTER_MAP = [-46.725513951680966, -23.558790769911838];
const CENTER_RECT_X_METERS = 800;
const CENTER_RECT_Y_METERS = 600;
let geolocationWatchId = null;
let currentCompassHeading = 0;
let smartphoneLocationReady = false;
let compassReady = false;
let activeCompassEventType = null;
let lastRenderedCompassHeading = null;
let listenerIsWalking = false;
let sceneGainStopTimer = null;
let lastSmartphoneWalkingPosition = null;
let screenWakeLock = null;
const POINTER_WALKING_IDLE_MS = 450;
const SMARTPHONE_WALKING_IDLE_MS = 5000;
const SMARTPHONE_WALKING_MIN_DISTANCE_METERS = 1.2;
const SCENE_GAIN_FADE_IN_MS = 2000;
const SCENE_GAIN_FADE_OUT_MS = 5000;

const audios = [];
const places = [
    { id: 1, name: "Place 1", longitude: -46.72484612918464, latitude: -23.55742778145293 },
    { id: 2, name: "Place 2", longitude: -46.724521677227045, latitude: -23.558035883056476 },
    { id: 3, name: "Place 3", longitude: -46.72452543276725, latitude: -23.55880586198643 },
    { id: 4, name: "Place 4", longitude: -46.72407938302487, latitude: -23.559550421100212 },
    { id: 5, name: "Place 5", longitude: -46.724981440415434, latitude: -23.55982230577682 },
    { id: 6, name: "Place 6", longitude: -46.7262030794669, latitude: -23.559401386222163 },
    { id: 7, name: "Place 7", longitude: -46.72687904779477, latitude: -23.559106613765778 },
    { id: 8, name: "Place 8", longitude: -46.72683432863636, latitude: -23.55800169887131 },
    { id: 9, name: "Place 9", longitude: -46.725510185084374, latitude: -23.557207930894776 },
];

const movingPlaces = [
    // ONIBUS
    {
        id: 1,
        name: "Moving Place 1",
        centerLongitude: -46.72731078995591,
        centerLatitude: -23.558421622228266,
        longitude: -46.72731078995591,
        latitude: -23.558421622228266,
        maxDistanceMeters: 120,
        fullGainDistanceMeters: 12,
        speedMetersPerSecond: 1.1,
        algorithm: "perlin",
        seed: 101,
    },
    {
        id: 2,
        name: "Moving Place 2",
        centerLongitude: -46.72498378006918,
        centerLatitude: -23.557662208748084,
        longitude: -46.72498378006918,
        latitude: -23.557662208748084,
        maxDistanceMeters: 120,
        fullGainDistanceMeters: 12,
        speedMetersPerSecond: 1.1,
        algorithm: "perlin",
        seed: 101,
    },
];

let lastMovingPlacesTimestamp = null;
let lastMovingSpatialSentAt = 0;
let movingPlacesAnimationStarted = false;
const MOVING_SPATIAL_SEND_INTERVAL_MS = 50;
var compassActive = false;
const map = new maplibregl.Map({
    container: "map",
    style: "https://tiles.openfreemap.org/styles/liberty",
    center: CENTER_MAP,
    zoom: 16,
});

// ───────────────────────────────────────
function setStartStatus(message) {
    const status = document.getElementById("startStatus");
    if (status) status.textContent = message;
}

// ───────────────────────────────────────
function hideStartPanel() {
    const panel = document.getElementById("startPanel");
    if (panel) panel.style.display = "none";
}

// ───────────────────────────────────────
function waitForPd4Web() {
    if (Pd4Web) return Promise.resolve();

    return new Promise((resolve) => {
        const interval = window.setInterval(() => {
            if (!Pd4Web) return;
            window.clearInterval(interval);
            resolve();
        }, 50);
    });
}

// ───────────────────────────────────────
function isSmartphone() {
    const coarsePointer = window.matchMedia?.("(pointer: coarse)")?.matches;
    const narrowScreen = window.matchMedia?.("(max-width: 900px)")?.matches;
    return coarsePointer && narrowScreen && navigator.maxTouchPoints > 0;
}

// ───────────────────────────────────────
async function requestFullscreen() {
    if (document.fullscreenElement) return true;

    const element = document.documentElement;
    if (typeof element.requestFullscreen !== "function") {
        console.warn("Fullscreen is not available in this browser.");
        return false;
    }

    await element.requestFullscreen();
    return true;
}

// ───────────────────────────────────────
async function requestScreenWakeLock() {
    if (!navigator.wakeLock || typeof navigator.wakeLock.request !== "function") {
        console.warn("Screen Wake Lock is not available in this browser.");
        return false;
    }

    screenWakeLock = await navigator.wakeLock.request("screen");
    screenWakeLock.addEventListener("release", () => {
        screenWakeLock = null;
    });
    return true;
}

// ───────────────────────────────────────
async function requestSmartphoneFullscreenAndWakeLock() {
    if (!isSmartphone()) return;

    try {
        await requestFullscreen();
        await requestScreenWakeLock();
    } catch (error) {
        console.warn("Unable to request fullscreen or screen wake lock:", error);
    }
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
function clampRoomPositionToRadius(position, center, maxDistanceMeters) {
    const dx = position.x - center.x;
    const dy = position.y - center.y;
    const distance = Math.sqrt(dx * dx + dy * dy);

    if (distance <= maxDistanceMeters || distance === 0) {
        return position;
    }

    const scale = maxDistanceMeters / distance;
    return {
        x: center.x + dx * scale,
        y: center.y + dy * scale,
    };
}

// ───────────────────────────────────────
function seededRandom(seed) {
    const value = Math.sin(seed * 12.9898) * 43758.5453;
    return value - Math.floor(value);
}

// ───────────────────────────────────────
function smoothstep(value) {
    return value * value * (3 - 2 * value);
}

// ───────────────────────────────────────
function valueNoise(seed, time) {
    const left = Math.floor(time);
    const fraction = time - left;
    const a = seededRandom(seed + left * 17.17) * 2 - 1;
    const b = seededRandom(seed + (left + 1) * 17.17) * 2 - 1;
    return a + (b - a) * smoothstep(fraction);
}

// ───────────────────────────────────────
function randomPointInCircle(center, radiusMeters, seed) {
    const angle = seededRandom(seed) * Math.PI * 2;
    const radius = Math.sqrt(seededRandom(seed + 91.7)) * radiusMeters;
    return {
        x: center.x + Math.cos(angle) * radius,
        y: center.y + Math.sin(angle) * radius,
    };
}

// ───────────────────────────────────────
function initializeMovingPlaceState(place) {
    if (place.state) return place.state;

    const center = geoToRoomCoordinates([place.centerLongitude, place.centerLatitude]);
    place.state = {
        center,
        position: geoToRoomCoordinates([place.longitude, place.latitude]),
        heading: seededRandom(place.seed) * Math.PI * 2,
        waypoint: randomPointInCircle(center, place.maxDistanceMeters, place.seed + 200),
        waypointSeed: place.seed + 300,
    };

    return place.state;
}

// ───────────────────────────────────────
function updateMovingPlacePosition(place, elapsedSeconds, deltaSeconds) {
    const state = initializeMovingPlaceState(place);
    const speed = place.speedMetersPerSecond;

    if (place.algorithm === "perlin") {
        const time = elapsedSeconds * Math.max(0.05, speed) * 0.08;
        const position = {
            x: state.center.x + valueNoise(place.seed, time) * place.maxDistanceMeters,
            y: state.center.y + valueNoise(place.seed + 1000, time + 41.3) * place.maxDistanceMeters,
        };
        state.position = clampRoomPositionToRadius(position, state.center, place.maxDistanceMeters);
    } else if (place.algorithm === "random-walk") {
        const turn = valueNoise(place.seed + 500, elapsedSeconds * 0.7) * Math.PI * 0.9;
        state.heading += turn * deltaSeconds;
        const position = {
            x: state.position.x + Math.cos(state.heading) * speed * deltaSeconds,
            y: state.position.y + Math.sin(state.heading) * speed * deltaSeconds,
        };
        state.position = clampRoomPositionToRadius(position, state.center, place.maxDistanceMeters);

        if (distanceRoomMeters(state.position, state.center) >= place.maxDistanceMeters * 0.98) {
            state.heading += Math.PI * 0.8;
        }
    } else if (place.algorithm === "waypoint") {
        const distanceToWaypoint = distanceRoomMeters(state.position, state.waypoint);

        if (distanceToWaypoint < 1) {
            state.waypointSeed += 1;
            state.waypoint = randomPointInCircle(state.center, place.maxDistanceMeters, state.waypointSeed);
        } else {
            const travelDistance = Math.min(speed * deltaSeconds, distanceToWaypoint);
            state.position = {
                x: state.position.x + ((state.waypoint.x - state.position.x) / distanceToWaypoint) * travelDistance,
                y: state.position.y + ((state.waypoint.y - state.position.y) / distanceToWaypoint) * travelDistance,
            };
        }
    }

    const [longitude, latitude] = roomToGeoCoordinates(state.position);
    place.longitude = longitude;
    place.latitude = latitude;
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
function startMovingPlacesAnimation(delayMs = 0) {
    if (movingPlacesAnimationStarted) return;
    movingPlacesAnimationStarted = true;

    window.setTimeout(() => {
        lastMovingPlacesTimestamp = null;
        window.requestAnimationFrame(animateMovingPlaces);
    }, delayMs);
}

// ───────────────────────────────────────
function animateMovingPlaces(timestamp) {
    if (lastMovingPlacesTimestamp === null) {
        lastMovingPlacesTimestamp = timestamp;
    }

    const deltaSeconds = Math.min((timestamp - lastMovingPlacesTimestamp) / 1000, 0.1);
    const elapsedSeconds = timestamp / 1000;
    lastMovingPlacesTimestamp = timestamp;

    movingPlaces.forEach((place) => updateMovingPlacePosition(place, elapsedSeconds, deltaSeconds));

    if (timestamp - lastMovingSpatialSentAt >= MOVING_SPATIAL_SEND_INTERVAL_MS) {
        lastMovingSpatialSentAt = timestamp;
        sendCurrentSourceSpatialData();
    }

    window.requestAnimationFrame(animateMovingPlaces);
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
function attenuationWithFullGainDistance(distanceMeters, fullGainDistanceMeters) {
    if (distanceMeters <= fullGainDistanceMeters) return 1;
    return attenuation(distanceMeters - fullGainDistanceMeters);
}

// ─────────────────────────────────────
function sendSourceAzimuth(sourceNumber, sourceLng, sourceLat) {
    if (!Pd4Web) return;
    const compassAzimuth = compassAzimuthBetween(current_longitude, current_latitude, sourceLng, sourceLat);
    const azimuth = normalize(compassAzimuth - currentCompassHeading);
    Pd4Web.sendFloat(`source${sourceNumber}-azi`, azimuth);
}

// ─────────────────────────────────────
function sendMovingSourceAzimuth(sourceNumber, sourceLng, sourceLat) {
    if (!Pd4Web) return;
    const compassAzimuth = compassAzimuthBetween(current_longitude, current_latitude, sourceLng, sourceLat);
    const azimuth = normalize(compassAzimuth - currentCompassHeading);
    //console.log(azimuth);
    Pd4Web.sendFloat(`source${sourceNumber}-moving-azi`, azimuth);
}

// ─────────────────────────────────────
function sendSourceGain(sourceNumber, gain) {
    if (!Pd4Web) return;
    Pd4Web.sendFloat(`source${sourceNumber}-gain`, gain);
    Pd4Web.sendFloat(`gain${sourceNumber}`, gain);
}

// ─────────────────────────────────────
function sendMovingSourceGain(sourceNumber, gain) {
    if (!Pd4Web) return;
    Pd4Web.sendFloat(`source${sourceNumber}-moving-gain`, gain);
}

// ─────────────────────────────────────
function sendSceneGain(value) {
    if (!Pd4Web) return;
    const rampMs = value > 0 ? SCENE_GAIN_FADE_IN_MS : SCENE_GAIN_FADE_OUT_MS;

    ["scenegain"].forEach((receiver) => {
        if (typeof Pd4Web.sendList === "function") {
            try {
                Pd4Web.sendList(receiver, [value, rampMs]);
                return;
            } catch (error) {
                console.warn(`Unable to send list to ${receiver}:`, error);
            }
        }

        if (typeof Pd4Web.sendMessage === "function") {
            try {
                Pd4Web.sendMessage(receiver, [value, rampMs]);
                return;
            } catch (error) {
                console.warn(`Unable to send message to ${receiver}:`, error);
            }
        }

        Pd4Web.sendFloat(receiver, value);
    });
}

// ─────────────────────────────────────
function setWalkingState(isWalking) {
    updateWalkingOverlay(isWalking);
    if (listenerIsWalking === isWalking) return;
    listenerIsWalking = isWalking;
    sendSceneGain(isWalking ? 1 : 0);
}

// ───────────────────────────────────────
function updateWalkingOverlay(isWalking = listenerIsWalking) {
    const overlay = document.getElementById("walkingOverlay");
    const message = document.getElementById("walkingOverlayMessage");
    if (!overlay || !message) return;

    const isNearPracaDoRelogio = geoToRoomCoordinates([current_longitude, current_latitude]).inside;
    message.textContent = isNearPracaDoRelogio
        ? "Você precisa caminhar para ouvir os sons"
        : "Você está longe da Praça do Relógio";
    overlay.hidden = !patchIsOpen || (isNearPracaDoRelogio && isWalking);
}

// ─────────────────────────────────────
function markWalking(timeoutMs) {
    setWalkingState(true);
    window.clearTimeout(sceneGainStopTimer);
    sceneGainStopTimer = window.setTimeout(() => setWalkingState(false), timeoutMs);
}

// ─────────────────────────────────────
function updateSmartphoneWalkingState(lng, lat) {
    const nextPosition = { lng, lat };

    if (lastSmartphoneWalkingPosition === null) {
        lastSmartphoneWalkingPosition = nextPosition;
        setWalkingState(false);
        return;
    }

    const movedMeters = distanceMeters(lastSmartphoneWalkingPosition.lat, lastSmartphoneWalkingPosition.lng, lat, lng);

    if (movedMeters >= SMARTPHONE_WALKING_MIN_DISTANCE_METERS) {
        lastSmartphoneWalkingPosition = nextPosition;
        markWalking(SMARTPHONE_WALKING_IDLE_MS);
    }
}

// ─────────────────────────────────────
function sendCurrentSourceSpatialData() {
    if (!Pd4Web) return;

    places.forEach((place) => {
        const dist = distanceMeters(place.latitude, place.longitude, current_latitude, current_longitude);
        sendSourceAzimuth(place.id, place.longitude, place.latitude);
        sendSourceGain(place.id, attenuation(dist));
    });

    audios.forEach((audio) => {
        const dist = distanceMeters(audio.latitude, audio.longitude, current_latitude, current_longitude);
        sendSourceAzimuth(audio.sourceNumber, audio.longitude, audio.latitude);
        sendSourceGain(audio.sourceNumber, attenuation(dist));
    });

    movingPlaces.forEach((place) => {
        const dist = distanceMeters(place.latitude, place.longitude, current_latitude, current_longitude);
        sendMovingSourceAzimuth(place.id, place.longitude, place.latitude);
        sendMovingSourceGain(place.id, attenuationWithFullGainDistance(dist, place.fullGainDistanceMeters));
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
function getScreenAngle() {
    let screenAngle = 0;
    if (screen.orientation && typeof screen.orientation.angle === "number") {
        screenAngle = screen.orientation.angle;
    } else if (typeof window.orientation === "number") {
        screenAngle = window.orientation;
    }

    return normalize(screenAngle);
}

// ─────────────────────────────────────
function validHeading(value) {
    return typeof value === "number" && Number.isFinite(value);
}

// ─────────────────────────────────────
function getAbsoluteNorth(event) {
    if (validHeading(event.webkitCompassHeading)) {
        return normalize(event.webkitCompassHeading);
    }

    if (!validHeading(event.alpha)) {
        return null;
    }

    return normalize(360 - event.alpha + getScreenAngle());
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
function rotateMapToCompass(heading) {
    if (
        lastRenderedCompassHeading !== null &&
        Math.abs(shortestAngleDelta(lastRenderedCompassHeading, heading)) < 0.35
    ) {
        return;
    }

    lastRenderedCompassHeading = heading;
    map.rotateTo(heading, {
        duration: 0,
        essential: true,
    });
}

// ─────────────────────────────────────
function onDeviceOrientation(event) {
    if (activeCompassEventType === "deviceorientationabsolute" && event.type !== activeCompassEventType) {
        return;
    }

    const rawHeading = getAbsoluteNorth(event);
    if (rawHeading === null) return;

    if (event.type === "deviceorientationabsolute" || activeCompassEventType === null) {
        activeCompassEventType = event.type;
    }

    const heading = smoothCompassHeading(rawHeading);
    compassReady = true;
    currentCompassHeading = heading;
    rotateMapToCompass(heading);
    if (!isSmartphone() || smartphoneLocationReady) {
        sendCurrentSourceSpatialData();
    }
}

// ─────────────────────────────────────
async function requestCompassPermission() {
    if (
        typeof DeviceOrientationEvent !== "undefined" &&
        typeof DeviceOrientationEvent.requestPermission === "function"
    ) {
        const permission = await DeviceOrientationEvent.requestPermission();
        return permission === "granted";
    }

    return true;
}

// ─────────────────────────────────────
function startListening() {
    if (compassActive) return;

    console.log("activating compass");
    window.addEventListener("deviceorientationabsolute", onDeviceOrientation, true);
    window.addEventListener("deviceorientation", onDeviceOrientation, true);
    compassActive = true;
}

// ─────────────────────────────────────
function waitForCompassReading(timeoutMs = 2500) {
    if (compassReady) return Promise.resolve(true);

    return new Promise((resolve) => {
        const startedAt = Date.now();
        const interval = window.setInterval(() => {
            if (compassReady) {
                window.clearInterval(interval);
                resolve(true);
                return;
            }

            if (Date.now() - startedAt >= timeoutMs) {
                window.clearInterval(interval);
                resolve(false);
            }
        }, 100);
    });
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
// ─────────────────────────────────────
function updateListenerPosition(lng, lat, options = {}) {
    current_latitude = lat;
    current_longitude = lng;
    marker.setLngLat([lng, lat]);
    updateWalkingOverlay();

    if (options.walking) {
        markWalking(options.walkingTimeoutMs ?? POINTER_WALKING_IDLE_MS);
    }

    if (options.centerMap) {
        map.easeTo({ center: [lng, lat], duration: 500 });
    }

    if (Pd4Web) {
        sendCurrentSourceSpatialData();
    }
}

// ─────────────────────────────────────
function startGeolocationTracking() {
    if (!isSmartphone()) return Promise.resolve(true);
    if (geolocationWatchId !== null) return Promise.resolve(smartphoneLocationReady);

    if (!navigator.geolocation) {
        console.warn("Geolocation is not available in this browser.");
        return Promise.resolve(false);
    }

    const options = {
        enableHighAccuracy: true,
        maximumAge: 1000,
        timeout: 10000,
    };

    return new Promise((resolve) => {
        let settled = false;

        const settle = (value) => {
            if (settled) return;
            settled = true;
            resolve(value);
        };

        const onPosition = (position) => {
            smartphoneLocationReady = true;
            updateSmartphoneWalkingState(position.coords.longitude, position.coords.latitude);
            updateListenerPosition(position.coords.longitude, position.coords.latitude, {
                centerMap: true,
            });
            settle(true);
        };

        const onError = (error) => {
            console.warn("Unable to read smartphone location:", error.message);
            settle(false);
        };

        navigator.geolocation.getCurrentPosition(onPosition, onError, options);
        geolocationWatchId = navigator.geolocation.watchPosition(onPosition, onError, options);
    });
}

// ─────────────────────────────────────
map.on("load", () => {
    const center = map.getCenter();
    current_longitude = center.lng;
    current_latitude = center.lat;
    marker.setLngLat(center).addTo(map);

});

// native compass
map.addControl(new maplibregl.NavigationControl(), "top-right");

// ─────────────────────────────────────
map.on("mousemove", (e) => {
    if (isSmartphone()) return;
    updateListenerPosition(e.lngLat.lng, e.lngLat.lat, {
        walking: true,
        walkingTimeoutMs: POINTER_WALKING_IDLE_MS,
    });
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
    startMovingPlacesAnimation(2000);

    if (!isSmartphone() || smartphoneLocationReady) {
        sendCurrentSourceSpatialData();
    }
    sendSceneGain(listenerIsWalking ? 1 : 0);
}

// ─────────────────────────────────────
async function startExperience() {
    const button = document.getElementById("startButton");
    if (button) button.disabled = true;

    try {
        setStartStatus("Ativando a tela cheia...");
        await requestSmartphoneFullscreenAndWakeLock();

        setStartStatus("Solicitando acesso à bússola...");
        const compassAllowed = await requestCompassPermission();
        if (compassAllowed) {
            startListening();
        } else {
            console.warn("Compass permission was not granted.");
        }
        const compassStarted = compassAllowed ? await waitForCompassReading() : false;

        setStartStatus("Solicitando acesso à localização...");
        const locationAllowed = await startGeolocationTracking();

        setStartStatus("Iniciando o áudio...");
        await waitForPd4Web();
        if (!patchIsOpen) {
            await sendFiles();
            patchIsOpen = true;
        }
        updateWalkingOverlay();

        if (!locationAllowed) {
            setStartStatus("Iniciado sem acesso à localização.");
        } else if (!compassStarted) {
            setStartStatus("Iniciado sem acesso à bússola.");
        } else {
            setStartStatus("Iniciado.");
        }
        window.setTimeout(hideStartPanel, 700);
    } catch (error) {
        console.warn("Unable to start sensors or audio:", error);
        setStartStatus("Não foi possível iniciar. Toque em Iniciar novamente.");
        if (button) button.disabled = false;
    }
}

// ─────────────────────────────────────
map.on("click", (e) => {
    if (!isSmartphone()) {
        updateListenerPosition(e.lngLat.lng, e.lngLat.lat);
    }
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
});
