const API_BASE = window.location.origin;
const LOCATION_SYNC_MS = 5000;
const PRESENCE_PING_MS = 10000;
const USER_MARKER_ICON_URL = "Icon/gps-green.png";
const OTHER_USER_MARKER_BLINK_MS = 500;
const PENDING_CHAT_USER_KEY = "careclickPendingChatUserId";

let map = null;
let userMarker = null;
let locationWatchId = null;
let lastLocationSyncAt = 0;
let activeMarkers = [];
let customUserMarkerIconAvailable = null;
let customUserMarkerIconCheckPromise = null;
let userMarkerReadyPromise = null;
let latestMarkerUpdateId = 0;
let currentUserId = null;
let socket = null;
let presencePingId = null;
const otherUserMarkers = new Map();
let isRequestingActive = false;
let selectedUserForModal = null;

function authHeaders() {
    return {
        "Content-Type": "application/json",
    };
}

function setLocationLabel(text) {
    const locationEl = document.getElementById("live-location");
    if (locationEl) {
        locationEl.textContent = text;
    }
}

function formatCoordinates(lat, lng) {
    return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
}

function clearSessionAndRedirect() {
    if (presencePingId) {
        clearInterval(presencePingId);
        presencePingId = null;
    }

    if (socket) {
        socket.disconnect();
        socket = null;
    }

    otherUserMarkers.forEach((entry) => entry.marker.remove());
    otherUserMarkers.clear();

    window.location.href = "Login.html";
}

async function apiRequest(path, options = {}) {
    const response = await fetch(`${API_BASE}${path}`, {
        ...options,
        credentials: "include",
        headers: {
            ...(options.headers || {}),
            ...authHeaders(),
        },
    });

    let data = {};
    try {
        data = await response.json();
    } catch (_error) {
        data = {};
    }

    if (response.status === 401) {
        clearSessionAndRedirect();
        throw new Error("Session expired");
    }

    if (!response.ok) {
        throw new Error(data.message || "Request failed");
    }

    return data;
}

function initMap() {
    if (typeof L === "undefined") {
        return;
    }

    map = L.map("map", {
        zoomControl: false,
        attributionControl: true,
        dragging: true,
        scrollWheelZoom: true,
        doubleClickZoom: true,
        boxZoom: true,
        keyboard: true,
        tap: true,
    });

    map.setView([15.48, 120.976], 14);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
        minZoom: 15,
        maxZoom: 19,
        attribution: "&copy; OpenStreetMap contributors",
    }).addTo(map);
}

function checkCustomUserMarkerIconAvailability() {
    if (customUserMarkerIconAvailable !== null) {
        return Promise.resolve(customUserMarkerIconAvailable);
    }

    if (customUserMarkerIconCheckPromise) {
        return customUserMarkerIconCheckPromise;
    }

    customUserMarkerIconCheckPromise = new Promise((resolve) => {
        const img = new Image();

        img.onload = () => {
            customUserMarkerIconAvailable = true;
            resolve(true);
        };

        img.onerror = () => {
            customUserMarkerIconAvailable = false;
            resolve(false);
        };

        img.src = USER_MARKER_ICON_URL;
    });

    return customUserMarkerIconCheckPromise;
}

function createDefaultUserMarker(coords) {
    return L.circleMarker(coords, {
        radius: 7,
        color: "#3b82f6",
        weight: 2,
        fillColor: "#3b82f6",
        fillOpacity: 0.9,
        interactive: false,
    }).addTo(map);
}

function createOtherUserMarker(coords) {
    return L.circleMarker(coords, {
        radius: 8,
        color: "#890c0c",
        weight: 2,
        fillColor: "#f90909",
        fillOpacity: 1,
        className: "other-user-marker",
    }).addTo(map);
}

async function createUserMarker(coords) {
    const hasCustomIcon = await checkCustomUserMarkerIconAvailability();

    if (hasCustomIcon) {
        const userIcon = L.icon({
            iconUrl: USER_MARKER_ICON_URL,
            iconSize: [36, 36],
            iconAnchor: [18, 34],
            popupAnchor: [0, -36],
        });

        return L.marker(coords, { icon: userIcon, interactive: false }).addTo(map);
    }

    return createDefaultUserMarker(coords);
}

async function ensureUserMarker(coords) {
    if (userMarker) {
        return userMarker;
    }

    if (!userMarkerReadyPromise) {
        userMarkerReadyPromise = createUserMarker(coords)
            .then((marker) => {
                userMarker = marker;
                return marker;
            })
            .finally(() => {
                userMarkerReadyPromise = null;
            });
    }

    return userMarkerReadyPromise;
}

async function updateMapLocation(lat, lng) {
    if (!map) return;

    const coords = [lat, lng];
    const currentUpdateId = ++latestMarkerUpdateId;
    const marker = await ensureUserMarker(coords);

    // Ignore stale async completions and apply only the newest position.
    if (currentUpdateId !== latestMarkerUpdateId) {
        return;
    }

    if (typeof marker.setLatLng === "function") {
        marker.setLatLng(coords);
    }

    map.panTo(coords, { animate: true, duration: 0.7 });
}

async function syncLocation(lat, lng) {
    const now = Date.now();
    if (now - lastLocationSyncAt < LOCATION_SYNC_MS) return;
    lastLocationSyncAt = now;

    if (socket && socket.connected) {
        socket.emit("location:update", { lat, lng });
        return;
    }

    try {
        await apiRequest("/api/users/me/location", {
            method: "PATCH",
            body: JSON.stringify({ lat, lng }),
        });
    } catch (error) {
        console.error("Location sync failed:", error.message);
    }
}

function handlePosition(position) {
    const lat = position.coords.latitude;
    const lng = position.coords.longitude;

    setLocationLabel(`Live: ${formatCoordinates(lat, lng)}`);
    updateMapLocation(lat, lng);
    syncLocation(lat, lng);
}

function handlePositionError(_error) {
    setLocationLabel("Location access denied");
}

function startLocationTracking() {
    if (!navigator.geolocation) {
        setLocationLabel("Geolocation unsupported");
        return;
    }

    locationWatchId = navigator.geolocation.watchPosition(handlePosition, handlePositionError, {
        enableHighAccuracy: true,
        maximumAge: 3000,
        timeout: 15000,
    });
}

function applyRequestingUI(isRequesting) {
    isRequestingActive = Boolean(isRequesting);

    if (isRequestingActive) {
        hideElement("sos-btn");
        hideElement("request-panel");
        hideElement("incoming-modal");
        showElement("location-panel");
    } else {
        hideElement("request-panel");
        hideElement("location-panel");
        hideElement("incoming-modal");
        showElement("sos-btn");
    }
}

async function loadCurrentUser() {
    try {
        const data = await apiRequest("/api/users/me");
        currentUserId = data?.user?._id || null;
        applyRequestingUI(data?.user?.isRequesting);
        const userLocation = data?.user?.userLocation;
        if (Number.isFinite(userLocation?.lat) && Number.isFinite(userLocation?.lng)) {
            setLocationLabel(`Last known: ${formatCoordinates(userLocation.lat, userLocation.lng)}`);
            updateMapLocation(userLocation.lat, userLocation.lng);
        } else {
            setLocationLabel("Locating...");
        }
    } catch (error) {
        console.error("Failed to load profile:", error.message);
    }
}

function syncOtherUserMarkers(users) {
    if (!map) return;

    const onlineOtherUsers = users.filter((user) => {
        const isOtherUser = String(user._id) !== String(currentUserId);
        const hasCoords =
            Number.isFinite(user?.userLocation?.lat) && Number.isFinite(user?.userLocation?.lng);
        return isOtherUser && user.isOnline && hasCoords && user.isRequesting;
    });

    const activeIds = new Set(onlineOtherUsers.map((user) => String(user._id)));

    otherUserMarkers.forEach((entry, userId) => {
        if (!activeIds.has(userId)) {
            entry.marker.remove();
            otherUserMarkers.delete(userId);
        }
    });

    onlineOtherUsers.forEach((user) => {
        const userId = String(user._id);
        const coords = [user.userLocation.lat, user.userLocation.lng];
        const existing = otherUserMarkers.get(userId);
        if (existing) {
            existing.marker.setLatLng(coords);
            existing.user = user;
            return;
        }

        const marker = createOtherUserMarker(coords);
        marker.on("click", () => showIncomingUserModal(user));
        otherUserMarkers.set(userId, { marker, user });
    });
}

async function refreshLocationFeedMarkers() {
    try {
        const data = await apiRequest("/api/users/location-feed");
        const users = Array.isArray(data?.users) ? data.users : [];
        syncOtherUserMarkers(users);
    } catch (error) {
        console.error("Location feed refresh failed:", error.message);
    }
}

function startPresencePing() {
    if (presencePingId) return;
    if (socket && socket.connected) {
        socket.emit("presence:ping");
    }
    presencePingId = setInterval(() => {
        if (socket && socket.connected) {
            socket.emit("presence:ping");
        }
    }, PRESENCE_PING_MS);
}

function stopPresencePing() {
    if (presencePingId) {
        clearInterval(presencePingId);
        presencePingId = null;
    }
}

function startLocationSocket() {
    if (typeof io === "undefined") {
        refreshLocationFeedMarkers();
        return;
    }

    if (socket) return;

    socket = io(API_BASE, { withCredentials: true });

    socket.on("connect", () => {
        startPresencePing();
    });

    socket.on("location:feed", (payload = {}) => {
        const users = Array.isArray(payload?.users) ? payload.users : [];
        syncOtherUserMarkers(users);
    });

    socket.on("location:error", (payload = {}) => {
        if (payload?.message) {
            console.warn("Location update error:", payload.message);
        }
    });

    socket.on("disconnect", () => {
        stopPresencePing();
    });

    socket.on("connect_error", (error) => {
        console.error("Socket connection failed:", error.message);
        refreshLocationFeedMarkers();
    });
}

function requestHelp() {
    hideElement("sos-btn");
    showElement("request-panel");

    /*setTimeout(() => {
        const panel = document.getElementById("request-panel");
        if (!panel.classList.contains("hidden")) {
            showLocation();
        }
    }, 2000);*/

    setTimeout(() => {
        showLocation();
    }, 2000);
}

function showLocation() {
    hideElement("request-panel");
    showElement("location-panel");
    setRequestingStatus(true);
    isRequestingActive = true;
}

function cancelRequest() {
    resetHome();
}

function showIncomingUserModal(user) {
    selectedUserForModal = user || null;
    const nameEl = document.getElementById("incoming-username");
    if (nameEl) {
        nameEl.textContent = user?.userName || "User";
    }
    if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
    hideElement("sos-btn");
    showElement("incoming-modal");
}

function closeModal() {
    selectedUserForModal = null;
    hideElement("incoming-modal");
    showElement("sos-btn");
}

function openChatFromModal() {
    if (!selectedUserForModal?._id) {
        closeModal();
        return;
    }
    localStorage.setItem(PENDING_CHAT_USER_KEY, selectedUserForModal._id);
    window.location.href = "Profile.html";
}

function resetHome() {
    hideElement("request-panel");
    hideElement("location-panel");
    hideElement("incoming-modal");
    showElement("sos-btn");
    setRequestingStatus(false);
    isRequestingActive = false;

    activeMarkers.forEach((m) => m.remove());
    activeMarkers = [];

    /*setTimeout(() => {
        receiveIncomingRequest();
    }, 3000);*/
}

async function setRequestingStatus(isRequesting) {
    try {
        await apiRequest("/api/users/me/requesting", {
            method: "PATCH",
            body: JSON.stringify({ isRequesting }),
        });
        isRequestingActive = Boolean(isRequesting);
    } catch (error) {
        console.error("Request status update failed:", error.message);
    }
}

function hideElement(id) {
    document.getElementById(id).classList.add("hidden");
}

function showElement(id) {
    document.getElementById(id).classList.remove("hidden");
}

function openSearch() {
    alert("Search button clicked!");
}

function goHome() {
    alert("Home button clicked!");
}

window.requestHelp = requestHelp;
window.cancelRequest = cancelRequest;
window.closeModal = closeModal;
window.openChatFromModal = openChatFromModal;
window.resetHome = resetHome;
window.openSearch = openSearch;
window.goHome = goHome;

document.addEventListener("DOMContentLoaded", async () => {
    document.documentElement.style.setProperty(
        "--other-user-blink-ms",
        `${OTHER_USER_MARKER_BLINK_MS}ms`
    );
    initMap();
    await loadCurrentUser();
    startLocationTracking();
    startLocationSocket();
});

window.addEventListener("beforeunload", () => {
    stopPresencePing();

    if (socket) {
        socket.disconnect();
        socket = null;
    }

    otherUserMarkers.forEach((entry) => entry.marker.remove());
    otherUserMarkers.clear();

    if (locationWatchId !== null && navigator.geolocation) {
        navigator.geolocation.clearWatch(locationWatchId);
    }
});
