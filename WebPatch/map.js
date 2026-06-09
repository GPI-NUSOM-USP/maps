// ─────────────────────────────────────
var current_latitude = 0;
var current_longitude = 0;
const CENTER_MAP = [-46.64767763, -23.56106566];
const audios = [];
var compassActive = false;
const map = new maplibregl.Map({
    container: "map",
    style: "https://tiles.openfreemap.org/styles/liberty",
    center: CENTER_MAP,
    zoom: 16,
});

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
    Pd4Web.sendFloat(`source${audioData.sourceNumber}-lon`, pos.x);
    Pd4Web.sendFloat(`source${audioData.sourceNumber}-lat`, pos.y);
    Pd4Web.sendSymbol(`source${audioData.sourceNumber}-file`, `audio${audioData.sourceNumber}.${ext}`);
    // Pd4Web.sendList(`source${audioData.sourceNumber}-pos`, [pos.x, pos.y]);
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
    const halfDistance = 40;
    const alpha = Math.log(0.5) / halfDistance;
    let gain = Math.exp(alpha * distanceMeters);
    gain = Math.min(1, Math.max(0, gain));
    console.log(distanceMeters, gain);
    return gain;
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
    const heading = smoothCompassHeading(rawHeading);
    map.setBearing(heading);
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
map.on("load", () => {
    const newmarker = new maplibregl.Marker();
    marker.setLngLat(map.getCenter()).addTo(map);

    const soundPosition = moveNorth(CENTER_MAP, 50);
    new maplibregl.Marker().setLngLat(soundPosition).addTo(map);
});

// native compass
map.addControl(new maplibregl.NavigationControl(), "top-right");

// ─────────────────────────────────────
map.on("mousemove", (e) => {
    if (Pd4Web) {
        // atualiza os ganhos
        audios.forEach((audio) => {
            const dist = distanceMeters(audio.latitude, audio.longitude, e.lngLat.lat, e.lngLat.lng);
            const gain = attenuation(dist);
            Pd4Web.sendFloat(`source${audio.sourceNumber}-gain`, gain);
        });
    }
});

// ─────────────────────────────────────
map.on("rotate", () => {
    const bearing = (map.getBearing() + 360) % 360;
    currentBearing = smoothCompassHeading(bearing);
    if (Pd4Web) {
        Pd4Web.sendFloat("compass-yaw", bearing);
    }
});

// ─────────────────────────────────────
map.on("click", (e) => {
    current_latitude = e.lngLat.lat;
    current_longitude = e.lngLat.lng;
    startListening();
    Pd4Web.openPatch("index.pd", {
        projectName: "MyProject",
        sampleRate: 48000,
        renderGui: false,
        requestMidi: false,
        fps: 0,
    });
    Pd4Web.init();
});
