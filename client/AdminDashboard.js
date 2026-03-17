const CareClick = window.CareClick || {};
const { apiRequest: sharedApiRequest, createToast } = CareClick;

const usersList = document.getElementById("users-list");
const emptyState = document.getElementById("users-empty");
const searchInput = document.getElementById("user-search-input");
const logoutBtn = document.getElementById("admin-logout-btn");
const deleteModal = document.getElementById("delete-modal");
const deleteModalBody = document.getElementById("delete-modal-body");
const deleteConfirmBtn = document.getElementById("delete-confirm-btn");
const deleteCancelBtn = document.getElementById("delete-cancel-btn");
const deleteCancelBtnFooter = document.getElementById("delete-cancel-btn-footer");

let allUsers = [];
let currentSearch = "";
let pendingDeleteUserId = null;

async function apiRequest(path, options = {}) {
    return sharedApiRequest(path, options, {
        onUnauthorized: () => {
            window.location.href = "Login.html";
        },
        unauthorizedMessage: "Admin access required",
    });
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
    headerRow.appendChild(main);
    headerRow.appendChild(roleBadge);

    const actions = document.createElement("div");
    actions.className = "actions";

    const roleBtn = document.createElement("button");
    roleBtn.className = "btn btn-role";
    roleBtn.type = "button";
    roleBtn.textContent =
        user.role === "admin" ? "Set as User" : "Set as Admin";
    roleBtn.addEventListener("click", () => {
        const nextRole = user.role === "admin" ? "user" : "admin";
        updateRole(user._id, nextRole);
    });

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "btn btn-danger";
    deleteBtn.type = "button";
    deleteBtn.textContent = "Delete User";
    deleteBtn.addEventListener("click", () => {
        openDeleteModal(user);
    });

    actions.appendChild(roleBtn);
    actions.appendChild(deleteBtn);

    card.appendChild(headerRow);
    card.appendChild(actions);

    return card;
}

function openDeleteModal(user) {
    if (!deleteModal || !deleteModalBody || !deleteConfirmBtn) return;
    pendingDeleteUserId = user?._id || null;
    const name = user?.userName || "this user";
    deleteModalBody.textContent = `Delete ${name}? This cannot be undone.`;
    deleteModal.classList.remove("hidden");
}

function closeDeleteModal() {
    if (!deleteModal) return;
    deleteModal.classList.add("hidden");
    pendingDeleteUserId = null;
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
    loadUsers();
    if (searchInput) {
        searchInput.addEventListener("input", (event) => {
            currentSearch = event.target.value || "";
            renderUsers();
        });
    }
    if (logoutBtn) {
        logoutBtn.addEventListener("click", logoutUser);
    }
    if (deleteConfirmBtn) {
        deleteConfirmBtn.addEventListener("click", () => {
            if (pendingDeleteUserId) {
                deleteUser(pendingDeleteUserId);
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
