
(() => {
    const CareClick = window.CareClick || {};
    const {
        createNotificationPoller,
        showMessageToast,
        openChatWithUserId,
    } = CareClick;

    const NOTIFY_POLL_MS =
        CareClick.config?.polling?.notificationsMs || 5000;

    const seenNotifyMessageIds = new Set();
    let currentUserId = null;

    CareClick.setCurrentUserId = function setCurrentUserId(userId) {
        currentUserId = userId || null;
    };

    CareClick.getCurrentUserId = function getCurrentUserId() {
        return currentUserId;
    };

    function isChatOrMessengerVisible() {
        const chatView = document.getElementById("view-chat");
        const messengerView = document.getElementById("view-messenger");
        const chatVisible = chatView && !chatView.classList.contains("hidden");
        const messengerVisible =
            messengerView && !messengerView.classList.contains("hidden");
        return Boolean(chatVisible || messengerVisible);
    }

    function handleNotifyMessage(message = {}) {
        if (!message?._id) return;
        if (seenNotifyMessageIds.has(message._id)) return;
        seenNotifyMessageIds.add(message._id);

        if (String(message.senderId) === String(currentUserId)) {
            return;
        }

        if (isChatOrMessengerVisible()) {
            return;
        }

        showMessageToast({
            senderName: message.senderName || "User",
            body: message.body,
            createdAt: message.createdAt,
            senderId: message.senderId,
            onClick: () => openChatWithUserId(message.senderId),
        });
    }

    const notificationPoller = createNotificationPoller({
        pollMs: NOTIFY_POLL_MS,
        onMessage: handleNotifyMessage,
        onUnauthorized: CareClick.redirectToLogin,
        onError: (error) => {
            console.error("Notification poll failed:", error.message);
        },
    });

    document.addEventListener("DOMContentLoaded", () => {
        notificationPoller.start();
    });

    window.addEventListener("beforeunload", () => {
        notificationPoller.stop();
    });
})();

(() => {
    const viewIds = {
        home: "app-home",
        menu: "app-menu",
        profile: "app-profile",
    };

    let viewNodes = {};
    let styleNodes = {};

    function initViewNodes() {
        viewNodes = {
            home: document.getElementById(viewIds.home),
            menu: document.getElementById(viewIds.menu),
            profile: document.getElementById(viewIds.profile),
        };
        styleNodes = {
            home: document.getElementById("style-home"),
            menu: document.getElementById("style-menu"),
            profile: document.getElementById("style-profile"),
        };
    }

    function setActiveStyle(target) {
        Object.entries(styleNodes).forEach(([key, node]) => {
            if (!node) return;
            node.disabled = key !== target;
        });
    }

    function showMainView(target, { skipInternal = false } = {}) {
        if (!viewNodes.home) {
            initViewNodes();
        }

        Object.entries(viewNodes).forEach(([key, node]) => {
            if (!node) return;
            node.classList.toggle("hidden", key !== target);
        });

        setActiveStyle(target);

        if (skipInternal) return;

        if (target === "menu" && window.MenuModule?.showMenu) {
            window.MenuModule.showMenu();
        }
        if (target === "profile" && typeof window.openProfile === "function") {
            window.openProfile();
        }
        if (target === "home" && window.HomeModule?.onShow) {
            window.HomeModule.onShow();
        }
    }

    window.showMainView = showMainView;

    document.addEventListener("DOMContentLoaded", () => {
        initViewNodes();
        showMainView("home");
    });
})();

(() => {
    const CareClick = window.CareClick || {};

    CareClick.openChatInMain = function openChatInMain(userId) {
        if (!userId) return;
        if (typeof window.showMainView === "function") {
            window.showMainView("profile", { skipInternal: true });
        }
        if (typeof window.openMessages === "function") {
            window.openMessages();
        }
        if (typeof window.startConversationWithUser === "function") {
            window.startConversationWithUser(userId);
        }
    };
})();
(() => {
    const CareClick = window.CareClick || {};
    const {
        apiRequest: sharedApiRequest,
        showMessageToast,
        openChatWithUserId,
    } = CareClick;
    const LOCATION_SYNC_MS = 5000;
    const USER_MARKER_ICON_URL = "Icon/gps-green.png";
    const OTHER_USER_MARKER_BLINK_MS = 500;
    const FEED_REFRESH_MS =
        CareClick.config?.polling?.locationFeedMs || LOCATION_SYNC_MS;
    const NEARBY_RADIUS_METERS = 1000;

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
    let feedRefreshTimerId = null;
    const otherUserMarkers = new Map();
    let isRequestingActive = false;
    let selectedUserForModal = null;

    function setLocationLabel(text) {
        const locationEl = document.getElementById("live-location");
        if (locationEl) {
            locationEl.textContent = text;
        }
    }

    function formatCoordinates(lat, lng) {
        return `${lat.toFixed(5)}, ${lng.toFixed(5)}`;
    }

    function degreesToRadians(degrees) {
        return (degrees * Math.PI) / 180;
    }

    function haversineMeters(lat1, lng1, lat2, lng2) {
        const R = 6371000;
        const dLat = degreesToRadians(lat2 - lat1);
        const dLng = degreesToRadians(lng2 - lng1);
        const a =
            Math.sin(dLat / 2) ** 2 +
            Math.cos(degreesToRadians(lat1)) *
                Math.cos(degreesToRadians(lat2)) *
                Math.sin(dLng / 2) ** 2;
        return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    function getCurrentUserLatLng(users) {
        const me = users.find((user) => String(user._id) === String(currentUserId));
        if (!me?.userLocation) return null;
        const lat = Number(me.userLocation.lat);
        const lng = Number(me.userLocation.lng);
        if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
        return { lat, lng };
    }

    function clearSessionAndRedirect() {
        if (feedRefreshTimerId) {
            clearInterval(feedRefreshTimerId);
            feedRefreshTimerId = null;
        }

        otherUserMarkers.forEach((entry) => entry.marker.remove());
        otherUserMarkers.clear();

        window.location.href = "Login.html";
    }

    async function apiRequest(path, options = {}) {
        return sharedApiRequest(path, options, { onUnauthorized: clearSessionAndRedirect });
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
            CareClick.setCurrentUserId(currentUserId);
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

        const me = getCurrentUserLatLng(users);

        const onlineOtherUsers = users.filter((user) => {
            const isOtherUser = String(user._id) !== String(currentUserId);
            const hasCoords =
                Number.isFinite(user?.userLocation?.lat) && Number.isFinite(user?.userLocation?.lng);
            if (!(isOtherUser && user.isOnline && hasCoords && user.isRequesting)) {
                return false;
            }

            if (!me) {
                return true;
            }

            const distance = haversineMeters(
                me.lat,
                me.lng,
                Number(user.userLocation.lat),
                Number(user.userLocation.lng)
            );

            return distance <= NEARBY_RADIUS_METERS;
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

    function startLocationFeedRefresh() {
        if (feedRefreshTimerId) return;
        refreshLocationFeedMarkers();
        feedRefreshTimerId = setInterval(refreshLocationFeedMarkers, FEED_REFRESH_MS);
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
        openChatWithUserId(selectedUserForModal._id);
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

    function onShow() {
        if (map && typeof map.invalidateSize === "function") {
            map.invalidateSize();
        }
    }

    window.HomeModule = { onShow };

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
        startLocationFeedRefresh();
    });

    window.addEventListener("beforeunload", () => {
        if (feedRefreshTimerId) {
            clearInterval(feedRefreshTimerId);
            feedRefreshTimerId = null;
        }

        otherUserMarkers.forEach((entry) => entry.marker.remove());
        otherUserMarkers.clear();

        if (locationWatchId !== null && navigator.geolocation) {
            navigator.geolocation.clearWatch(locationWatchId);
        }
    });
})();
(() => {
    const CareClick = window.CareClick || {};
    const {
        apiRequest: sharedApiRequest,
    } = CareClick;
    const API_BASE = CareClick.API_BASE || window.location.origin;
    let currentUserId = null;

    const menuView = document.getElementById("menu-view");
    const notificationView = document.getElementById("notification-view");
    const privacyView = document.getElementById("privacy-view");
    const securityView = document.getElementById("security-view");
    const languageView = document.getElementById("language-view");
    const helpView = document.getElementById("help-view");
    const aboutView = document.getElementById("about-view");
    const supportView = document.getElementById("support-view");
    const bottomNav = document.getElementById("bottom-nav");
    const backBtn = document.getElementById("back-btn");
    const headerTitle = document.getElementById("header-title");
    const termsView = document.getElementById("terms-view");

    function showNotifications() {
        hideAllViews();
        notificationView.style.display = "block";
        headerTitle.innerText = "Notification Settings";
    }

    function showPrivacy() {
        hideAllViews();
        privacyView.style.display = "block";
        headerTitle.innerText = "Privacy Settings";
    }

    function showSecurity() {
        hideAllViews();
        securityView.style.display = "block";
        headerTitle.innerText = "Account Security";
    }

    function showLanguage() {
        hideAllViews();
        languageView.style.display = "block";
        headerTitle.innerText = "Language";
    }

    function showHelp() {
        hideAllViews();
        helpView.style.display = "block";
        headerTitle.innerText = "Help";
    }

    function showAbout() {
        hideAllViews();
        aboutView.style.display = "block";
        headerTitle.innerText = "About CareClick";
    }

    function showSupport() {
        hideAllViews();
        supportView.style.display = "block";
        headerTitle.innerText = "Contact Support";
    }

    function showMenu() {
        menuView.style.display = "block";
        notificationView.style.display = "none";
        privacyView.style.display = "none";
        securityView.style.display = "none";
        languageView.style.display = "none";
        helpView.style.display = "none";
        aboutView.style.display = "none";
        supportView.style.display = "none";
        bottomNav.style.display = "flex";
        backBtn.style.display = "none";
        headerTitle.innerText = "Menu";
        if (termsView) {
            termsView.style.display = "none";
        }
    }

    function hideAllViews() {
        menuView.style.display = "none";
        notificationView.style.display = "none";
        privacyView.style.display = "none";
        securityView.style.display = "none";
        languageView.style.display = "none";
        helpView.style.display = "none";
        aboutView.style.display = "none";
        supportView.style.display = "none";
        bottomNav.style.display = "none";
        backBtn.style.display = "block";
        if (termsView) {
            termsView.style.display = "none";
        }
    }

    async function logoutUser() {
        try {
            await fetch(`${API_BASE}/api/auth/logout`, {
                method: "POST",
                credentials: "include",
            });
        } catch (_error) {
            // Ignore network errors; we'll still redirect.
        }
        window.location.href = "Login.html";
    }

    async function apiRequest(path, options = {}) {
        return sharedApiRequest(path, options, {
            onUnauthorized: () => {
                window.location.href = "Login.html";
            },
        });
    }

    async function requireAuth() {
        try {
            const data = await apiRequest("/api/users/me");
            currentUserId = data?.user?._id || null;
            CareClick.setCurrentUserId(currentUserId);
        } catch (_error) {
            window.location.href = "Login.html";
        }
    }

    // Logic for Language Selection
    document.querySelectorAll(".language-item").forEach((item) => {
        item.addEventListener("click", function onSelectLanguage() {
            document
                .querySelectorAll(".language-item")
                .forEach((li) => li.classList.remove("selected"));
            this.classList.add("selected");
        });
    });

    const menuItems = document.querySelectorAll(".menu-item");
    menuItems.forEach((item) => {
        const label = item.querySelector(".item-label");
        const text = label ? label.textContent.trim().toLowerCase() : "";
        if (text === "sign out" || text === "log out" || text === "logout") {
            item.addEventListener("click", logoutUser);
        }
    });

    window.MenuModule = {
        showMenu,
        showNotifications,
        showPrivacy,
        showSecurity,
        showLanguage,
        showHelp,
        showAbout,
        showSupport,
    };

    window.showMenu = () => {
        showMainView("menu", { skipInternal: true });
        showMenu();
    };
    window.showNotifications = () => {
        showMainView("menu", { skipInternal: true });
        showNotifications();
    };
    window.showPrivacy = () => {
        showMainView("menu", { skipInternal: true });
        showPrivacy();
    };
    window.showSecurity = () => {
        showMainView("menu", { skipInternal: true });
        showSecurity();
    };
    window.showLanguage = () => {
        showMainView("menu", { skipInternal: true });
        showLanguage();
    };
    window.showHelp = () => {
        showMainView("menu", { skipInternal: true });
        showHelp();
    };
    window.showAbout = () => {
        showMainView("menu", { skipInternal: true });
        showAbout();
    };
    window.showSupport = () => {
        showMainView("menu", { skipInternal: true });
        showSupport();
    };

    document.addEventListener("DOMContentLoaded", () => {
        requireAuth();
        showMenu();
    });
})();
