"use client";

import { useState } from "react";
import { type ExtendedAccount } from "./lib/wallet-utils";
import { type P256Credential, toCoinbaseSmartAccount, type UserOperation } from "viem/account-abstraction";
import { 
  generateMnemonic,
  validateMnemonic,
  deriveKeypairFromMnemonic,
  generatePRFSalt,
  deriveMnemonicFromPRF,
  mnemonicToEntropy,
  generateMnemonicBridgeBitmask,
  storeMnemonicBridgeBitmask,
  recoverOriginalMnemonic,
} from "./lib/prf-mnemonic-utils";
import { createWebAuthnCredentialWithPRF, authenticateWithPRF } from "./lib/webauthn-prf";
import { bytesToHex, hexToBytes } from "@noble/hashes/utils";
import { createEOAWalletFromMnemonic, createEOAClient, encodeInitializeArgs, createSetImplementationHash, signSetImplementation } from "./lib/wallet-utils";
import { createPublicClient, http, maxUint256, type Hex, parseEther } from "viem";
import { baseSepolia } from "./lib/chains";
import { CBSW_IMPLEMENTATION_ADDRESS, ZERO_ADDRESS, EIP7702PROXY_TEMPLATE_ADDRESS } from "./lib/constants";
import { getNonceFromTracker, checkContractState } from "./lib/contract-utils";
import { formatGasEstimate, GAS_ASSUMPTIONS } from "./lib/gas-utils";

export default function Home() {
  const [activeSection, setActiveSection] = useState<string>("generate");
  
  // Section 1: Generate Mnemonic
  const [generatedMnemonic, setGeneratedMnemonic] = useState<string>("");
  
  // Section 2: Upgrade Mnemonic to Smart Wallet
  const [walletMnemonic, setWalletMnemonic] = useState<string>("");
  const [walletAccount, setWalletAccount] = useState<ExtendedAccount | null>(null);
  const [walletAddress, setWalletAddress] = useState<string>("");
  const [upgradeStatus, setUpgradeStatus] = useState<string>("");
  const [isUpgraded, setIsUpgraded] = useState(false);
  
  // Transaction signing states
  const [txRecipient, setTxRecipient] = useState<string>("");
  const [txValue, setTxValue] = useState<string>("0.0001");
  const [eoaSignedTx, setEoaSignedTx] = useState<string>("");
  const [eoaGasEstimate, setEoaGasEstimate] = useState<string>("");
  const [userOp, setUserOp] = useState<string>("");
  const [userOpGasEstimate, setUserOpGasEstimate] = useState<string>("");
  const [signingStatus, setSigningStatus] = useState<string>("");
  
  // Section 3: Create PRF Passkey & Bitmask (Modified)
  const [bitmaskMnemonic, setBitmaskMnemonic] = useState<string>("");
  const [passkeyName, setPasskeyName] = useState<string>("");
  const [bitmaskPasskey, setBitmaskPasskey] = useState<P256Credential | null>(null);
  const [bitmaskOutput, setBitmaskOutput] = useState<string>("");
  const [prfMnemonic, setPrfMnemonic] = useState<string>("");
  const [bitmaskStatus, setBitmaskStatus] = useState<string>("");
  
  // Section 4: Recover Mnemonic (Modified to show names)
  const [availablePasskeys, setAvailablePasskeys] = useState<Array<{id: string, name: string}>>([]);
  const [selectedPasskeyId, setSelectedPasskeyId] = useState<string>("");
  const [recoveryBitmask, setRecoveryBitmask] = useState<string>("");
  const [recoveredMnemonic, setRecoveredMnemonic] = useState<string>("");
  const [recoveryStatus, setRecoveryStatus] = useState<string>("");

  // Section 1: Generate Mnemonic
  const handleGenerateMnemonic = () => {
    const mnemonic = generateMnemonic();
    setGeneratedMnemonic(mnemonic);
  };

  // Section 2: Upgrade Mnemonic to Smart Wallet
  const handleCreateWalletFromMnemonic = async () => {
    const trimmedMnemonic = walletMnemonic.trim();
    
    if (!trimmedMnemonic || !validateMnemonic(trimmedMnemonic)) {
      setUpgradeStatus("❌ Invalid mnemonic phrase");
      return;
    }

    try {
      setUpgradeStatus("Creating wallet from mnemonic...");
      
      // Derive keypair and create EOA
      const keypair = await deriveKeypairFromMnemonic(trimmedMnemonic, 0);
      const account = await createEOAWalletFromMnemonic(keypair.privateKey);
      
      setWalletAccount(account);
      setWalletAddress(account.address);
      setUpgradeStatus("✅ Wallet created. Click 'Upgrade to Smart Wallet' to continue.");
    } catch (error) {
      setUpgradeStatus(`❌ Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleUpgradeToSmartWallet = async () => {
    if (!walletAccount) {
      setUpgradeStatus("❌ Please create a wallet first");
      return;
    }

    try {
      setUpgradeStatus("Upgrading to smart wallet...");
      
      // Create clients
      const userWallet = createEOAClient(walletAccount);
      const publicClient = createPublicClient({
        chain: baseSepolia,
        transport: http(),
      });
      
      // Derive the EOA's public key from the mnemonic
      setUpgradeStatus("Deriving EOA public key...");
      const trimmedMnemonic = walletMnemonic.trim();
      const keypair = await deriveKeypairFromMnemonic(trimmedMnemonic, 0);
      const eoaPublicKey = keypair.publicKey;
      
      // For this version, we'll add both the EOA's public key and the relayer as owners
      const relayerAddress = process.env.NEXT_PUBLIC_RELAYER_ADDRESS;
      if (!relayerAddress) {
        throw new Error("NEXT_PUBLIC_RELAYER_ADDRESS not defined");
      }
      
      // Initialize with EOA public key and relayer
      const initArgs = encodeInitializeArgs([
        { publicKey: eoaPublicKey as Hex }, // EOA's secp256k1 public key
        relayerAddress as Hex,               // Relayer address
      ]);
      
      const nonce = await getNonceFromTracker(publicClient, walletAccount.address);
      const chainId = baseSepolia.id;
      
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
      
      const signature = await signSetImplementation(userWallet, setImplementationHash);
      
      // Create the authorization signature for EIP-7702
      setUpgradeStatus("Creating authorization signature...");
      const authorization = await userWallet.signAuthorization({
        contractAddress: EIP7702PROXY_TEMPLATE_ADDRESS,
      });
      
      setUpgradeStatus("Submitting upgrade transaction...");
      
      const upgradeResponse = await fetch("/api/relay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(
          {
            operation: "upgradeEOA",
            targetAddress: walletAccount.address,
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
      setUpgradeStatus("Waiting for confirmation...");
      
      const upgradeReceipt = await publicClient.waitForTransactionReceipt({
        hash: upgradeHash,
      });
      
      if (upgradeReceipt.status !== "success") {
        throw new Error("Upgrade transaction failed");
      }
      
      // Verify deployment
      const state = await checkContractState(publicClient, walletAccount.address);
      if (state.bytecode === "0x") {
        throw new Error("Code deployment failed");
      }
      
      setIsUpgraded(true);
      setUpgradeStatus(`✅ Successfully upgraded to smart wallet! 
        Address: ${walletAccount.address}
        Transaction: ${upgradeHash}
        The EOA can now sign UserOperations as a smart wallet owner using its secp256k1 key.`);
    } catch (error) {
      setUpgradeStatus(`❌ Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  // Sign transaction as EOA (using mnemonic-derived private key)
  const handleSignAsEOA = async () => {
    if (!walletAccount || !txRecipient) {
      setSigningStatus("❌ Please enter a recipient address");
      return;
    }

    try {
      setSigningStatus("Signing transaction as EOA...");
      
      const userWallet = createEOAClient(walletAccount);
      const publicClient = createPublicClient({
        chain: baseSepolia,
        transport: http(),
      });

      // Parse the value in ETH to wei
      const valueInWei = parseEther(txValue || "0");

      // Prepare the transaction
      const tx = {
        to: txRecipient as `0x${string}`,
        value: valueInWei,
        data: "0x" as `0x${string}`,
      };

      // Estimate gas
      const gasEstimate = await publicClient.estimateGas({
        ...tx,
        account: walletAccount.address,
      });

      // Get current gas prices
      const { maxFeePerGas, maxPriorityFeePerGas } = await publicClient.estimateFeesPerGas();

      // Build the complete transaction object
      const fullTx = {
        ...tx,
        gas: gasEstimate,
        maxFeePerGas: maxFeePerGas || BigInt(20000000000),
        maxPriorityFeePerGas: maxPriorityFeePerGas || BigInt(1000000000),
        nonce: await publicClient.getTransactionCount({ address: walletAccount.address }),
        chainId: baseSepolia.id,
      };

      // Sign the transaction
      const signedTx = await userWallet.signTransaction(fullTx);

      // Store both the RLP-encoded version and the object representation
      setEoaSignedTx(JSON.stringify({
        rlpEncoded: signedTx,
        decoded: {
          from: walletAccount.address,
          to: fullTx.to,
          value: fullTx.value.toString(),
          data: fullTx.data,
          gas: fullTx.gas.toString(),
          maxFeePerGas: fullTx.maxFeePerGas.toString(),
          maxPriorityFeePerGas: fullTx.maxPriorityFeePerGas.toString(),
          nonce: fullTx.nonce,
          chainId: fullTx.chainId,
        }
      }));
      
      // Use fixed gas assumptions for display
      setEoaGasEstimate(formatGasEstimate(gasEstimate, GAS_ASSUMPTIONS.gasPrice));
      setSigningStatus("✅ Transaction signed as EOA");
    } catch (error) {
      setSigningStatus(`❌ Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  // Sign UserOperation as 4337 Smart Account
  const handleSignAsSmartAccount = async () => {
    if (!walletAccount || !txRecipient || !isUpgraded) {
      setSigningStatus("❌ Please upgrade to smart wallet and enter a recipient address");
      return;
    }

    try {
      setSigningStatus("Creating UserOperation as smart account...");
      
      const publicClient = createPublicClient({
        chain: baseSepolia,
        transport: http(),
      });

      // Create smart account client
      // Since the EOA's public key was added as an owner during upgrade,
      // we can use the EOA account directly to sign UserOperations
      const smartAccount = await toCoinbaseSmartAccount({
        client: publicClient,
        owners: [walletAccount], // Use the EOA account directly
        address: walletAccount.address,
      });

      // Parse the value in ETH to wei
      const valueInWei = parseEther(txValue || "0");

      // Encode the call
      const callData = await smartAccount.encodeCalls([
        {
          to: txRecipient as `0x${string}`,
          value: valueInWei,
          data: "0x" as const,
        },
      ]);

      // Get nonce
      const nonce = await smartAccount.getNonce();

      // Get current gas prices from the network
      const { maxFeePerGas, maxPriorityFeePerGas } = await publicClient.estimateFeesPerGas();

      // Estimate gas for the actual call
      // This is a rough estimation - in production, you'd want to use the bundler's estimateUserOperationGas
      let callGasEstimate: bigint;
      try {
        // Try to estimate gas for the actual transaction
        callGasEstimate = await publicClient.estimateGas({
          account: walletAccount.address,
          to: txRecipient as `0x${string}`,
          value: valueInWei,
          data: "0x" as `0x${string}`,
        });
        // Add 20% buffer for smart contract overhead
        callGasEstimate = (callGasEstimate * BigInt(120)) / BigInt(100);
      } catch {
        // Fallback to default if estimation fails
        callGasEstimate = BigInt(100000);
      }

      // Gas limits with better defaults based on operation type
      const gasLimits = {
        callGasLimit: callGasEstimate < BigInt(50000) ? BigInt(50000) : callGasEstimate,
        verificationGasLimit: BigInt(150000), // Typical for signature verification
        preVerificationGas: BigInt(50000), // Typical bundler overhead
      };

      // Add buffer for safety
      const totalGasLimit = gasLimits.callGasLimit + gasLimits.verificationGasLimit + gasLimits.preVerificationGas;
      
      setSigningStatus(`Estimated gas: ${totalGasLimit.toString()} units. Creating UserOperation...`);

      // Prepare UserOperation
      const unsignedUserOp = {
        sender: smartAccount.address,
        nonce,
        initCode: "0x" as const,
        callData,
        callGasLimit: gasLimits.callGasLimit,
        verificationGasLimit: gasLimits.verificationGasLimit,
        preVerificationGas: gasLimits.preVerificationGas,
        maxFeePerGas: maxFeePerGas || BigInt(20000000000),
        maxPriorityFeePerGas: maxPriorityFeePerGas || BigInt(1000000000),
        paymasterAndData: "0x" as const,
        signature: "0x" as const,
      } as const;

      // Sign the UserOperation
      const signature = await smartAccount.signUserOperation(unsignedUserOp);
      const signedUserOp = { ...unsignedUserOp, signature } as UserOperation;

      // Calculate total gas for UserOp
      const totalGas = unsignedUserOp.callGasLimit + 
                      unsignedUserOp.verificationGasLimit + 
                      unsignedUserOp.preVerificationGas;

      // Create a packed representation of the UserOp (similar to RLP for regular txs)
      // This is a simplified packed format for display purposes
      const packedUserOp = [
        signedUserOp.sender,
        '0x' + signedUserOp.nonce.toString(16).padStart(64, '0'),
        signedUserOp.initCode,
        signedUserOp.callData,
        '0x' + signedUserOp.callGasLimit.toString(16).padStart(64, '0'),
        '0x' + signedUserOp.verificationGasLimit.toString(16).padStart(64, '0'),
        '0x' + signedUserOp.preVerificationGas.toString(16).padStart(64, '0'),
        '0x' + signedUserOp.maxFeePerGas.toString(16).padStart(64, '0'),
        '0x' + signedUserOp.maxPriorityFeePerGas.toString(16).padStart(64, '0'),
        signedUserOp.paymasterAndData,
        signedUserOp.signature
      ].join('');

      setUserOp(JSON.stringify({
        packed: packedUserOp,
        decoded: JSON.parse(JSON.stringify(signedUserOp, (_, value) => 
          typeof value === "bigint" ? value.toString() : value
        ))
      }, null, 2));
      
      // Use fixed gas assumptions for display with breakdown
      setUserOpGasEstimate(formatGasEstimate(
        totalGas, 
        GAS_ASSUMPTIONS.gasPrice,
        {
          call: unsignedUserOp.callGasLimit,
          verification: unsignedUserOp.verificationGasLimit,
          preVerification: unsignedUserOp.preVerificationGas,
        }
      ));
      setSigningStatus("✅ UserOperation created and signed");
    } catch (error) {
      console.error("Error signing as smart account:", error);
      setSigningStatus(`❌ Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  // Section 3: Create PRF Passkey & Bitmask
  const handleCreateBitmask = async () => {
    const trimmedMnemonic = bitmaskMnemonic.trim();
    
    if (!trimmedMnemonic || !validateMnemonic(trimmedMnemonic)) {
      setBitmaskStatus("❌ Invalid mnemonic phrase");
      return;
    }

    if (!passkeyName.trim()) {
      setBitmaskStatus("❌ Please enter a name for the passkey");
      return;
    }

    try {
      setBitmaskStatus("Creating PRF passkey...");
      
      // Create passkey with PRF using the user-defined name
      const tempId = Date.now().toString();
      const prfSalt = generatePRFSalt(tempId);
      
      const extendedPasskey = await createWebAuthnCredentialWithPRF(
        passkeyName.trim(), // Use the user-defined name
        prfSalt
      );
      
      if (extendedPasskey.prfOutput?.enabled !== true) {
        throw new Error("PRF not supported by this authenticator");
      }
      
      const passkey: P256Credential = {
        id: extendedPasskey.id,
        publicKey: extendedPasskey.publicKey.startsWith('0x') 
          ? extendedPasskey.publicKey as Hex 
          : `0x${extendedPasskey.publicKey}` as Hex,
        raw: extendedPasskey.raw,
      };
      
      setBitmaskPasskey(passkey);
      
      // Store salt and name for later
      localStorage.setItem(`passkey-${extendedPasskey.id}-salt`, prfSalt);
      localStorage.setItem(`passkey-${extendedPasskey.id}-name`, passkeyName.trim());
      
      setBitmaskStatus("Authenticating to get PRF output...");
      
      // Authenticate to get PRF output
      const prfOutput = await authenticateWithPRF(passkey.id, prfSalt);
      
      if (!prfOutput) {
        throw new Error("No PRF output received");
      }
      
      // Derive PRF mnemonic
      const prfDerivedMnemonic = await deriveMnemonicFromPRF(prfOutput);
      setPrfMnemonic(prfDerivedMnemonic);
      
      // Generate bitmask
      setBitmaskStatus("Generating bitmask...");
      
      const originalEntropy = await mnemonicToEntropy(trimmedMnemonic);
      const prfEntropy = await mnemonicToEntropy(prfDerivedMnemonic);
      const bitmask = generateMnemonicBridgeBitmask(originalEntropy, prfEntropy);
      
      const bitmaskHex = bytesToHex(new Uint8Array(bitmask));
      setBitmaskOutput(bitmaskHex);
      
      // Store bitmask
      storeMnemonicBridgeBitmask(extendedPasskey.id, bitmask);
      
      setBitmaskStatus(`✅ Bitmask created! Passkey "${passkeyName}" (ID: ${passkey.id})`);
    } catch (error) {
      setBitmaskStatus(`❌ Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  // Section 4: Recover Mnemonic (Modified to show names)
  const loadAvailablePasskeys = () => {
    const passkeys: Array<{id: string, name: string}> = [];
    
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key && key.startsWith('passkey-') && key.endsWith('-salt')) {
        // Extract passkey ID from the key
        const passkeyId = key.replace('passkey-', '').replace('-salt', '');
        // Get the stored name for this passkey
        const storedName = localStorage.getItem(`passkey-${passkeyId}-name`);
        const name = storedName || `Unnamed Passkey (${passkeyId.substring(0, 8)}...)`;
        passkeys.push({ id: passkeyId, name });
      }
    }
    
    setAvailablePasskeys(passkeys);
    if (passkeys.length > 0 && !selectedPasskeyId) {
      setSelectedPasskeyId(passkeys[0].id);
    }
  };

  const handleRecoverMnemonic = async () => {
    const trimmedBitmask = recoveryBitmask.trim();
    
    if (!trimmedBitmask || !selectedPasskeyId) {
      setRecoveryStatus("❌ Please select a passkey and provide a bitmask");
      return;
    }

    try {
      setRecoveryStatus("Authenticating with selected passkey...");
      
      // Get stored salt or generate new one
      const storedSalt = localStorage.getItem(`passkey-${selectedPasskeyId}-salt`);
      const salt = storedSalt || generatePRFSalt(selectedPasskeyId);
      
      // Authenticate to get PRF output
      const prfOutput = await authenticateWithPRF(selectedPasskeyId, salt);
      
      if (!prfOutput) {
        throw new Error("No PRF output received - make sure to use the correct passkey");
      }
      
      // Derive PRF mnemonic
      setRecoveryStatus("Deriving PRF mnemonic...");
      const prfDerivedMnemonic = await deriveMnemonicFromPRF(prfOutput);
      
      // Convert bitmask from hex
      const bitmaskBytes = hexToBytes(trimmedBitmask);
      
      // Recover original mnemonic
      setRecoveryStatus("Recovering original mnemonic...");
      const prfEntropy = await mnemonicToEntropy(prfDerivedMnemonic);
      const recovered = recoverOriginalMnemonic(prfEntropy, bitmaskBytes.buffer as ArrayBuffer);
      
      setRecoveredMnemonic(recovered);
      setRecoveryStatus("✅ Mnemonic recovered successfully!");
    } catch (error) {
      setRecoveryStatus(`❌ Error: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  // Handle section changes
  const handleSectionChange = (sectionId: string) => {
    setActiveSection(sectionId);
    
    // Load passkeys when switching to recover
    if (sectionId === 'recover') {
      loadAvailablePasskeys();
    }
    
    // Reset states when switching sections
    if (sectionId !== "upgrade") {
      // Reset transaction signing states
      setTxRecipient("");
      setTxValue("0.0001");
      setEoaSignedTx("");
      setEoaGasEstimate("");
      setUserOp("");
      setUserOpGasEstimate("");
      setSigningStatus("");
    }
  };

  const sections = [
    { id: "generate", title: "1. Generate Mnemonic" },
    { id: "upgrade", title: "2. Upgrade Mnemonic to Smart Wallet" },
    { id: "bitmask", title: "3. Create PRF Passkey & Bitmask" },
    { id: "recover", title: "4. Recover Mnemonic" },
  ];

  return (
    <main className="flex min-h-screen flex-col items-center p-8">
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold mb-4">
          <a
            href="https://github.com/ethereum/EIPs/blob/master/EIPS/eip-7702.md"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 hover:text-blue-300 underline"
          >
            EIP-7702
          </a>{" "}
          + PRF Demo
        </h1>
        <p className="text-xl text-gray-400">
          Mnemonic Recovery with WebAuthn PRF
        </p>
      </div>

      {/* Section Navigation (Updated) */}
      <div className="flex gap-4 mb-8">
        {sections.map((section) => (
          <button
            key={section.id}
            onClick={() => handleSectionChange(section.id)}
            className={`px-4 py-2 rounded transition-colors ${
              activeSection === section.id
                ? "bg-blue-600 text-white"
                : "bg-gray-700 text-gray-300 hover:bg-gray-600"
            }`}
          >
            {section.title}
          </button>
        ))}
      </div>

      <div className="w-full max-w-4xl">
        {/* Section 1: Generate Mnemonic */}
        {activeSection === "generate" && (
          <div className="bg-gray-900 p-8 rounded-lg">
            <h2 className="text-2xl font-bold mb-6 text-blue-400">Generate Mnemonic</h2>
            <p className="text-gray-400 mb-6">
              Generate a new 12-word BIP39 mnemonic phrase for wallet creation.
            </p>
            
            <button
              onClick={handleGenerateMnemonic}
              className="px-6 py-3 bg-blue-500 text-white rounded hover:bg-blue-600 mb-6"
            >
              Generate New Mnemonic
            </button>
            
            {generatedMnemonic && (
              <div className="bg-gray-800 p-4 rounded">
                <h3 className="font-bold text-green-400 mb-2">Generated Mnemonic:</h3>
                <p className="font-mono text-sm">{generatedMnemonic}</p>
                <p className="text-xs text-yellow-400 mt-3">
                  ⚠️ Save this mnemonic securely. You&apos;ll need it to recover your wallet.
                </p>
              </div>
            )}
          </div>
        )}

        {/* Section 2: Upgrade Mnemonic to Smart Wallet (Updated UI) */}
        {activeSection === "upgrade" && (
          <div className="bg-gray-900 p-8 rounded-lg">
            <h2 className="text-2xl font-bold mb-6 text-blue-400">Upgrade Mnemonic to Smart Wallet</h2>
            <p className="text-gray-400 mb-6">
              Create an EOA from a mnemonic and upgrade it to a Coinbase Smart Wallet using EIP-7702.
              The EOA remains in control through its private key.
            </p>
            
            <div className="space-y-4">
              <textarea
                value={walletMnemonic}
                onChange={(e) => setWalletMnemonic(e.target.value)}
                placeholder="Enter your 12-word mnemonic phrase..."
                className="w-full p-3 bg-gray-800 text-white rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
                rows={3}
              />
              
              <div className="flex gap-4">
                <button
                  onClick={handleCreateWalletFromMnemonic}
                  className="px-6 py-3 bg-blue-500 text-white rounded hover:bg-blue-600"
                >
                  Create Wallet
                </button>
                
                {walletAccount && !isUpgraded && (
                  <button
                    onClick={handleUpgradeToSmartWallet}
                    className="px-6 py-3 bg-purple-500 text-white rounded hover:bg-purple-600"
                  >
                    Upgrade to Smart Wallet
                  </button>
                )}
              </div>
              
              {walletAddress && (
                <div className="bg-gray-800 p-4 rounded">
                  <p className="text-sm">
                    <span className="text-gray-400">Wallet Address:</span>{" "}
                    <span className="font-mono text-green-400">{walletAddress}</span>
                  </p>
                  {isUpgraded && (
                    <p className="text-xs text-gray-500 mt-2">
                      This EOA now has smart wallet capabilities through EIP-7702
                    </p>
                  )}
                </div>
              )}
              
              {upgradeStatus && (
                <div className="bg-gray-800 p-4 rounded">
                  <p className="text-sm font-mono whitespace-pre-line">{upgradeStatus}</p>
                </div>
              )}

              {/* Transaction Signing Section */}
              {isUpgraded && (
                <div className="mt-8 space-y-4">
                  <h3 className="text-xl font-bold text-purple-400">Sign Transactions</h3>
                  <p className="text-gray-400 text-sm">
                    Sign a transaction as an EOA (using mnemonic) or as a 4337 smart account owner.
                  </p>
                  
                  <div className="space-y-3">
                    <input
                      type="text"
                      value={txRecipient}
                      onChange={(e) => setTxRecipient(e.target.value)}
                      placeholder="Recipient address (0x...)"
                      className="w-full p-3 bg-gray-800 text-white rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
                    />
                    
                    <input
                      type="text"
                      value={txValue}
                      onChange={(e) => setTxValue(e.target.value)}
                      placeholder="Value in ETH (default: 0.0001)"
                      className="w-full p-3 bg-gray-800 text-white rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
                    />
                    
                    <div className="flex gap-4">
                      <button
                        onClick={handleSignAsEOA}
                        className="px-6 py-3 bg-green-500 text-white rounded hover:bg-green-600"
                      >
                        Sign as EOA
                      </button>
                      
                      <button
                        onClick={handleSignAsSmartAccount}
                        className="px-6 py-3 bg-indigo-500 text-white rounded hover:bg-indigo-600"
                      >
                        Sign as Smart Account (4337)
                      </button>
                    </div>
                    
                    {signingStatus && (
                      <div className="bg-gray-800 p-4 rounded">
                        <p className="text-sm font-mono">{signingStatus}</p>
                      </div>
                    )}
                    
                    {/* EOA Signed Transaction */}
                    {eoaSignedTx && (
                      <div className="bg-gray-800 p-4 rounded">
                        <h4 className="font-bold text-green-400 mb-2">EOA Signed Transaction:</h4>
                        <p className="text-xs text-gray-400 mb-2">{eoaGasEstimate}</p>
                        {(() => {
                          try {
                            const txData = JSON.parse(eoaSignedTx);
                            return (
                              <>
                                <div className="mb-4">
                                  <h5 className="text-sm font-semibold text-gray-300 mb-2">RLP Encoded (Raw):</h5>
                                  <div className="bg-gray-900 p-3 rounded overflow-x-auto">
                                    <pre className="text-xs font-mono text-gray-300 whitespace-pre-wrap break-all">
                                      {txData.rlpEncoded}
                                    </pre>
                                  </div>
                                </div>
                                <div>
                                  <h5 className="text-sm font-semibold text-gray-300 mb-2">Decoded Transaction:</h5>
                                  <div className="bg-gray-900 p-3 rounded overflow-x-auto">
                                    <pre className="text-xs font-mono text-gray-300">
                                      {JSON.stringify(txData.decoded, null, 2)}
                                    </pre>
                                  </div>
                                </div>
                              </>
                            );
                          } catch {
                            // Fallback for old format
                            return (
                              <div className="bg-gray-900 p-3 rounded overflow-x-auto">
                                <pre className="text-xs font-mono text-gray-300 whitespace-pre-wrap break-all">
                                  {eoaSignedTx}
                                </pre>
                              </div>
                            );
                          }
                        })()}
                      </div>
                    )}
                    
                    {/* Smart Account UserOperation */}
                    {userOp && (
                      <div className="bg-gray-800 p-4 rounded">
                        <h4 className="font-bold text-indigo-400 mb-2">Smart Account UserOperation:</h4>
                        <p className="text-xs text-gray-400 mb-2">{userOpGasEstimate}</p>
                        {(() => {
                          try {
                            const userOpData = JSON.parse(userOp);
                            return (
                              <>
                                <div className="mb-4">
                                  <h5 className="text-sm font-semibold text-gray-300 mb-2">Packed UserOp (Raw):</h5>
                                  <div className="bg-gray-900 p-3 rounded overflow-x-auto">
                                    <pre className="text-xs font-mono text-gray-300 whitespace-pre-wrap break-all">
                                      {userOpData.packed}
                                    </pre>
                                  </div>
                                </div>
                                <div>
                                  <h5 className="text-sm font-semibold text-gray-300 mb-2">Decoded UserOperation:</h5>
                                  <div className="bg-gray-900 p-3 rounded overflow-x-auto max-h-96 overflow-y-auto">
                                    <pre className="text-xs font-mono text-gray-300">
                                      {JSON.stringify(userOpData.decoded, null, 2)}
                                    </pre>
                                  </div>
                                </div>
                              </>
                            );
                          } catch {
                            // Fallback for old format
                            return (
                              <div className="bg-gray-900 p-3 rounded overflow-x-auto max-h-96 overflow-y-auto">
                                <pre className="text-xs font-mono text-gray-300">
                                  {userOp}
                                </pre>
                              </div>
                            );
                          }
                        })()}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Section 3: Create PRF Passkey & Bitmask (Updated) */}
        {activeSection === "bitmask" && (
          <div className="bg-gray-900 p-8 rounded-lg">
            <h2 className="text-2xl font-bold mb-6 text-blue-400">Create PRF Passkey & Bitmask</h2>
            <p className="text-gray-400 mb-6">
              Create a named PRF-enabled passkey and generate a bitmask that bridges to your mnemonic.
            </p>
            
            <div className="space-y-4">
              <div>
                <label className="block text-gray-400 mb-2">Passkey Name:</label>
                <input
                  type="text"
                  value={passkeyName}
                  onChange={(e) => setPasskeyName(e.target.value)}
                  placeholder="e.g., My Recovery Key, Hardware Wallet, etc."
                  className="w-full p-3 bg-gray-800 text-white rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
                />
              </div>
              
              <div>
                <label className="block text-gray-400 mb-2">Mnemonic to Protect:</label>
                <textarea
                  value={bitmaskMnemonic}
                  onChange={(e) => setBitmaskMnemonic(e.target.value)}
                  placeholder="Enter any 12-word mnemonic phrase..."
                  className="w-full p-3 bg-gray-800 text-white rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
                  rows={3}
                />
              </div>
              
              <button
                onClick={handleCreateBitmask}
                className="px-6 py-3 bg-blue-500 text-white rounded hover:bg-blue-600"
              >
                Create Named PRF Passkey & Generate Bitmask
              </button>
              
              {bitmaskPasskey && (
                <div className="bg-gray-800 p-4 rounded">
                  <p className="text-sm mb-2">
                    <span className="text-gray-400">Passkey Name:</span>{" "}
                    <span className="font-mono text-green-400">{passkeyName}</span>
                  </p>
                  <p className="text-sm">
                    <span className="text-gray-400">Passkey ID:</span>{" "}
                    <span className="font-mono text-blue-400">{bitmaskPasskey.id}</span>
                  </p>
                </div>
              )}
              
              {prfMnemonic && (
                <div className="bg-gray-800 p-4 rounded">
                  <h3 className="font-bold text-green-400 mb-2">PRF-Derived Mnemonic:</h3>
                  <p className="font-mono text-sm">{prfMnemonic}</p>
                </div>
              )}
              
              {bitmaskOutput && (
                <div className="bg-gray-800 p-4 rounded">
                  <h3 className="font-bold text-green-400 mb-2">Bitmask (hex):</h3>
                  <p className="font-mono text-xs break-all">{bitmaskOutput}</p>
                  <p className="text-xs text-gray-500 mt-2">
                    Save this bitmask - combined with your &quot;{passkeyName}&quot; passkey, it can recover your original mnemonic
                  </p>
                </div>
              )}
              
              {bitmaskStatus && (
                <div className="bg-gray-800 p-4 rounded">
                  <p className="text-sm font-mono">{bitmaskStatus}</p>
                </div>
              )}
            </div>
          </div>
        )}

        {/* Section 4: Recover Mnemonic (Updated) */}
        {activeSection === "recover" && (
          <div className="bg-gray-900 p-8 rounded-lg">
            <h2 className="text-2xl font-bold mb-6 text-blue-400">Recover Mnemonic</h2>
            <p className="text-gray-400 mb-6">
              Select a passkey and provide the bitmask to recover your original mnemonic.
            </p>
            
            <div className="space-y-4">
              {availablePasskeys.length > 0 ? (
                <div>
                  <label className="block text-gray-400 mb-2">Select Passkey:</label>
                  <select
                    value={selectedPasskeyId}
                    onChange={(e) => setSelectedPasskeyId(e.target.value)}
                    className="w-full p-3 bg-gray-800 text-white rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
                  >
                    {availablePasskeys.map((passkey) => (
                      <option key={passkey.id} value={passkey.id}>
                        {passkey.name}
                      </option>
                    ))}
                  </select>
                  <p className="text-xs text-gray-500 mt-1">
                    {availablePasskeys.length} passkey{availablePasskeys.length !== 1 ? 's' : ''} found
                  </p>
                </div>
              ) : (
                <div className="bg-gray-800 p-4 rounded">
                  <p className="text-yellow-400">
                    No passkeys found. Create a PRF passkey in Section 3 first.
                  </p>
                </div>
              )}
              
              <textarea
                value={recoveryBitmask}
                onChange={(e) => setRecoveryBitmask(e.target.value)}
                placeholder="Enter bitmask (hex)..."
                className="w-full p-3 bg-gray-800 text-white rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
                rows={3}
              />
              
              <button
                onClick={handleRecoverMnemonic}
                disabled={availablePasskeys.length === 0}
                className="px-6 py-3 bg-purple-500 text-white rounded hover:bg-purple-600 disabled:opacity-50 disabled:cursor-not-allowed"
              >
                Recover Mnemonic
              </button>
              
              {recoveredMnemonic && (
                <div className="bg-gray-800 p-4 rounded">
                  <h3 className="font-bold text-green-400 mb-2">Recovered Mnemonic:</h3>
                  <p className="font-mono text-sm">{recoveredMnemonic}</p>
                  <p className="text-xs text-green-400 mt-3">
                    ✅ Successfully recovered your original mnemonic!
                  </p>
                </div>
              )}
              
              {recoveryStatus && (
                <div className="bg-gray-800 p-4 rounded">
                  <p className="text-sm font-mono">{recoveryStatus}</p>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </main>
  );
}
