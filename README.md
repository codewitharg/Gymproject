# Form & Field Gym Management

This is a Firebase-backed gym management app. Student records, attendance, fees, and coach notes are stored in Firestore and can be accessed from different devices. Firestore's client-side rules deny direct access; authenticated callable functions enforce coach-only changes and return each student only their own attendance and notes.

## Set up a live Firebase project

1. Create a Firebase project and register a Web app in the Firebase console.
2. Start Firebase Authentication and create a Firestore database.
3. The Web app configuration is already connected in `firebase-config.js`. `.firebaserc` selects the Firebase project `gym-project-3b8aa`.
4. Install Node.js 20 or later and the Firebase CLI, then sign in:

   ```powershell
   npm install -g firebase-tools
   firebase login
   ```

5. Set the coach's initial password when prompted. Firebase stores it as a Functions secret, not in the web app:

   ```powershell
   firebase functions:secrets:set COACH_PASSWORD
   ```

   Enter `123` at the prompt to use the requested initial coach password.

6. Install the Functions dependencies and deploy the app, functions, and locked-down Firestore rules:

   ```powershell
   Set-Location functions
   npm install
   Set-Location ..
   firebase deploy
   ```

Deploying Cloud Functions requires Firebase billing to be enabled (Blaze plan). Review Firebase's current pricing and set budget alerts before deploying.

After deployment, open the Hosting URL. The coach signs in as `coach` / `123`. Add students with a **unique name** and email address; the app creates their login using the name and initial password `123`. Students sign in with that name and password, then can change their password in the student portal. The email is the contact address and is not used as the student's login name.

The coach password is stored in Firebase Secret Manager. To change it, run `firebase functions:secrets:set COACH_PASSWORD` again with the new password and redeploy the Functions. The requested `123` starter password is weak; choose a stronger coach password before sharing the app publicly.

## Privacy and data

- Coach notes are attached to one student account and only returned to that authenticated student's portal.
- Students can read only their own profile, attendance, and coach notes through the callable backend.
- Students cannot access Firestore directly or write coach-managed data.
- Student passwords are stored as salted password hashes. Login attempts are rate-limited by source IP.
- Deleting a student deletes their sign-in account and their associated records.
- Firebase Web configuration is public by design; keep service-account credentials and private keys out of the web app.
