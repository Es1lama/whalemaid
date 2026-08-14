// SPEC: docs/adr/INDEX.md#ADR-033 设备密钥（WebCrypto ECDSA P-256 不可导出）
const DB_NAME = 'whalemaid'
const DB_VERSION = 1
const STORE = 'keys'
const KEYPAIR_KEY = 'device-keypair'

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION)
    req.onupgradeneeded = () => req.result.createObjectStore(STORE)
    req.onsuccess = () => resolve(req.result)
    req.onerror = () => reject(req.error)
  })
}

async function loadStored(): Promise<CryptoKeyPair | undefined> {
  const db = await openDb()
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly')
    const req = tx.objectStore(STORE).get(KEYPAIR_KEY)
    req.onsuccess = () => resolve(req.result as CryptoKeyPair | undefined)
    req.onerror = () => reject(req.error)
  })
}

async function persist(pair: CryptoKeyPair): Promise<void> {
  const db = await openDb()
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite')
    tx.objectStore(STORE).put(pair, KEYPAIR_KEY)
    tx.oncomplete = () => resolve()
    tx.onerror = () => reject(tx.error)
  })
}

/** 获取或创建设备密钥对（私钥不可导出；重装/清存储即需重新配对，REQ-015） */
export async function getOrCreateKeypair(): Promise<CryptoKeyPair> {
  const stored = await loadStored()
  if (stored) return stored
  const pair = await crypto.subtle.generateKey(
    { name: 'ECDSA', namedCurve: 'P-256' },
    /* extractable */ false,
    ['sign', 'verify'],
  )
  await persist(pair)
  return pair
}

export async function exportPublicJwk(pair: CryptoKeyPair): Promise<JsonWebKey> {
  return crypto.subtle.exportKey('jwk', pair.publicKey)
}

/** 对 nonce 签名（挑战-应答，TM-004），返回 base64 */
export async function signNonce(pair: CryptoKeyPair, nonce: string): Promise<string> {
  const sig = await crypto.subtle.sign(
    { name: 'ECDSA', hash: 'SHA-256' },
    pair.privateKey,
    new TextEncoder().encode(nonce),
  )
  return btoa(String.fromCharCode(...new Uint8Array(sig)))
}
