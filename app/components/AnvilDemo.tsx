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

      // Create wallet clients
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

      // Step 2: Prepare upgrade data
      addStatus("\n=== Step 2: Preparing upgrade data ===");
      const proxyAddress =
        "0x261D8c5e9742e6f7f1076Fa1F560894524e19cad" as `0x${string}`;
      addStatus(`Using proxy template: ${proxyAddress}`);

      // Create authorization signature
      const authorization = await userWallet.signAuthorization({
        contractAddress: proxyAddress,
        sponsor: relayerWallet.account.address,
      });
      addStatus(`Created authorization signature: ${authorization}`);

      // Step 3: Prepare initialization data
      addStatus("\n=== Step 3: Preparing initialization data ===");

      // Encode the array of encoded owners (in this case, just one)
      const initArgs = encodeInitializeArgs(relayerWallet.account.address);
      addStatus(`Encoded initialization args: ${initArgs}`);

      // Create initialization hash for signing
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

      // Step 4: Submit upgrade transaction
      addStatus("\n=== Step 4: Submitting upgrade transaction ===");
      const upgradeHash = await relayerWallet.sendTransaction({
        to: accountToUpgrade.address,
        authorizationList: [authorization],
      });
      const upgradeReceipt = await publicClient.waitForTransactionReceipt({
        hash: upgradeHash,
      });
      if (upgradeReceipt.status !== "success") {
        throw new Error("Upgrade transaction reverted");
      }
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

      // Step 6: Submit initialization transaction
      addStatus("\n=== Step 6: Submitting initialization transaction ===");
      addStatus(`Initialization args: ${initArgs}`);
      addStatus(`Initialization signature: ${initSignature}`);

      const initHash = await relayerWallet.sendTransaction({
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
      });
      const initReceipt = await publicClient.waitForTransactionReceipt({
        hash: initHash,
      });
      if (initReceipt.status !== "success") {
        throw new Error("Initialization transaction reverted");
      }
      addStatus(`Initialization transaction confirmed (tx: ${initHash})`);

      // Inspect the transaction receipt in detail
      addStatus("\n=== Initialization Transaction Details ===");
      addStatus(`Gas used: ${initReceipt.gasUsed}`);
      addStatus(`Block number: ${initReceipt.blockNumber}`);
      addStatus(`Transaction status: ${initReceipt.status}`);

      // Look for any logs/events
      if (initReceipt.logs && initReceipt.logs.length > 0) {
        addStatus("\nTransaction logs:");
        initReceipt.logs.forEach((log, index) => {
          addStatus(`\nLog ${index + 1}:`);
          addStatus(`  Address: ${log.address}`);
          addStatus(`  Topics: ${JSON.stringify(log.topics)}`);
          addStatus(`  Data: ${log.data}`);

          // Try to decode if it's an AddOwner event
          if (
            log.topics[0] ===
            keccak256(new TextEncoder().encode("AddOwner(uint256,bytes)"))
          ) {
            addStatus("  This appears to be an AddOwner event!");
            // The first topic is the event signature
            // The second topic should be the indexed ownerIndex
            const ownerIndex = log.topics[1];
            addStatus(`  Owner Index: ${ownerIndex}`);
            // The data contains the non-indexed owner bytes
            addStatus(`  Owner Data: ${log.data}`);
          }
        });
      } else {
        addStatus("\nNo logs found in the transaction receipt!");
      }

      // Step 7: Verify EOA ownership
      addStatus("\n=== Step 7: Verifying Relayer ownership ===");
      addStatus(`Checking if ${relayerWallet.account.address} is owner...`);

      // Let's check the owner count first
      const ownerCount = await publicClient.readContract({
        address: accountToUpgrade.address,
        abi: [
          {
            type: "function",
            name: "ownerCount",
            inputs: [],
            outputs: [{ type: "uint256" }],
            stateMutability: "view",
          },
        ],
        functionName: "ownerCount",
      });
      addStatus(`Current owner count: ${ownerCount}`);

      // Let's also check nextOwnerIndex and removedOwnersCount
      const nextOwnerIndex = await publicClient.readContract({
        address: accountToUpgrade.address,
        abi: [
          {
            type: "function",
            name: "nextOwnerIndex",
            inputs: [],
            outputs: [{ type: "uint256" }],
            stateMutability: "view",
          },
        ],
        functionName: "nextOwnerIndex",
      });
      addStatus(`Next owner index: ${nextOwnerIndex}`);

      const removedOwnersCount = await publicClient.readContract({
        address: accountToUpgrade.address,
        abi: [
          {
            type: "function",
            name: "removedOwnersCount",
            inputs: [],
            outputs: [{ type: "uint256" }],
            stateMutability: "view",
          },
        ],
        functionName: "removedOwnersCount",
      });
      addStatus(`Removed owners count: ${removedOwnersCount}`);

      // Let's check what's at index 0
      const ownerAtZero = await publicClient.readContract({
        address: accountToUpgrade.address,
        abi: [
          {
            type: "function",
            name: "ownerAtIndex",
            inputs: [{ type: "uint256" }],
            outputs: [{ type: "bytes" }],
            stateMutability: "view",
          },
        ],
        functionName: "ownerAtIndex",
        args: [BigInt(0)],
      });
      addStatus(`Owner at index 0: ${ownerAtZero}`);

      try {
        const isOwnerAddress = await publicClient.readContract({
          address: accountToUpgrade.address,
          abi: [
            {
              type: "function",
              name: "isOwnerAddress",
              inputs: [{ name: "owner", type: "address" }],
              outputs: [{ type: "bool" }],
              stateMutability: "view",
            },
          ],
          functionName: "isOwnerAddress",
          args: [relayerWallet.account.address],
        });

        if (isOwnerAddress) {
          addStatus(
            "✓ Success! Relayer is confirmed as owner of the smart wallet"
          );
        } else {
          throw new Error(
            "Ownership verification failed - Relayer is not owner"
          );
        }
      } catch (e) {
        addStatus(`Error checking ownership: ${e}`);
        throw new Error(
          "Ownership verification failed - could not check ownership"
        );
      }
    } catch (error: any) {
      addStatus(`\n❌ Error: ${error.message || String(error)}`);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <button
        onClick={handleStartDemo}
        disabled={loading}
        className="px-4 py-2 text-sm font-semibold text-white bg-blue-500 rounded hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? "Running..." : "Start Demo"}
      </button>
      {status && (
        <pre className="p-4 bg-gray-900 text-green-400 rounded overflow-x-auto">
          {status}
        </pre>
      )}
    </div>
  );
}
