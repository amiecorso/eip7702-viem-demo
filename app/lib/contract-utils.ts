import { type Address, type PublicClient } from "viem";
import { NONCE_TRACKER_ADDRESS, ERC1967_IMPLEMENTATION_SLOT, MAGIC_PREFIX, EIP7702PROXY_TEMPLATE_ADDRESS, CBSW_IMPLEMENTATION_ADDRESS, ENTRYPOINT_ADDRESS, NEXT_OWNER_INDEX_SLOT } from "./constants";
import type { P256Credential } from "viem/account-abstraction";
import { ENTRYPOINT_ABI } from "./abi/EntryPoint";

export const MIN_DEPOSIT = BigInt("100000000000000000"); // 0.1 ETH

// Gets the next nonce for the account in the NonceTracker contract,
// used for calls to `EIP7702Proxy.setImplementation`.
export async function getNonceFromTracker(
  publicClient: PublicClient,
  account: Address
): Promise<bigint> {
  const nonce = await publicClient.readContract({
    address: NONCE_TRACKER_ADDRESS,
    abi: [{
      type: "function",
      name: "nonces",
      inputs: [{ name: "account", type: "address" }],
      outputs: [{ type: "uint256" }],
      stateMutability: "view"
    }],
    functionName: "nonces",
    args: [account],
  });

  return nonce;
}

// Gets the current implementation address from the ERC1967 slot at the given address
export async function getCurrentImplementation(
  publicClient: PublicClient,
  address: Address
): Promise<Address> {
  const implementationSlotData = await publicClient.getStorageAt({
    address,
    slot: ERC1967_IMPLEMENTATION_SLOT,
  });
  
  if (!implementationSlotData) {
    throw new Error("Failed to read implementation slot");
  }
  return `0x${implementationSlotData.slice(-40)}` as Address;
}

// The current state of the contract at the given address
export type ContractState = {
  bytecode: string;
  implementation: Address;
  isDelegateDisrupted: boolean;
  isImplementationDisrupted: boolean;
  isOwnershipDisrupted: boolean;
  nextOwnerIndex: bigint;
};

// The expected bytecode for a EOA upgraded to a CoinbaseSmartWallet, including the EIP-7702 magic prefix
export function getExpectedBytecode() {
  return `${MAGIC_PREFIX}${EIP7702PROXY_TEMPLATE_ADDRESS.slice(2).toLowerCase()}`.toLowerCase();
}

// Gets the current nextOwnerIndex value from the account's storage
export async function getNextOwnerIndex(
  publicClient: PublicClient,
  address: Address
): Promise<bigint> {
  const storageValue = await publicClient.getStorageAt({
    address,
    slot: NEXT_OWNER_INDEX_SLOT,
  });

  if (!storageValue) {
    return BigInt(0);
  }

  // Convert the hex storage value to a bigint
  return BigInt(storageValue);
}

// Checks the current state of the contract at the given address
export async function checkContractState(
  publicClient: PublicClient,
  address: Address
): Promise<ContractState> {
  // Get all states in parallel
  const [bytecode, implementation, nextOwnerIndex] = await Promise.all([
    publicClient.getCode({ address }),
    getCurrentImplementation(publicClient, address),
    getNextOwnerIndex(publicClient, address).catch(() => BigInt(0)) // Default to 0 if call fails
  ]);

  // Check if delegate is disrupted by comparing bytecode with expected format
  const expectedBytecode = getExpectedBytecode();
  const currentBytecode = (bytecode || "0x").toLowerCase();
  const isDelegateDisrupted = currentBytecode !== "0x" && currentBytecode !== expectedBytecode;

  // Check if implementation is disrupted
  const isImplementationDisrupted = implementation.toLowerCase() !== CBSW_IMPLEMENTATION_ADDRESS.toLowerCase();

  // Check if ownership is disrupted (nextOwnerIndex is 0)
  const isOwnershipDisrupted = nextOwnerIndex === BigInt(0);

  return {
    bytecode: bytecode || "0x",
    implementation,
    isDelegateDisrupted,
    isImplementationDisrupted,
    isOwnershipDisrupted,
    nextOwnerIndex
  };
}

// Verifies that the given passkey is an owner of the given wallet address
export async function verifyPasskeyOwnership(
  publicClient: PublicClient,
  walletAddress: Address,
  passkey: P256Credential
): Promise<boolean> {
  // Remove the 0x prefix and the 04 format byte to get just the coordinates
  const pubKeyWithoutPrefix = passkey.publicKey.slice(2); // Remove '0x'
  
  // Check if it starts with '04' (uncompressed format)
  if (!pubKeyWithoutPrefix.startsWith('04')) {
    throw new Error('Invalid public key format - expected uncompressed (0x04...)');
  }
  
  // Remove the '04' format byte
  const coordinates = pubKeyWithoutPrefix.slice(2);
  
  // Extract X and Y coordinates (each should be 64 hex chars = 32 bytes)
  const xCoord = coordinates.slice(0, 64);
  const yCoord = coordinates.slice(64, 128);
  
  // Verify we have the correct lengths
  if (xCoord.length !== 64 || yCoord.length !== 64) {
    throw new Error(`Invalid public key coordinates length - X: ${xCoord.length}, Y: ${yCoord.length}`);
  }
  
  const isOwner = await publicClient.readContract({
    address: walletAddress,
    abi: [{
      type: "function",
      name: "isOwnerPublicKey",
      inputs: [
        { name: "x", type: "bytes32" },
        { name: "y", type: "bytes32" },
      ],
      outputs: [{ type: "bool" }],
      stateMutability: "view",
    }],
    functionName: "isOwnerPublicKey",
    args: [
      `0x${xCoord}` as `0x${string}`,
      `0x${yCoord}` as `0x${string}`,
    ],
  });

  return isOwner;
}

// The balances of the account at the given address, including the account balance and its current entrypoint deposit
export type AccountBalances = {
  accountBalance: bigint;
  entryPointDeposit: bigint;
  needsDeposit: boolean;
};

// Checks the balances of the account at the given address, including the account balance and its current entrypoint deposit
export async function checkAccountBalances(
  publicClient: PublicClient,
  address: Address
): Promise<AccountBalances> {
  // Get both balances in parallel
  const [accountBalance, entryPointDeposit] = await Promise.all([
    publicClient.getBalance({ address }),
    publicClient.readContract({
      address: ENTRYPOINT_ADDRESS,
      abi: ENTRYPOINT_ABI,
      functionName: "balanceOf",
      args: [address],
    }) as Promise<bigint>
  ]);

  return {
    accountBalance,
    entryPointDeposit,
    needsDeposit: entryPointDeposit < MIN_DEPOSIT
  };
}
