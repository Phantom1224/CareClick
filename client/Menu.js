const API_BASE = window.location.origin;
const PRESENCE_PING_MS = 10000;
const TOAST_LIFETIME_MS = 5000;
const TOAST_MAX_VISIBLE = 3;
const PENDING_CHAT_USER_KEY = "careclickPendingChatUserId";
let currentUserId = null;
const seenNotifyMessageIds = new Set();
let socket = null;
let presencePingId = null;
const menuView = document.getElementById('menu-view');
const notificationView = document.getElementById('notification-view');
const privacyView = document.getElementById('privacy-view');
const securityView = document.getElementById('security-view');
const languageView = document.getElementById('language-view');
const helpView = document.getElementById('help-view');
const aboutView = document.getElementById('about-view'); // Added for About View
const supportView = document.getElementById('support-view'); // Added for Support
const bottomNav = document.getElementById('bottom-nav');
const backBtn = document.getElementById('back-btn');
const headerTitle = document.getElementById('header-title');
const termsView = document.getElementById('terms-view');

function showNotifications() {
    hideAllViews();
    notificationView.style.display = 'block';
    headerTitle.innerText = 'Notification Settings';
}

function showPrivacy() {
    hideAllViews();
    privacyView.style.display = 'block';
    headerTitle.innerText = 'Privacy Settings';
}

function showSecurity() {
    hideAllViews();
    securityView.style.display = 'block';
    headerTitle.innerText = 'Account Security';
}

function showLanguage() {
    hideAllViews();
    languageView.style.display = 'block';
    headerTitle.innerText = 'Language';
}

function showHelp() {
    hideAllViews();
    helpView.style.display = 'block';
    headerTitle.innerText = 'Help';
}

// Added logic for showing About View
function showAbout() {
    hideAllViews();
    aboutView.style.display = 'block';
    headerTitle.innerText = 'About CareClick';
}

// Added logic for showing Support View
function showSupport() {
    hideAllViews();
    supportView.style.display = 'block';
    headerTitle.innerText = 'Contact Support';
}

function showMenu() {
    menuView.style.display = 'block';
    notificationView.style.display = 'none';
    privacyView.style.display = 'none';
    securityView.style.display = 'none';
    languageView.style.display = 'none';
    helpView.style.display = 'none';
    aboutView.style.display = 'none'; 
    supportView.style.display = 'none'; // Added
    bottomNav.style.display = 'flex'; 
    backBtn.style.display = 'none';
    headerTitle.innerText = 'Menu';
    termsView.style.display = 'none';
    
}

function hideAllViews() {
    menuView.style.display = 'none';
    notificationView.style.display = 'none';
    privacyView.style.display = 'none';
    securityView.style.display = 'none';
    languageView.style.display = 'none';
    helpView.style.display = 'none';
    aboutView.style.display = 'none';
    supportView.style.display = 'none'; // Added
    bottomNav.style.display = 'none'; 
    backBtn.style.display = 'block';
    termsView.style.display = 'none';
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
    window.location.href = 'Login.html';
}

async function requireAuth() {
    try {
        const response = await fetch(`${API_BASE}/api/users/me`, {
            method: "GET",
            credentials: "include",
        });

        if (response.status === 401 || response.status === 403) {
            window.location.href = "Login.html";
            return;
        }

        if (response.ok) {
            const data = await response.json();
            currentUserId = data?.user?._id || null;
        }
    } catch (_error) {
        window.location.href = "Login.html";
    }
}

function formatToastTime(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function sanitizeToastBody(text) {
    const trimmed = String(text || "").trim();
    if (!trimmed) return "Tap to open chat";
    if (trimmed.length <= 80) return trimmed;
    return `${trimmed.slice(0, 77)}...`;
}

function openChatWithUserId(userId) {
    if (!userId) return;
    localStorage.setItem(PENDING_CHAT_USER_KEY, userId);
    window.location.href = "Profile.html";
}

function pruneToasts(stackEl) {
    const toasts = stackEl.querySelectorAll(".toast");
    if (toasts.length <= TOAST_MAX_VISIBLE) return;
    const extra = Array.from(toasts).slice(0, toasts.length - TOAST_MAX_VISIBLE);
    extra.forEach((toast) => toast.remove());
}

function showMessageToast({ senderName, body, createdAt, senderId }) {
    const stackEl = document.getElementById("toast-stack");
    if (!stackEl) return;

    const toast = document.createElement("button");
    toast.type = "button";
    toast.className = "toast";

    const title = document.createElement("div");
    title.className = "toast-title";
    title.textContent = senderName ? `New message from ${senderName}` : "New message received";

    const message = document.createElement("div");
    message.className = "toast-body";
    message.textContent = sanitizeToastBody(body);

    const time = document.createElement("div");
    time.className = "toast-time";
    time.textContent = formatToastTime(createdAt);

    toast.appendChild(title);
    toast.appendChild(message);
    if (time.textContent) {
        toast.appendChild(time);
    }

    toast.addEventListener("click", () => {
        openChatWithUserId(senderId);
    });

    stackEl.appendChild(toast);
    pruneToasts(stackEl);

    window.setTimeout(() => {
        toast.remove();
    }, TOAST_LIFETIME_MS);
}

function handleChatNotify(payload = {}) {
    const message = payload.message || {};
    if (!message?._id) return;
    if (seenNotifyMessageIds.has(message._id)) return;
    seenNotifyMessageIds.add(message._id);

    if (String(message.senderId) === String(currentUserId)) {
        return;
    }

    showMessageToast({
        senderName: message.senderName || "User",
        body: message.body,
        createdAt: message.createdAt,
        senderId: message.senderId,
    });
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

function startSocketConnection() {
    if (typeof io === "undefined") return;
    if (socket) return;

    socket = io(API_BASE, { withCredentials: true });

    socket.on("connect", () => {
        startPresencePing();
    });

    socket.on("chat:notify", (payload = {}) => {
        handleChatNotify(payload);
    });

    socket.on("disconnect", () => {
        stopPresencePing();
    });

    socket.on("connect_error", (error) => {
        console.error("Socket connection failed:", error.message);
    });
}

// Logic for Language Selection
document.querySelectorAll('.language-item').forEach(item => {
    item.addEventListener('click', function() {
        document.querySelectorAll('.language-item').forEach(li => li.classList.remove('selected'));
        this.classList.add('selected');
    });
});

const menuItems = document.querySelectorAll('.menu-item');
menuItems.forEach((item) => {
    const label = item.querySelector('.item-label');
    if (label && label.textContent.trim().toLowerCase() === 'log out') {
        item.addEventListener('click', logoutUser);
    }
});

document.addEventListener("DOMContentLoaded", () => {
    requireAuth();
    startSocketConnection();
});
