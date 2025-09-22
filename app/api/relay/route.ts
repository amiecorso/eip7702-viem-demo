import { privateKeyToAccount } from "viem/accounts";
import { createWalletClient, http, type Hex, encodeFunctionData, maxUint256 } from "viem";
import { chains } from "@/app/lib/chains";
import { CBSW_IMPLEMENTATION_ADDRESS, VALIDATOR_ADDRESS } from "../../lib/constants";
import { MULTI_OWNABLE_STORAGE_ERASER_ABI } from "../../lib/abi/MultiOwnableStorageEraser";

// This runs on the server, so it's safe to access the private key
const RELAYER_PRIVATE_KEY = process.env.RELAYER_PRIVATE_KEY as Hex;
const PUBLIC_RELAYER_ADDRESS = process.env.NEXT_PUBLIC_RELAYER_ADDRESS;

if (!RELAYER_PRIVATE_KEY) {
  throw new Error("RELAYER_PRIVATE_KEY environment variable is required");
}

if (!PUBLIC_RELAYER_ADDRESS) {
  throw new Error(
    "NEXT_PUBLIC_RELAYER_ADDRESS environment variable is required"
  );
}

// Create relayer wallet once
const relayerAccount = privateKeyToAccount(RELAYER_PRIVATE_KEY);

// Verify the relayer address matches what's public
if (
  relayerAccount.address.toLowerCase() !== PUBLIC_RELAYER_ADDRESS.toLowerCase()
) {
  throw new Error("Relayer private key does not match public address");
}

const relayerWallet = createWalletClient({
  account: relayerAccount,
  chain: chains[process.env.SELECTED_CHAIN as keyof typeof chains ?? "baseSepolia"],
  transport: http(),
});

// Helper to encode setImplementation call
const encodeSetImplementation = (
  newImplementation: Hex,
  callData: Hex,
  signature: Hex,
  expiry: bigint,
  allowCrossChainReplay = false
) => {
  return encodeFunctionData({
    abi: [{
      type: "function",
      name: "setImplementation",
      inputs: [
        { name: "newImplementation", type: "address" },
        { name: "callData", type: "bytes" },
        { name: "validator", type: "address" },
        { name: "expiry", type: "uint256" },
        { name: "signature", type: "bytes" },
        { name: "allowCrossChainReplay", type: "bool" }
      ],
      outputs: [],
      stateMutability: "payable"
    }],
    functionName: "setImplementation",
    args: [
      newImplementation,
      callData,
      VALIDATOR_ADDRESS,
      expiry,
      signature,
      allowCrossChainReplay
    ]
  });
};

// Helper to submit transaction with optional authorization
const submitTransaction = async (
  to: Hex,
  value: bigint = BigInt(0),
  data?: Hex,
  authorizationList?: any[]
) => {
  const tx = {
    to,
    value,
    ...(data && { data }),
    ...(authorizationList && { authorizationList })
  };
  
  return await relayerWallet.sendTransaction(tx);
};

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const { operation, targetAddress } = body;

    switch (operation) {
      // *************** Fund **************************************** 
      case "fund": {
        const { value } = body;
        const hash = await submitTransaction(
          targetAddress,
          BigInt(value)
        );
        return Response.json({ hash });
      }

      // *************** Submit 7702 Authorization *******************
      case "submit7702Auth": {
        const { authorizationList } = body;
        
        console.log("\n=== Submitting 7702 Authorization ===");
        console.log("Received auth request:", {
          targetAddress,
          hasAuthList: !!authorizationList,
          authListLength: authorizationList?.length,
          authDetails: authorizationList?.[0],
        });

        const hash = await submitTransaction(
          targetAddress,
          BigInt(0),
          "0x",  // Empty calldata for only the 7702 authorization
          authorizationList
        );
        
        return Response.json({ hash });
      }

      // *************** Set Implementation ****************************
      case "setImplementation": {
        const { signature, initArgs = "0x" } = body;
        
        console.log("\n=== Setting Implementation ===");
        console.log("Received setImplementation request:", {
          targetAddress,
          hasSignature: !!signature,
          hasInitArgs: !!initArgs,
        });
        
        const data = encodeSetImplementation(
          CBSW_IMPLEMENTATION_ADDRESS,
          initArgs,
          signature,
          BigInt(maxUint256)
        );
        
        const hash = await submitTransaction(
          targetAddress,
          BigInt(0),
          data
        );
        
        return Response.json({ hash });
      }

      // *************** Upgrade EOA (Combined Operation) ******************
      case "upgradeEOA": {
        const { initArgs, signature, authorizationList } = body;
        
        console.log("\n=== Upgrading EOA (Combined Operation) ===");
        console.log("Received upgradeEOA request:", {
          targetAddress,
          hasAuthList: !!authorizationList,
          authListLength: authorizationList?.length,
          authDetails: authorizationList?.[0],
          hasInitArgs: !!initArgs,
          hasSignature: !!signature,
        });
        
        // Combined transaction that includes both the 7702 authorization and setImplementation call
        const data = encodeSetImplementation(
          CBSW_IMPLEMENTATION_ADDRESS,
          initArgs,
          signature,
          BigInt(maxUint256),
          false
        );
        
        const hash = await submitTransaction(
          targetAddress,
          BigInt(0),
          data,
          authorizationList
        );
        
        console.log("Submitted upgradeEOA transaction:", {
          hash,
          targetAddress,
          implementation: CBSW_IMPLEMENTATION_ADDRESS,
          validator: VALIDATOR_ADDRESS,
        });
        
        return Response.json({ hash });
      }
      // *************** Erase Storage ****************************
      case "eraseStorage": {
        console.log("\n=== Erasing Storage ===");
        console.log("Target address:", targetAddress);
        
        const data = encodeFunctionData({
          abi: MULTI_OWNABLE_STORAGE_ERASER_ABI,
          functionName: "eraseNextOwnerIndexStorage",
          args: []
        });
        
        const hash = await submitTransaction(
          targetAddress,
          BigInt(0),
          data
        );
        
        console.log("Submitted eraseStorage transaction:", {
          hash,
          targetAddress,
        });
        
        return Response.json({ hash });
      }

      default:
        return new Response(
          JSON.stringify({ error: `Unknown operation: ${operation}` }),
          { status: 400 }
        );
    }
  } catch (error: any) {
    console.error("Relay error:", error);
    return new Response(
      JSON.stringify({ 
        error: error.message || "Internal server error",
        details: error.shortMessage || error.details || undefined
      }),
      { status: 500 }
    );
  }
}
