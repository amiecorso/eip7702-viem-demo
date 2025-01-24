import {
  createWalletClient,
  http,
  encodeAbiParameters,
  WalletClient,
  type Account,
  type Address,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { anvil } from "viem/chains";
import { eip7702Actions } from "viem/experimental";
import { secp256k1 } from "@noble/curves/secp256k1";
import { hexToBytes } from "@noble/curves/abstract/utils";
import { keccak256 as keccak256Crypto } from "ethereum-cryptography/keccak";
import { odysseyTestnet } from "./chains";

// Configure anvil chain with the correct URL
export const localAnvil = {
  ...anvil,
  rpcUrls: {
    default: {
      http: ["http://127.0.0.1:8545"],
    },
    public: {
      http: ["http://127.0.0.1:8545"],
    },
  },
} as const;

// Anvil's first pre-funded account
export const ANVIL_RELAYER_PRIVATE_KEY =
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80";

// Add a type for our extended account that includes the private key
export type ExtendedAccount = ReturnType<typeof privateKeyToAccount> & {
  _privateKey: Hex;
};

export async function getRelayerWalletClient(useAnvil = true) {
  if (useAnvil) {
    // For Anvil, we can still use the local account
    const privateKey = ANVIL_RELAYER_PRIVATE_KEY as Hex;
    const relayerAccount = privateKeyToAccount(privateKey);
    return createWalletClient({
      account: relayerAccount,
      chain: localAnvil,
      transport: http(),
    }).extend(eip7702Actions());
  }

  // For non-Anvil, return a proxy that calls our API
  return {
    account: {
      // Use the public relayer address
      address: process.env.NEXT_PUBLIC_RELAYER_ADDRESS as `0x${string}`,
    },
    async sendTransaction({
      to,
      value,
      authorizationList,
    }: {
      to: `0x${string}`;
      value: bigint;
      authorizationList: any[];
    }) {
      const response = await fetch("/api/relay", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          to,
          value: value.toString(),
          authorizationList,
        }),
      });

      if (!response.ok) {
        const error = await response.json();
        throw new Error(error.error || "Failed to relay transaction");
      }

      const { hash } = await response.json();
      return hash as `0x${string}`;
    },
  };
}

export function createEOAClient(account: ExtendedAccount, useAnvil = true) {
  // Create the wallet client with the extended account to get access to private key
  return createWalletClient({
    account,
    chain: useAnvil ? localAnvil : odysseyTestnet,
    transport: http(),
  }).extend(eip7702Actions());
}

export async function createEOAWallet(): Promise<ExtendedAccount> {
  // Generate a random private key
  const privateKey = `0x${crypto
    .getRandomValues(new Uint8Array(32))
    .reduce(
      (str, byte) => str + byte.toString(16).padStart(2, "0"),
      ""
    )}` as Hex;
  const account = privateKeyToAccount(privateKey);
  return {
    ...account,
    _privateKey: privateKey,
  };
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
