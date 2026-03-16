const { requestJson } = window.CareClick || {};
const API_BASE = window.CareClick?.API_BASE || window.location.origin;
let countdownInterval = null;
let pendingSignupEmail = "";
let pendingForgotEmail = "";
const OTP_RESEND_SECONDS = 60;
let signupInFlight = false;
let forgotCodeInFlight = false;

function toggleView(viewId) {
    clearMessages();
    const cards = document.querySelectorAll(".card");
    cards.forEach((card) => card.classList.add("hidden"));

    const activeCard = document.getElementById(viewId);
    if (activeCard) {
        activeCard.classList.remove("hidden");
    }

    window.scrollTo({ top: 0, behavior: "smooth" });
}

function setMessage(messageId, message, isError = false) {
    const el = document.getElementById(messageId);
    if (!el) return;

    el.textContent = message;
    el.classList.remove("hidden");
    el.classList.toggle("error", isError);
}

function clearMessages() {
    ["login-message", "signup-message", "forgot-message", "verify-message"].forEach((id) => {
        const el = document.getElementById(id);
        if (!el) return;
        el.classList.add("hidden");
        el.classList.remove("error");
        el.textContent = "";
    });
}

function setOtpInputsDisabled(isDisabled) {
    document.querySelectorAll(".otp-input").forEach((input) => {
        input.disabled = isDisabled;
    });
}

function clearOtpInputs() {
    const inputs = document.querySelectorAll(".otp-input");
    inputs.forEach((input) => {
        input.value = "";
    });
    if (inputs[0]) {
        inputs[0].focus();
    }
}

async function postJson(path, payload) {
    return requestJson(path, {
        method: "POST",
        body: JSON.stringify(payload),
    });
}

async function handleLogin(event) {
    event.preventDefault();
    clearMessages();

    const emailAddress = document.getElementById("login-email").value.trim().toLowerCase();
    const password = document.getElementById("login-password").value;

    if (!emailAddress || !password) {
        setMessage("login-message", "Email and password are required.", true);
        return;
    }

    try {
        const data = await postJson("/api/auth/login", { emailAddress, password });
        window.location.href = "Home.html";
    } catch (error) {
        setMessage("login-message", error.message, true);
    }
}

async function handleSignup(event) {
    event.preventDefault();
    clearMessages();

    const userName = document.getElementById("signup-name").value.trim();
    const emailAddress = document.getElementById("signup-email").value.trim().toLowerCase();
    const password = document.getElementById("signup-password").value;
    const confirmPassword = document.getElementById("signup-confirm-password").value;

    if (!userName || !emailAddress || !password || !confirmPassword) {
        setMessage("signup-message", "All fields are required.", true);
        return;
    }

    if (password !== confirmPassword) {
        setMessage("signup-message", "Passwords do not match.", true);
        return;
    }

    if (password.length < 8) {
        setMessage("signup-message", "Password must be at least 8 characters long.", true);
        return;
    }

    if (signupInFlight) {
        return;
    }
    signupInFlight = true;

    try {
        await postJson("/api/auth/signup/request-code", {
            userName,
            emailAddress,
            password,
            confirmPassword,
        });

        pendingSignupEmail = emailAddress;
        setOtpInputsDisabled(false);
        clearOtpInputs();
        toggleView("view-verify");
        setMessage("verify-message", "Verification code sent. Check your email.");
        startResendTimer("signup-resend-btn", "signup-timer-display");
    } catch (error) {
        setMessage("signup-message", error.message, true);
    } finally {
        signupInFlight = false;
    }
}

function updateTimerDisplay(timerDisplay, seconds) {
    const m = Math.floor(seconds / 60);
    const s = seconds % 60;
    timerDisplay.textContent = `(Resend in ${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")})`;
}

function startResendTimer(resendBtnId, timerDisplayId) {
    const resendBtn = document.getElementById(resendBtnId);
    const timerDisplay = document.getElementById(timerDisplayId);
    let secondsLeft = OTP_RESEND_SECONDS;

    if (!resendBtn || !timerDisplay) {
        return;
    }

    resendBtn.classList.add("hidden");
    timerDisplay.classList.remove("hidden");
    updateTimerDisplay(timerDisplay, secondsLeft);

    clearInterval(countdownInterval);
    countdownInterval = setInterval(() => {
        secondsLeft -= 1;
        updateTimerDisplay(timerDisplay, secondsLeft);

        if (secondsLeft <= 0) {
            clearInterval(countdownInterval);
            countdownInterval = null;
            resendBtn.classList.remove("hidden");
            timerDisplay.classList.add("hidden");
        }
    }, 1000);
}

async function handleResendSignupCode() {
    clearMessages();

    if (!pendingSignupEmail) {
        setMessage("verify-message", "No pending signup found. Please sign up again.", true);
        return;
    }

    try {
        await postJson("/api/auth/signup/resend-code", { emailAddress: pendingSignupEmail });
        setMessage("verify-message", "A new code has been sent.");
        clearOtpInputs();
        startResendTimer("signup-resend-btn", "signup-timer-display");
    } catch (error) {
        setMessage("verify-message", error.message, true);
    }
}

async function handleVerify() {
    clearMessages();

    if (!pendingSignupEmail) {
        setMessage("verify-message", "No pending signup found. Please sign up again.", true);
        toggleView("view-signup");
        return;
    }

    const inputs = document.querySelectorAll(".otp-input");
    const code = Array.from(inputs).map((i) => i.value).join("");

    if (!/^\d{6}$/.test(code)) {
        setMessage("verify-message", "Please enter a valid 6-digit code.", true);
        return;
    }

    try {
        const data = await postJson("/api/auth/signup/verify-code", {
            emailAddress: pendingSignupEmail,
            code,
        });

        pendingSignupEmail = "";
        window.location.href = "Home.html";
    } catch (error) {
        setMessage("verify-message", error.message, true);
    }
}

async function handleForgotCodeRequest() {
    clearMessages();

    const emailAddress = document.getElementById("forgot-email").value.trim().toLowerCase();
    if (!emailAddress) {
        setMessage("forgot-message", "Email is required to get a code.", true);
        return;
    }

    if (forgotCodeInFlight) {
        return;
    }
    forgotCodeInFlight = true;

    try {
        await postJson("/api/auth/password/request-code", { emailAddress });
        pendingForgotEmail = emailAddress;
        setMessage("forgot-message", "A verification code has been sent to your email.");
        startResendTimer("forgot-resend-btn", "forgot-timer-display");
    } catch (error) {
        setMessage("forgot-message", error.message, true);
    } finally {
        forgotCodeInFlight = false;
    }
}

async function handleForgotPassword(event) {
    event.preventDefault();
    clearMessages();

    const emailAddress = document.getElementById("forgot-email").value.trim().toLowerCase();
    const newPassword = document.getElementById("forgot-new-password").value;
    const confirmPassword = document.getElementById("forgot-confirm-password").value;
    const code = document.getElementById("forgot-code").value.trim();

    if (!emailAddress || !newPassword || !confirmPassword || !code) {
        setMessage("forgot-message", "All fields are required.", true);
        return;
    }

    if (newPassword !== confirmPassword) {
        setMessage("forgot-message", "Passwords do not match.", true);
        return;
    }

    if (newPassword.length < 8) {
        setMessage("forgot-message", "Password must be at least 8 characters long.", true);
        return;
    }

    if (!/^\d{6}$/.test(code)) {
        setMessage("forgot-message", "Verification code must be a 6-digit number.", true);
        return;
    }

    try {
        await postJson("/api/auth/password/reset", {
            emailAddress,
            newPassword,
            confirmPassword,
            code,
        });
        pendingForgotEmail = "";
        setMessage("forgot-message", "Password updated. You can log in now.");
        toggleView("view-login");
    } catch (error) {
        setMessage("forgot-message", error.message, true);
    }
}

function setupOtpInputBehavior() {
    const otpInputs = document.querySelectorAll(".otp-input");
    otpInputs.forEach((input, index) => {
        input.addEventListener("input", (event) => {
            const cleanedValue = event.target.value.replace(/\D/g, "");
            event.target.value = cleanedValue.slice(0, 1);
            if (event.target.value && index < otpInputs.length - 1) {
                otpInputs[index + 1].focus();
            }
        });

        input.addEventListener("keydown", (event) => {
            if (event.key === "Backspace" && !event.target.value && index > 0) {
                otpInputs[index - 1].focus();
            }
        });
    });
}

document.addEventListener("DOMContentLoaded", () => {
    checkExistingSession();

    setOtpInputsDisabled(false);
    document.getElementById("login-form").addEventListener("submit", handleLogin);
    document.getElementById("signup-form").addEventListener("submit", handleSignup);
    document.getElementById("forgot-form").addEventListener("submit", handleForgotPassword);
    setupOtpInputBehavior();
});

async function checkExistingSession() {
    try {
        const response = await fetch(`${API_BASE}/api/users/me`, {
            method: "GET",
            credentials: "include",
        });
        if (response.ok) {
            window.location.href = "Home.html";
            return true;
        }
    } catch (_error) {
        // Ignore network errors; user will log in.
    }
    return false;
}

window.handleVerify = handleVerify;
window.handleResendSignupCode = handleResendSignupCode;
window.handleForgotCodeRequest = handleForgotCodeRequest;
