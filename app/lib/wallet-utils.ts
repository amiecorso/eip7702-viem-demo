import {
  createWalletClient,
  http,
  encodeAbiParameters,
  encodeFunctionData,
  keccak256,
  WalletClient,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { secp256k1 } from "@noble/curves/secp256k1";
import { hexToBytes } from "@noble/curves/abstract/utils";
import { chains } from "./chains";
import { 
  IMPLEMENTATION_SET_TYPEHASH, 
  VALIDATOR_ADDRESS,
} from "./constants";

// Add a type for our extended account that includes the private key
export type ExtendedAccount = ReturnType<typeof privateKeyToAccount> & {
  _privateKey: Hex;
};

// Creates a new wallet client with the given account, which is extended to include the private key
export function createEOAClient(account: ExtendedAccount) {
  // Create the wallet client with the extended account to get access to private key
  return createWalletClient({
    account,
    chain: chains[process.env.NEXT_PUBLIC_SELECTED_CHAIN as keyof typeof chains ?? "baseSepolia"],
    transport: http(),
  });
}

// Creates a new extended account with a random private key
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

// Creates a new extended account with a given private key
export function createEOAWalletFromPrivateKey(privateKey: Hex): ExtendedAccount {
  const account = privateKeyToAccount(privateKey);
  return {
    ...account,
    _privateKey: privateKey,
  };
}

// Encodes the calldata for `CoinbaseSmartWallet.initialize`
export function encodeInitializeArgs(
  owners: (Hex | { publicKey: Hex })[]
): Hex {
  // First encode each owner - either an address or a WebAuthn public key
  const encodedOwners = owners.map((owner) => {
    if (typeof owner === "string") {
      // Regular address
      return encodeAbiParameters([{ type: "address" }], [owner]);
    } else {
      // WebAuthn public key - encode as bytes32[2] for x and y coordinates
      const pubKeyHex = owner.publicKey.slice(2); // remove 0x prefix
      const x = `0x${pubKeyHex.slice(0, 64)}` as Hex;
      const y = `0x${pubKeyHex.slice(64)}` as Hex;
      return encodeAbiParameters(
        [{ type: "bytes32" }, { type: "bytes32" }],
        [x, y]
      );
    }
  });

  // Encode the function call using encodeFunctionData
  return encodeFunctionData({
    abi: [{
      type: 'function',
      name: 'initialize',
      inputs: [{ type: 'bytes[]', name: 'owners' }],
      outputs: [],
      stateMutability: 'payable'
    }],
    functionName: 'initialize',
    args: [encodedOwners]
  });
}

// Creates the hash to be signed for a call to `EIP7702Proxy.setImplementation`
export function createSetImplementationHash(
  proxyAddr: Hex,
  newImplementation: Hex,
  callData: Hex,
  nonce: bigint,
  currentImplementation: Hex,
  allowCrossChainReplay: boolean,
  chainId: bigint,
  expiry: bigint,
): Hex {
  // First hash the calldata
  const callDataHash = keccak256(callData);

  // First compute the typehash
  const typeHash = keccak256(
    Buffer.from(IMPLEMENTATION_SET_TYPEHASH, 'utf-8')
  );

  // Construct the hash using the typehash
  const encodedData = encodeAbiParameters(
    [
      { type: "bytes32" },  // typehash
      { type: "uint256" },  // chainId
      { type: "address" },  // proxy
      { type: "uint256" },  // nonce
      { type: "address" },  // currentImplementation
      { type: "address" },  // newImplementation
      { type: "bytes32" },  // keccak256(callData)
      { type: "address" },  // validator
      { type: "uint256" },  // expiry
    ],
    [
      typeHash,
      chainId,
      proxyAddr,
      nonce,
      currentImplementation,
      newImplementation,
      callDataHash,
      VALIDATOR_ADDRESS,
      expiry,
    ]
  );

  console.log("encodedData", encodedData);

  const result = keccak256(encodedData);
  console.log("result", result);
  return result;
}

// Signs a hash using the private key of the given wallet client
export async function signSetImplementation(
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
  return`0x${r}${s}${v.toString(16)}` as Hex;
}
