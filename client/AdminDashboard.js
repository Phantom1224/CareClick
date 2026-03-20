const CareClick = window.CareClick || {};
const { apiRequest: sharedApiRequest, createToast } = CareClick;

const usersList = document.getElementById("users-list");
const emptyState = document.getElementById("users-empty");
const searchInput = document.getElementById("user-search-input");
const logoutBtn = document.getElementById("admin-logout-btn");
const homeBtn = document.getElementById("admin-home-btn");
const filterAllBtn = document.getElementById("filter-all");
const filterApprovedBtn = document.getElementById("filter-approved");
const filterPendingBtn = document.getElementById("filter-pending");
const deleteModal = document.getElementById("delete-modal");
const deleteModalBody = document.getElementById("delete-modal-body");
const deleteConfirmBtn = document.getElementById("delete-confirm-btn");
const deleteCancelBtn = document.getElementById("delete-cancel-btn");
const deleteCancelBtnFooter = document.getElementById("delete-cancel-btn-footer");

let allUsers = [];
let currentSearch = "";
let pendingDeleteUserId = null;
let pendingAction = null;
let currentFilter = "all";

async function apiRequest(path, options = {}) {
    return sharedApiRequest(path, options, {
        onUnauthorized: () => {
            window.location.href = "Login.html";
        },
        unauthorizedMessage: "Admin access required",
    });
}

async function ensureAdminSession() {
    try {
        const data = await apiRequest("/api/users/me");
        if (data?.user?.role !== "admin") {
            window.location.href = "Home.html";
            return false;
        }
        return true;
    } catch (_error) {
        window.location.href = "Login.html";
        return false;
    }
}

function showToast(message, isError = false) {
    createToast({
        title: isError ? "Action Failed" : "Success",
        body: message,
        lifetimeMs: 3500,
        maxVisible: 2,
    });
}

function renderUsers() {
    if (!usersList || !emptyState) return;

    const term = currentSearch.trim().toLowerCase();
    const filtered = allUsers.filter((user) => {
        if (currentFilter === "approved" && !user.isApproved) return false;
        if (currentFilter === "pending" && user.isApproved) return false;
        if (!term) return true;
        const name = (user.userName || "").toLowerCase();
        const email = (user.emailAddress || "").toLowerCase();
        return name.includes(term) || email.includes(term);
    }).sort((a, b) => {
        const aIsAdmin = a.role === "admin";
        const bIsAdmin = b.role === "admin";
        if (aIsAdmin !== bIsAdmin) {
            return aIsAdmin ? -1 : 1;
        }
        return (a.emailAddress || "").localeCompare(b.emailAddress || "");
    });

    usersList.innerHTML = "";
    if (!filtered.length) {
        emptyState.classList.remove("hidden");
        return;
    }

    emptyState.classList.add("hidden");
    filtered.forEach((user) => {
        usersList.appendChild(renderUserCard(user));
    });
}

function renderUserCard(user) {
    const card = document.createElement("div");
    card.className = "user-card";

    const headerRow = document.createElement("div");
    headerRow.className = "user-row";

    const main = document.createElement("div");
    main.className = "user-main";

    const nameEl = document.createElement("div");
    nameEl.className = "user-name";
    nameEl.textContent = user.userName || "Unknown user";

    const emailEl = document.createElement("div");
    emailEl.className = "user-email";
    emailEl.textContent = user.emailAddress || "No email";

    const roleBadge = document.createElement("span");
    roleBadge.className = `role-badge ${user.role}`;
    roleBadge.textContent = user.role === "admin" ? "Admin" : "User";

    main.appendChild(nameEl);
    main.appendChild(emailEl);
    const badgeRow = document.createElement("div");
    badgeRow.className = "badge-row";

    const statusBadge = document.createElement("span");
    statusBadge.className = `status-badge ${user.isApproved ? "approved" : "pending"}`;
    statusBadge.textContent = user.isApproved ? "Approved" : "Pending";

    badgeRow.appendChild(roleBadge);
    badgeRow.appendChild(statusBadge);
    headerRow.appendChild(main);
    headerRow.appendChild(badgeRow);

    const actions = document.createElement("div");
    actions.className = "actions";

    if (!user.isApproved) {
        const approveBtn = document.createElement("button");
        approveBtn.className = "btn btn-role";
        approveBtn.type = "button";
        approveBtn.textContent = "Approve";
        approveBtn.addEventListener("click", () => {
            openConfirmModal({
                title: "Approve User",
                message: `Approve ${user.userName || "this user"}?`,
                confirmText: "Approve",
                confirmClass: "btn-primary",
                onConfirm: () => approveUser(user._id),
            });
        });
        actions.appendChild(approveBtn);
    }

    const roleBtn = document.createElement("button");
    roleBtn.className = "btn btn-role";
    roleBtn.type = "button";
    roleBtn.textContent =
        user.role === "admin" ? "Set as User" : "Set as Admin";
    roleBtn.addEventListener("click", () => {
        const nextRole = user.role === "admin" ? "user" : "admin";
        openConfirmModal({
            title: "Change Role",
            message: `Set ${user.userName || "this user"} as ${nextRole}?`,
            confirmText: "Confirm",
            confirmClass: "btn-primary",
            onConfirm: () => updateRole(user._id, nextRole),
        });
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "btn btn-danger";
    deleteBtn.type = "button";
    deleteBtn.textContent = "Delete User";
    deleteBtn.addEventListener("click", () => {
        openConfirmModal({
            title: "Delete User",
            message: `Delete ${user.userName || "this user"}? This cannot be undone.`,
            confirmText: "Delete",
            confirmClass: "btn-danger",
            onConfirm: () => deleteUser(user._id),
        });
    });

    actions.appendChild(roleBtn);
    actions.appendChild(deleteBtn);

    card.appendChild(headerRow);
    if (user.validIdImage?.fileId) {
        const idRow = document.createElement("div");
        idRow.className = "id-preview";

        const img = document.createElement("img");
        img.className = "id-thumb";
        img.alt = "Valid ID preview";
        img.src = `/api/files/student-id/${user.validIdImage.fileId}`;

        const link = document.createElement("a");
        link.className = "id-link";
        link.href = `/api/files/student-id/${user.validIdImage.fileId}`;
        link.target = "_blank";
        link.rel = "noopener noreferrer";
        link.textContent = "View ID";

        idRow.appendChild(img);
        idRow.appendChild(link);
        card.appendChild(idRow);
    }
    card.appendChild(actions);

    return card;
}

function openConfirmModal({ title, message, confirmText, confirmClass, onConfirm }) {
    if (!deleteModal || !deleteModalBody || !deleteConfirmBtn) return;
    const titleEl = document.getElementById("delete-modal-title");
    if (titleEl) titleEl.textContent = title || "Confirm Action";
    deleteModalBody.textContent = message || "Are you sure?";
    deleteConfirmBtn.textContent = confirmText || "Confirm";
    deleteConfirmBtn.classList.remove("btn-danger", "btn-primary", "btn-role");
    deleteConfirmBtn.classList.add(confirmClass || "btn-danger");
    pendingAction = typeof onConfirm === "function" ? onConfirm : null;
    deleteModal.classList.remove("hidden");
}

function closeDeleteModal() {
    if (!deleteModal) return;
    deleteModal.classList.add("hidden");
    pendingDeleteUserId = null;
    pendingAction = null;
}

async function loadUsers() {
    try {
        const data = await apiRequest("/api/admin/users");
        allUsers = Array.isArray(data?.users) ? data.users : [];
        renderUsers();
    } catch (error) {
        showToast(error.message || "Unable to load users", true);
    }
}

async function updateRole(userId, role) {
    try {
        await apiRequest(`/api/admin/users/${userId}/role`, {
            method: "PATCH",
            body: JSON.stringify({ role }),
        });
        const user = allUsers.find((u) => u._id === userId);
        if (user) {
            user.role = role;
        }
        showToast("Role updated");
        renderUsers();
    } catch (error) {
        showToast(error.message || "Unable to update role", true);
    }
}

async function approveUser(userId) {
    try {
        await apiRequest(`/api/admin/users/${userId}/approve`, {
            method: "PATCH",
        });
        const user = allUsers.find((u) => u._id === userId);
        if (user) {
            user.isApproved = true;
        }
        showToast("User approved");
        renderUsers();
    } catch (error) {
        showToast(error.message || "Unable to approve user", true);
    }
}

async function deleteUser(userId) {
    try {
        await apiRequest(`/api/admin/users/${userId}`, {
            method: "DELETE",
        });
        allUsers = allUsers.filter((user) => user._id !== userId);
        showToast("User deleted");
        renderUsers();
    } catch (error) {
        showToast(error.message || "Unable to delete user", true);
    }
}

async function logoutUser() {
    try {
        await fetch(`${CareClick.API_BASE}/api/auth/logout`, {
            method: "POST",
            credentials: "include",
        });
    } catch (_error) {
        // Ignore network errors; we'll still redirect.
    }
    window.location.href = "Login.html";
}

document.addEventListener("DOMContentLoaded", () => {
    ensureAdminSession().then((ok) => {
        if (ok) {
            loadUsers();
        }
    });
    if (searchInput) {
        searchInput.addEventListener("input", (event) => {
            currentSearch = event.target.value || "";
            renderUsers();
        });
    }
    if (logoutBtn) {
        logoutBtn.addEventListener("click", logoutUser);
    }
    if (homeBtn) {
        homeBtn.addEventListener("click", () => {
            window.location.href = "Home.html";
        });
    }
    const setFilter = (filter) => {
        currentFilter = filter;
        if (filterAllBtn) filterAllBtn.classList.toggle("active", filter === "all");
        if (filterApprovedBtn)
            filterApprovedBtn.classList.toggle("active", filter === "approved");
        if (filterPendingBtn)
            filterPendingBtn.classList.toggle("active", filter === "pending");
        renderUsers();
    };
    if (filterAllBtn) filterAllBtn.addEventListener("click", () => setFilter("all"));
    if (filterApprovedBtn)
        filterApprovedBtn.addEventListener("click", () => setFilter("approved"));
    if (filterPendingBtn)
        filterPendingBtn.addEventListener("click", () => setFilter("pending"));
    if (deleteConfirmBtn) {
        deleteConfirmBtn.addEventListener("click", () => {
            if (pendingAction) {
                pendingAction();
            }
            closeDeleteModal();
        });
    }
    if (deleteCancelBtn) {
        deleteCancelBtn.addEventListener("click", closeDeleteModal);
    }
    if (deleteCancelBtnFooter) {
        deleteCancelBtnFooter.addEventListener("click", closeDeleteModal);
    }
    if (deleteModal) {
        deleteModal.addEventListener("click", (event) => {
            if (event.target === deleteModal) {
                closeDeleteModal();
            }
        });
    }
});
