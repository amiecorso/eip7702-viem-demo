import { type P256Credential } from "viem/account-abstraction";
import { bytesToHex } from "@noble/hashes/utils";

// Type for Chrome-specific methods on AuthenticatorAttestationResponse
interface ChromeAuthenticatorMethods {
  getPublicKey?(): ArrayBuffer | null;
  getPublicKeyAlgorithm?(): number;
}

type ExtendedAuthenticatorAttestationResponse = AuthenticatorAttestationResponse & ChromeAuthenticatorMethods;

// Extended types for PRF support
export interface PRFValues {
  first: Uint8Array;
  second?: Uint8Array;
}

export interface PRFExtensionInput {
  eval?: PRFValues;
  evalByCredential?: Record<string, PRFValues>;
}

export interface PRFExtensionOutput {
  enabled?: boolean;
  results?: {
    first?: ArrayBuffer;
    second?: ArrayBuffer;
  };
}

export interface ExtendedP256Credential extends P256Credential {
  prfOutput?: PRFExtensionOutput;
}

/**
 * Create a WebAuthn credential with PRF extension support
 * @param name - Name for the credential
 * @param prfSalt - Salt for PRF evaluation
 * @returns Extended P256Credential with PRF output
 */
export async function createWebAuthnCredentialWithPRF(
  name: string,
  prfSalt?: string
): Promise<ExtendedP256Credential> {
  console.log("[WebAuthn-PRF] Creating credential with PRF extension");
  console.log("[WebAuthn-PRF] PRF salt:", prfSalt);

  try {
    // First, check if PRF is supported
    const prfSupported = await checkPRFSupport();
    console.log("[WebAuthn-PRF] PRF support available:", prfSupported);

    // Prepare the creation options
    const challenge = crypto.getRandomValues(new Uint8Array(32));
    const userId = crypto.getRandomValues(new Uint8Array(16));

    const publicKeyCredentialCreationOptions: PublicKeyCredentialCreationOptions = {
      challenge,
      rp: {
        name: "EIP7702 Viem Demo",
        id: window.location.hostname,
      },
      user: {
        id: userId,
        name: name,
        displayName: name,
      },
      pubKeyCredParams: [
        { alg: -7, type: "public-key" }, // ES256
        { alg: -257, type: "public-key" }, // RS256
      ],
      authenticatorSelection: {
        // Don't restrict to platform authenticators - allow security keys too
        // authenticatorAttachment: "platform",
        residentKey: "required",
        requireResidentKey: true, // Required for PRF
        userVerification: "required", // Required for PRF
      },
      timeout: 60000,
      attestation: "none",
      extensions: prfSupported && prfSalt ? {
        prf: {
          eval: {
            first: new TextEncoder().encode(prfSalt),
          },
        },
      } as any : {},
    };

    console.log("[WebAuthn-PRF] Creating credential with options:", publicKeyCredentialCreationOptions);

    // Create the credential using native WebAuthn API
    const credential = await navigator.credentials.create({
      publicKey: publicKeyCredentialCreationOptions,
    }) as PublicKeyCredential;

    if (!credential) {
      throw new Error("Failed to create credential");
    }

    console.log("[WebAuthn-PRF] Credential created:", credential);

    // Extract the public key and other data
    const response = credential.response as ExtendedAuthenticatorAttestationResponse;
    
    // Parse the attestation object to get the public key
    const publicKey = await extractPublicKeyFromCredential(response);
    console.log("[WebAuthn-PRF] Extracted public key (hex):", bytesToHex(publicKey));

    // Get client extension results
    const extensionResults = credential.getClientExtensionResults() as any;
    console.log("[WebAuthn-PRF] Extension results:", extensionResults);
    console.log("[WebAuthn-PRF] PRF extension details:", JSON.stringify(extensionResults?.prf, null, 2));

    // Create viem-compatible P256Credential
    const publicKeyHex = `0x${bytesToHex(publicKey)}` as `0x${string}`;
    const p256Credential: ExtendedP256Credential = {
      id: credential.id,
      publicKey: publicKeyHex,
      raw: credential as any,
    };

    // Add PRF output if available
    if (extensionResults?.prf) {
      p256Credential.prfOutput = {
        enabled: extensionResults.prf.enabled,
        results: extensionResults.prf.results,
      };
      
      if (extensionResults.prf.enabled) {
        console.log("[WebAuthn-PRF] PRF is enabled for this credential");
      } else {
        console.log("[WebAuthn-PRF] PRF is NOT enabled for this credential");
      }
      
      if (extensionResults.prf.results?.first) {
        console.log("[WebAuthn-PRF] PRF output (hex):", 
          bytesToHex(new Uint8Array(extensionResults.prf.results.first))
        );
      } else {
        console.log("[WebAuthn-PRF] No PRF results in extension output");
        console.log("[WebAuthn-PRF] This might mean PRF evaluation is deferred to authentication time");
      }
    } else {
      console.log("[WebAuthn-PRF] No PRF extension in results");
    }

    return p256Credential;
  } catch (error) {
    console.error("[WebAuthn-PRF] Error creating credential:", error);
    throw error;
  }
}

/**
 * Authenticate with a credential and get PRF output
 * @param credentialId - The credential ID to use
 * @param prfSalt - Salt for PRF evaluation
 * @returns PRF output
 */
export async function authenticateWithPRF(
  credentialId: string,
  prfSalt: string
): Promise<ArrayBuffer | null> {
  console.log("[WebAuthn-PRF] Authenticating with PRF");
  console.log("[WebAuthn-PRF] Credential ID:", credentialId);
  console.log("[WebAuthn-PRF] PRF salt:", prfSalt);

  try {
    const challenge = crypto.getRandomValues(new Uint8Array(32));

    const publicKeyCredentialRequestOptions: PublicKeyCredentialRequestOptions = {
      challenge,
      rpId: window.location.hostname,
      timeout: 60000,
      userVerification: "preferred",
      allowCredentials: [{
        id: base64UrlToArrayBuffer(credentialId),
        type: "public-key",
      }],
      extensions: {
        prf: {
          eval: {
            first: new TextEncoder().encode(prfSalt),
          },
        },
      } as any,
    };

    const assertion = await navigator.credentials.get({
      publicKey: publicKeyCredentialRequestOptions,
    }) as PublicKeyCredential;

    if (!assertion) {
      throw new Error("Failed to get assertion");
    }

    const extensionResults = assertion.getClientExtensionResults() as any;
    console.log("[WebAuthn-PRF] Authentication extension results:", extensionResults);

    if (extensionResults?.prf?.results?.first) {
      const prfOutput = extensionResults.prf.results.first;
      console.log("[WebAuthn-PRF] PRF output (hex):", 
        bytesToHex(new Uint8Array(prfOutput))
      );
      return prfOutput;
    }

    return null;
  } catch (error) {
    console.error("[WebAuthn-PRF] Error during authentication:", error);
    throw error;
  }
}

/**
 * Check if PRF extension is supported
 * @returns true if PRF is supported
 */
async function checkPRFSupport(): Promise<boolean> {
  try {
    // Check if WebAuthn is available
    if (!window.PublicKeyCredential) {
      console.log("[WebAuthn-PRF] WebAuthn not supported");
      return false;
    }

    // For now, we'll assume PRF is supported if WebAuthn is available
    // In production, you might want to do a more thorough check
    return true;
  } catch (error) {
    console.error("[WebAuthn-PRF] Error checking PRF support:", error);
    return false;
  }
}

/**
 * Extract public key from credential response
 * @param response - Authenticator attestation response
 * @returns Raw public key bytes (65 bytes for P-256: 0x04 + x + y)
 */
async function extractPublicKeyFromCredential(response: ExtendedAuthenticatorAttestationResponse): Promise<Uint8Array> {
  // Parse attestation object (CBOR encoded)
  const attestationObject = response.attestationObject;
  
  // For simplicity, we'll use the getPublicKey() method if available
  // This is a Chrome-specific extension
  if ('getPublicKey' in response && typeof response.getPublicKey === 'function') {
    const publicKeyDER = response.getPublicKey();
    if (publicKeyDER) {
      return extractPublicKeyFromDER(publicKeyDER);
    }
  }
  
  // Otherwise, parse the attestation object manually
  // The attestation object contains authData which includes the credential public key
  // For this demo, we'll extract it from the attestation object
  
  // This is a simplified approach - in production, use a proper CBOR parser
  const attestationArray = new Uint8Array(attestationObject);
  
  // Look for the EC2 public key pattern in the attestation object
  // EC2 keys have a specific CBOR structure with -2 (x coordinate) and -3 (y coordinate)
  for (let i = 0; i < attestationArray.length - 66; i++) {
    // Look for potential EC2 key indicators
    if (attestationArray[i] === 0xa5 || attestationArray[i] === 0xa4) { // CBOR map with 4 or 5 items
      // Check if this could be a COSE key
      // This is a very simplified check - in production use proper CBOR parsing
      
      // Try to find x and y coordinates (32 bytes each)
      let xCoord: Uint8Array | null = null;
      let yCoord: Uint8Array | null = null;
      
      // Look ahead for potential coordinates
      for (let j = i; j < Math.min(i + 200, attestationArray.length - 32); j++) {
        if (attestationArray[j] === 0x58 && attestationArray[j + 1] === 0x20) { // CBOR byte string of length 32
          if (!xCoord) {
            xCoord = attestationArray.slice(j + 2, j + 34);
          } else if (!yCoord) {
            yCoord = attestationArray.slice(j + 2, j + 34);
            break;
          }
        }
      }
      
      if (xCoord && yCoord) {
        // Construct uncompressed public key (0x04 + x + y)
        const publicKey = new Uint8Array(65);
        publicKey[0] = 0x04;
        publicKey.set(xCoord, 1);
        publicKey.set(yCoord, 33);
        
        console.log("[WebAuthn-PRF] Found public key in attestation object");
        return publicKey;
      }
    }
  }
  
  throw new Error("Could not extract public key from attestation object");
}

/**
 * Extract raw public key from DER-encoded key
 * @param der - DER-encoded public key
 * @returns Raw public key bytes (65 bytes for P-256: 0x04 + x + y)
 */
function extractPublicKeyFromDER(der: ArrayBuffer): Uint8Array {
  const derArray = new Uint8Array(der);
  
  // For P-256, the public key is typically at the end of the DER structure
  // This is a simplified extraction - in production, use a proper ASN.1 parser
  
  // Look for the uncompressed point indicator (0x04) followed by 64 bytes
  for (let i = derArray.length - 65; i >= 0; i--) {
    if (derArray[i] === 0x04 && i + 65 <= derArray.length) {
      return derArray.slice(i, i + 65);
    }
  }
  
  throw new Error("Could not extract public key from DER");
}

/**
 * Convert base64url string to ArrayBuffer
 * @param base64url - Base64url encoded string
 * @returns ArrayBuffer
 */
function base64UrlToArrayBuffer(base64url: string): ArrayBuffer {
  // Replace URL-safe characters with standard base64 characters
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  
  // Pad with '=' to make the length a multiple of 4
  const padded = base64 + '=='.substring(0, (4 - base64.length % 4) % 4);
  
  // Decode base64
  const binary = atob(padded);
  
  // Convert to ArrayBuffer
  const buffer = new ArrayBuffer(binary.length);
  const bytes = new Uint8Array(buffer);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  
  return buffer;
} 