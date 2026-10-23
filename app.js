import { initializeApp } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js";
import { getAuth, onAuthStateChanged, signInWithCustomToken, signOut } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-auth.js";
import { getFunctions, httpsCallable } from "https://www.gstatic.com/firebasejs/10.14.1/firebase-functions.js";
import { firebaseConfig } from "./firebase-config.js";

const configReady = Object.values(firebaseConfig).every(
  (value) => typeof value === "string" && value.length > 0 && !value.startsWith("REPLACE_WITH_"),
);
const firebaseApp = configReady ? initializeApp(firebaseConfig) : null;
const auth = firebaseApp ? getAuth(firebaseApp) : null;
const functions = firebaseApp ? getFunctions(firebaseApp) : null;
const coachLoginEmail = "coach@formfield.local";
const app = document.querySelector("#app");

const icons = {
  dashboard: "⌂",
  students: "♙",
  attendance: "◷",
  complaints: "✎",
  fees: "₹",
};

const titles = {
  dashboard: "Overview",
  students: "Students",
  attendance: "Attendance",
  complaints: "Complaints",
  fees: "Fees",
};

let state = { students: [], attendance: [], complaints: [] };
let session = null;
let page = "dashboard";
let loginRole = "coach";
let selectedDate = localDate();
let searchTerm = "";

async function callBackend(name, payload = {}) {
  const response = await httpsCallable(functions, name)(payload);
  return response.data;
}

async function loadGymData() {
  const data = await callBackend("loadGymData");
  state = {
    students: Array.isArray(data.students) ? data.students : [],
    attendance: Array.isArray(data.attendance) ? data.attendance : [],
    complaints: Array.isArray(data.complaints) ? data.complaints : [],
  };
}

async function saveState() {
  await callBackend("saveGymData", state);
}

async function persistChanges(message) {
  try {
    await saveState();
    render();
    showToast(message);
  } catch (error) {
    console.error("Could not save gym changes.", error);
    showToast(`Changes were not saved: ${error.message || "Please try again."}`);
    try {
      await loadGymData();
      render();
    } catch (reloadError) {
      console.error("Could not reload gym data after a save failure.", reloadError);
      showToast(`Could not reload gym data: ${reloadError.message || "Check your connection."}`);
    }
  }
}

function localDate(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function escapeHtml(value = "") {
  return String(value).replace(/[&<>"']/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  })[character]);
}

function initials(name = "") {
  return name.trim().split(/\s+/).slice(0, 2).map((part) => part[0] || "").join("").toUpperCase() || "?";
}

function money(value) {
  return new Intl.NumberFormat("en-IN", {
    style: "currency", currency: "INR", maximumFractionDigits: 0,
  }).format(Number(value) || 0);
}

function formattedDate(date) {
  if (!date) return "—";
  return new Date(`${date}T00:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", year: "numeric" });
}

function getStudent(id) {
  return state.students.find((student) => student.id === id);
}

function todayAttendance(studentId, date = selectedDate) {
  return state.attendance.find((record) => record.studentId === studentId && record.date === date);
}

function statusBadge(status) {
  if (status === "paid") return '<span class="badge badge-paid">Paid</span>';
  if (status === "unpaid") return '<span class="badge badge-unpaid">Unpaid</span>';
  if (status === "present") return '<span class="badge badge-present">Present</span>';
  if (status === "absent") return '<span class="badge badge-absent">Absent</span>';
  return '<span class="badge badge-pending">Not marked</span>';
}

function render() {
  if (!configReady) {
    renderSetupRequired();
    return;
  }
  if (!session) {
    renderLogin();
    return;
  }
  if (session.role === "student") {
    renderStudent();
    return;
  }
  renderCoach();
}

function renderSetupRequired() {
  app.innerHTML = `<main class="login-page"><section class="login-art"><div class="brand"><div class="brand-mark">F</div><div class="brand-name">form &amp; field<span class="brand-sub">gym management</span></div></div><div class="login-message"><p class="login-kicker">Almost ready</p><h1>Your gym,<br><span>all in sync.</span></h1><p>Connect your Firebase project to enable secure accounts and shared records.</p></div><div class="art-footer">Your gym data will be stored in your Firebase project.</div></section><section class="login-side"><div class="login-card"><p class="eyebrow">One-time setup</p><h2>Connect Firebase</h2><p>This app is configured for real multi-device sign-in and storage. Add your Firebase Web app settings before deploying.</p><div class="login-hint">Open <b>firebase-config.js</b>, replace the <b>REPLACE_WITH_…</b> values with your Firebase Web app configuration, then deploy using the steps in <b>README.md</b>.</div></div></section></main>`;
}

function renderLogin() {
  app.innerHTML = `
    <main class="login-page">
      <section class="login-art">
        <div class="brand">
          <div class="brand-mark">F</div>
          <div class="brand-name">form &amp; field<span class="brand-sub">gym management</span></div>
        </div>
        <div class="login-message">
          <p class="login-kicker">A stronger studio starts here</p>
          <h1>Less admin.<br><span>More progress.</span></h1>
          <p>Everything your gym needs to keep people moving — all in one place.</p>
        </div>
        <div class="art-footer">A little more consistency, every day.</div>
      </section>
      <section class="login-side">
        <div class="login-card">
          <p class="eyebrow">Welcome to Form &amp; Field</p>
          <h2>Sign in to your gym</h2>
          <p>Use your coach or student account to continue.</p>
          <div class="role-toggle" role="tablist" aria-label="Choose account type">
            <button class="role-option ${loginRole === "coach" ? "active" : ""}" data-action="set-role" data-role="coach" role="tab" aria-selected="${loginRole === "coach"}">Coach</button>
            <button class="role-option ${loginRole === "student" ? "active" : ""}" data-action="set-role" data-role="student" role="tab" aria-selected="${loginRole === "student"}">Student</button>
          </div>
          <form class="login-form" id="login-form">
            <label>
              <span class="field-label">${loginRole === "coach" ? "Username" : "Student name"}</span>
              <input class="field" name="username" autocomplete="username" placeholder="${loginRole === "coach" ? "coach" : "Your name"}" required>
            </label>
            <label>
              <span class="field-label">Password</span>
              <input class="field" name="password" type="password" autocomplete="current-password" placeholder="Enter your password" required>
            </label>
            <p class="login-error" id="login-error" aria-live="polite"></p>
            <button class="button" type="submit">Sign in <span aria-hidden="true">→</span></button>
          </form>
          <div class="login-hint">${loginRole === "coach"
            ? "<strong>Coach sign-in:</strong> username <b>coach</b>, password <b>123</b> for the initial account."
            : "<strong>Student sign-in:</strong> use the name your coach entered and your account password (<b>123</b> when first added)."}</div>
        </div>
      </section>
    </main>`;
}

function renderCoach() {
  const nav = Object.keys(titles).map((key) => `
    <button class="nav-item ${page === key ? "active" : ""}" data-action="navigate" data-page="${key}">
      <span class="nav-icon" aria-hidden="true">${icons[key]}</span>${titles[key]}
    </button>`).join("");
  app.innerHTML = `
    <div class="app-shell">
      <aside class="sidebar">
        <div class="brand"><div class="brand-mark">F</div><div class="brand-name">form &amp; field<span class="brand-sub">gym management</span></div></div>
        <p class="nav-label">Workspace</p>
        <nav class="nav-list" aria-label="Main navigation">${nav}</nav>
        <div class="sidebar-bottom">
          <div class="coach-card"><strong>Coach workspace</strong>Student records and notes are saved on this device.</div>
          <button class="nav-item logout-button" data-action="logout"><span class="nav-icon">↪</span>Sign out</button>
        </div>
      </aside>
      <main class="main-area">
        <header class="topbar">
          <div><p class="eyebrow">Form &amp; Field / ${escapeHtml(titles[page])}</p><h1>${escapeHtml(titles[page])}</h1></div>
          <div class="profile-chip"><div class="avatar">C</div><div><div class="profile-name">Coach</div><div class="profile-role">Administrator</div></div></div>
        </header>
        <div class="content">${coachPageContent()}</div>
      </main>
    </div>
    <div id="modal-root"></div>`;
}

function coachPageContent() {
  if (page === "dashboard") return dashboardPage();
  if (page === "students") return studentsPage();
  if (page === "attendance") return attendancePage();
  if (page === "complaints") return complaintsPage();
  return feesPage();
}

function welcome(title, description, action = "") {
  return `<div class="welcome-row"><div><h2>${title}</h2><p>${description}</p></div>${action}</div>`;
}

function dashboardPage() {
  const paid = state.students.filter((student) => student.feesPaid).reduce((sum, student) => sum + Number(student.monthlyFee || 0), 0);
  const outstanding = state.students.filter((student) => !student.feesPaid).reduce((sum, student) => sum + Number(student.monthlyFee || 0), 0);
  const present = state.students.filter((student) => todayAttendance(student.id, localDate())?.status === "present").length;
  const recentStudents = [...state.students].slice(-5).reverse();
  return `
    ${welcome("Your gym, at a glance.", "A little progress each day adds up. Here’s where things stand today.", '<button class="button" data-action="open-student">＋ Add student</button>')}
    <section class="stats-grid" aria-label="Gym summary">
      <article class="stat-card"><div class="stat-top"><span>Total students</span><span class="stat-icon">♙</span></div><div class="stat-value">${state.students.length}</div><div class="stat-note">Active members on your roster</div></article>
      <article class="stat-card"><div class="stat-top"><span>Present today</span><span class="stat-icon">◷</span></div><div class="stat-value">${present}<span style="font-size:13px;color:#89928a"> / ${state.students.length}</span></div><div class="stat-note">Attendance marked for today</div></article>
      <article class="stat-card"><div class="stat-top"><span>Fees collected</span><span class="stat-icon">₹</span></div><div class="stat-value">${money(paid)}</div><div class="stat-note">Paid monthly fees</div></article>
      <article class="stat-card"><div class="stat-top"><span>Fees outstanding</span><span class="stat-icon">↗</span></div><div class="stat-value">${money(outstanding)}</div><div class="stat-note">Unpaid monthly fees</div></article>
    </section>
    <div class="dashboard-grid">
      <section class="panel">
        <div class="panel-head"><div><h3>Student roster</h3><p>Your latest student records</p></div><button class="text-link" data-action="navigate" data-page="students">View all →</button></div>
        <div class="panel-body">${recentStudents.length ? studentTable(recentStudents, false) : emptyState("Your roster starts here", "Add a student to keep their contact details, attendance, and fees together.", "open-student", "＋ Add first student")}</div>
      </section>
      <section class="panel">
        <div class="panel-head"><div><h3>Today’s check-in</h3><p>${formattedDate(localDate())}</p></div><button class="text-link" data-action="navigate" data-page="attendance">Attendance →</button></div>
        <div class="panel-body">${state.students.length ? `<div class="quick-list">${state.students.slice(0, 5).map((student) => `<div class="quick-row"><div><strong>${escapeHtml(student.name)}</strong><span>${escapeHtml(student.email)}</span></div>${statusBadge(todayAttendance(student.id, localDate())?.status)}</div>`).join("")}</div>` : emptyState("No check-ins yet", "Add your students and mark attendance from the attendance page.")}</div>
      </section>
    </div>`;
}

function emptyState(title, description, action = "", actionLabel = "") {
  return `<div class="empty-state"><div class="empty-icon">✦</div><h3>${escapeHtml(title)}</h3><p>${escapeHtml(description)}</p>${action ? `<button class="button button-small" style="margin-top:14px" data-action="${action}">${escapeHtml(actionLabel)}</button>` : ""}</div>`;
}

function studentTable(students, withActions = true) {
  return `<div class="table-wrap"><table><thead><tr><th>Student</th><th>Phone</th><th>Monthly fee</th><th>Payment</th>${withActions ? "<th>Actions</th>" : ""}</tr></thead><tbody>
    ${students.map((student) => `<tr>
      <td><div class="person-cell"><span class="mini-avatar">${escapeHtml(initials(student.name))}</span><div><div class="person-name">${escapeHtml(student.name)}</div><div class="person-detail">${escapeHtml(student.email)}</div></div></div></td>
      <td>${escapeHtml(student.phone || "—")}</td><td>${money(student.monthlyFee)}</td><td>${statusBadge(student.feesPaid ? "paid" : "unpaid")}</td>
      ${withActions ? `<td><div style="display:flex;gap:6px"><button class="button button-light button-small" data-action="edit-student" data-id="${escapeHtml(student.id)}">Edit</button><button class="button button-danger button-small" data-action="delete-student" data-id="${escapeHtml(student.id)}" aria-label="Delete ${escapeHtml(student.name)}">Delete</button></div></td>` : ""}
    </tr>`).join("")}
  </tbody></table></div>`;
}

function studentsPage() {
  const query = searchTerm.trim().toLowerCase();
  const filtered = state.students.filter((student) => `${student.name} ${student.email} ${student.phone}`.toLowerCase().includes(query));
  return `${welcome("People make the gym.", "Manage student details, phone numbers, and monthly membership fees.", '<button class="button" data-action="open-student">＋ Add student</button>')}
    <section class="panel"><div class="panel-body">
      <div class="section-toolbar"><input class="search-input" id="student-search" value="${escapeHtml(searchTerm)}" placeholder="Search students by name, email, or phone" aria-label="Search students"><span class="badge badge-pending">${filtered.length} ${filtered.length === 1 ? "student" : "students"}</span></div>
      ${filtered.length ? studentTable(filtered) : emptyState(query ? "No matching students" : "No students added yet", query ? "Try a different name, email, or phone number." : "Add your first student to start managing your gym roster.", query ? "" : "open-student", query ? "" : "＋ Add student")}
    </div></section>`;
}

function attendancePage() {
  const records = state.students.map((student) => {
    const attendance = todayAttendance(student.id, selectedDate);
    return `<tr><td><div class="person-cell"><span class="mini-avatar">${escapeHtml(initials(student.name))}</span><div><div class="person-name">${escapeHtml(student.name)}</div><div class="person-detail">${escapeHtml(student.email)}</div></div></div></td>
      <td>${statusBadge(attendance?.status)}</td><td><div style="display:flex;gap:6px"><button class="button button-small ${attendance?.status === "present" ? "" : "button-light"}" data-action="mark-attendance" data-id="${escapeHtml(student.id)}" data-status="present">Present</button><button class="button button-small ${attendance?.status === "absent" ? "button-danger" : "button-light"}" data-action="mark-attendance" data-id="${escapeHtml(student.id)}" data-status="absent">Absent</button></div></td></tr>`;
  }).join("");
  return `${welcome("Every session counts.", "Mark each student present or absent. Attendance is saved by date.", "")}
    <section class="panel"><div class="panel-head"><div><h3>Daily attendance</h3><p>${formattedDate(selectedDate)}</p></div><button class="button button-light button-small" data-action="mark-all-present" ${state.students.length ? "" : "disabled"}>Mark all present</button></div>
    <div class="panel-body"><div class="section-toolbar" style="justify-content:space-between"><label style="display:flex;align-items:center;gap:9px;font-size:11px;font-weight:700">Attendance date <input class="field" id="attendance-date" type="date" value="${escapeHtml(selectedDate)}" style="width:auto"></label><span class="badge badge-pending">${state.students.length} students</span></div>
      ${state.students.length ? `<div class="table-wrap"><table><thead><tr><th>Student</th><th>Status</th><th>Update attendance</th></tr></thead><tbody>${records}</tbody></table></div>` : emptyState("Your roster is empty", "Add students before marking attendance.", "open-student", "＋ Add student")}
    </div></section>`;
}

function complaintsPage() {
  const list = [...state.complaints].reverse();
  const studentOptions = state.students.map((student) => `<option value="${escapeHtml(student.email)}">${escapeHtml(student.name)}</option>`).join("");
  return `${welcome("A private note, just for them.", "Write a concern or a follow-up for one student. Only that student can see their notes.", "")}
    <div class="dashboard-grid">
      <section class="panel"><div class="panel-head"><div><h3>Write a student note</h3><p>Notes are linked to the selected student’s email address.</p></div></div>
        <div class="panel-body">${state.students.length ? `<form id="complaint-form" class="form-grid">
          <div class="form-field full"><label class="field-label" for="complaint-email">Student email address</label><input class="field" id="complaint-email" name="email" type="email" list="student-emails" placeholder="Type the student's email address" required><datalist id="student-emails">${studentOptions}</datalist></div>
          <div class="form-field full"><label class="field-label" for="complaint-text">Complaint or note</label><textarea class="field" id="complaint-text" name="text" maxlength="2000" placeholder="Write a respectful note or concern for this student..." required></textarea></div>
          <div class="form-field full"><button class="button" type="submit">Save private note</button></div>
        </form>` : emptyState("Add a student first", "A note is always attached to a specific student and their email.", "open-student", "＋ Add student")}</div>
      </section>
      <section class="panel"><div class="panel-head"><div><h3>Recent notes</h3><p>Visible to the named student only</p></div><span class="badge badge-pending">${list.length}</span></div>
        <div class="panel-body">${list.length ? list.map((item) => { const student = getStudent(item.studentId); return `<article class="complaint-card"><div class="complaint-top"><div><strong>${escapeHtml(student?.name || "Student removed")}</strong><div class="person-detail">${escapeHtml(student?.email || "")}</div></div><div style="text-align:right"><div class="complaint-date">${formattedDate(item.createdAt)}</div><button class="text-link" style="margin-top:6px;color:#a23c31" data-action="delete-complaint" data-id="${escapeHtml(item.id)}">Delete</button></div></div><p class="complaint-text">${escapeHtml(item.text)}</p></article>`; }).join("") : emptyState("No notes yet", "Notes you write for a student will appear here.")}</div>
      </section>
    </div>`;
}

function feesPage() {
  const total = state.students.reduce((sum, student) => sum + Number(student.monthlyFee || 0), 0);
  const paid = state.students.filter((student) => student.feesPaid).reduce((sum, student) => sum + Number(student.monthlyFee || 0), 0);
  const outstanding = total - paid;
  return `${welcome("Keep fees clear.", "Track monthly membership fees and mark payments as they come in.", "")}
    <section class="stats-grid">
      <article class="stat-card"><div class="stat-top"><span>Monthly total</span><span class="stat-icon">₹</span></div><div class="stat-value">${money(total)}</div><div class="stat-note">Across all students</div></article>
      <article class="stat-card"><div class="stat-top"><span>Collected</span><span class="stat-icon">✓</span></div><div class="stat-value">${money(paid)}</div><div class="stat-note">Fees marked as paid</div></article>
      <article class="stat-card"><div class="stat-top"><span>Outstanding</span><span class="stat-icon">↗</span></div><div class="stat-value">${money(outstanding)}</div><div class="stat-note">Fees still due</div></article>
      <article class="stat-card"><div class="stat-top"><span>Unpaid students</span><span class="stat-icon">♙</span></div><div class="stat-value">${state.students.filter((student) => !student.feesPaid).length}</div><div class="stat-note">Membership payments pending</div></article>
    </section>
    <section class="panel"><div class="panel-head"><div><h3>Membership payments</h3><p>Use the payment button to update each student's fee status.</p></div></div>
      <div class="panel-body">${state.students.length ? `<div class="table-wrap"><table><thead><tr><th>Student</th><th>Monthly fee</th><th>Status</th><th>Update payment</th></tr></thead><tbody>${state.students.map((student) => `<tr><td><div class="person-cell"><span class="mini-avatar">${escapeHtml(initials(student.name))}</span><div><div class="person-name">${escapeHtml(student.name)}</div><div class="person-detail">${escapeHtml(student.email)}</div></div></div></td><td>${money(student.monthlyFee)}</td><td>${statusBadge(student.feesPaid ? "paid" : "unpaid")}</td><td><button class="button button-small ${student.feesPaid ? "button-light" : ""}" data-action="toggle-fee" data-id="${escapeHtml(student.id)}">${student.feesPaid ? "Mark unpaid" : "Mark paid"}</button></td></tr>`).join("")}</tbody></table></div>` : emptyState("No student fees yet", "Add students and set their monthly fees to start tracking payments.", "open-student", "＋ Add student")}</div>
    </section>`;
}

function renderStudent() {
  const student = getStudent(session.studentId);
  if (!student) {
    session = null;
    renderLogin();
    return;
  }
  const records = state.attendance.filter((item) => item.studentId === student.id).sort((a, b) => b.date.localeCompare(a.date));
  const presentCount = records.filter((item) => item.status === "present").length;
  const complaints = state.complaints.filter((item) => item.studentId === student.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  app.innerHTML = `
    <div class="app-shell">
      <main class="main-area" style="margin-left:0">
        <header class="topbar"><div><p class="eyebrow">Form &amp; Field / Student portal</p><h1>Your progress</h1></div><div class="profile-chip"><div class="avatar">${escapeHtml(initials(student.name))}</div><div><div class="profile-name">${escapeHtml(student.name)}</div><div class="profile-role">Student</div></div><button class="button button-light button-small" data-action="logout" style="margin-left:8px">Sign out</button></div></header>
        <div class="content">
          <section class="student-hero"><div class="avatar">${escapeHtml(initials(student.name))}</div><div><h2>Good to see you, ${escapeHtml(student.name.split(/\s+/)[0])}.</h2><p>${escapeHtml(student.email)}${student.phone ? ` · ${escapeHtml(student.phone)}` : ""}</p></div></section>
          <div class="stats-grid" style="margin-top:17px">
            <article class="stat-card"><div class="stat-top"><span>Sessions attended</span><span class="stat-icon">◷</span></div><div class="stat-value">${presentCount}</div><div class="stat-note">Attendance marked present</div></article>
            <article class="stat-card"><div class="stat-top"><span>Monthly fee</span><span class="stat-icon">₹</span></div><div class="stat-value">${money(student.monthlyFee)}</div><div class="stat-note">Your membership fee</div></article>
            <article class="stat-card"><div class="stat-top"><span>Payment status</span><span class="stat-icon">✓</span></div><div class="stat-value" style="font-size:20px">${student.feesPaid ? "Paid" : "Unpaid"}</div><div class="stat-note">${student.feesPaid ? "Your fee is up to date" : "Please contact your coach"}</div></article>
            <article class="stat-card"><div class="stat-top"><span>Attendance records</span><span class="stat-icon">▤</span></div><div class="stat-value">${records.length}</div><div class="stat-note">Total sessions recorded</div></article>
          </div>
          <div class="student-layout">
            <section class="panel"><div class="panel-head"><div><h3>Notes from your coach</h3><p>Private notes addressed to you</p></div><span class="badge badge-pending">${complaints.length}</span></div>
              <div class="panel-body">${complaints.length ? `<p class="notice">These notes are private to your student account and are not shown to other students.</p>${complaints.map((item) => `<article class="complaint-card"><div class="complaint-top"><strong>Coach note</strong><span class="complaint-date">${formattedDate(item.createdAt)}</span></div><p class="complaint-text">${escapeHtml(item.text)}</p></article>`).join("")}` : emptyState("All caught up", "Your coach has not left any notes for you.")}</div>
            </section>
            <section class="panel"><div class="panel-head"><div><h3>Attendance history</h3><p>Your recent check-ins</p></div></div><div class="panel-body">${records.length ? `<div class="table-wrap"><table><thead><tr><th>Date</th><th>Status</th></tr></thead><tbody>${records.slice(0, 12).map((record) => `<tr><td>${formattedDate(record.date)}</td><td>${statusBadge(record.status)}</td></tr>`).join("")}</tbody></table></div>` : emptyState("No attendance yet", "Your attendance will show here after your coach records a session.")}</div></section>
            <section class="panel"><div class="panel-head"><div><h3>Account security</h3><p>Change your initial password</p></div></div><div class="panel-body"><form id="password-form" class="form-grid"><div class="form-field full"><label class="field-label" for="current-password">Current password</label><input class="field" id="current-password" name="currentPassword" type="password" autocomplete="current-password" required></div><div class="form-field full"><label class="field-label" for="new-password">New password</label><input class="field" id="new-password" name="newPassword" type="password" autocomplete="new-password" minlength="6" maxlength="128" required><span class="person-detail">Use at least 6 characters.</span></div><div class="form-field full"><button class="button" type="submit">Change password</button></div></form></div></section>
          </div>
        </div>
      </main>
    </div>`;
}

function openStudentModal(student = null) {
  const modalRoot = document.querySelector("#modal-root");
  if (!modalRoot) return;
  const editing = Boolean(student);
  modalRoot.innerHTML = `<div class="modal-backdrop" data-action="close-modal">
    <section class="modal" role="dialog" aria-modal="true" aria-labelledby="student-modal-title">
      <div class="modal-head"><h2 id="student-modal-title">${editing ? "Edit student" : "Add a student"}</h2><button class="close-button" data-action="close-modal" aria-label="Close">×</button></div>
      <form class="modal-form" id="student-form" data-id="${editing ? escapeHtml(student.id) : ""}">
        <div class="form-grid">
          <div class="form-field"><label class="field-label" for="student-name">Full name</label><input class="field" id="student-name" name="name" required maxlength="80" value="${escapeHtml(student?.name || "")}" placeholder="e.g. Asha Patel"></div>
          <div class="form-field"><label class="field-label" for="student-email">Email address</label><input class="field" id="student-email" name="email" type="email" required maxlength="160" value="${escapeHtml(student?.email || "")}" placeholder="asha@example.com"></div>
          <div class="form-field"><label class="field-label" for="student-phone">Phone number</label><input class="field" id="student-phone" name="phone" type="tel" maxlength="25" value="${escapeHtml(student?.phone || "")}" placeholder="+91 98765 43210"></div>
          <div class="form-field"><label class="field-label" for="student-fee">Monthly fee (₹)</label><input class="field" id="student-fee" name="monthlyFee" type="number" min="0" step="1" required value="${escapeHtml(student?.monthlyFee ?? "")}" placeholder="e.g. 1500"></div>
          <div class="form-field full"><label style="display:flex;align-items:center;gap:9px;font-size:11px;font-weight:600"><input name="feesPaid" type="checkbox" ${student?.feesPaid ? "checked" : ""}> This month's fee has been paid</label></div>
        </div>
        <div class="modal-actions"><button class="button button-light" type="button" data-action="close-modal">Cancel</button><button class="button" type="submit">${editing ? "Save changes" : "Add student"}</button></div>
      </form>
    </section></div>`;
  modalRoot.querySelector("#student-name").focus();
}

function showToast(message) {
  document.querySelector(".toast")?.remove();
  const toast = document.createElement("div");
  toast.className = "toast";
  toast.setAttribute("role", "status");
  toast.textContent = message;
  document.body.append(toast);
  window.setTimeout(() => toast.remove(), 2600);
}

document.addEventListener("click", async (event) => {
  const button = event.target.closest("[data-action]");
  if (!button) {
    if (event.target.classList.contains("modal-backdrop")) document.querySelector("#modal-root").innerHTML = "";
    return;
  }
  const action = button.dataset.action;
  if (action === "set-role") {
    loginRole = button.dataset.role;
    renderLogin();
  } else if (action === "navigate") {
    page = button.dataset.page;
    searchTerm = "";
    render();
  } else if (action === "logout") {
    loginRole = "coach";
    try {
      await signOut(auth);
    } catch (error) {
      console.error("Could not sign out.", error);
      showToast(`Could not sign out: ${error.message}`);
    }
  } else if (action === "open-student") {
    openStudentModal();
  } else if (action === "close-modal") {
    document.querySelector("#modal-root").innerHTML = "";
  } else if (action === "edit-student") {
    openStudentModal(getStudent(button.dataset.id));
  } else if (action === "delete-student") {
    const student = getStudent(button.dataset.id);
    if (!student || !window.confirm(`Delete ${student.name} and their attendance and notes?`)) return;
    state.students = state.students.filter((item) => item.id !== student.id);
    state.attendance = state.attendance.filter((item) => item.studentId !== student.id);
    state.complaints = state.complaints.filter((item) => item.studentId !== student.id);
    await persistChanges("Student and related records deleted.");
  } else if (action === "mark-attendance") {
    await setAttendance(button.dataset.id, selectedDate, button.dataset.status);
  } else if (action === "mark-all-present") {
    state.students.forEach((student) => setAttendance(student.id, selectedDate, "present", false));
    await persistChanges(`All students marked present for ${formattedDate(selectedDate)}.`);
  } else if (action === "toggle-fee") {
    const student = getStudent(button.dataset.id);
    if (!student) return;
    student.feesPaid = !student.feesPaid;
    await persistChanges(`${student.name}'s fee marked ${student.feesPaid ? "paid" : "unpaid"}.`);
  } else if (action === "delete-complaint") {
    state.complaints = state.complaints.filter((item) => item.id !== button.dataset.id);
    await persistChanges("Note deleted.");
  }
});

async function setAttendance(studentId, date, status, persist = true) {
  const existing = state.attendance.find((item) => item.studentId === studentId && item.date === date);
  if (existing) existing.status = status;
  else state.attendance.push({ studentId, date, status });
  if (persist) {
    await persistChanges(`Attendance marked ${status}.`);
  }
}

document.addEventListener("submit", async (event) => {
  const form = event.target;
  if (!form.matches("form")) return;
  event.preventDefault();
  const data = new FormData(form);
  if (form.id === "login-form") {
    const username = String(data.get("username") || "").trim();
    const password = String(data.get("password") || "");
    if ((loginRole === "coach" && username.toLowerCase() !== "coach") || !username) {
      document.querySelector("#login-error").textContent = "Enter the correct username for this account.";
      return;
    }
    try {
      const result = await callBackend("authenticateLogin", {
        username: loginRole === "coach" ? "coach" : username,
        password,
        role: loginRole,
      });
      await signInWithCustomToken(auth, result.token);
      document.querySelector("#login-error").textContent = "";
    } catch (error) {
      console.error("Sign-in failed.", error);
      document.querySelector("#login-error").textContent =
        error.code === "functions/unauthenticated" || error.code === "auth/invalid-credential" || error.code === "auth/user-not-found" || error.code === "auth/wrong-password"
          ? "The username or password is incorrect. Ask your coach to check your account."
          : `Could not sign in: ${error.message}`;
    }
    return;
  }
  if (form.id === "student-form") {
    const id = form.dataset.id;
    const email = String(data.get("email") || "").trim().toLowerCase();
    const duplicate = state.students.find((student) => student.email.toLowerCase() === email && student.id !== id);
    if (duplicate) {
      window.alert("That email address is already linked to another student. Each student needs a unique email.");
      return;
    }
    const studentData = {
      name: String(data.get("name") || "").trim(),
      email,
      phone: String(data.get("phone") || "").trim(),
      monthlyFee: Number(data.get("monthlyFee")),
      feesPaid: data.get("feesPaid") === "on",
    };
    if (id) Object.assign(getStudent(id), studentData);
    else state.students.push({ id: crypto.randomUUID(), ...studentData });
    try {
      await saveState();
    } catch (error) {
      console.error("Could not save student details.", error);
      showToast(`Student details were not saved: ${error.message || "Please try again."}`);
      try {
        await loadGymData();
        render();
      } catch (reloadError) {
        console.error("Could not reload student details after a save failure.", reloadError);
        showToast(`Could not reload gym data: ${reloadError.message || "Check your connection."}`);
      }
      return;
    }
    document.querySelector("#modal-root").innerHTML = "";
    render();
    showToast(id ? "Student details updated." : "Student added. Their initial password is 123.");
    return;
  }
  if (form.id === "complaint-form") {
    const email = String(data.get("email") || "").trim().toLowerCase();
    const student = state.students.find((item) => item.email.toLowerCase() === email);
    const text = String(data.get("text") || "").trim();
    if (!student) {
      window.alert("No student is linked to that email address. Check the email and try again.");
      return;
    }
    if (!text) return;
    state.complaints.push({ id: crypto.randomUUID(), studentId: student.id, text, createdAt: localDate() });
    await persistChanges(`Private note saved for ${student.name}.`);
    return;
  }
  if (form.id === "password-form") {
    try {
      await callBackend("changeStudentPassword", {
        currentPassword: String(data.get("currentPassword") || ""),
        newPassword: String(data.get("newPassword") || ""),
      });
      form.reset();
      showToast("Your password has been changed.");
    } catch (error) {
      console.error("Could not change student password.", error);
      showToast(`Password was not changed: ${error.message || "Please try again."}`);
    }
  }
});

document.addEventListener("change", (event) => {
  if (event.target.id === "attendance-date" && event.target.value) {
    selectedDate = event.target.value;
    render();
  }
});

document.addEventListener("input", (event) => {
  if (event.target.id === "student-search") {
    const cursor = event.target.selectionStart;
    searchTerm = event.target.value;
    render();
    const input = document.querySelector("#student-search");
    input.focus();
    input.setSelectionRange(cursor, cursor);
  }
});

document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && document.querySelector("#modal-root")) document.querySelector("#modal-root").innerHTML = "";
});

window.addEventListener("focus", async () => {
  if (!auth?.currentUser) return;
  try {
    await loadGymData();
    render();
  } catch (error) {
    console.error("Could not refresh gym data.", error);
    showToast(`Could not refresh gym data: ${error.message}`);
  }
});

if (configReady) {
  render();
  onAuthStateChanged(auth, async (user) => {
    if (!user) {
      session = null;
      state = { students: [], attendance: [], complaints: [] };
      render();
      return;
    }
    session = user.email?.toLowerCase() === coachLoginEmail
      ? { role: "coach" }
      : { role: "student", studentId: user.uid };
    try {
      await loadGymData();
      page = "dashboard";
      render();
    } catch (error) {
      console.error("Could not load account data.", error);
      showToast(`Could not load account data: ${error.message}`);
      try {
        await signOut(auth);
      } catch (signOutError) {
        console.error("Could not end the invalid session.", signOutError);
        showToast(`Could not end the invalid session: ${signOutError.message}`);
      }
    }
  });
} else {
  renderSetupRequired();
}
