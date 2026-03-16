const { requestJson, formatTime, sanitizeToastBody, createToast } = window.CareClick || {};
const API_BASE = window.CareClick?.API_BASE || window.location.origin;
const TOAST_LIFETIME_MS = 5000;
const TOAST_MAX_VISIBLE = 3;
const PENDING_CHAT_USER_KEY = "careclickPendingChatUserId";
const NOTIFY_POLL_MS = 5000;
let currentUserId = null;
const seenNotifyMessageIds = new Set();
let notifyPollId = null;
let lastNotifyAt = null;
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
    if (termsView) {
        termsView.style.display = 'none';
    }
    
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
    if (termsView) {
        termsView.style.display = 'none';
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
    window.location.href = 'Login.html';
}

async function apiRequest(path, options = {}) {
    return requestJson(path, options, {
        onUnauthorized: () => {
            window.location.href = "Login.html";
        },
    });
}

async function requireAuth() {
    try {
        const data = await apiRequest("/api/users/me");
        currentUserId = data?.user?._id || null;
    } catch (_error) {
        window.location.href = "Login.html";
    }
}

function openChatWithUserId(userId) {
    if (!userId) return;
    localStorage.setItem(PENDING_CHAT_USER_KEY, userId);
    window.location.href = "Profile.html";
}

function showMessageToast({ senderName, body, createdAt, senderId }) {
    const title = senderName ? `New message from ${senderName}` : "New message received";
    createToast({
        title,
        body: sanitizeToastBody(body),
        time: formatTime(createdAt),
        onClick: () => openChatWithUserId(senderId),
        lifetimeMs: TOAST_LIFETIME_MS,
        maxVisible: TOAST_MAX_VISIBLE,
    });
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

function handleNotifyMessage(message = {}) {
    if (!message?._id) return;
    handleChatNotify({ message });
}

async function fetchNotifications() {
    try {
        const params = new URLSearchParams();
        if (lastNotifyAt) {
            params.set("since", lastNotifyAt);
        }
        const query = params.toString() ? `?${params.toString()}` : "";
        const data = await apiRequest(`/api/messages/notifications${query}`);
        const messages = Array.isArray(data?.messages) ? data.messages : [];
        messages.forEach(handleNotifyMessage);
        if (data?.nextSince) {
            lastNotifyAt = data.nextSince;
        }
    } catch (error) {
        console.error("Notification poll failed:", error.message);
    }
}

function startNotificationPolling() {
    if (notifyPollId) return;
    if (!lastNotifyAt) {
        lastNotifyAt = new Date().toISOString();
    }
    fetchNotifications();
    notifyPollId = setInterval(fetchNotifications, NOTIFY_POLL_MS);
}

function stopNotificationPolling() {
    if (notifyPollId) {
        clearInterval(notifyPollId);
        notifyPollId = null;
    }
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
    startNotificationPolling();
});

window.addEventListener("beforeunload", () => {
    stopNotificationPolling();
});
