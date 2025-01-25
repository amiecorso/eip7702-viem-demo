import {
  createPublicClient,
  createWalletClient,
  encodeAbiParameters,
  WalletClient,
  http,
  type Hex,
  parseEther,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { secp256k1 } from "@noble/curves/secp256k1";
import { hexToBytes } from "@noble/curves/abstract/utils";
import { keccak256 as keccak256Crypto } from "ethereum-cryptography/keccak";
import { eip7702Actions } from "viem/experimental";
import { anvil } from "viem/chains";
import crypto from "crypto";

// Add a type for our extended account
type ExtendedAccount = ReturnType<typeof privateKeyToAccount> & {
  _privateKey: Hex;
};

// Constants
const PROXY_ADDRESS = "0x261D8c5e9742e6f7f1076Fa1F560894524e19cad";

// Predefined Anvil relayer account for testing
const RELAYER = {
  address: "0x3C44CdDdB6a900fa2b585dd299e03d12FA4293BC" as const,
  privateKey:
    "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a" as const,
};

export function createRandomEOAWallet() {
  const randomBytes = crypto.randomBytes(32);
  const privateKey = `0x${randomBytes.toString("hex")}` as const;
  const account = privateKeyToAccount(privateKey);
  // Store the private key on the account object
  return { ...account, _privateKey: privateKey } as ExtendedAccount;
}

export function createEOAClient(account: ExtendedAccount, useAnvil = true) {
  // Create the wallet client with the extended account to get access to private key
  return createWalletClient({
    account,
    chain: anvil,
    transport: http(),
  }).extend(eip7702Actions());
}

export function encodeInitializeArgs(ownerAddress: Hex): Hex {
  // First encode the owner address
  const encodedOwner = encodeAbiParameters(
    [{ type: "address" }],
    [ownerAddress]
  );

  // Create an array with the single encoded owner
  const owners = [encodedOwner];

  // Then encode the array of encoded owners
  const initArgs = encodeAbiParameters([{ type: "bytes[]" }], [owners]);
  return initArgs;
}

export function createInitializeHash(proxyAddr: Hex, initArgs: Hex): Hex {
  // ABI encode the proxy address and init args
  const abiEncoded = encodeAbiParameters(
    [
      { name: "proxyAddr", type: "address" },
      { name: "initArgs", type: "bytes" },
    ],
    [proxyAddr, initArgs]
  );

  // Convert hex string to Uint8Array for keccak256
  const abiEncodedBytes = hexToBytes(abiEncoded.slice(2));
  const hashBytes = keccak256Crypto(abiEncodedBytes);
  const hash = `0x${Buffer.from(hashBytes).toString("hex")}` as Hex;
  return hash;
}

// Create a raw signature without Ethereum prefix
export async function signInitialization(
  walletClient: WalletClient,
  hash: Hex
): Promise<Hex> {
  if (!walletClient.account) {
    throw new Error("Wallet client has no account");
  }

  // Get the private key from our extended account
  const privateKeyBytes = hexToBytes(
    (walletClient.account as ExtendedAccount)._privateKey.slice(2)
  );

  // Sign the hash (without any Ethereum prefix)
  const hashBytes = hexToBytes(hash.slice(2));
  const signature = secp256k1.sign(hashBytes, privateKeyBytes);

  // Get r, s, v values
  const r = signature.r.toString(16).padStart(64, "0");
  const s = signature.s.toString(16).padStart(64, "0");
  const v = signature.recovery + 27;

  // Pack the signature
  const packedSignature = `0x${r}${s}${v.toString(16)}` as Hex;

  return packedSignature;
}

async function main() {
  try {
    console.log("\n=== Starting wallet upgrade process ===");

    // Create a new random EOA
    const accountToUpgrade = createRandomEOAWallet();
    const relayerAccount = privateKeyToAccount(RELAYER.privateKey);
    console.log("EOA address:", accountToUpgrade.address);
    console.log("EOA private key:", accountToUpgrade._privateKey);
    console.log("Relayer address:", relayerAccount.address);

    // Create wallet clients
    const userWallet = createEOAClient(accountToUpgrade, true);

    const relayerWallet = createEOAClient(
      {
        ...relayerAccount,
        _privateKey: RELAYER.privateKey,
      },
      true
    );

    // Create public client for reading state
    const publicClient = createPublicClient({
      chain: anvil,
      transport: http(),
    });

    console.log("Proxy template address:", PROXY_ADDRESS);

    // Create the authorization signature
    console.log("\nSigning authorization object...");
    const authorization = await userWallet.signAuthorization({
      contractAddress: PROXY_ADDRESS,
      sponsor: relayerWallet.account.address,
    });

    // Create initialization args with the relayer as the new owner
    console.log("\nPreparing initialization data and signature...");
    const initArgs = encodeInitializeArgs(relayerWallet.account.address as Hex);
    const initHash = createInitializeHash(PROXY_ADDRESS, initArgs);
    const signature = await signInitialization(userWallet, initHash);

    // Submit the upgrade transaction
    console.log("\nSubmitting upgrade transaction...");
    const hash = await relayerWallet.sendTransaction({
      to: accountToUpgrade.address,
      value: parseEther("0.0001"),
      authorizationList: [authorization],
    });
    console.log("✓ Upgrade transaction submitted");

    // Check the transaction receipt
    const receipt = await publicClient.getTransactionReceipt({
      hash: hash,
    });
    if (receipt.status === "success") {
      console.log("✓ Upgrade transaction confirmed");
    }

    // Check if the code was deployed
    console.log("\nVerifying deployment...");
    const code = await publicClient.getCode({
      address: accountToUpgrade.address,
    });

    if (code && code !== "0x") {
      console.log("✓ Code deployed successfully");
      console.log("\n=== Wallet upgrade complete ===");
      console.log("Smart wallet address:", accountToUpgrade.address);
      console.log("Owner address:", relayerWallet.account.address);
    } else {
      console.log("✗ Code deployment failed");
      throw new Error("Code deployment failed");
    }

    // Initialize the wallet
    console.log("\nInitializing smart wallet owner...");
    const initTxnHash = await relayerWallet.writeContract({
      address: accountToUpgrade.address as `0x${string}`,
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
      args: [initArgs, signature],
    });
    console.log("✓ Initialization transaction submitted");

    const initReceipt = await publicClient.waitForTransactionReceipt({
      hash: initTxnHash,
    });
    if (initReceipt.status === "success") {
      console.log("✓ Initialization transaction confirmed");
    } else {
      console.log("✗ Initialization transaction failed");
      throw new Error("Initialization transaction failed");
    }

    // Verify the relayer is the owner
    const isOwner = await publicClient.readContract({
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

    if (!isOwner) {
      throw new Error("Relayer is not the owner of the smart wallet");
    }

    console.log("✓ Relayer verified as owner");
    console.log("\n=== Process complete ===");
  } catch (error: any) {
    console.error("\nError:", error.message || error);
    process.exit(1);
  }
}

// Run the script
main();
