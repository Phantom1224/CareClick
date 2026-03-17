(function initCareClickShared() {
    const CareClick = window.CareClick || (window.CareClick = {});
    const API_BASE = window.location.origin;
    const PENDING_CHAT_USER_KEY = "careclickPendingChatUserId";
    const config = {
        polling: {
            locationFeedMs: 3000,
            notificationsMs: 3000,
            conversationsMs: 3000,
            messagesMs: 3000,
        },
        retry: {
            baseDelayMs: 1000,
            maxDelayMs: 15000,
            jitterMs: 300,
        },
    };

    CareClick.API_BASE = API_BASE;
    CareClick.PENDING_CHAT_USER_KEY = PENDING_CHAT_USER_KEY;
    CareClick.config = CareClick.config || config;

    CareClick.redirectToLogin = function redirectToLogin() {
        window.location.href = "Login.html";
    };

    CareClick.parseJsonSafe = async function parseJsonSafe(response) {
        try {
            return await response.json();
        } catch (_error) {
            return {};
        }
    };

    CareClick.requestJson = async function requestJson(
        path,
        options = {},
        { onUnauthorized, unauthorizedMessage = "Session expired" } = {}
    ) {
        const response = await fetch(`${API_BASE}${path}`, {
            credentials: "include",
            ...options,
            headers: {
                "Content-Type": "application/json",
                ...(options.headers || {}),
            },
        });

        const data = await CareClick.parseJsonSafe(response);

        if (response.status === 401) {
            if (typeof onUnauthorized === "function") {
                onUnauthorized();
            }
            throw new Error(data.message || unauthorizedMessage);
        }

        if (!response.ok) {
            throw new Error(data.message || "Request failed");
        }

        return data;
    };

    CareClick.apiRequest = async function apiRequest(path, options = {}, { onUnauthorized } = {}) {
        return CareClick.requestJson(path, options, {
            onUnauthorized: onUnauthorized || CareClick.redirectToLogin,
        });
    };

    CareClick.formatTime = function formatTime(value, options = {}) {
        if (!value) return "";
        const date = new Date(value);
        if (Number.isNaN(date.getTime())) return "";
        return date.toLocaleTimeString([], {
            hour: "numeric",
            minute: "2-digit",
            ...options,
        });
    };

    CareClick.sanitizeToastBody = function sanitizeToastBody(text, maxLen = 80) {
        const trimmed = String(text || "").trim();
        if (!trimmed) return "Tap to open chat";
        if (trimmed.length <= maxLen) return trimmed;
        return `${trimmed.slice(0, Math.max(0, maxLen - 3))}...`;
    };

    CareClick.openChatWithUserId = function openChatWithUserId(userId, path = "Profile.html") {
        if (!userId) return;
        localStorage.setItem(PENDING_CHAT_USER_KEY, userId);
        window.location.href = path;
    };

    CareClick.showMessageToast = function showMessageToast({
        senderName,
        body,
        createdAt,
        senderId,
        onClick,
        lifetimeMs = 5000,
        maxVisible = 3,
    }) {
        const title = senderName ? `New message from ${senderName}` : "New message received";
        CareClick.createToast({
            title,
            body: CareClick.sanitizeToastBody(body),
            time: CareClick.formatTime(createdAt),
            onClick: onClick || (() => CareClick.openChatWithUserId(senderId)),
            lifetimeMs,
            maxVisible,
        });
    };

    CareClick.createNotificationPoller = function createNotificationPoller({
        apiPath = "/api/messages/notifications",
        pollMs = CareClick.config?.polling?.notificationsMs || 5000,
        onMessage,
        onError,
        onUnauthorized,
        retry = CareClick.config?.retry,
    } = {}) {
        let timerId = null;
        let lastSince = null;
        let failureCount = 0;
        let running = false;

        const normalizeRetry = () => ({
            baseDelayMs: Math.max(250, Number(retry?.baseDelayMs) || 1000),
            maxDelayMs: Math.max(1000, Number(retry?.maxDelayMs) || 15000),
            jitterMs: Math.max(0, Number(retry?.jitterMs) || 0),
        });

        const computeRetryDelay = () => {
            const { baseDelayMs, maxDelayMs, jitterMs } = normalizeRetry();
            const expDelay = baseDelayMs * 2 ** Math.max(0, failureCount - 1);
            const capped = Math.min(expDelay, maxDelayMs);
            const jitter = jitterMs ? Math.floor(Math.random() * jitterMs) : 0;
            return capped + jitter;
        };

        const fetchNotifications = async () => {
            try {
                const params = new URLSearchParams();
                if (lastSince) {
                    params.set("since", lastSince);
                }
                const query = params.toString() ? `?${params.toString()}` : "";
                const data = await CareClick.apiRequest(`${apiPath}${query}`, {}, { onUnauthorized });
                const messages = Array.isArray(data?.messages) ? data.messages : [];
                messages.forEach((message) => {
                    if (typeof onMessage === "function") {
                        onMessage(message);
                    }
                });
                if (data?.nextSince) {
                    lastSince = data.nextSince;
                }
                failureCount = 0;
            } catch (error) {
                failureCount += 1;
                if (typeof onError === "function") {
                    onError(error);
                }
                throw error;
            }
        };

        const scheduleNext = (delayMs) => {
            if (!running) return;
            timerId = setTimeout(async () => {
                try {
                    await fetchNotifications();
                    scheduleNext(pollMs);
                } catch (_error) {
                    scheduleNext(computeRetryDelay());
                }
            }, delayMs);
        };

        return {
            start() {
                if (running) return;
                running = true;
                if (!lastSince) {
                    lastSince = new Date().toISOString();
                }
                scheduleNext(0);
            },
            stop() {
                running = false;
                if (timerId) {
                    clearTimeout(timerId);
                    timerId = null;
                }
            },
            resetSince(value = null) {
                lastSince = value;
            },
        };
    };

    CareClick.createToast = function createToast({
        stackId = "toast-stack",
        title = "",
        body = "",
        time = "",
        onClick,
        lifetimeMs = 5000,
        maxVisible = 3,
    }) {
        const stackEl = document.getElementById(stackId);
        if (!stackEl) return;

        const toast = document.createElement("button");
        toast.type = "button";
        toast.className = "toast";

        if (title) {
            const titleEl = document.createElement("div");
            titleEl.className = "toast-title";
            titleEl.textContent = title;
            toast.appendChild(titleEl);
        }

        const bodyEl = document.createElement("div");
        bodyEl.className = "toast-body";
        bodyEl.textContent = body;
        toast.appendChild(bodyEl);

        if (time) {
            const timeEl = document.createElement("div");
            timeEl.className = "toast-time";
            timeEl.textContent = time;
            toast.appendChild(timeEl);
        }

        if (typeof onClick === "function") {
            toast.addEventListener("click", onClick);
        }

        stackEl.appendChild(toast);

        const toasts = stackEl.querySelectorAll(".toast");
        if (toasts.length > maxVisible) {
            const extra = Array.from(toasts).slice(0, toasts.length - maxVisible);
            extra.forEach((item) => item.remove());
        }

        window.setTimeout(() => {
            toast.remove();
        }, lifetimeMs);
    };
})();
