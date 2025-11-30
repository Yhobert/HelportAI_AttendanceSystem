const authModal = document.getElementById("authModal");
const authTitle = document.getElementById("authTitle");
const authAction = document.getElementById("authAction");
const switchMode = document.getElementById("switchMode");
const usernameInput = document.getElementById("username");
const passwordInput = document.getElementById("password");
const toggleAuth = document.getElementById("toggleAuth");

let mode = "login";
let currentUser = null;

const USERS_KEY = "helportai_users";
const SESSION_KEY = "helportai_session";

function getUsers() {
  return JSON.parse(localStorage.getItem(USERS_KEY) || "[]");
}
function saveUsers(users) {
  localStorage.setItem(USERS_KEY, JSON.stringify(users));
}
function hash(str) {
  return btoa(str);
}

const roleSelect = document.createElement("select");
roleSelect.id = "roleSelect";
roleSelect.innerHTML = `
  <option value="user">User</option>
  <option value="admin">Admin</option>
`;
roleSelect.style.display = "none";
roleSelect.style.margin = "10px 0";
roleSelect.style.padding = "8px";
roleSelect.style.borderRadius = "8px";
roleSelect.style.background = "rgba(255,255,255,0.05)";
roleSelect.style.color = "white";
roleSelect.style.border = "1px solid rgba(255,255,255,0.1)";
authModal.querySelector(".auth-box").insertBefore(roleSelect, authAction);

switchMode.addEventListener("click", e => {
  e.preventDefault();
  if (mode === "login") {
    mode = "signup";
    authTitle.textContent = "Sign Up";
    authAction.textContent = "Sign Up";
    roleSelect.style.display = "block";
    toggleAuth.innerHTML = `Have an account? <a href="#" id="switchMode">Login</a>`;
  } else {
    mode = "login";
    authTitle.textContent = "Login";
    authAction.textContent = "Login";
    roleSelect.style.display = "none";
    toggleAuth.innerHTML = `No account? <a href="#" id="switchMode">Sign up</a>`;
  }
  document.getElementById("switchMode").addEventListener("click", switchMode.click);
});

authAction.addEventListener("click", () => {
  const username = usernameInput.value.trim();
  const password = passwordInput.value.trim();
  const role = roleSelect.value;

  if (!username || !password) {
    alert("Please fill out all fields.");
    return;
  }

  const users = getUsers();

  if (mode === "signup") {
    if (users.find(u => u.username === username)) {
      alert("Username already exists!");
      return;
    }
    users.push({ username, password: hash(password), role });
    saveUsers(users);
    alert("Sign up successful! Please log in.");
    mode = "login";
    authTitle.textContent = "Login";
    authAction.textContent = "Login";
    roleSelect.style.display = "none";
    toggleAuth.innerHTML = `No account? <a href="#" id="switchMode">Sign up</a>`;
  } else {
    const user = users.find(u => u.username === username && u.password === hash(password));
    if (!user) {
      alert("Invalid credentials!");
      return;
    }
    currentUser = user;
    localStorage.setItem(SESSION_KEY, JSON.stringify(user));
    authModal.classList.add("hidden");
    applyRoleUI(user.role);
  }
});

window.addEventListener("load", () => {
  const session = localStorage.getItem(SESSION_KEY);
  if (session) {
    currentUser = JSON.parse(session);
    authModal.classList.add("hidden");
    applyRoleUI(currentUser.role);
  } else {
    authModal.classList.remove("hidden");
  }
});

function applyRoleUI(role) {
  const exportBtn = document.getElementById("exportCsv");
  const clearBtn = document.getElementById("clearLog");

  if (exportBtn) {
    exportBtn.style.display = role === "admin" ? "inline-block" : "none";
  }
  if (clearBtn) {
    clearBtn.style.display = role === "admin" ? "inline-block" : "none";
  }
  showUserInfo(role);
}

function showUserInfo(role) {
  const header = document.querySelector("header");
  let info = document.getElementById("userInfo");
  if (!info) {
    info = document.createElement("div");
    info.id = "userInfo";
    info.style.marginLeft = "auto";
    info.style.display = "flex";
    info.style.alignItems = "center";
    info.style.gap = "10px";

    const name = document.createElement("span");
    name.id = "userName";
    name.style.fontSize = "14px";
    name.style.color = "#9aa4b2";

    const logoutBtn = document.createElement("button");
    logoutBtn.textContent = "Logout";
    logoutBtn.classList.add("primary");
    logoutBtn.addEventListener("click", () => {
      localStorage.removeItem(SESSION_KEY);
      location.reload();
    });

    info.appendChild(name);
    info.appendChild(logoutBtn);
    header.appendChild(info);
  }

  document.getElementById("userName").textContent =
    `${currentUser.username} (${role})`;
}
