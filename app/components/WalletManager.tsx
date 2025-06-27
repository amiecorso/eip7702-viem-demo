import { useState, useEffect } from "react";
import { createPublicClient, http, maxUint256, type Hex } from "viem";
import {
  createEOAClient,
  encodeInitializeArgs,
  createSetImplementationHash,
  signSetImplementation,
  type ExtendedAccount,
} from "../lib/wallet-utils";
import { baseSepolia } from "../lib/chains";
import {
  type P256Credential,
} from "viem/account-abstraction";
import {
  CBSW_IMPLEMENTATION_ADDRESS,
  ZERO_ADDRESS,
  EIP7702PROXY_TEMPLATE_ADDRESS,
} from "../lib/constants";
import { getNonceFromTracker, verifyPasskeyOwnership, checkContractState } from "../lib/contract-utils";
import { createWebAuthnCredentialWithPRF, type ExtendedP256Credential } from "../lib/webauthn-prf";
import { 
  generatePRFSalt, 
  deriveMnemonicFromPRF, 
  deriveKeypairFromMnemonic,
  generateMnemonic,
  validateMnemonic,
  mnemonicToEntropy,
  generateMnemonicBridgeBitmask,
  storeMnemonicBridgeBitmask,
  storeOriginalMnemonic,
} from "../lib/prf-mnemonic-utils";
// import { bytesToHex } from "@noble/hashes/utils"; // Removed unused import

interface WalletManagerProps {
  onWalletCreated: (address: string, explorerLink: string | null) => void;
  onUpgradeComplete: (
    address: `0x${string}`,
    upgradeHash: string,
    code: string
  ) => void;
  resetKey: number;
  onAccountCreated: (account: ExtendedAccount | null) => void;
  onPasskeyStored: (passkey: P256Credential) => void;
}

function formatError(error: any): string {
  let errorMessage = "Failed to upgrade wallet: ";
  if (error.shortMessage) {
    errorMessage += error.shortMessage;
  } else if (error.message) {
    errorMessage += error.message;
  }
  // Check for contract revert reasons
  if (error.data?.message) {
    errorMessage += `\nContract message: ${error.data.message}`;
  }
  return errorMessage;
}

function formatExplorerLink(hash: string, type: 'transaction' | 'address' = 'transaction'): string | null {
  return `${baseSepolia.blockExplorers.default.url}/${type}/${hash}`;
}

export function WalletManager({
  onWalletCreated,
  onUpgradeComplete,
  resetKey,
  onAccountCreated,
  onPasskeyStored,
}: WalletManagerProps) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [account, setAccount] = useState<ExtendedAccount | null>(null);
  const [isUpgraded, setIsUpgraded] = useState(false);
  const [status, setStatus] = useState<string>("");
  const [showMnemonicInput, setShowMnemonicInput] = useState(false);
  const [mnemonicInput, setMnemonicInput] = useState("");
  const [originalMnemonic, setOriginalMnemonic] = useState<string | null>(null);

  // Reset internal state when resetKey changes
  useEffect(() => {
    setLoading(false);
    setError(null);
    setAccount(null);
    setIsUpgraded(false);
    setStatus("");
    setShowMnemonicInput(false);
    setMnemonicInput("");
    setOriginalMnemonic(null);
  }, [resetKey]);

  // Creates a new EOA wallet with the new mnemonic flow
  const handleCreateEOA = async () => {
    try {
      setLoading(true);
      setError(null);
      setStatus("Setting up wallet creation...");

      // Step 1: Get or generate the original mnemonic
      let mnemonic: string;
      
      if (showMnemonicInput && mnemonicInput) {
        // Trim whitespace and newlines from user input
        const trimmedInput = mnemonicInput.trim();
        
        // Validate user input
        if (!validateMnemonic(trimmedInput)) {
          throw new Error("Invalid mnemonic phrase. Please check and try again.");
        }
        mnemonic = trimmedInput;
        setStatus("Using provided mnemonic phrase...");
      } else {
        // Generate a new mnemonic
        mnemonic = generateMnemonic();
        setStatus("Generated new mnemonic phrase...");
      }
      
      setOriginalMnemonic(mnemonic);
      storeOriginalMnemonic(mnemonic);
      
      console.log("\n=== Creating Wallet with Original Mnemonic ===");
      console.log("[WalletManager] Original mnemonic created/imported");
      
      // Step 2: Derive wallet from original mnemonic
      const originalKeypair = await deriveKeypairFromMnemonic(mnemonic, 0);
      const { createEOAWalletFromMnemonic } = await import("../lib/wallet-utils");
      const newAccount = await createEOAWalletFromMnemonic(originalKeypair.privateKey);
      
      setAccount(newAccount);
      const explorerLink = formatExplorerLink(newAccount.address, 'address');
      onWalletCreated(newAccount.address, explorerLink);
      onAccountCreated(newAccount);
      
      // Step 3: Create passkey with PRF
      setStatus("Creating passkey with PRF extension...");
      const tempId = Date.now().toString();
      const prfSalt = generatePRFSalt(tempId);
      
      let extendedPasskey: ExtendedP256Credential;
      let passkey: P256Credential;
      
      try {
        extendedPasskey = await createWebAuthnCredentialWithPRF(
          "Wallet Recovery Passkey",
          prfSalt
        );
        
        // Ensure publicKey has 0x prefix
        const publicKeyHex = extendedPasskey.publicKey.startsWith('0x') 
          ? extendedPasskey.publicKey 
          : `0x${extendedPasskey.publicKey}`;
        
        // Convert to standard P256Credential for compatibility
        passkey = {
          id: extendedPasskey.id,
          publicKey: publicKeyHex as Hex,
          raw: extendedPasskey.raw,
        };
        
        console.log("[WalletManager] Passkey created successfully");
        onPasskeyStored(passkey);
      } catch (prfError) {
        console.error("[WalletManager] Failed to create passkey with PRF:", prfError);
        throw new Error("Failed to create passkey with PRF. Please use a PRF-enabled authenticator.");
      }
      
      // Step 4: Authenticate to get PRF output and create bitmask
      if (extendedPasskey.prfOutput?.enabled === true) {
        console.log("[WalletManager] PRF is enabled, authenticating to create recovery bitmask...");
        
        // Store passkey info for later PRF evaluation
        localStorage.setItem(`passkey-${extendedPasskey.id}-salt`, prfSalt);
        
        setStatus("Authenticating with passkey to create recovery bitmask...");
        try {
          const { authenticateWithPRF } = await import("../lib/webauthn-prf");
          const prfOutput = await authenticateWithPRF(passkey.id, prfSalt);
          
          if (prfOutput) {
            console.log("\n=== Creating Recovery Bitmask ===");
            
            // Derive PRF-based mnemonic
            const prfMnemonic = await deriveMnemonicFromPRF(prfOutput);
            console.log("[WalletManager] PRF-derived mnemonic created");
            
            // Convert both mnemonics to entropy
            const originalEntropy = await mnemonicToEntropy(mnemonic);
            const prfEntropy = await mnemonicToEntropy(prfMnemonic);
            
            // Generate bitmask that bridges PRF mnemonic to original
            const bitmask = generateMnemonicBridgeBitmask(originalEntropy, prfEntropy);
            
            // Store the bitmask
            storeMnemonicBridgeBitmask(extendedPasskey.id, bitmask);
            
            // Store the passkey for later use during upgrade
            const storedPasskeys = JSON.parse(localStorage.getItem("eoa-passkeys") || "{}");
            storedPasskeys[newAccount.address] = passkey;
            localStorage.setItem("eoa-passkeys", JSON.stringify(storedPasskeys));
            
            setStatus("✓ Wallet created with recovery passkey!");
            console.log("\n=== Wallet Creation Complete ===");
            console.log("Original wallet derived from:", showMnemonicInput ? "imported mnemonic" : "generated mnemonic");
            console.log("Recovery bitmask created to bridge PRF mnemonic to original");
          } else {
            console.error("[WalletManager] No PRF output received during authentication");
            throw new Error("PRF authentication failed - no output received");
          }
        } catch (authError) {
          console.error("[WalletManager] PRF authentication failed:", authError);
          throw authError;
        }
      } else {
        console.error("[WalletManager] PRF is NOT enabled for this credential");
        throw new Error("PRF not supported by this authenticator. Please use a PRF-enabled authenticator.");
      }
    } catch (error: any) {
      console.error("Error creating wallet:", error);
      setError(error.message || "Failed to create wallet");
    } finally {
      setLoading(false);
    }
  };

  // Upgrades the EOA wallet to a CoinbaseSmartWallet and initializes passkey ownership
  const handleUpgradeWallet = async () => {
    if (!account) return;

    // Check if we have the passkey from EOA creation
    const storedPasskeys = localStorage.getItem("eoa-passkeys");
    if (!storedPasskeys) {
      setError("No passkey found. Please create a new EOA wallet first.");
      return;
    }
    
    const passkeys = JSON.parse(storedPasskeys);
    const passkey = passkeys[account.address];
    if (!passkey) {
      setError("No passkey found for this EOA address.");
      return;
    }

    try {
      setLoading(true);
      setError(null);
      setStatus("Starting wallet upgrade process...");

      console.log("\n=== Starting wallet upgrade process ===");
      console.log("EOA address:", account.address);
      console.log("Using existing passkey from EOA creation");

      // Create user's wallet client for signing
      const userWallet = createEOAClient(account);

      // Create public client for reading state
      const publicClient = createPublicClient({
        chain: baseSepolia,
                transport: http(),
      });

      // Create initialization args with both passkey and relayer as owners
      // We include the relayer as owner only for the purposes of this demo, which allows the relayer
      // to retrieve their entrypoint deposit while serving as a lightweight bundler.
      setStatus("Preparing initialization data and signature...");
      
      const relayerAddress = process.env.NEXT_PUBLIC_RELAYER_ADDRESS;
      if (!relayerAddress) {
        throw new Error("NEXT_PUBLIC_RELAYER_ADDRESS is not defined in environment variables");
      }
      
      console.log("[WalletManager] Passkey for initialization:", passkey);
      console.log("[WalletManager] Relayer address for initialization:", relayerAddress);
      
      const initArgs = encodeInitializeArgs([
        passkey,
        relayerAddress as Hex,
      ]);
      const nonce = await getNonceFromTracker(publicClient, account.address);
      const chainId = baseSepolia.id;

      // Create the setImplementationHash for the upgrade transaction
      const setImplementationHash = createSetImplementationHash(
        EIP7702PROXY_TEMPLATE_ADDRESS,
        CBSW_IMPLEMENTATION_ADDRESS,
        initArgs,
        nonce,
        ZERO_ADDRESS,
        false,
        BigInt(chainId),
        BigInt(maxUint256)
      );

      // Sign the hash
      const signature = await signSetImplementation(userWallet, setImplementationHash);

      // Create the authorization signature for EIP-7702
      setStatus("Creating authorization signature...");
      const authorization = await userWallet.signAuthorization({
        contractAddress: EIP7702PROXY_TEMPLATE_ADDRESS,
      });

      // Submit the combined upgrade transaction
      setStatus("Submitting upgrade transaction...");
      const upgradeResponse = await fetch("/api/relay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          {
            operation: "upgradeEOA",
            targetAddress: account.address,
            initArgs,
            signature,
            authorizationList: [authorization],
          },
          (_, value) => (typeof value === "bigint" ? value.toString() : value)
        ),
      });

      if (!upgradeResponse.ok) {
        const error = await upgradeResponse.json();
        throw new Error(error.error || "Failed to relay upgrade transaction");
      }
      const upgradeHash = (await upgradeResponse.json()).hash;
      console.log("Upgrade transaction submitted:", upgradeHash);

      // Wait for the upgrade transaction to be mined
      setStatus("Waiting for upgrade transaction confirmation...");
      const upgradeReceipt = await publicClient.waitForTransactionReceipt({
        hash: upgradeHash,
      });
      if (upgradeReceipt.status !== "success") {
        throw new Error("Upgrade transaction failed");
      }
      console.log("Upgrade transaction confirmed");

      // Check if the code was deployed
      setStatus("Verifying deployment...");
      const state = await checkContractState(publicClient, account.address);

      // TODO: establish constant expected bytecode in the contracts.ts file and use here and elsewhere
      if (state.bytecode !== "0x") {
        console.log("✓ Code deployed successfully");
        
        // Verify passkey ownership
        setStatus("✓ Verifying passkey ownership...");
        const isOwner = await verifyPasskeyOwnership(publicClient, account.address, passkey);

        if (!isOwner) {
          throw new Error("Passkey verification failed: not registered as an owner");
        }

        console.log("\n=== Wallet upgrade complete ===");
        setStatus("✓ EOA has been upgraded to a Coinbase Smart Wallet with verified passkey!");
        onUpgradeComplete(
          account.address as `0x${string}`,
          upgradeHash,
          state.bytecode
        );
        setIsUpgraded(true);
      } else {
        console.log("✗ Code deployment failed");
        throw new Error("Code deployment failed");
      }
    } catch (error: any) {
      console.error("Upgrade failed:", error);
      setError(formatError(error));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-4">
      {!account && (
        <>
          <div className="flex gap-2">
            <button
              onClick={() => setShowMnemonicInput(!showMnemonicInput)}
              className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700"
            >
              {showMnemonicInput ? "Generate New" : "Import Existing"}
            </button>
          </div>
          
          {showMnemonicInput && (
            <textarea
              value={mnemonicInput}
              onChange={(e) => setMnemonicInput(e.target.value)}
              placeholder="Enter your 12 word mnemonic phrase..."
              className="w-full p-3 bg-gray-800 text-white rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
              rows={3}
            />
          )}
          
          <button
            onClick={handleCreateEOA}
            disabled={loading}
            className="w-64 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
          >
            {loading ? "Creating..." : showMnemonicInput ? "Import Wallet" : "Create New Wallet"}
          </button>
        </>
      )}

      {account && !isUpgraded && (
        <button
          onClick={handleUpgradeWallet}
          disabled={loading}
          className="w-64 px-4 py-2 bg-purple-500 text-white rounded hover:bg-purple-600 disabled:opacity-50"
        >
          {loading ? "Upgrading..." : "Upgrade EOA to Smart Wallet"}
        </button>
      )}

      {originalMnemonic && !showMnemonicInput && (
        <div className="w-full p-4 bg-yellow-900 rounded">
          <p className="text-yellow-200 font-bold mb-2">⚠️ Save Your Recovery Phrase</p>
          <p className="text-sm font-mono bg-gray-800 p-3 rounded">{originalMnemonic}</p>
          <p className="text-xs text-yellow-300 mt-2">Write this down and store it safely. You&apos;ll need it to recover your wallet.</p>
        </div>
      )}

      {status && (
        <div className="w-full text-center">
          <p className="mb-2">Status:</p>
          <div className="bg-gray-900 text-green-400 p-4 rounded font-mono text-left">
            {status}
            {error && <div className="text-red-400">❌ Error: {error}</div>}
          </div>
        </div>
      )}
    </div>
  );
}
