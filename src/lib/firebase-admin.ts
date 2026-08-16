import { applicationDefault, cert, getApps, initializeApp, type App, type AppOptions } from "firebase-admin/app";
import { getFirestore, type Firestore } from "firebase-admin/firestore";

type ServiceAccountJson = {
  project_id?: string;
  projectId?: string;
  client_email?: string;
  clientEmail?: string;
  private_key?: string;
  privateKey?: string;
};

let firestore: Firestore | undefined;

function projectIdFromEnvironment() {
  if (process.env.GOOGLE_CLOUD_PROJECT) return process.env.GOOGLE_CLOUD_PROJECT;
  if (process.env.GCLOUD_PROJECT) return process.env.GCLOUD_PROJECT;
  if (process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID) return process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;

  const firebaseConfig = process.env.FIREBASE_CONFIG;
  if (firebaseConfig?.startsWith("{")) {
    try {
      return (JSON.parse(firebaseConfig) as { projectId?: string }).projectId;
    } catch {
      throw new Error("FIREBASE_CONFIG가 올바른 JSON이 아닙니다.");
    }
  }

  return undefined;
}

function serviceAccountOptions(raw: string): AppOptions {
  let parsed: ServiceAccountJson;
  try {
    parsed = JSON.parse(raw) as ServiceAccountJson;
  } catch {
    throw new Error("FIREBASE_SERVICE_ACCOUNT_JSON이 올바른 JSON이 아닙니다.");
  }

  const projectId = parsed.project_id ?? parsed.projectId;
  const clientEmail = parsed.client_email ?? parsed.clientEmail;
  const privateKey = (parsed.private_key ?? parsed.privateKey)?.replace(/\\n/g, "\n");

  if (!projectId || !clientEmail || !privateKey) {
    throw new Error("Firebase 서비스 계정에 project_id, client_email, private_key가 필요합니다.");
  }

  return {
    credential: cert({ projectId, clientEmail, privateKey }),
    projectId,
  };
}

function initializeFirebaseAdmin(): App {
  const existing = getApps()[0];
  if (existing) return existing;

  const projectId = projectIdFromEnvironment();
  if (process.env.FIRESTORE_EMULATOR_HOST) {
    return initializeApp(projectId ? { projectId } : undefined);
  }

  const serviceAccount = process.env.FIREBASE_SERVICE_ACCOUNT_JSON;
  if (serviceAccount) {
    return initializeApp(serviceAccountOptions(serviceAccount));
  }

  return initializeApp({
    credential: applicationDefault(),
    ...(projectId ? { projectId } : {}),
  });
}

export function getFirebaseAdminApp() {
  return initializeFirebaseAdmin();
}

export function getFirebaseAdminFirestore() {
  firestore ??= getFirestore(initializeFirebaseAdmin());
  return firestore;
}
