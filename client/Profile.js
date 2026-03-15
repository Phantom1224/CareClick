const API_BASE = window.location.origin;
const PENDING_CHAT_USER_KEY = "careclickPendingChatUserId";
const PRESENCE_PING_MS = 10000;

let currentUserId = null;
let activeConversationId = null;
let lastMessageCursor = null;
const conversationCache = new Map();
let allUsers = [];
let searchTerm = "";
let socket = null;
let presencePingId = null;
let activeConversationRoom = null;
let activeMessageIds = new Set();

function authHeaders() {
    return {
        "Content-Type": "application/json",
    };
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
        if (socket) {
            socket.disconnect();
            socket = null;
        }
        window.location.href = "Login.html";
        throw new Error("Session expired");
    }

    if (!response.ok) {
        throw new Error(data.message || "Request failed");
    }

    return data;
}

function setProfileDetails(user) {
    const nameEl = document.getElementById("profile-username");
    const emailEl = document.getElementById("profile-email");

    if (nameEl) {
        nameEl.textContent = user?.userName || "Unknown user";
    }

    if (emailEl) {
        emailEl.textContent = user?.emailAddress || "No email on file";
    }
}

async function loadProfile() {
    try {
        const data = await apiRequest("/api/users/me");
        setProfileDetails(data?.user);
        currentUserId = data?.user?._id || null;
    } catch (error) {
        console.error("Failed to load profile:", error.message);
    }
}

function formatTime(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleTimeString([], { hour: "numeric", minute: "2-digit" });
}

function buildAvatarText(name = "") {
    const trimmed = name.trim();
    if (!trimmed) return "U";
    return trimmed.charAt(0).toUpperCase();
}

function normalizeConversation(raw) {
    if (!raw) return null;
    if (raw.otherUser) return raw;
    const participants = Array.isArray(raw.participants) ? raw.participants : [];
    const other = participants.find((participant) => participant._id !== currentUserId);
    return {
        _id: raw._id,
        lastMessageText: raw.lastMessageText || "",
        lastMessageAt: raw.lastMessageAt || raw.updatedAt,
        otherUser: other
            ? {
                  _id: other._id,
                  userName: other.userName,
                  emailAddress: other.emailAddress,
                  lastSeenAt: other.lastSeenAt || null,
                  isOnline: false,
              }
            : null,
    };
}

function renderConversations(conversations = [], { replaceCache = true } = {}) {
    const listEl = document.getElementById("messages-list");
    const emptyEl = document.getElementById("messages-empty");
    if (!listEl || !emptyEl) return;

    if (replaceCache) {
        conversationCache.clear();
    }
    listEl.innerHTML = "";

    if (!conversations.length) {
        emptyEl.classList.remove("hidden");
        return;
    }

    emptyEl.classList.add("hidden");

    conversations.forEach((conversation) => {
        if (replaceCache) {
            conversationCache.set(conversation._id, conversation);
        }
        const other = conversation.otherUser || {};
        const row = document.createElement("div");
        row.className = "message-row";
        row.addEventListener("click", () => openChatByConversationId(conversation._id));

        const avatar = document.createElement("div");
        avatar.className = "msg-avatar avatar-lime";
        avatar.textContent = buildAvatarText(other.userName);

        const body = document.createElement("div");
        body.className = "msg-body";

        const header = document.createElement("div");
        header.className = "msg-header";

        const name = document.createElement("span");
        name.className = "msg-name";
        name.textContent = other.userName || "Unknown user";

        const time = document.createElement("span");
        time.className = "msg-time";
        time.textContent = formatTime(conversation.lastMessageAt);

        const text = document.createElement("p");
        text.className = "msg-text";
        text.textContent = conversation.lastMessageText || "Start the conversation";

        header.appendChild(name);
        header.appendChild(time);
        body.appendChild(header);
        body.appendChild(text);
        row.appendChild(avatar);
        row.appendChild(body);
        listEl.appendChild(row);
    });
}

function renderConversationCache() {
    const sorted = Array.from(conversationCache.values()).sort((a, b) => {
        const aTime = new Date(a.lastMessageAt || 0).getTime();
        const bTime = new Date(b.lastMessageAt || 0).getTime();
        return bTime - aTime;
    });
    renderConversations(sorted, { replaceCache: false });
}

function renderUserDirectory(users = []) {
    const listEl = document.getElementById("users-list");
    const emptyEl = document.getElementById("users-empty");
    if (!listEl || !emptyEl) return;

    listEl.innerHTML = "";

    if (!searchTerm.trim()) {
        emptyEl.classList.add("hidden");
        return;
    }

    if (!users.length) {
        emptyEl.classList.remove("hidden");
        return;
    }

    emptyEl.classList.add("hidden");

    users.forEach((user) => {
        const row = document.createElement("div");
        row.className = "message-row";
        row.addEventListener("click", () => startConversationWithUser(user._id));

        const avatar = document.createElement("div");
        avatar.className = "msg-avatar avatar-purple";
        avatar.textContent = buildAvatarText(user.userName);

        const body = document.createElement("div");
        body.className = "msg-body";

        const header = document.createElement("div");
        header.className = "msg-header";

        const name = document.createElement("span");
        name.className = "msg-name";
        name.textContent = user.userName || "Unknown user";

        const time = document.createElement("span");
        time.className = "msg-time";
        time.textContent = user.isOnline ? "Online" : "Offline";

        const text = document.createElement("p");
        text.className = "msg-text";
        text.textContent = user.emailAddress || "Tap to start a chat";

        header.appendChild(name);
        header.appendChild(time);
        body.appendChild(header);
        body.appendChild(text);
        row.appendChild(avatar);
        row.appendChild(body);
        listEl.appendChild(row);
    });
}

function getFilteredUsers() {
    const term = searchTerm.trim().toLowerCase();
    if (!term) return [];
    return allUsers.filter((user) => {
        const name = (user.userName || "").toLowerCase();
        const email = (user.emailAddress || "").toLowerCase();
        return name.includes(term) || email.includes(term);
    });
}

function setSearchMode(isSearch) {
    const messagesList = document.getElementById("messages-list");
    const messagesEmpty = document.getElementById("messages-empty");
    const usersList = document.getElementById("users-list");
    const usersEmpty = document.getElementById("users-empty");

    if (messagesList) messagesList.classList.toggle("hidden", isSearch);
    if (messagesEmpty) messagesEmpty.classList.toggle("hidden", isSearch);
    if (usersList) usersList.classList.toggle("hidden", !isSearch);
    if (usersEmpty) usersEmpty.classList.toggle("hidden", !isSearch);
}

async function loadConversations() {
    try {
        const data = await apiRequest("/api/messages/conversations");
        renderConversations(data?.conversations || [], { replaceCache: true });
    } catch (error) {
        console.error("Failed to load conversations:", error.message);
    }
}

async function loadUserDirectory() {
    try {
        const data = await apiRequest("/api/users/location-feed");
        allUsers = (data?.users || []).filter((user) => user._id !== currentUserId);
        renderUserDirectory(getFilteredUsers());
    } catch (error) {
        console.error("Failed to load users:", error.message);
    }
}

function findConversationByUserId(userId) {
    for (const conversation of conversationCache.values()) {
        if (conversation?.otherUser?._id === userId) {
            return conversation;
        }
    }
    return null;
}

async function startConversationWithUser(userId) {
    try {
        const existing = findConversationByUserId(userId);
        if (existing) {
            openChatByConversationId(existing._id);
            return;
        }
        const data = await apiRequest(`/api/messages/conversations/with/${userId}`);
        const conversation = normalizeConversation(data?.conversation);
        if (!conversation) return;
        conversationCache.set(conversation._id, conversation);
        openChatByConversationId(conversation._id);
    } catch (error) {
        console.error("Failed to start conversation:", error.message);
    }
}

function startConversationPolling() {
    loadConversations();
    loadUserDirectory();
}

function stopConversationPolling() {
}

function setChatHeader(conversation) {
    const titleEl = document.getElementById("chat-title");
    const statusEl = document.getElementById("chat-status");
    const other = conversation?.otherUser || {};

    if (titleEl) {
        titleEl.textContent = other.userName || "Conversation";
    }

    if (statusEl) {
        if (other.isOnline) {
            statusEl.textContent = "Active now";
        } else if (other.lastSeenAt) {
            statusEl.textContent = `Last seen ${new Date(other.lastSeenAt).toLocaleString()}`;
        } else {
            statusEl.textContent = "Offline";
        }
    }
}

function renderMessageBubble(message) {
    const container = document.getElementById("chat-messages");
    if (!container) return;

    const bubble = document.createElement("div");
    const isSent = message.senderId === currentUserId;
    bubble.className = `chat-bubble ${isSent ? "bubble-sent" : "bubble-received"}`;
    bubble.textContent = message.body;

    const meta = document.createElement("span");
    meta.className = "chat-meta";
    meta.textContent = formatTime(message.createdAt);

    bubble.appendChild(meta);
    container.appendChild(bubble);
}

function scrollChatToBottom() {
    const container = document.getElementById("chat-messages");
    if (!container) return;
    container.scrollTop = container.scrollHeight;
}

async function loadMessages({ reset } = {}) {
    if (!activeConversationId) return;
    try {
        const params = new URLSearchParams();
        if (!reset && lastMessageCursor) {
            params.set("since", lastMessageCursor);
        } else {
            params.set("limit", "50");
        }

        const query = params.toString() ? `?${params.toString()}` : "";
        const data = await apiRequest(
            `/api/messages/conversations/${activeConversationId}/messages${query}`
        );

        const messages = data?.messages || [];
        if (reset) {
            const container = document.getElementById("chat-messages");
            if (container) container.innerHTML = "";
            activeMessageIds.clear();
        }

        if (messages.length) {
            messages.forEach((message) => {
                activeMessageIds.add(message._id);
                renderMessageBubble(message);
            });
            lastMessageCursor = messages[messages.length - 1].createdAt;
            requestAnimationFrame(() => scrollChatToBottom());
        }
    } catch (error) {
        console.error("Failed to load messages:", error.message);
    }
}

function startMessagePolling() {
    if (!activeConversationId) return;
    lastMessageCursor = null;
    loadMessages({ reset: true });
}

function stopMessagePolling() {
}

async function sendMessage() {
    const input = document.getElementById("chat-input");
    if (!input || !activeConversationId) return;
    const body = input.value.trim();
    if (!body) return;

    try {
        const data = await apiRequest(
            `/api/messages/conversations/${activeConversationId}/messages`,
            {
                method: "POST",
                body: JSON.stringify({ body }),
            }
        );
        input.value = "";
        const message = data?.message;
        if (message && (!socket || !socket.connected)) {
            renderMessageBubble(message);
            lastMessageCursor = message.createdAt;
            scrollChatToBottom();
        }
    } catch (error) {
        console.error("Failed to send message:", error.message);
    }
}

function openMessages() {
    hideAllViews();
    showElement("view-messenger");
    showElement("main-nav");
    showElement("brand-header");
    stopMessagePolling();
    startConversationPolling();
    setSearchMode(false);
    leaveActiveConversationRoom();
    window.scrollTo(0, 0);
}

function toggleUserSearch() {
    const row = document.getElementById("user-search-row");
    const input = document.getElementById("user-search-input");
    if (!row || !input) return;
    const isHidden = row.classList.contains("hidden");
    if (isHidden) {
        row.classList.remove("hidden");
        setSearchMode(true);
        input.focus();
        return;
    }
    row.classList.add("hidden");
    input.value = "";
    searchTerm = "";
    setSearchMode(false);
    renderUserDirectory(getFilteredUsers());
}

function openProfile() {
    hideAllViews();
    showElement("view-profile");
    showElement("main-nav");
    showElement("brand-header");
    stopMessagePolling();
    stopConversationPolling();
    leaveActiveConversationRoom();
    window.scrollTo(0, 0);
}

function openChatByConversationId(conversationId) {
    const conversation = conversationCache.get(conversationId);
    if (!conversation) {
        console.warn("Conversation not found in cache");
        return;
    }

    activeConversationId = conversationId;

    hideAllViews();
    hideElement("main-nav");
    showElement("view-chat");
    setChatHeader(conversation);
    stopConversationPolling();
    startMessagePolling();
    joinConversationRoom(conversationId);
    window.scrollTo(0, 0);
}

function startCall() {
    hideElement("view-chat");
    hideElement("brand-header");
    showElement("view-call");
}

function endCall() {
    hideElement("view-call");
    showElement("brand-header");
    showElement("view-chat");
}

function hideAllViews() {
    const views = ["view-profile", "view-messenger", "view-chat", "view-call"];
    views.forEach((id) => {
        const el = document.getElementById(id);
        if (el) el.classList.add("hidden");
    });
}

function hideElement(id) {
    const el = document.getElementById(id);
    if (el) el.classList.add("hidden");
}

function showElement(id) {
    const el = document.getElementById(id);
    if (el) el.classList.remove("hidden");
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

function joinConversationRoom(conversationId) {
    if (!socket || !socket.connected || !conversationId) return;
    if (activeConversationRoom === conversationId) return;
    leaveActiveConversationRoom();
    socket.emit("chat:join", { conversationId });
    activeConversationRoom = conversationId;
}

function leaveActiveConversationRoom() {
    if (!socket || !socket.connected || !activeConversationRoom) return;
    socket.emit("chat:leave", { conversationId: activeConversationRoom });
    activeConversationRoom = null;
}

function applyConversationUpdate(conversation) {
    const normalized = normalizeConversation(conversation);
    if (!normalized?._id) return;
    conversationCache.set(normalized._id, normalized);
    renderConversationCache();

    if (normalized._id === activeConversationId) {
        setChatHeader(normalized);
    }
}

function applyPresenceUpdate(payload = {}) {
    const targetId = payload.userId ? String(payload.userId) : "";
    if (!targetId) return;
    let updated = false;

    conversationCache.forEach((conversation, key) => {
        if (String(conversation?.otherUser?._id) !== targetId) return;
        conversation.otherUser = {
            ...conversation.otherUser,
            isOnline: Boolean(payload.isOnline),
            lastSeenAt: payload.lastSeenAt || conversation.otherUser?.lastSeenAt || null,
        };
        conversationCache.set(key, conversation);
        updated = true;
        if (String(conversation._id) === String(activeConversationId)) {
            setChatHeader(conversation);
        }
    });

    if (updated) {
        renderConversationCache();
    }
}

function handleIncomingMessage(message) {
    if (!message?._id) return;
    if (message.conversationId && String(message.conversationId) !== String(activeConversationId)) {
        return;
    }
    if (activeMessageIds.has(message._id)) return;
    activeMessageIds.add(message._id);
    renderMessageBubble(message);
    lastMessageCursor = message.createdAt;
    scrollChatToBottom();
}

function startSocketConnection() {
    if (typeof io === "undefined") return;
    if (socket) return;

    socket = io(API_BASE, { withCredentials: true });

    socket.on("connect", () => {
        startPresencePing();
        if (activeConversationId) {
            joinConversationRoom(activeConversationId);
        }
    });

    socket.on("chat:conversation:update", (payload = {}) => {
        applyConversationUpdate(payload.conversation);
    });

    socket.on("chat:message", (payload = {}) => {
        handleIncomingMessage(payload.message);
    });

    socket.on("chat:presence:update", (payload = {}) => {
        applyPresenceUpdate(payload);
    });

    socket.on("disconnect", () => {
        stopPresencePing();
    });

    socket.on("connect_error", (error) => {
        console.error("Socket connection failed:", error.message);
    });
}

document.addEventListener("DOMContentLoaded", async () => {
    await loadProfile();
    openProfile();

    const sendBtn = document.getElementById("chat-send-btn");
    const input = document.getElementById("chat-input");
    const userSearchInput = document.getElementById("user-search-input");

    if (sendBtn) {
        sendBtn.addEventListener("click", sendMessage);
    }

    if (input) {
        input.addEventListener("keydown", (event) => {
            if (event.key === "Enter" && !event.shiftKey) {
                event.preventDefault();
                sendMessage();
            }
        });
    }

    if (userSearchInput) {
        userSearchInput.addEventListener("input", (event) => {
            searchTerm = event.target.value || "";
            renderUserDirectory(getFilteredUsers());
        });
    }

    setSearchMode(false);

    const pendingUserId = localStorage.getItem(PENDING_CHAT_USER_KEY);
    if (pendingUserId) {
        localStorage.removeItem(PENDING_CHAT_USER_KEY);
        openMessages();
        startConversationWithUser(pendingUserId);
    }

    startSocketConnection();
});
