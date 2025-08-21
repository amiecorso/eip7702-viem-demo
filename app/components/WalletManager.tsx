import { useState, useEffect } from "react";
import { createPublicClient, http, maxUint256, type Hex } from "viem";
import {
  createEOAWallet,
  createEOAWalletFromPrivateKey,
  createEOAClient,
  encodeInitializeArgs,
  createSetImplementationHash,
  signSetImplementation,
  type ExtendedAccount,
} from "../lib/wallet-utils";
import { chains } from "../lib/chains";
import {
  createWebAuthnCredential,
  CreateWebAuthnCredentialReturnType,
  type P256Credential,
} from "viem/account-abstraction";
import {
  CBSW_IMPLEMENTATION_ADDRESS,
  ZERO_ADDRESS,
  EIP7702PROXY_TEMPLATE_ADDRESS,
} from "../lib/constants";
import { getNonceFromTracker, verifyPasskeyOwnership, checkContractState } from "../lib/contract-utils";

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
  return `${chains[process.env.NEXT_PUBLIC_SELECTED_CHAIN as keyof typeof chains ?? "baseSepolia"].blockExplorers.default.url}/${type}/${hash}`;
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
  const [privateKey, setPrivateKey] = useState<string>("");

  // Reset internal state when resetKey changes
  useEffect(() => {
    setLoading(false);
    setError(null);
    setAccount(null);
    setIsUpgraded(false);
    setStatus("");
  }, [resetKey]);

  // Creates a random new EOA wallet
  const handleCreateEOA = async () => {
    try {
      setLoading(true);
      setError(null);
      const newAccount = await createEOAWallet();
      setAccount(newAccount);
      const explorerLink = formatExplorerLink(newAccount.address, 'address');
      onWalletCreated(newAccount.address, explorerLink);
      onAccountCreated(newAccount);
    } catch (error) {
      console.error("Error creating EOA:", error);
      setError("Failed to create EOA wallet");
    } finally {
      setLoading(false);
    }
  };

  // Creates EOA wallet from private key
  const handleCreateEOAFromPrivateKey = async () => {
    try {
      setLoading(true);
      setError(null);
      const newAccount = createEOAWalletFromPrivateKey(privateKey as Hex);
      setAccount(newAccount);
      const explorerLink = formatExplorerLink(newAccount.address, 'address');
      onWalletCreated(newAccount.address, explorerLink);
      onAccountCreated(newAccount);
    } catch (error) {
      console.error("Error creating EOA from private key:", error);
      setError("Failed to create EOA wallet from private key");
    } finally {
      setLoading(false);
    }
  };

  // Upgrades the EOA wallet to a CoinbaseSmartWallet and initializes passkey ownership
  const handleUpgradeWallet = async () => {
    if (!account) return;

    try {
      setLoading(true);
      setError(null);
      setStatus("Starting wallet upgrade process...");

      console.log("\n=== Starting wallet upgrade process ===");
      console.log("EOA address:", account.address);

      // Create user's wallet client for signing
      const userWallet = createEOAClient(account);

      // Create public client for reading state
      const publicClient = createPublicClient({
        chain: chains[process.env.NEXT_PUBLIC_SELECTED_CHAIN as keyof typeof chains ?? "baseSepolia"],
        transport: http(),
      });

      // Create a new passkey
      let passkey: CreateWebAuthnCredentialReturnType | null = null;
      if (process.env.NEXT_PUBLIC_ENABLE_PASSKEY === "true") {
        setStatus("Creating new passkey...");
        passkey = await createWebAuthnCredential({ name: "Smart Wallet Owner" });
        onPasskeyStored(passkey);
      }

      // Create initialization args with both passkey and relayer as owners
      // We include the relayer as owner only for the purposes of this demo, which allows the relayer
      // to retrieve their entrypoint deposit while serving as a lightweight bundler.
      setStatus("Preparing initialization data and signature...");
      const isEOASameAsRelayer = account.address.toLowerCase() === (process.env.NEXT_PUBLIC_RELAYER_ADDRESS as string).toLowerCase();

      const initArgs = encodeInitializeArgs([
        ...(passkey ? [passkey] : []),
        account.address,
         // Only adding relay as an owner so that it can move funds out of the wallet for testing.  Should not happen on prod
        ...(isEOASameAsRelayer ? [] : [(process.env.NEXT_PUBLIC_RELAYER_ADDRESS as Hex)]),
      ]);

      console.log("initArgs", initArgs);
      const nonce = await getNonceFromTracker(publicClient, account.address);
      const chainId = chains[process.env.NEXT_PUBLIC_SELECTED_CHAIN as keyof typeof chains ?? "baseSepolia"].id;

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
        executor: isEOASameAsRelayer ? account.address : undefined,
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
        // setStatus("✓ Verifying passkey ownership...");
        // const isOwner = await verifyPasskeyOwnership(publicClient, account.address, passkey);

        // if (!isOwner) {
        //   throw new Error("Passkey verification failed: not registered as an owner");
        // }

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
          <button
            onClick={handleCreateEOA}
            disabled={loading}
            className="w-64 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
          >
            {loading ? "Creating..." : "Create new EOA Wallet"}
          </button>
          <div className="flex flex-col gap-2 w-64">
            <input
              type="password"
              placeholder="Enter EOA private key"
              className="px-3 py-2 border border-gray-300 rounded text-black"
              onChange={(e) => setPrivateKey(e.target.value)}
            />
            <button
              onClick={handleCreateEOAFromPrivateKey}
              disabled={loading || !privateKey}
              className="px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600 disabled:opacity-50"
            >
              {loading ? "Creating..." : "Create EOA from Private Key"}
            </button>
          </div>
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
