import * as bip39 from "bip39";
import { sha256 } from "@noble/hashes/sha256";
import { pbkdf2 } from "@noble/hashes/pbkdf2";
import { secp256k1 } from "@noble/curves/secp256k1";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";

// Type definitions for PRF extension
// interface PRFValues {
//   first: ArrayBuffer;
//   second?: ArrayBuffer;
// }

// Constants
const SALT_SUFFIX = ":Base-Wallet-Recovery";
const PBKDF2_ITERATIONS = 2048;

/**
 * Generate salt for PRF evaluation
 * @param passkeyId - The passkey credential ID
 * @returns Salt string
 */
export function generatePRFSalt(passkeyId: string): string {
  return `${passkeyId}${SALT_SUFFIX}`;
}

/**
 * Derive mnemonic from PRF output
 * @param prfOutput - 256-bit PRF output
 * @returns BIP39 mnemonic phrase (12 words)
 */
export async function deriveMnemonicFromPRF(prfOutput: ArrayBuffer): Promise<string> {
  console.log("[PRF-Mnemonic] Raw PRF output length:", prfOutput.byteLength, "bytes");
  console.log("[PRF-Mnemonic] Raw PRF output (hex):", bytesToHex(new Uint8Array(prfOutput)));
  
  // Use PBKDF2 to derive entropy from PRF output
  const salt = new TextEncoder().encode("webauthn-prf-mnemonic");
  const entropy = pbkdf2(sha256, new Uint8Array(prfOutput), salt, {
    c: PBKDF2_ITERATIONS,
    dkLen: 16  // Changed from 32 to 16 bytes for 12-word mnemonic
  });
  
  console.log("[PRF-Mnemonic] PBKDF2 derived entropy (hex):", bytesToHex(entropy));
  
  // Generate 12-word mnemonic from 16-byte entropy
  const mnemonic = bip39.entropyToMnemonic(Buffer.from(entropy));
  console.log("[PRF-Mnemonic] Generated 12-word mnemonic");
  
  return mnemonic;
}

/**
 * Derive secp256k1 keypair from mnemonic
 * @param mnemonic - BIP39 mnemonic phrase
 * @param index - Derivation index (default 0)
 * @returns Private and public key pair
 */
export async function deriveKeypairFromMnemonic(
  mnemonic: string,
  index: number = 0
): Promise<{ privateKey: string; publicKey: string }> {
  // Generate seed from mnemonic
  const seed = await bip39.mnemonicToSeed(mnemonic);
  console.log("[PRF-Mnemonic] Seed from mnemonic (hex):", bytesToHex(new Uint8Array(seed)));
  
  // Simple derivation for demo - in production, use proper HD derivation (BIP32)
  const seedBytes = new Uint8Array(seed.slice(0, 32));
  const indexBytes = new Uint8Array([0, 0, 0, index]);
  const derivationData = new Uint8Array(seedBytes.length + indexBytes.length);
  derivationData.set(seedBytes, 0);
  derivationData.set(indexBytes, seedBytes.length);
  const privateKeyBytes = sha256(derivationData);
  
  // Generate secp256k1 keypair
  const publicKeyBytes = secp256k1.getPublicKey(privateKeyBytes, false);
  
  const privateKey = bytesToHex(privateKeyBytes);
  const publicKey = bytesToHex(publicKeyBytes);
  
  console.log("[PRF-Mnemonic] Derived private key:", privateKey);
  console.log("[PRF-Mnemonic] Derived public key:", publicKey);
  
  return { privateKey, publicKey };
}

/**
 * XOR two ArrayBuffers
 * @param a - First buffer
 * @param b - Second buffer
 * @returns XOR result
 */
export function xorBuffers(a: ArrayBuffer, b: ArrayBuffer): ArrayBuffer {
  const aBytes = new Uint8Array(a);
  const bBytes = new Uint8Array(b);
  const result = new Uint8Array(Math.max(aBytes.length, bBytes.length));
  
  for (let i = 0; i < result.length; i++) {
    result[i] = (aBytes[i] || 0) ^ (bBytes[i] || 0);
  }
  
  const buffer = new ArrayBuffer(result.length);
  new Uint8Array(buffer).set(result);
  return buffer;
}

/**
 * Generate bitmask for recovery scheme
 * @param basePRF - PRF output from passkey_0
 * @param currentPRF - PRF output from passkey_i
 * @returns Bitmask for recovery
 */
export function generateRecoveryBitmask(
  basePRF: ArrayBuffer,
  currentPRF: ArrayBuffer
): ArrayBuffer {
  const bitmask = xorBuffers(basePRF, currentPRF);
  console.log("[PRF-Mnemonic] Generated bitmask (hex):", bytesToHex(new Uint8Array(bitmask)));
  return bitmask;
}

/**
 * Recover base PRF using bitmask
 * @param currentPRF - PRF output from current passkey
 * @param bitmask - Recovery bitmask
 * @returns Recovered base PRF
 */
export function recoverBasePRF(
  currentPRF: ArrayBuffer,
  bitmask: ArrayBuffer
): ArrayBuffer {
  const recovered = xorBuffers(currentPRF, bitmask);
  console.log("[PRF-Mnemonic] Recovered base PRF (hex):", bytesToHex(new Uint8Array(recovered)));
  return recovered;
}

/**
 * Store recovery bitmask (in production, this would be stored securely)
 * @param passkeyId - The passkey credential ID
 * @param bitmask - The recovery bitmask
 */
export function storeRecoveryBitmask(passkeyId: string, bitmask: ArrayBuffer): void {
  const bitmaskHex = bytesToHex(new Uint8Array(bitmask));
  localStorage.setItem(`prf-bitmask-${passkeyId}`, bitmaskHex);
  console.log(`[PRF-Mnemonic] Stored bitmask for passkey ${passkeyId}`);
}

/**
 * Retrieve recovery bitmask
 * @param passkeyId - The passkey credential ID
 * @returns The recovery bitmask or null
 */
export function getRecoveryBitmask(passkeyId: string): ArrayBuffer | null {
  const bitmaskHex = localStorage.getItem(`prf-bitmask-${passkeyId}`);
  if (!bitmaskHex) return null;
  
  const bytes = hexToBytes(bitmaskHex);
  const bitmask = new ArrayBuffer(bytes.length);
  new Uint8Array(bitmask).set(bytes);
  console.log(`[PRF-Mnemonic] Retrieved bitmask for passkey ${passkeyId}`);
  return bitmask;
}

/**
 * Check if this is the first passkey (passkey_0)
 * @returns true if no passkeys exist yet
 */
export function isFirstPasskey(): boolean {
  const existingPasskeys = localStorage.getItem("prf-passkey-count");
  return !existingPasskeys || existingPasskeys === "0";
}

/**
 * Increment passkey count
 */
export function incrementPasskeyCount(): number {
  const current = parseInt(localStorage.getItem("prf-passkey-count") || "0");
  const next = current + 1;
  localStorage.setItem("prf-passkey-count", next.toString());
  return next;
}

/**
 * Generate a new mnemonic phrase
 * @returns BIP39 mnemonic phrase
 */
export function generateMnemonic(): string {
  const mnemonic = bip39.generateMnemonic(128); // 128 bits = 12 words (was 256 bits = 24 words)
  console.log("[PRF-Mnemonic] Generated new 12-word mnemonic");
  return mnemonic;
}

/**
 * Validate a mnemonic phrase
 * @param mnemonic - BIP39 mnemonic phrase to validate
 * @returns true if valid
 */
export function validateMnemonic(mnemonic: string): boolean {
  // Trim whitespace and newlines before validation
  return bip39.validateMnemonic(mnemonic.trim());
}

/**
 * Convert mnemonic to entropy (returns 16 bytes for 12-word mnemonics)
 * @param mnemonic - BIP39 mnemonic phrase
 * @returns 16-byte entropy
 */
export async function mnemonicToEntropy(mnemonic: string): Promise<ArrayBuffer> {
  // Trim whitespace and newlines before processing
  const entropy = bip39.mnemonicToEntropy(mnemonic.trim());
  const entropyBytes = hexToBytes(entropy);
  
  // We only support 12-word mnemonics (16 bytes)
  if (entropyBytes.length !== 16) {
    throw new Error("Only 12-word mnemonics are supported");
  }
  
  const buffer = new ArrayBuffer(entropyBytes.length);
  new Uint8Array(buffer).set(entropyBytes);
  return buffer;
}

/**
 * Convert entropy to mnemonic (only supports 16-byte entropy for 12-word mnemonics)
 * @param entropy - 16-byte entropy
 * @returns BIP39 mnemonic phrase
 */
export function entropyToMnemonic(entropy: ArrayBuffer): string {
  const entropyBytes = new Uint8Array(entropy);
  
  // We only support 12-word mnemonics (16 bytes)
  if (entropyBytes.length !== 16) {
    throw new Error("Only 16-byte entropy for 12-word mnemonics is supported");
  }
  
  const entropyHex = bytesToHex(entropyBytes);
  return bip39.entropyToMnemonic(entropyHex);
}

/**
 * Generate bitmask to bridge from PRF-derived mnemonic to original mnemonic
 * @param originalMnemonicEntropy - Entropy from the original mnemonic
 * @param prfMnemonicEntropy - Entropy from the PRF-derived mnemonic
 * @returns Bitmask for recovery
 */
export function generateMnemonicBridgeBitmask(
  originalMnemonicEntropy: ArrayBuffer,
  prfMnemonicEntropy: ArrayBuffer
): ArrayBuffer {
  const bitmask = xorBuffers(originalMnemonicEntropy, prfMnemonicEntropy);
  console.log("[PRF-Mnemonic] Generated mnemonic bridge bitmask (hex):", bytesToHex(new Uint8Array(bitmask)));
  return bitmask;
}

/**
 * Recover original mnemonic using PRF-derived mnemonic and bitmask
 * @param prfMnemonicEntropy - Entropy from the PRF-derived mnemonic
 * @param bitmask - Recovery bitmask
 * @returns Recovered original mnemonic
 */
export function recoverOriginalMnemonic(
  prfMnemonicEntropy: ArrayBuffer,
  bitmask: ArrayBuffer
): string {
  const recoveredEntropy = xorBuffers(prfMnemonicEntropy, bitmask);
  console.log("[PRF-Mnemonic] Recovered original entropy (hex):", bytesToHex(new Uint8Array(recoveredEntropy)));
  
  const recoveredMnemonic = entropyToMnemonic(recoveredEntropy);
  console.log("[PRF-Mnemonic] Recovered original mnemonic");
  return recoveredMnemonic;
}

/**
 * Store recovery bitmask for mnemonic bridge (in production, this would be stored securely)
 * @param passkeyId - The passkey credential ID
 * @param bitmask - The recovery bitmask
 */
export function storeMnemonicBridgeBitmask(passkeyId: string, bitmask: ArrayBuffer): void {
  const bitmaskHex = bytesToHex(new Uint8Array(bitmask));
  localStorage.setItem(`mnemonic-bridge-bitmask-${passkeyId}`, bitmaskHex);
  console.log(`[PRF-Mnemonic] Stored mnemonic bridge bitmask for passkey ${passkeyId}`);
}

/**
 * Retrieve mnemonic bridge bitmask
 * @param passkeyId - The passkey credential ID
 * @returns The recovery bitmask or null
 */
export function getMnemonicBridgeBitmask(passkeyId: string): ArrayBuffer | null {
  const bitmaskHex = localStorage.getItem(`mnemonic-bridge-bitmask-${passkeyId}`);
  if (!bitmaskHex) return null;
  
  const bytes = hexToBytes(bitmaskHex);
  const bitmask = new ArrayBuffer(bytes.length);
  new Uint8Array(bitmask).set(bytes);
  console.log(`[PRF-Mnemonic] Retrieved mnemonic bridge bitmask for passkey ${passkeyId}`);
  return bitmask;
}

/**
 * Store original mnemonic (encrypted in production)
 * @param mnemonic - The original mnemonic
 */
export function storeOriginalMnemonic(mnemonic: string): void {
  // In production, this should be encrypted
  localStorage.setItem("original-mnemonic", mnemonic);
  console.log("[PRF-Mnemonic] Stored original mnemonic");
}

/**
 * Retrieve original mnemonic
 * @returns The original mnemonic or null
 */
export function getOriginalMnemonic(): string | null {
  return localStorage.getItem("original-mnemonic");
}

/**
 * Clear all stored recovery data
 */
export function clearRecoveryData(): void {
  const keys = Object.keys(localStorage);
  keys.forEach(key => {
    if (key.startsWith("mnemonic-bridge-bitmask-") || 
        key === "original-mnemonic" ||
        key.startsWith("passkey-") ||
        key.startsWith("prf-")) {
      localStorage.removeItem(key);
    }
  });
  console.log("[PRF-Mnemonic] Cleared all recovery data");
} 