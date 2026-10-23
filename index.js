const { initializeApp } = require("firebase-admin/app");
const { getAuth } = require("firebase-admin/auth");
const { getFirestore } = require("firebase-admin/firestore");
const { HttpsError, onCall } = require("firebase-functions/v2/https");
const { setGlobalOptions } = require("firebase-functions/v2");
const { defineSecret } = require("firebase-functions/params");
const { createHash, randomBytes, scryptSync, timingSafeEqual } = require("node:crypto");

initializeApp();
setGlobalOptions({ maxInstances: 10, region: "us-central1" });

const db = getFirestore();
const adminAuth = getAuth();
const coachPassword = defineSecret("COACH_PASSWORD");
const COACH_EMAIL = "coach@formfield.local";
const STUDENT_DOMAIN = "students.formfield.local";
const MAX_STUDENTS = 300;
const MAX_RECORDS_PER_TYPE = 5000;

function requireCoach(request) {
  if (!request.auth || request.auth.token.email?.toLowerCase() !== COACH_EMAIL) {
    throw new HttpsError("permission-denied", "Only the authenticated coach can manage gym records.");
  }
}

function loginForName(name) {
  const username = name.normalize("NFKD").replace(/[\u0300-\u036f]/g, "")
    .toLowerCase().trim().replace(/[^a-z0-9]+/g, ".").replace(/^\.+|\.+$/g, "");
  if (!username || username === "coach") {
    throw new HttpsError("invalid-argument", "Use a student name with at least one English letter or number; 'coach' is reserved.");
  }
  return `${username}@${STUDENT_DOMAIN}`;
}

function hashPassword(password, salt = randomBytes(16)) {
  const derived = scryptSync(password, salt, 64);
  return `${salt.toString("hex")}:${derived.toString("hex")}`;
}

function passwordMatches(password, storedHash) {
  const [saltHex, hashHex] = typeof storedHash === "string" ? storedHash.split(":") : [];
  if (!saltHex || !hashHex || !/^[a-f0-9]{32}$/.test(saltHex) || !/^[a-f0-9]{128}$/.test(hashHex)) return false;
  const expected = Buffer.from(hashHex, "hex");
  const actual = scryptSync(password, Buffer.from(saltHex, "hex"), expected.length);
  return timingSafeEqual(actual, expected);
}

async function limitLoginAttempts(request) {
  const ip = request.rawRequest.ip || "unknown";
  const id = createHash("sha256").update(ip).digest("hex");
  const reference = db.collection("loginAttempts").doc(id);
  const now = Date.now();
  const windowMs = 15 * 60 * 1000;
  await db.runTransaction(async (transaction) => {
    const snapshot = await transaction.get(reference);
    const current = snapshot.data();
    const activeWindow = current && now - current.windowStart < windowMs;
    const attempts = activeWindow ? current.count : 0;
    if (attempts >= 10) {
      throw new HttpsError("resource-exhausted", "Too many sign-in attempts. Try again in 15 minutes.");
    }
    transaction.set(reference, {
      count: attempts + 1,
      windowStart: activeWindow ? current.windowStart : now,
    });
  });
  return reference;
}

exports.authenticateLogin = onCall({ secrets: [coachPassword] }, async (request) => {
  const { username, password, role } = request.data || {};
  if (typeof username !== "string" || typeof password !== "string" ||
      username.trim().length < 1 || username.trim().length > 80 ||
      password.length < 1 || password.length > 128 || !["coach", "student"].includes(role)) {
    throw new HttpsError("invalid-argument", "Enter your username and password.");
  }
  const attemptReference = await limitLoginAttempts(request);
  let user;

  if (role === "coach") {
    const expected = coachPassword.value();
    const submitted = Buffer.from(password);
    const configured = Buffer.from(expected);
    const matches = username.trim().toLowerCase() === "coach" &&
      configured.length > 0 &&
      submitted.length === configured.length &&
      timingSafeEqual(submitted, configured);
    if (!matches) throw new HttpsError("unauthenticated", "The username or password is incorrect.");
    try {
      user = await adminAuth.getUserByEmail(COACH_EMAIL);
    } catch (error) {
      if (error.code !== "auth/user-not-found") throw error;
      user = await adminAuth.createUser({
        email: COACH_EMAIL,
        emailVerified: true,
        displayName: "Coach",
      });
    }
  } else {
    const loginEmail = loginForName(username);
    const snapshot = await db.collection("students").where("loginEmail", "==", loginEmail).limit(1).get();
    const student = snapshot.docs[0];
    if (!student || !passwordMatches(password, student.get("passwordHash"))) {
      throw new HttpsError("unauthenticated", "The username or password is incorrect.");
    }
    user = await adminAuth.getUser(student.id);
  }

  await attemptReference.delete();
  return { token: await adminAuth.createCustomToken(user.uid) };
});

function validateInput(data) {
  if (!data || !Array.isArray(data.students) || !Array.isArray(data.attendance) || !Array.isArray(data.complaints)) {
    throw new HttpsError("invalid-argument", "Student, attendance, and complaint lists are required.");
  }
  if (data.students.length > MAX_STUDENTS ||
      data.attendance.length > MAX_RECORDS_PER_TYPE ||
      data.complaints.length > MAX_RECORDS_PER_TYPE) {
    throw new HttpsError("resource-exhausted", "This gym has exceeded the supported record limit.");
  }

  const students = data.students.map((student) => {
    if (!student || typeof student.id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(student.id)) {
      throw new HttpsError("invalid-argument", "A student record has an invalid ID.");
    }
    const name = typeof student.name === "string" ? student.name.trim() : "";
    const email = typeof student.email === "string" ? student.email.trim().toLowerCase() : "";
    const phone = typeof student.phone === "string" ? student.phone.trim() : "";
    const monthlyFee = Number(student.monthlyFee);
    if (!name || name.length > 80 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ||
        email.length > 160 || phone.length > 25 || !Number.isFinite(monthlyFee) || monthlyFee < 0) {
      throw new HttpsError("invalid-argument", "A student has invalid name, email, phone, or fee details.");
    }
    return { id: student.id, name, email, phone, monthlyFee, feesPaid: student.feesPaid === true, loginEmail: loginForName(name) };
  });

  const ids = new Set();
  const contactEmails = new Set();
  const loginEmails = new Set();
  for (const student of students) {
    if (ids.has(student.id) || contactEmails.has(student.email) || loginEmails.has(student.loginEmail)) {
      throw new HttpsError("already-exists", "Student names and email addresses must be unique.");
    }
    ids.add(student.id);
    contactEmails.add(student.email);
    loginEmails.add(student.loginEmail);
  }

  const attendance = data.attendance.map((record) => {
    if (!record || !ids.has(record.studentId) || !/^\d{4}-\d{2}-\d{2}$/.test(record.date) ||
        !["present", "absent"].includes(record.status)) {
      throw new HttpsError("invalid-argument", "An attendance record is invalid.");
    }
    return { id: `${record.studentId}_${record.date}`, studentId: record.studentId, date: record.date, status: record.status };
  });
  const attendanceIds = new Set();
  for (const record of attendance) {
    if (attendanceIds.has(record.id)) throw new HttpsError("invalid-argument", "Duplicate attendance records were submitted.");
    attendanceIds.add(record.id);
  }

  const complaints = data.complaints.map((complaint) => {
    if (!complaint || typeof complaint.id !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(complaint.id) ||
        !ids.has(complaint.studentId) || typeof complaint.text !== "string" ||
        !complaint.text.trim() || complaint.text.length > 2000 ||
        !/^\d{4}-\d{2}-\d{2}$/.test(complaint.createdAt)) {
      throw new HttpsError("invalid-argument", "A student note is invalid.");
    }
    return {
      id: complaint.id,
      studentId: complaint.studentId,
      text: complaint.text.trim(),
      createdAt: complaint.createdAt,
    };
  });
  if (new Set(complaints.map((item) => item.id)).size !== complaints.length) {
    throw new HttpsError("invalid-argument", "Duplicate student notes were submitted.");
  }
  return { students, attendance, complaints };
}

async function readRecords(collection) {
  const snapshot = await db.collection(collection).get();
  return snapshot.docs.map((document) => ({ id: document.id, ...document.data() }));
}

async function writeCollection(collection, records) {
  const reference = db.collection(collection);
  const existing = await reference.get();
  const incomingIds = new Set(records.map((record) => record.id));
  const writes = [
    ...records.map((record) => ({ type: "set", id: record.id, data: record })),
    ...existing.docs
      .filter((document) => !incomingIds.has(document.id))
      .map((document) => ({ type: "delete", id: document.id })),
  ];
  for (let index = 0; index < writes.length; index += 400) {
    const batch = db.batch();
    for (const write of writes.slice(index, index + 400)) {
      const document = reference.doc(write.id);
      if (write.type === "delete") batch.delete(document);
      else batch.set(document, write.data);
    }
    await batch.commit();
  }
}

async function ensureStudentAccounts(students) {
  const incomingIds = new Set(students.map((student) => student.id));
  const existingStudents = await readRecords("students");
  const existingById = new Map(existingStudents.map((student) => [student.id, student]));

  for (const student of students) {
    try {
      const user = await adminAuth.getUser(student.id);
      if (user.email?.toLowerCase() !== student.loginEmail || user.displayName !== student.name) {
        await adminAuth.updateUser(student.id, {
          email: student.loginEmail,
          emailVerified: true,
          displayName: student.name,
        });
      }
    } catch (error) {
      if (error.code !== "auth/user-not-found") throw error;
      await adminAuth.createUser({
        uid: student.id,
        email: student.loginEmail,
        emailVerified: true,
        displayName: student.name,
      });
    }
  }

  for (const oldStudent of existingStudents) {
    if (incomingIds.has(oldStudent.id)) continue;
    try {
      await adminAuth.deleteUser(oldStudent.id);
    } catch (error) {
      if (error.code !== "auth/user-not-found") throw error;
    }
  }
  return students.map((student) => ({
    ...student,
    passwordHash: existingById.get(student.id)?.passwordHash || hashPassword("123"),
  }));
}

exports.loadGymData = onCall(async (request) => {
  if (!request.auth) throw new HttpsError("unauthenticated", "Sign in to view gym records.");
  const email = request.auth.token.email?.toLowerCase();
  if (email === COACH_EMAIL) {
    const [students, attendance, complaints] = await Promise.all([
      readRecords("students"),
      readRecords("attendance"),
      readRecords("complaints"),
    ]);
    return {
      students: students.map(({ loginEmail, passwordHash, ...student }) => student),
      attendance,
      complaints,
    };
  }

  const studentSnapshot = await db.collection("students").doc(request.auth.uid).get();
  if (!studentSnapshot.exists) throw new HttpsError("permission-denied", "This account is not linked to a student.");
  const student = { id: studentSnapshot.id, ...studentSnapshot.data() };
  const [attendanceSnapshot, complaintsSnapshot] = await Promise.all([
    db.collection("attendance").where("studentId", "==", student.id).get(),
    db.collection("complaints").where("studentId", "==", student.id).get(),
  ]);
  const { loginEmail, passwordHash, ...studentProfile } = student;
  return {
    students: [studentProfile],
    attendance: attendanceSnapshot.docs.map((document) => ({ id: document.id, ...document.data() })),
    complaints: complaintsSnapshot.docs.map((document) => ({ id: document.id, ...document.data() })),
  };
});

exports.changeStudentPassword = onCall(async (request) => {
  if (!request.auth || request.auth.token.email?.toLowerCase() === COACH_EMAIL) {
    throw new HttpsError("permission-denied", "Only a student account can change a student password.");
  }
  const { currentPassword, newPassword } = request.data || {};
  if (typeof currentPassword !== "string" || typeof newPassword !== "string" ||
      newPassword.length < 6 || newPassword.length > 128) {
    throw new HttpsError("invalid-argument", "The new password must be between 6 and 128 characters.");
  }
  const reference = db.collection("students").doc(request.auth.uid);
  const snapshot = await reference.get();
  if (!snapshot.exists || !passwordMatches(currentPassword, snapshot.get("passwordHash"))) {
    throw new HttpsError("unauthenticated", "The current password is incorrect.");
  }
  await reference.update({ passwordHash: hashPassword(newPassword) });
  return { success: true };
});

exports.saveGymData = onCall(async (request) => {
  requireCoach(request);
  const data = validateInput(request.data);
  const students = await ensureStudentAccounts(data.students);
  await Promise.all([
    writeCollection("students", students),
    writeCollection("attendance", data.attendance),
    writeCollection("complaints", data.complaints),
  ]);
  return { success: true };
});
