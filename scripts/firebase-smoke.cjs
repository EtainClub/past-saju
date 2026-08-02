/* eslint-disable @typescript-eslint/no-require-imports -- Node에서 직접 실행하는 CommonJS 점검 스크립트 */
const { randomUUID } = require("node:crypto");
const { applicationDefault, initializeApp } = require("firebase-admin/app");
const { FieldValue, getFirestore } = require("firebase-admin/firestore");

const projectId =
  process.env.GOOGLE_CLOUD_PROJECT ??
  process.env.GCLOUD_PROJECT ??
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

if (!projectId) {
  throw new Error("Firebase project ID 환경변수가 필요합니다.");
}

const app = initializeApp({ credential: applicationDefault(), projectId });
const db = getFirestore(app);
const ref = db.collection("internalHealthChecks").doc(`smoke-${randomUUID()}`);

async function main() {
  try {
    await ref.set({ source: "firebase-smoke", createdAt: FieldValue.serverTimestamp() });
    const snapshot = await ref.get();
    if (!snapshot.exists || snapshot.get("source") !== "firebase-smoke") {
      throw new Error("Firestore read-back mismatch");
    }
    console.log("firestore smoke: create/read/delete passed");
  } finally {
    await ref.delete();
    await app.delete();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
