import { type Address, type PublicClient } from "viem";
import { NONCE_TRACKER_ADDRESS, ERC1967_IMPLEMENTATION_SLOT, MAGIC_PREFIX, EIP7702PROXY_TEMPLATE_ADDRESS, CBSW_IMPLEMENTATION_ADDRESS, ENTRYPOINT_ADDRESS } from "./constants";
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

// Gets the current nextOwnerIndex value from the account
export async function getNextOwnerIndex(
  publicClient: PublicClient,
  address: Address
): Promise<bigint> {
  const nextOwnerIndex = await publicClient.readContract({
    address,
    abi: [{
      type: "function",
      name: "nextOwnerIndex",
      inputs: [],
      outputs: [{ type: "uint256" }],
      stateMutability: "view"
    }],
    functionName: "nextOwnerIndex",
  });

  return nextOwnerIndex;
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
      `0x${passkey.publicKey.slice(2, 66)}` as `0x${string}`,
      `0x${passkey.publicKey.slice(66)}` as `0x${string}`,
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
