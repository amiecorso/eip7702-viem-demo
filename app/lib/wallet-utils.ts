import {
  createWalletClient,
  http,
  encodePacked,
  keccak256,
  encodeAbiParameters,
  recoverMessageAddress,
  toBytes,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { type Hex } from "viem";
import { anvil, baseSepolia } from "viem/chains";
import { eip7702Actions } from "viem/experimental";

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

export async function getRelayerWalletClient(useAnvil = true) {
  let privateKey: Hex;
  let chain;

  if (useAnvil) {
    // Use Anvil's pre-funded account
    privateKey = ANVIL_RELAYER_PRIVATE_KEY as Hex;
    chain = localAnvil;
  } else {
    // Use environment variable for testnet
    if (!process.env.RELAYER_PRIVATE_KEY) {
      throw new Error(
        "RELAYER_PRIVATE_KEY environment variable is required for non-Anvil networks"
      );
    }
    privateKey = process.env.RELAYER_PRIVATE_KEY as Hex;
    chain = baseSepolia;
  }

  const relayerAccount = privateKeyToAccount(privateKey);

  const relayerWallet = createWalletClient({
    account: relayerAccount,
    chain,
    transport: http(),
  }).extend(eip7702Actions());

  return relayerWallet;
}

export function createEOAClient(
  account: ReturnType<typeof privateKeyToAccount>,
  useAnvil = true
) {
  return createWalletClient({
    account,
    chain: useAnvil ? localAnvil : baseSepolia,
    transport: http(),
    key: account.address,
  }).extend(eip7702Actions());
}

export function createEOAWallet() {
  const randomBytes = crypto.getRandomValues(new Uint8Array(32));
  const privateKey = `0x${Array.from(randomBytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("")}` as const;
  return privateKeyToAccount(privateKey);
}

export function encodeInitializeArgs(ownerAddress: Hex): Hex {
  // Create an array with a single owner
  const owners = [ownerAddress];

  // First encode each owner address
  const encodedOwners = owners.map((owner) =>
    encodeAbiParameters([{ type: "address" }], [owner])
  );

  // Then encode the array of encoded owners
  return encodeAbiParameters([{ type: "bytes[]" }], [encodedOwners]);
}

export function createInitializeHash(proxyAddress: Hex, initArgs: Hex): Hex {
  return keccak256(
    encodeAbiParameters(
      [{ type: "address" }, { type: "bytes" }],
      [proxyAddress, initArgs]
    )
  );
}

// Create a raw signature without Ethereum prefix
export async function signInitialization(
  wallet: ReturnType<typeof createEOAClient>,
  message: Hex
): Promise<Hex> {
  // Sign using viem's signMessage
  const signature = await wallet.signMessage({
    message,
  });
  return signature;
}
