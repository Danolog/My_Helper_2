/**
 * Fikstury subskrypcji Web Push: prawdziwe kształty endpointów usług push
 * i klucze o poprawnej długości (bez sieci — tylko dane).
 */
import { generateKeyPairSync, randomBytes } from "node:crypto";

function p256dhKey(): string {
  const { publicKey } = generateKeyPairSync("ec", { namedCurve: "prime256v1" });
  // SPKI DER P-256: ostatnie 65 bajtów to nieskompresowany punkt (0x04 || X || Y)
  const der = publicKey.export({ type: "spki", format: "der" });
  return der.subarray(der.length - 65).toString("base64url");
}

export const VALID_P256DH = p256dhKey();
export const VALID_AUTH = randomBytes(16).toString("base64url");

const token = (n: number) => randomBytes(n).toString("base64url");

/** Endpointy w formacie, jaki zwracają przeglądarki (PushSubscription.toJSON()). */
export const VALID_ENDPOINTS = {
  chromeFcm: `https://fcm.googleapis.com/fcm/send/${token(8)}:APA91b${token(105)}`,
  chromeFcmWp: `https://fcm.googleapis.com/wp/${token(8)}:APA91b${token(105)}`,
  firefox: `https://updates.push.services.mozilla.com/wpush/v2/gAAAAAB${token(190)}`,
  safari: `https://web.push.apple.com/Q${token(120)}`,
  edgeWns: `https://wns2-par02p.notify.windows.com/w/?token=BQYAAAD${token(200)}%2fx%2bY%3d`,
} as const;

export function validSubscription(endpoint: string = VALID_ENDPOINTS.chromeFcm) {
  return { endpoint, keys: { p256dh: VALID_P256DH, auth: VALID_AUTH } };
}
