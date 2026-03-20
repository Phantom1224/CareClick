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
let activeConversation = null;
let lastMessageCursor = null;
const conversationCache = new Map();
let allUsers = [];
let groupAddSearchTerm = "";
let groupAddExistingIds = new Set();
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
    if (raw.isGroup) {
        return {
            _id: raw._id,
            isGroup: true,
            name: raw.name || "Group chat",
            participantCount: raw.participantCount || 0,
            lastMessageText: raw.lastMessageText || "",
            lastMessageAt: raw.lastMessageAt || raw.updatedAt,
            lastMessageSenderId: raw.lastMessageSenderId || null,
            lastMessageSenderName: raw.lastMessageSenderName || null,
        };
    }
    if (raw.otherUser) {
        return {
            ...raw,
            lastMessageSenderName: raw.lastMessageSenderName || null,
        };
    }
    const participants = Array.isArray(raw.participants) ? raw.participants : [];
    const other = participants.find((participant) => participant._id !== currentUserId);
    return {
        _id: raw._id,
        lastMessageText: raw.lastMessageText || "",
        lastMessageAt: raw.lastMessageAt || raw.updatedAt,
        lastMessageSenderId: raw.lastMessageSenderId || null,
        lastMessageSenderName: raw.lastMessageSenderName || null,
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
        avatar.textContent = buildAvatarText(
            conversation.isGroup ? conversation.name || "G" : other.userName
        );

        const body = document.createElement("div");
        body.className = "msg-body";

        const header = document.createElement("div");
        header.className = "msg-header";

        const name = document.createElement("span");
        name.className = "msg-name";
        name.textContent = conversation.isGroup
            ? (conversation.name || "Group chat")
            : (other.userName || "Unknown user");

        const time = document.createElement("span");
        time.className = "msg-time";
        time.textContent = formatTime(conversation.lastMessageAt);

        header.appendChild(name);
        header.appendChild(time);
        body.appendChild(header);

        const text = document.createElement("p");
        text.className = "msg-text";
        const lastText = conversation.lastMessageText || "Start the conversation";
        const hasSenderId = Boolean(conversation.lastMessageSenderId);
        const isMe =
            hasSenderId && currentUserId
                ? String(conversation.lastMessageSenderId) === String(currentUserId)
                : false;
        const senderName =
            isMe ? "Me" : (conversation.lastMessageSenderName || other.userName || "User");

        if (conversation.isGroup) {
            text.textContent = `${senderName}: ${lastText}`;
        } else if (isMe) {
            text.textContent = `Me: ${lastText}`;
        } else {
            text.textContent = lastText;
        }
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
        renderGroupUserList();
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
        titleEl.textContent = conversation?.isGroup
            ? (conversation.name || "Group chat")
            : (other.userName || "Conversation");
    }

    if (statusEl) {
        if (conversation?.isGroup) {
            const count = conversation.participantCount || 0;
            statusEl.textContent = `Group chat • ${count} members`;
        } else if (other.isOnline) {
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

    if (message.messageType === "system") {
        const wrapper = document.createElement("div");
        wrapper.className = "chat-message system-message";
        const text = document.createElement("div");
        text.className = "system-message-text";
        text.textContent = message.body;
        wrapper.appendChild(text);
        container.appendChild(wrapper);
        return;
    }

    const isSent = message.senderId === currentUserId;
    const wrapper = document.createElement("div");
    wrapper.className = `chat-message ${isSent ? "message-sent" : "message-received"}`;

    const bubble = document.createElement("div");
    bubble.className = `chat-bubble ${isSent ? "bubble-sent" : "bubble-received"}`;
    if (activeConversation?.isGroup && !isSent) {
        const senderLabel = document.createElement("div");
        senderLabel.style.fontSize = "0.7rem";
        senderLabel.style.color = "#64748b";
        senderLabel.style.marginBottom = "4px";
        senderLabel.textContent = message.senderName || "User";
        bubble.appendChild(senderLabel);
    }
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
        if (activeConversation?.isGroup && !isSent) {
            const textLine = document.createElement("div");
            textLine.textContent = message.body;
            bubble.appendChild(textLine);
        } else {
            bubble.textContent = message.body;
        }
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
                if (message.messageType !== "image") {
                    const meta = tempBubble.querySelector(".chat-meta");
                    tempBubble.textContent = message.body;
                    if (meta) {
                        tempBubble.appendChild(meta);
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

function renderGroupUserList() {
    const listEl = document.getElementById("group-user-list");
    if (!listEl) return;
    listEl.innerHTML = "";

    const searchInput = document.getElementById("group-user-search");
    const term = searchInput?.value?.trim().toLowerCase() || "";
    const users = term
        ? allUsers.filter((user) => {
              const name = (user.userName || "").toLowerCase();
              const email = (user.emailAddress || "").toLowerCase();
              return name.includes(term) || email.includes(term);
          })
        : allUsers;

    users.forEach((user) => {
        const row = document.createElement("div");
        row.className = "group-item";

        const label = document.createElement("label");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.value = user._id;

        const text = document.createElement("span");
        text.className = "group-user-text";

        const nameLine = document.createElement("span");
        nameLine.className = "group-user-name";
        nameLine.textContent = user.userName || "User";

        const emailLine = document.createElement("span");
        emailLine.className = "group-user-email";
        emailLine.textContent = user.emailAddress || "No email";

        text.appendChild(nameLine);
        text.appendChild(emailLine);

        label.appendChild(checkbox);
        label.appendChild(text);
        row.appendChild(label);
        listEl.appendChild(row);
    });
}

function openGroupModal() {
    const modal = document.getElementById("group-modal");
    if (!modal) return;
    const nameError = document.getElementById("group-name-error");
    if (nameError) nameError.classList.add("hidden");
    const searchInput = document.getElementById("group-user-search");
    if (searchInput) searchInput.value = "";
    renderGroupUserList();
    modal.classList.remove("hidden");
}

function closeGroupModal() {
    const modal = document.getElementById("group-modal");
    if (!modal) return;
    modal.classList.add("hidden");
    const nameInput = document.getElementById("group-name-input");
    if (nameInput) nameInput.value = "";
    const nameError = document.getElementById("group-name-error");
    if (nameError) nameError.classList.add("hidden");
}

async function createGroupChat() {
    const nameInput = document.getElementById("group-name-input");
    const listEl = document.getElementById("group-user-list");
    const createBtn = document.getElementById("group-create-btn");
    if (!nameInput || !listEl) return;

    const name = nameInput.value.trim();
    const checked = Array.from(listEl.querySelectorAll("input[type='checkbox']:checked"))
        .map((input) => input.value);

    if (!name) {
        const nameError = document.getElementById("group-name-error");
        if (nameError) nameError.classList.remove("hidden");
        nameInput.focus();
        return;
    }

    if (checked.length < 2) {
        alert("Select at least 2 users.");
        return;
    }

    try {
        if (createBtn) createBtn.disabled = true;
        const data = await apiRequest("/api/messages/conversations/group", {
            method: "POST",
            body: JSON.stringify({ name, participantIds: checked }),
        });
        const conversation = normalizeConversation(data?.conversation);
        if (conversation) {
            conversationCache.set(conversation._id, conversation);
            openChatByConversationId(conversation._id);
        }
        closeGroupModal();
    } catch (error) {
        alert(error.message || "Unable to create group");
    } finally {
        if (createBtn) createBtn.disabled = false;
    }
}

function renderGroupMembers(members = []) {
    const listEl = document.getElementById("group-info-members");
    if (!listEl) return;
    listEl.innerHTML = "";

    const disableKicks = members.length <= 3;

    members.forEach((member) => {
        const row = document.createElement("div");
        row.className = "group-member";

        const topRow = document.createElement("div");
        topRow.className = "group-member-row";

        const info = document.createElement("div");

        const nameLine = document.createElement("span");
        nameLine.className = "group-user-name";
        nameLine.textContent = member.userName || "User";

        const emailLine = document.createElement("span");
        emailLine.className = "group-user-email";
        emailLine.textContent = member.emailAddress || "No email";

        info.appendChild(nameLine);
        info.appendChild(emailLine);

        const kickBtn = document.createElement("button");
        kickBtn.className = "kick-btn";
        kickBtn.type = "button";
        kickBtn.textContent = "Kick";
        if (String(member._id) === String(currentUserId)) {
            kickBtn.disabled = true;
            kickBtn.textContent = "You";
        } else if (disableKicks) {
            kickBtn.disabled = true;
        } else {
            kickBtn.addEventListener("click", () => kickGroupMember(member._id));
        }

        topRow.appendChild(info);
        topRow.appendChild(kickBtn);
        row.appendChild(topRow);
        listEl.appendChild(row);
    });
}

function renderAddMembersList(members = [], existingIds = new Set()) {
    const listEl = document.getElementById("group-add-list");
    if (!listEl) return;
    listEl.innerHTML = "";

    const term = groupAddSearchTerm.trim().toLowerCase();
    const candidates = members.filter((user) => {
        if (existingIds.has(String(user._id))) return false;
        if (!term) return true;
        const name = (user.userName || "").toLowerCase();
        const email = (user.emailAddress || "").toLowerCase();
        return name.includes(term) || email.includes(term);
    });
    if (!candidates.length) {
        const empty = document.createElement("div");
        empty.className = "group-add-empty";
        empty.textContent = term ? "No users found." : "No more users to add.";
        listEl.appendChild(empty);
        return;
    }

    candidates.forEach((user) => {
        const row = document.createElement("div");
        row.className = "group-item";

        const label = document.createElement("label");
        const checkbox = document.createElement("input");
        checkbox.type = "checkbox";
        checkbox.value = user._id;

        const text = document.createElement("span");
        text.className = "group-user-text";

        const nameLine = document.createElement("span");
        nameLine.className = "group-user-name";
        nameLine.textContent = user.userName || "User";

        const emailLine = document.createElement("span");
        emailLine.className = "group-user-email";
        emailLine.textContent = user.emailAddress || "No email";

        text.appendChild(nameLine);
        text.appendChild(emailLine);

        label.appendChild(checkbox);
        label.appendChild(text);
        row.appendChild(label);
        listEl.appendChild(row);
    });
}

async function openGroupInfoModal() {
    if (!activeConversationId || !activeConversation?.isGroup) return;
    const modal = document.getElementById("group-info-modal");
    const nameInput = document.getElementById("group-info-name-input");
    const nameError = document.getElementById("group-info-name-error");
    if (!modal || !nameInput) return;

    try {
        const data = await apiRequest(`/api/messages/conversations/${activeConversationId}`);
        const conversation = data?.conversation;
        if (conversation) {
            nameInput.value = conversation.name || "";
            renderGroupMembers(conversation.participants || []);
            const updated = normalizeConversation({
                ...activeConversation,
                name: conversation.name,
                isGroup: true,
                participantCount: (conversation.participants || []).length,
            });
            if (updated) {
                activeConversation = updated;
                conversationCache.set(updated._id, updated);
                setChatHeader(updated);
                renderConversationCache();
            }
        }
        if (nameError) nameError.classList.add("hidden");
        modal.classList.remove("hidden");
    } catch (error) {
        console.error("Failed to load group info:", error.message);
    }
}

function closeGroupInfoModal() {
    const modal = document.getElementById("group-info-modal");
    if (modal) modal.classList.add("hidden");
}

async function saveGroupInfo() {
    if (!activeConversationId || !activeConversation?.isGroup) return;
    const nameInput = document.getElementById("group-info-name-input");
    const nameError = document.getElementById("group-info-name-error");
    const saveBtn = document.getElementById("group-info-save-btn");
    if (!nameInput) return;

    const name = nameInput.value.trim();
    if (!name) {
        if (nameError) nameError.classList.remove("hidden");
        nameInput.focus();
        return;
    }

    try {
        if (saveBtn) saveBtn.disabled = true;
        const data = await apiRequest(`/api/messages/conversations/${activeConversationId}`, {
            method: "PATCH",
            body: JSON.stringify({ name }),
        });
        const updated = normalizeConversation({
            ...activeConversation,
            name: data?.conversation?.name || name,
            isGroup: true,
        });
        if (updated) {
            activeConversation = updated;
            conversationCache.set(updated._id, updated);
            setChatHeader(updated);
            renderConversationCache();
        }
        closeGroupInfoModal();
    } catch (error) {
        console.error("Failed to update group:", error.message);
    } finally {
        if (saveBtn) saveBtn.disabled = false;
    }
}

function getGroupExistingIds() {
    const ids = [];
    const members = document.querySelectorAll("#group-info-members .group-member");
    if (members.length && activeConversation?.isGroup) {
        // Fallback: use cached conversation if available.
    }
    if (activeConversation?.isGroup && activeConversation?.participantCount) {
        // no-op; handled by openGroupAddModal using server data
    }
    return new Set(ids);
}

async function openGroupAddModal() {
    if (!activeConversationId || !activeConversation?.isGroup) return;
    const modal = document.getElementById("group-add-modal");
    const searchInput = document.getElementById("group-add-search");
    if (!modal) return;

    try {
        const data = await apiRequest(`/api/messages/conversations/${activeConversationId}`);
        const conversation = data?.conversation;
        if (conversation) {
            const existingIds = new Set(
                (conversation.participants || []).map((member) => String(member._id))
            );
            groupAddExistingIds = existingIds;
            if (searchInput) searchInput.value = groupAddSearchTerm;
            renderAddMembersList(allUsers, existingIds);
        }
        modal.classList.remove("hidden");
    } catch (error) {
        console.error("Failed to load add members:", error.message);
    }
}

function closeGroupAddModal() {
    const modal = document.getElementById("group-add-modal");
    if (modal) modal.classList.add("hidden");
}

async function addGroupMembers() {
    if (!activeConversationId || !activeConversation?.isGroup) return;
    const listEl = document.getElementById("group-add-list");
    if (!listEl) return;

    const selected = Array.from(listEl.querySelectorAll("input[type='checkbox']:checked"))
        .map((input) => input.value);
    if (!selected.length) return;

    try {
        const data = await apiRequest(`/api/messages/conversations/${activeConversationId}/members`, {
            method: "POST",
            body: JSON.stringify({ participantIds: selected }),
        });
        await openGroupInfoModal();
        if (data?.conversation) {
            applyConversationUpdate({ ...activeConversation, ...data.conversation });
        }
        closeGroupAddModal();
    } catch (error) {
        console.error("Failed to add members:", error.message);
    }
}

async function kickGroupMember(memberId) {
    if (!activeConversationId || !activeConversation?.isGroup) return;
    if (!memberId) return;
    const shouldKick = window.confirm("Remove this member from the group?");
    if (!shouldKick) return;
    try {
        const data = await apiRequest(
            `/api/messages/conversations/${activeConversationId}/members/${memberId}`,
            { method: "DELETE" }
        );
        await openGroupInfoModal();
        if (data?.conversation) {
            applyConversationUpdate({ ...activeConversation, ...data.conversation });
        }
    } catch (error) {
        console.error("Failed to remove member:", error.message);
        alert(error.message || "Unable to remove member");
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
    activeConversation = conversation;

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
        activeConversation = normalized;
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
    const createGroupBtn = document.getElementById("create-group-btn");
    const groupCancelBtn = document.getElementById("group-cancel-btn");
    const groupCancelBtnFooter = document.getElementById("group-cancel-btn-footer");
    const groupCreateBtn = document.getElementById("group-create-btn");
    const groupModal = document.getElementById("group-modal");
    const groupUserSearch = document.getElementById("group-user-search");
    const chatTitle = document.getElementById("chat-title");
    const groupInfoModal = document.getElementById("group-info-modal");
    const groupInfoCloseBtn = document.getElementById("group-info-close-btn");
    const groupInfoCancelBtn = document.getElementById("group-info-cancel-btn");
    const groupInfoAddBtn = document.getElementById("group-info-add-btn");
    const groupInfoSaveBtn = document.getElementById("group-info-save-btn");
    const groupInfoNameInput = document.getElementById("group-info-name-input");
    const groupInfoNameError = document.getElementById("group-info-name-error");
    const groupAddModal = document.getElementById("group-add-modal");
    const groupAddCloseBtn = document.getElementById("group-add-close-btn");
    const groupAddCancelBtn = document.getElementById("group-add-cancel-btn");
    const groupAddConfirmBtn = document.getElementById("group-add-confirm-btn");
    const groupAddSearch = document.getElementById("group-add-search");
    const groupNameInput = document.getElementById("group-name-input");
    const groupNameError = document.getElementById("group-name-error");

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

    if (createGroupBtn) {
        createGroupBtn.addEventListener("click", openGroupModal);
    }
    if (groupCancelBtn) {
        groupCancelBtn.addEventListener("click", closeGroupModal);
    }
    if (groupCancelBtnFooter) {
        groupCancelBtnFooter.addEventListener("click", closeGroupModal);
    }
    if (groupCreateBtn) {
        groupCreateBtn.addEventListener("click", createGroupChat);
    }
    if (groupModal) {
        groupModal.addEventListener("click", (event) => {
            if (event.target === groupModal) {
                closeGroupModal();
            }
        });
    }
    if (groupUserSearch) {
        groupUserSearch.addEventListener("input", () => {
            renderGroupUserList();
        });
    }

    if (chatTitle) {
        chatTitle.addEventListener("click", openGroupInfoModal);
        chatTitle.addEventListener("keydown", (event) => {
            if (event.key === "Enter" || event.key === " ") {
                event.preventDefault();
                openGroupInfoModal();
            }
        });
    }

    if (groupInfoCloseBtn) {
        groupInfoCloseBtn.addEventListener("click", closeGroupInfoModal);
    }
    if (groupInfoCancelBtn) {
        groupInfoCancelBtn.addEventListener("click", closeGroupInfoModal);
    }
    if (groupInfoSaveBtn) {
        groupInfoSaveBtn.addEventListener("click", saveGroupInfo);
    }
    if (groupInfoAddBtn) {
        groupInfoAddBtn.addEventListener("click", openGroupAddModal);
    }
    if (groupInfoModal) {
        groupInfoModal.addEventListener("click", (event) => {
            if (event.target === groupInfoModal) {
                closeGroupInfoModal();
            }
        });
    }
    if (groupInfoNameInput && groupInfoNameError) {
        groupInfoNameInput.addEventListener("input", () => {
            if (groupInfoNameInput.value.trim()) {
                groupInfoNameError.classList.add("hidden");
            }
        });
    }

    if (groupAddCloseBtn) {
        groupAddCloseBtn.addEventListener("click", closeGroupAddModal);
    }
    if (groupAddCancelBtn) {
        groupAddCancelBtn.addEventListener("click", closeGroupAddModal);
    }
    if (groupAddConfirmBtn) {
        groupAddConfirmBtn.addEventListener("click", addGroupMembers);
    }
    if (groupAddModal) {
        groupAddModal.addEventListener("click", (event) => {
            if (event.target === groupAddModal) {
                closeGroupAddModal();
            }
        });
    }
    if (groupAddSearch) {
        groupAddSearch.addEventListener("input", (event) => {
            groupAddSearchTerm = event.target.value || "";
            renderAddMembersList(allUsers, groupAddExistingIds);
        });
    }


    if (userSearchInput) {
        userSearchInput.addEventListener("input", (event) => {
            searchTerm = event.target.value || "";
            renderUserDirectory(getFilteredUsers());
        });
    }

    if (groupNameInput && groupNameError) {
        groupNameInput.addEventListener("input", () => {
            if (groupNameInput.value.trim()) {
                groupNameError.classList.add("hidden");
            }
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
