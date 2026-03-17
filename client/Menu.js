const CareClick = window.CareClick || {};
const {
    apiRequest: sharedApiRequest,
    showMessageToast,
    openChatWithUserId,
    createNotificationPoller,
} = CareClick;
const API_BASE = CareClick.API_BASE || window.location.origin;
const NOTIFY_POLL_MS =
    CareClick.config?.polling?.notificationsMs || 5000;
let currentUserId = null;
const seenNotifyMessageIds = new Set();
const notificationPoller = createNotificationPoller({
    pollMs: NOTIFY_POLL_MS,
    onMessage: handleNotifyMessage,
    onUnauthorized: () => {
        window.location.href = "Login.html";
    },
    onError: (error) => {
        console.error("Notification poll failed:", error.message);
    },
});
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
    } catch (_error) {
        window.location.href = "Login.html";
    }
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
        onClick: () => openChatWithUserId(message.senderId),
    });
}

function handleNotifyMessage(message = {}) {
    if (!message?._id) return;
    handleChatNotify({ message });
}

function startNotificationPolling() {
    notificationPoller.start();
}

function stopNotificationPolling() {
    notificationPoller.stop();
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
    const text = label ? label.textContent.trim().toLowerCase() : "";
    if (text === 'sign out' || text === 'log out' || text === 'logout') {
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
