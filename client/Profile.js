const CareClick = window.CareClick || {};
const {
    apiRequest: sharedApiRequest,
    showMessageToast,
    createNotificationPoller,
    formatTime,
} = CareClick;
const PENDING_CHAT_USER_KEY =
    CareClick.PENDING_CHAT_USER_KEY || "careclickPendingChatUserId";
const NOTIFY_POLL_MS =
    CareClick.config?.polling?.notificationsMs || 5000;
const CONVERSATION_POLL_MS =
    CareClick.config?.polling?.conversationsMs || 5000;
const MESSAGE_POLL_MS =
    CareClick.config?.polling?.messagesMs || 5000;

let currentUserId = null;
let conversationPollId = null;
let messagePollId = null;
let activeConversationId = null;
let lastMessageCursor = null;
const conversationCache = new Map();
let allUsers = [];
let searchTerm = "";
let activeMessageIds = new Set();
let sendInFlight = false;
let pendingImageFile = null;
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

async function apiRequest(path, options = {}) {
    return sharedApiRequest(path, options, {
        onUnauthorized: () => {
            window.location.href = "Login.html";
        },
    });
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

function openChatWithUserId(userId) {
    if (!userId) return;
    localStorage.setItem(PENDING_CHAT_USER_KEY, userId);
    openMessages();
    startConversationWithUser(userId);
}

function handleChatNotify(payload = {}) {
    const message = payload.message || {};
    if (!message?._id) return;
    if (seenNotifyMessageIds.has(message._id)) return;
    seenNotifyMessageIds.add(message._id);

    if (String(message.senderId) === String(currentUserId)) {
        return;
    }

    const chatView = document.getElementById("view-chat");
    if (chatView && !chatView.classList.contains("hidden")) {
        return;
    }

    const messengerView = document.getElementById("view-messenger");
    if (messengerView && !messengerView.classList.contains("hidden")) {
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
        lastMessageSenderId: raw.lastMessageSenderId || null,
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
        const lastText = conversation.lastMessageText || "Start the conversation";
        if (conversation.lastMessageSenderId && currentUserId) {
            if (String(conversation.lastMessageSenderId) === String(currentUserId)) {
                text.textContent = `Me: ${lastText}`;
            } else {
                text.textContent = lastText;
            }
        } else {
            text.textContent = lastText;
        }

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
    stopConversationPolling();
    loadConversations();
    loadUserDirectory();
    conversationPollId = setInterval(loadConversations, CONVERSATION_POLL_MS);
}

function stopConversationPolling() {
    if (conversationPollId) {
        clearInterval(conversationPollId);
        conversationPollId = null;
    }
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

function renderMessageBubble(message, { status, tempId, localImageUrl } = {}) {
    const container = document.getElementById("chat-messages");
    if (!container) return;

    const isSent = message.senderId === currentUserId;
    const wrapper = document.createElement("div");
    wrapper.className = `chat-message ${isSent ? "message-sent" : "message-received"}`;

    const bubble = document.createElement("div");
    bubble.className = `chat-bubble ${isSent ? "bubble-sent" : "bubble-received"}`;
    if (message.messageType === "image" && (message.image?.fileId || localImageUrl)) {
        const img = document.createElement("img");
        img.src = message.image?.fileId
            ? `/api/files/chat-image/${message.image.fileId}`
            : localImageUrl;
        img.alt = message.image.originalName || "Chat image";
        img.style.maxWidth = "100%";
        img.style.borderRadius = "12px";
        img.style.display = "block";
        bubble.appendChild(img);
        if (message.image?.fileId) {
            bubble.dataset.imageFileId = String(message.image.fileId);
        }
    } else {
        bubble.textContent = message.body;
    }
    if (message._id) {
        bubble.dataset.messageId = String(message._id);
    }
    if (tempId) {
        bubble.dataset.tempId = String(tempId);
    }
    bubble.dataset.body = message.body;

    const meta = document.createElement("span");
    meta.className = "chat-meta";
    meta.textContent = formatTime(message.createdAt);

    bubble.appendChild(meta);
    wrapper.appendChild(bubble);

    if (status) {
        const statusEl = document.createElement("span");
        statusEl.className = "chat-status";
        statusEl.textContent = status;
        if (status === "Sending") statusEl.classList.add("status-sending");
        if (status === "Sent") statusEl.classList.add("status-sent");
        if (status === "Failed") statusEl.classList.add("status-failed");
        wrapper.appendChild(statusEl);
    }

    container.appendChild(wrapper);
}

function scrollChatToBottom() {
    const container = document.getElementById("chat-messages");
    if (!container) return;
    container.scrollTop = container.scrollHeight;
}

function autoResizeChatInput(input) {
    if (!input) return;
    const maxHeight = 90;
    input.style.height = "auto";
    const nextHeight = Math.min(input.scrollHeight, maxHeight);
    input.style.height = `${nextHeight}px`;
    input.style.overflowY = input.scrollHeight > maxHeight ? "auto" : "hidden";
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
                if (activeMessageIds.has(message._id)) {
                    return;
                }
                if (message.messageType === "image" && message.image?.fileId) {
                    const existingImage = document.querySelector(
                        `[data-image-file-id="${message.image.fileId}"]`
                    );
                    if (existingImage) {
                        activeMessageIds.add(message._id);
                        return;
                    }
                }
                if (String(message.senderId) === String(currentUserId)) {
                    const tempBubble = message.messageType === "image"
                        ? document.querySelector("[data-temp-id][data-body=\"[Image]\"]")
                        : document.querySelector(
                              `[data-temp-id][data-body="${CSS.escape(message.body)}"]`
                          );
                    if (tempBubble) {
                        tempBubble.dataset.messageId = String(message._id);
                        tempBubble.removeAttribute("data-temp-id");
                        if (message.messageType === "image" && message.image?.fileId) {
                            tempBubble.dataset.imageFileId = String(message.image.fileId);
                            const img = tempBubble.querySelector("img");
                            if (img) {
                                img.src = `/api/files/chat-image/${message.image.fileId}`;
                            }
                        }
                        activeMessageIds.add(message._id);
                        const wrapper = tempBubble.closest(".chat-message");
                        if (wrapper) {
                            const statusEl = wrapper.querySelector(".chat-status");
                            if (statusEl) {
                                statusEl.textContent = "Sent";
                                statusEl.classList.remove("status-sending", "status-failed");
                                statusEl.classList.add("status-sent");
                            }
                        }
                        return;
                    }
                }
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
    messagePollId = setInterval(
        () => loadMessages({ reset: false }),
        MESSAGE_POLL_MS
    );
}

function stopMessagePolling() {
    if (messagePollId) {
        clearInterval(messagePollId);
        messagePollId = null;
    }
}

function startNotificationPolling() {
    notificationPoller.start();
}

function stopNotificationPolling() {
    notificationPoller.stop();
}

async function sendMessage() {
    const input = document.getElementById("chat-input");
    const sendBtn = document.getElementById("chat-send-btn");
    if (!input || !activeConversationId) return;
    const body = input.value.trim();
    if (!body && pendingImageFile) {
        sendImageMessage();
        return;
    }
    if (!body) return;
    if (sendInFlight) return;
    let tempId = null;

    try {
        sendInFlight = true;
        if (sendBtn) sendBtn.disabled = true;
        input.value = "";
        autoResizeChatInput(input);
        tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        renderMessageBubble(
            {
                _id: null,
                body,
                senderId: currentUserId,
                createdAt: new Date().toISOString(),
            },
            { status: "Sending", tempId }
        );
        scrollChatToBottom();

        const data = await apiRequest(
            `/api/messages/conversations/${activeConversationId}/messages`,
            {
                method: "POST",
                body: JSON.stringify({ body }),
            }
        );
        const message = data?.message;
        if (message) {
            if (activeMessageIds.has(message._id)) {
                lastMessageCursor = message.createdAt;
                scrollChatToBottom();
                return;
            }
            const tempBubble = document.querySelector(`[data-temp-id="${tempId}"]`);
            if (tempBubble) {
                tempBubble.dataset.messageId = String(message._id);
                tempBubble.removeAttribute("data-temp-id");
                activeMessageIds.add(message._id);
                const wrapper = tempBubble.closest(".chat-message");
                if (wrapper) {
                    const statusEl = wrapper.querySelector(".chat-status");
                    if (statusEl) {
                        statusEl.textContent = "Sent";
                        statusEl.classList.remove("status-sending", "status-failed");
                        statusEl.classList.add("status-sent");
                    }
                }
            } else {
                renderMessageBubble(message);
            }
            lastMessageCursor = message.createdAt;
            scrollChatToBottom();
        }
    } catch (error) {
        console.error("Failed to send message:", error.message);
        const tempBubble = document.querySelector(`[data-temp-id="${tempId}"]`);
        if (tempBubble) {
            const wrapper = tempBubble.closest(".chat-message");
            if (wrapper) {
                const statusEl = wrapper.querySelector(".chat-status");
                if (statusEl) {
                    statusEl.textContent = "Failed";
                    statusEl.classList.remove("status-sending", "status-sent");
                    statusEl.classList.add("status-failed");
                }
            }
        }
    } finally {
        sendInFlight = false;
        if (sendBtn) sendBtn.disabled = false;
    }
}

async function sendImageMessage() {
    const sendBtn = document.getElementById("chat-send-btn");
    const preview = document.getElementById("chat-image-preview");
    if (!pendingImageFile || !activeConversationId) return;
    let tempId = null;

    try {
        if (sendBtn) sendBtn.disabled = true;
        const formData = new FormData();
        formData.append("image", pendingImageFile);

        tempId = `temp-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
        const localUrl = URL.createObjectURL(pendingImageFile);
        renderMessageBubble(
            {
                _id: null,
                body: "[Image]",
                senderId: currentUserId,
                createdAt: new Date().toISOString(),
                messageType: "image",
                image: { originalName: pendingImageFile.name },
            },
            { status: "Sending", tempId, localImageUrl: localUrl }
        );
        scrollChatToBottom();

        pendingImageFile = null;
        if (preview) preview.classList.add("hidden");

        const response = await fetch(
            `/api/messages/conversations/${activeConversationId}/images`,
            {
                method: "POST",
                credentials: "include",
                body: formData,
            }
        );
        const data = await response.json().catch(() => ({}));
        if (!response.ok) {
            throw new Error(data.message || "Unable to send image");
        }

        if (data?.message) {
            if (activeMessageIds.has(data.message._id)) {
                return;
            }
            const tempBubble = document.querySelector(`[data-temp-id="${tempId}"]`);
            if (tempBubble) {
                tempBubble.dataset.messageId = String(data.message._id);
                tempBubble.removeAttribute("data-temp-id");
                activeMessageIds.add(data.message._id);
                if (data.message.image?.fileId) {
                    tempBubble.dataset.imageFileId = String(data.message.image.fileId);
                    const img = tempBubble.querySelector("img");
                    if (img) {
                        img.src = `/api/files/chat-image/${data.message.image.fileId}`;
                    }
                }
                const wrapper = tempBubble.closest(".chat-message");
                if (wrapper) {
                    const statusEl = wrapper.querySelector(".chat-status");
                    if (statusEl) {
                        statusEl.textContent = "Sent";
                        statusEl.classList.remove("status-sending", "status-failed");
                        statusEl.classList.add("status-sent");
                    }
                }
            } else {
                renderMessageBubble(data.message);
            }
            lastMessageCursor = data.message.createdAt;
            scrollChatToBottom();
        }

        // Preview already hidden on send.
    } catch (error) {
        console.error("Failed to send image:", error.message);
        const tempBubble = document.querySelector(`[data-temp-id="${tempId}"]`);
        if (tempBubble) {
            const wrapper = tempBubble.closest(".chat-message");
            if (wrapper) {
                const statusEl = wrapper.querySelector(".chat-status");
                if (statusEl) {
                    statusEl.textContent = "Failed";
                    statusEl.classList.remove("status-sending", "status-sent");
                    statusEl.classList.add("status-failed");
                }
            }
        }
    } finally {
        if (sendBtn) sendBtn.disabled = false;
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

function applyConversationUpdate(conversation) {
    const normalized = normalizeConversation(conversation);
    if (!normalized?._id) return;
    conversationCache.set(normalized._id, normalized);
    renderConversationCache();

    if (normalized._id === activeConversationId) {
        setChatHeader(normalized);
    }
}

document.addEventListener("DOMContentLoaded", async () => {
    await loadProfile();
    openProfile();

    const sendBtn = document.getElementById("chat-send-btn");
    const input = document.getElementById("chat-input");
    const userSearchInput = document.getElementById("user-search-input");
    const imageBtn = document.getElementById("chat-image-btn");
    const imageInput = document.getElementById("chat-image-input");
    const imagePreview = document.getElementById("chat-image-preview");
    const imagePreviewImg = document.getElementById("chat-image-preview-img");
    const imageCancelBtn = document.getElementById("chat-image-cancel-btn");

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
        input.addEventListener("input", () => autoResizeChatInput(input));
        autoResizeChatInput(input);
    }

    if (imageBtn && imageInput) {
        imageBtn.addEventListener("click", () => imageInput.click());
        imageInput.addEventListener("change", () => {
            const file = imageInput.files?.[0] || null;
            if (!file) return;
            if (!["image/jpeg", "image/png"].includes(file.type)) {
                alert("Only JPEG or PNG images are allowed.");
                imageInput.value = "";
                return;
            }
            pendingImageFile = file;
            if (imagePreviewImg) {
                imagePreviewImg.src = URL.createObjectURL(file);
            }
            if (imagePreview) {
                imagePreview.classList.remove("hidden");
            }
        });
    }

    if (imageCancelBtn && imagePreview) {
        imageCancelBtn.addEventListener("click", () => {
            pendingImageFile = null;
            if (imagePreviewImg) imagePreviewImg.src = "";
            imagePreview.classList.add("hidden");
            if (imageInput) imageInput.value = "";
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

    startNotificationPolling();
});

window.addEventListener("beforeunload", () => {
    stopNotificationPolling();
});
