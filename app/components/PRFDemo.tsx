import { useState } from "react";
import { type P256Credential } from "viem/account-abstraction";
import { createWebAuthnCredentialWithPRF, authenticateWithPRF } from "../lib/webauthn-prf";
import { 
  generatePRFSalt, 
  deriveMnemonicFromPRF, 
  deriveKeypairFromMnemonic,
  generateMnemonicBridgeBitmask,
  recoverOriginalMnemonic,
  mnemonicToEntropy,
  getMnemonicBridgeBitmask,
  getOriginalMnemonic,
  generateMnemonic,
} from "../lib/prf-mnemonic-utils";
import { bytesToHex } from "@noble/hashes/utils";

interface PRFDemoProps {
  passkey?: P256Credential | null;
}

export function PRFDemo({ passkey }: PRFDemoProps) {
  const [status, setStatus] = useState<string>("");
  const [prfOutput, setPrfOutput] = useState<string>("");
  const [prfMnemonic, setPrfMnemonic] = useState<string>("");
  const [originalMnemonic, setOriginalMnemonic] = useState<string>("");
  const [recoveredMnemonic, setRecoveredMnemonic] = useState<string>("");
  const [keypair, setKeypair] = useState<{ privateKey: string; publicKey: string } | null>(null);
  const [bitmask, setBitmask] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const handleTestNewFlow = async () => {
    try {
      setLoading(true);
      setStatus("Testing new mnemonic bridge flow...");
      setPrfOutput("");
      setPrfMnemonic("");
      setOriginalMnemonic("");
      setRecoveredMnemonic("");
      setKeypair(null);
      setBitmask("");

      // Step 1: Generate original mnemonic
      const original = generateMnemonic();
      setOriginalMnemonic(original);
      setStatus("Generated original mnemonic");

      // Step 2: Create test passkey with PRF
      const testId = `test-${Date.now()}`;
      const salt = generatePRFSalt(testId);
      
      setStatus("Creating test passkey with PRF extension...");
      const testPasskey = await createWebAuthnCredentialWithPRF(
        "Mnemonic Bridge Test",
        salt
      );

      if (testPasskey.prfOutput?.enabled === true) {
        setStatus("PRF enabled. Authenticating to get PRF output...");
        
        // Authenticate to get PRF output
        const prfData = await authenticateWithPRF(testPasskey.id, salt);
        
        if (prfData) {
          const prfHex = bytesToHex(new Uint8Array(prfData));
          setPrfOutput(prfHex);
          
          // Step 3: Derive PRF-based mnemonic
          setStatus("Deriving PRF-based mnemonic...");
          const prfDerivedMnemonic = await deriveMnemonicFromPRF(prfData);
          setPrfMnemonic(prfDerivedMnemonic);
          
          // Step 4: Generate encrypted ciphertext
          setStatus("Generating encrypted bridge data...");
          const originalEntropy = await mnemonicToEntropy(original);
          const prfEntropy = await mnemonicToEntropy(prfDerivedMnemonic);
          const ciphertext = await generateMnemonicBridgeBitmask(originalEntropy, prfEntropy);
          const ciphertextHex = bytesToHex(new Uint8Array(ciphertext));
          setBitmask(ciphertextHex);
          
          // Step 5: Test recovery
          setStatus("Testing recovery of original mnemonic...");
          const recovered = await recoverOriginalMnemonic(prfEntropy, ciphertext);
          setRecoveredMnemonic(recovered);
          
          if (recovered === original) {
            setStatus("✅ Success! Original mnemonic recovered correctly using PRF + encrypted data");
          } else {
            setStatus("❌ Recovery failed - recovered mnemonic doesn't match original");
          }
          
          // Derive keypair from original for display
          const derivedKeypair = await deriveKeypairFromMnemonic(original);
          setKeypair(derivedKeypair);
        } else {
          setStatus("⚠️ No PRF output received - authenticator may not support PRF");
        }
      } else {
        setStatus("⚠️ PRF extension not supported by this authenticator");
      }
    } catch (error) {
      console.error("Test error:", error);
      setStatus(`❌ Error: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoading(false);
    }
  };

  const handleTestRecovery = async () => {
    if (!passkey) {
      setStatus("❌ No passkey available for recovery test");
      return;
    }

    try {
      setLoading(true);
      setStatus("Testing recovery with existing passkey...");
      
      // Get stored data
      const storedOriginal = getOriginalMnemonic();
      const storedBitmask = getMnemonicBridgeBitmask(passkey.id);
      
      if (!storedOriginal || !storedBitmask) {
        setStatus("❌ No recovery data found for this passkey");
        return;
      }
      
      setOriginalMnemonic(storedOriginal);
      setBitmask(bytesToHex(new Uint8Array(storedBitmask)));
      
      // Authenticate with PRF
      const storedSalt = localStorage.getItem(`passkey-${passkey.id}-salt`);
      const salt = storedSalt || generatePRFSalt(passkey.id);
      
      setStatus("Authenticating with passkey to get PRF output...");
      const prfData = await authenticateWithPRF(passkey.id, salt);
      
      if (prfData) {
        setPrfOutput(bytesToHex(new Uint8Array(prfData)));
        
        // Derive PRF mnemonic
        const prfDerivedMnemonic = await deriveMnemonicFromPRF(prfData);
        setPrfMnemonic(prfDerivedMnemonic);
        
        // Recover original using encrypted ciphertext
        const prfEntropy = await mnemonicToEntropy(prfDerivedMnemonic);
        const recovered = await recoverOriginalMnemonic(prfEntropy, storedBitmask);
        setRecoveredMnemonic(recovered);
        
        if (recovered === storedOriginal) {
          setStatus("✅ Recovery successful! Original mnemonic recovered from passkey + encrypted data");
          
          // Derive keypair
          const derivedKeypair = await deriveKeypairFromMnemonic(recovered);
          setKeypair(derivedKeypair);
        } else {
          setStatus("❌ Recovery failed - recovered mnemonic doesn't match stored original");
        }
      } else {
        setStatus("⚠️ No PRF output received during authentication");
      }
    } catch (error) {
      console.error("Recovery error:", error);
      setStatus(`❌ Error: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mt-8 p-6 bg-gray-900 rounded-lg">
      <h2 className="text-2xl font-bold mb-4 text-blue-400">Mnemonic Bridge Demo</h2>
      
      <div className="space-y-4">
        <div className="flex gap-4">
          <button
            onClick={handleTestNewFlow}
            disabled={loading}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
          >
            Test New Mnemonic Bridge
          </button>
          
          {passkey && (
            <button
              onClick={handleTestRecovery}
              disabled={loading}
              className="px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600 disabled:opacity-50"
            >
              Test Recovery with Passkey
            </button>
          )}
        </div>

        {status && (
          <div className="p-4 bg-gray-800 rounded">
            <p className="text-sm font-mono">{status}</p>
          </div>
        )}

        {originalMnemonic && (
          <div className="p-4 bg-gray-800 rounded">
            <h3 className="font-bold text-green-400 mb-2">Original Mnemonic:</h3>
            <p className="text-sm font-mono">{originalMnemonic}</p>
          </div>
        )}

        {prfOutput && (
          <div className="p-4 bg-gray-800 rounded">
            <h3 className="font-bold text-green-400 mb-2">PRF Output (256-bit):</h3>
            <p className="text-xs font-mono break-all">{prfOutput}</p>
          </div>
        )}

        {prfMnemonic && (
          <div className="p-4 bg-gray-800 rounded">
            <h3 className="font-bold text-green-400 mb-2">PRF-Derived Mnemonic:</h3>
            <p className="text-sm font-mono">{prfMnemonic}</p>
          </div>
        )}

        {bitmask && (
          <div className="p-4 bg-gray-800 rounded">
            <h3 className="font-bold text-green-400 mb-2">Encrypted Bridge Data:</h3>
            <p className="text-xs font-mono break-all">{bitmask}</p>
            <p className="text-xs text-gray-400 mt-2">This encrypted data bridges from PRF mnemonic to original mnemonic</p>
          </div>
        )}

        {recoveredMnemonic && (
          <div className="p-4 bg-gray-800 rounded">
            <h3 className="font-bold text-yellow-400 mb-2">Recovered Mnemonic:</h3>
            <p className="text-sm font-mono">{recoveredMnemonic}</p>
          </div>
        )}

        {keypair && (
          <div className="p-4 bg-gray-800 rounded">
            <h3 className="font-bold text-green-400 mb-2">Derived secp256k1 Keypair:</h3>
            <div className="space-y-2">
              <div>
                <span className="text-gray-400">Private Key:</span>
                <p className="text-xs font-mono break-all">{keypair.privateKey}</p>
              </div>
              <div>
                <span className="text-gray-400">Public Key:</span>
                <p className="text-xs font-mono break-all">{keypair.publicKey}</p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
} 