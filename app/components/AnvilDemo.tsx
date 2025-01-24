import { useState } from "react";
import {
  createWalletClient,
  http,
  createPublicClient,
  parseEther,
  type Hex,
  type Hash,
  type Address,
  encodeAbiParameters,
  keccak256,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { foundry } from "viem/chains";
import { eip7702Actions } from "viem/experimental";
import {
  createEOAClient,
  encodeInitializeArgs,
  createInitializeHash,
  signInitialization,
} from "../lib/wallet-utils";

// Predefined Anvil accounts
const EOA_TO_UPGRADE = {
  address: "0x70997970C51812dc3A010C7d01b50e0d17dc79C8" as const,
  privateKey:
    "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d" as const,
};

const RELAYER = {
  address: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as const,
  privateKey:
    "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" as const,
};

// Configure local anvil chain
const localAnvil = {
  ...foundry,
  id: 31337,
  name: "Local Anvil",
  rpcUrls: {
    default: { http: ["http://127.0.0.1:8545"] },
    public: { http: ["http://127.0.0.1:8545"] },
  },
};

export function AnvilDemo() {
  const [status, setStatus] = useState<string>("");
  const [loading, setLoading] = useState(false);

  const addStatus = (message: string) => {
    console.log(message);
    setStatus((prev) => prev + "\n" + message);
  };

  const handleStartDemo = async () => {
    try {
      setLoading(true);
      setStatus("");

      // Step 1: Set up our accounts
      addStatus("=== Step 1: Setting up accounts ===");
      const accountToUpgrade = privateKeyToAccount(EOA_TO_UPGRADE.privateKey);
      const relayerAccount = privateKeyToAccount(RELAYER.privateKey);
      addStatus(`EOA to upgrade: ${accountToUpgrade.address}`);
      addStatus(`Relayer address: ${relayerAccount.address}`);

      // Step 2: Create wallet clients
      const userWallet = createEOAClient(
        {
          ...accountToUpgrade,
          _privateKey: EOA_TO_UPGRADE.privateKey,
        },
        true
      );

      const relayerWallet = createEOAClient(
        {
          ...relayerAccount,
          _privateKey: RELAYER.privateKey,
        },
        true
      );

      const publicClient = createPublicClient({
        chain: localAnvil,
        transport: http(),
      });

      // Step 3: Create authorization signature and prepare upgrade
      addStatus("\n=== Step 2: Creating authorization signature ===");
      const proxyAddress =
        "0x261D8c5e9742e6f7f1076Fa1F560894524e19cad" as `0x${string}`;
      addStatus(`Using proxy template: ${proxyAddress}`);

      // Prepare initialization data
      addStatus("\n=== Step 3: Preparing initialization data ===");

      // Encode the EOA address as the owner
      const encodedOwner = encodeAbiParameters(
        [{ type: "address" }],
        [accountToUpgrade.address]
      );

      // Encode the array of encoded owners (in this case, just one)
      const initArgs = encodeAbiParameters(
        [{ type: "bytes[]" }],
        [[encodedOwner]]
      );
      addStatus(`Encoded initialization args: ${initArgs}`);

      // Create initialization hash for signing
      // This is what the EOA will sign to prove they want to be the owner
      const abiEncoded = encodeAbiParameters(
        [
          { name: "proxyAddr", type: "address" },
          { name: "initArgs", type: "bytes" },
        ],
        [proxyAddress, initArgs]
      );
      addStatus(`ABI encoded data: ${abiEncoded}`);

      const initHashForSig = createInitializeHash(proxyAddress, initArgs);
      addStatus(`Initialization hash to sign: ${initHashForSig}`);

      // Verify we have a valid wallet client with private key
      if (!userWallet.account || !("_privateKey" in userWallet.account)) {
        throw new Error("Wallet client has no private key");
      }
      addStatus(`Using private key: ${userWallet.account._privateKey}`);

      // Sign the initialization hash (without Ethereum prefix)
      const initSignature = await signInitialization(
        userWallet,
        initHashForSig
      );
      addStatus(`Initialization signature: ${initSignature}`);

      const authorization = await userWallet.signAuthorization({
        contractAddress: proxyAddress,
        sponsor: relayerWallet.account.address,
      });

      addStatus(`Created authorization signature: ${authorization}`);

      // Step 4: Submit upgrade transaction
      addStatus("\n=== Step 4: Submitting upgrade transaction ===");
      const upgradeHash = await relayerWallet.sendTransaction({
        to: accountToUpgrade.address,
        abi: [
          {
            type: "function",
            name: "initialize",
            inputs: [
              { name: "args", type: "bytes" },
              { name: "signature", type: "bytes" },
            ],
            outputs: [],
            stateMutability: "payable",
          },
        ],
        functionName: "initialize",
        args: [initArgs, initSignature],
        authorizationList: [authorization],
      });
      await publicClient.waitForTransactionReceipt({ hash: upgradeHash });
      addStatus(`Upgrade transaction confirmed (tx: ${upgradeHash})`);

      // Step 5: Verify code deployment
      addStatus("\n=== Step 5: Verifying code deployment ===");
      const code = await publicClient.getCode({
        address: accountToUpgrade.address,
      });
      if (!code || code === "0x") {
        throw new Error("Code deployment failed - no code at address");
      }
      addStatus(
        `✓ Code deployed successfully! Length: ${(code.length - 2) / 2} bytes`
      );

      // Step 6: Verify EOA is owner
      addStatus("\n=== Step 6: Verifying EOA ownership ===");
      const isOwner = await publicClient.readContract({
        address: accountToUpgrade.address,
        abi: [
          {
            type: "function",
            name: "isOwner",
            inputs: [{ name: "owner", type: "address" }],
            outputs: [{ type: "bool" }],
            stateMutability: "view",
          },
        ],
        functionName: "isOwner",
        args: [accountToUpgrade.address],
      });

      if (isOwner) {
        addStatus("✓ Success! EOA is confirmed as owner of the smart wallet");
      } else {
        throw new Error("Ownership verification failed - EOA is not owner");
      }
    } catch (error: any) {
      addStatus(`\n❌ Error: ${error.message || String(error)}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-4">
      <button
        onClick={handleStartDemo}
        disabled={loading}
        className="w-64 px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
      >
        {loading ? "Running Demo..." : "Start Demo"}
      </button>

      {status && (
        <div className="w-full max-w-4xl">
          <pre className="bg-gray-900 text-green-400 p-4 rounded font-mono text-sm whitespace-pre-wrap">
            {status}
          </pre>
        </div>
      )}
    </div>
  );
}
