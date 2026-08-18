import { randomBytes } from "node:crypto";
import { Timestamp } from "firebase-admin/firestore";
import { getFirebaseAdminFirestore } from "./firebase-admin";

/**
 * 백업 코드 — 익명 계정을 기기 간에 옮기는 수단.
 *
 * 익명 로그인의 uid 는 이 브라우저(정확히는 IndexedDB)에 묶여 있다. 기기를
 * 바꾸거나 앱 캐시를 지우면 그 uid 를 다시는 못 만든다. 토스 미니앱은
 * 애초에 구글 연동이 성립하지 않으므로(`lib/platform.ts`) 이 경로가
 * **유일한** 복구 수단이고, 웹에서도 연동을 안 한 사용자에게는 마찬가지다.
 *
 * 코드는 새 uid 를 만드는 게 아니라 **원래 uid 로 다시 로그인할 수 있는
 * 커스텀 토큰을 받을 열쇠**다. `/api/auth/recover` 가 검증 후
 * `createCustomToken(uid)` 를 돌려주면, 클라이언트는 `signInWithCustomToken`
 * 으로 원래 uid 로 갈아탄다 — 구글 연동(linkWithPopup)이 uid 를 유지하는 것과
 * 같은 효과를, 실계정 없이 얻는다. 그래서 별도의 "병합" 로직이 필요 없다:
 * 세션은 이미 uid 로만 조회된다(`reading-store.ts`).
 *
 * ## 토스 로그인이 붙었을 때
 *
 * 같은 조각을 그대로 재사용한다: 토스 유저 id → (매핑 조회) → uid →
 * `createCustomToken(uid)`. 지금은 토스 OAuth 자체가 미니앱에서 안 되므로
 * 매핑을 저장할 곳이 없다. 붙이게 되면 `tossLinks/{tossUserId} -> uid`
 * 컬렉션을 하나 추가하고, 이 파일의 `redeemBackupCode` 가 하는 일(코드→uid)을
 * 그 컬렉션에서 토스ID→uid 로 바꿔 부르면 된다.
 */

const COLLECTION = "backupCodes";
/** 저장 기록의 최장 보관기간(1년, `reading-store.ts`)보다 여유 있게 둔다. */
const CODE_TTL_MS = 400 * 24 * 60 * 60 * 1000;
/** 15바이트 → base32 24자 → 4자씩 6그룹. 무작위 대입으로 못 맞힐 만큼 충분하다. */
const CODE_BYTES = 15;
/** 0/1/I/O 를 뺐다 — 손으로 옮겨 적을 때 헷갈리는 문자를 원천에서 없앤다. */
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

function randomCodeKey(): string {
  const bytes = randomBytes(CODE_BYTES);
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of bytes) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out;
}

/** 사람이 옮겨 적기 쉽게 4자씩 묶는다. 저장·조회 키는 묶기 전 값(대시 없음)이다. */
function toDisplay(key: string): string {
  return key.match(/.{1,4}/g)!.join("-");
}

/** 사용자가 입력한 코드를 정규화한다 — 대소문자·붙여쓰기·대시 유무 상관없이 통과시킨다. */
function normalizeCode(input: string): string {
  return input.trim().toUpperCase().replace(/[^A-Z0-9]/g, "");
}

function shouldUseFirestore() {
  if (process.env.NODE_ENV === "production") return true;
  if (process.env.FIRESTORE_EMULATOR_HOST) return true;
  return process.env.FIREBASE_STORAGE_BACKEND === "firestore";
}

const globalForBackupCode = globalThis as unknown as {
  pastSajuBackupCodes?: Map<string, { uid: string; expiresAt: number }>;
};
const memoryCodes = globalForBackupCode.pastSajuBackupCodes ?? new Map<string, { uid: string; expiresAt: number }>();
globalForBackupCode.pastSajuBackupCodes = memoryCodes;

export type IssuedBackupCode = { code: string; expiresAt: number };

/** 지금 uid 를 가리키는 새 백업 코드를 발급한다. 기존 코드를 무효화하지 않는다 — 여러 장 가지고 있어도 된다. */
export async function issueBackupCode(uid: string): Promise<IssuedBackupCode> {
  const key = randomCodeKey();
  const now = Date.now();
  const expiresAt = now + CODE_TTL_MS;

  if (!shouldUseFirestore()) {
    memoryCodes.set(key, { uid, expiresAt });
    return { code: toDisplay(key), expiresAt };
  }

  const db = getFirebaseAdminFirestore();
  await db.collection(COLLECTION).doc(key).set({
    uid,
    createdAt: now,
    expiresAt: Timestamp.fromMillis(expiresAt),
  });
  return { code: toDisplay(key), expiresAt };
}

export type RedeemVerdict = { status: "ok"; uid: string } | { status: "not-found" };

/** 코드가 가리키는 uid 를 찾는다. 없거나 만료됐으면 "not-found" — 둘을 구분해도 공격자에게 줄 정보가 없다. */
export async function redeemBackupCode(rawCode: string): Promise<RedeemVerdict> {
  const key = normalizeCode(rawCode);
  if (!key) return { status: "not-found" };

  if (!shouldUseFirestore()) {
    const entry = memoryCodes.get(key);
    if (!entry || Date.now() >= entry.expiresAt) return { status: "not-found" };
    return { status: "ok", uid: entry.uid };
  }

  const db = getFirebaseAdminFirestore();
  const snapshot = await db.collection(COLLECTION).doc(key).get();
  if (!snapshot.exists) return { status: "not-found" };

  const data = snapshot.data()!;
  const expiresAt = (data.expiresAt as Timestamp).toMillis();
  if (Date.now() >= expiresAt) return { status: "not-found" };
  return { status: "ok", uid: data.uid as string };
}
