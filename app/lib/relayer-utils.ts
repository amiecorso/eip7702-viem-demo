import {
  createPublicClient,
  http,
  type Address,
  createWalletClient,
  encodeFunctionData,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chains } from "./chains";
import { ENTRYPOINT_ADDRESS } from "./constants";
import { ENTRYPOINT_ABI } from "./abi/EntryPoint";

// Withdraws the entry point deposit for the smart wallet to the relayer address, which is acting as mini bundler
export async function withdrawEntryPointDeposit({
  smartWalletAddress,
  withdrawAddress,
  onStatus,
}: {
  smartWalletAddress: Address;
  withdrawAddress: Address;
  onStatus?: (status: string) => void;
}) {
  if (!process.env.RELAYER_PRIVATE_KEY) {
    throw new Error("RELAYER_PRIVATE_KEY environment variable is required");
  }

  const publicClient = createPublicClient({
    chain: chains[process.env.SELECTED_CHAIN as keyof typeof chains ?? "baseSepolia"],
    transport: http(),
  });

  // Check current deposit
  onStatus?.("Checking current deposit via balanceOf...");
  onStatus?.(`Smart wallet address: ${smartWalletAddress}`);
  onStatus?.(`Withdraw to address: ${withdrawAddress}`);
  onStatus?.(`EntryPoint address: ${ENTRYPOINT_ADDRESS}`);

  const currentDeposit = (await publicClient.readContract({
    address: ENTRYPOINT_ADDRESS,
    abi: ENTRYPOINT_ABI,
    functionName: "balanceOf",
    args: [smartWalletAddress],
  })) as bigint;

  onStatus?.(
    `balanceOf result: ${currentDeposit.toString()} wei (${
      Number(currentDeposit) / 1e18
    } ETH)`
  );

  if (currentDeposit === BigInt(0)) {
    onStatus?.("No deposit to withdraw");
    return;
  }

  // Double check the deposit info
  onStatus?.("Getting detailed deposit info...");
  const depositInfo = (await publicClient.readContract({
    address: ENTRYPOINT_ADDRESS,
    abi: ENTRYPOINT_ABI,
    functionName: "getDepositInfo",
    args: [smartWalletAddress],
  })) as {
    deposit: bigint;
    staked: boolean;
    stake: bigint;
    unstakeDelaySec: bigint;
    withdrawTime: bigint;
  };

  const withdrawableAmount = depositInfo.deposit;
  if (withdrawableAmount === BigInt(0)) {
    onStatus?.("No withdrawable amount available");
    return;
  }

  // Withdraw the full amount
  onStatus?.(
    `Attempting to withdraw full deposit: ${withdrawableAmount.toString()} wei (${
      Number(withdrawableAmount) / 1e18
    } ETH)`
  );

  try {
    // Create wallet client for the relayer
    const relayer = privateKeyToAccount(
      process.env.RELAYER_PRIVATE_KEY as `0x${string}`
    );
    onStatus?.(`Relayer address: ${relayer.address}`);

    const walletClient = createWalletClient({
      account: relayer,
      chain: chains[process.env.SELECTED_CHAIN as keyof typeof chains ?? "baseSepolia"],
      transport: http(),
    });

    // Get the encoded call data for withdrawTo
    onStatus?.("Encoding withdrawTo calldata...");
    try {
      // Encode the withdrawTo call without simulation
      const withdrawCalldata = encodeFunctionData({
        abi: ENTRYPOINT_ABI,
        functionName: "withdrawTo",
        args: [withdrawAddress, withdrawableAmount],
      });

      // Now simulate the execute call on the smart wallet
      onStatus?.("Simulating execute call on smart wallet...");
      await publicClient.simulateContract({
        address: smartWalletAddress,
        abi: [
          {
            type: "function",
            name: "execute",
            inputs: [
              { name: "target", type: "address" },
              { name: "value", type: "uint256" },
              { name: "data", type: "bytes" },
            ],
            outputs: [],
            stateMutability: "payable",
          },
        ],
        functionName: "execute",
        args: [ENTRYPOINT_ADDRESS, BigInt(0), withdrawCalldata],
        account: relayer.address,
      });
      onStatus?.("Simulation successful");

      // Have the relayer call execute on the smart wallet
      onStatus?.(`Calling execute on smart wallet ${smartWalletAddress}...`);
      const hash = await walletClient.writeContract({
        address: smartWalletAddress,
        abi: [
          {
            type: "function",
            name: "execute",
            inputs: [
              { name: "target", type: "address" },
              { name: "value", type: "uint256" },
              { name: "data", type: "bytes" },
            ],
            outputs: [],
            stateMutability: "payable",
          },
        ],
        functionName: "execute",
        args: [ENTRYPOINT_ADDRESS, BigInt(0), withdrawCalldata],
      });

      onStatus?.(`Withdrawal transaction submitted: ${hash}`);
      onStatus?.("Waiting for confirmation...");

      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      onStatus?.(`Transaction status: ${receipt.status}`);
      // Get final deposit info to verify withdrawal
      onStatus?.("Getting final deposit info...");
      const finalDepositInfo = (await publicClient.readContract({
        address: ENTRYPOINT_ADDRESS,
        abi: ENTRYPOINT_ABI,
        functionName: "getDepositInfo",
        args: [smartWalletAddress],
      })) as {
        deposit: bigint;
        staked: boolean;
        stake: bigint;
        unstakeDelaySec: bigint;
        withdrawTime: bigint;
      };

      if (finalDepositInfo.deposit === BigInt(0)) {
        onStatus?.("Withdrawal successful - deposit is now zero!");
        return { hash };
      } else {
        throw new Error(
          `Withdrawal may have failed - deposit is still ${finalDepositInfo.deposit.toString()} wei`
        );
      }
    } catch (simError) {
      onStatus?.("Simulation failed with error:");
      onStatus?.(
        `${simError instanceof Error ? simError.message : String(simError)}`
      );
      if (simError instanceof Error && simError.cause) {
        onStatus?.(`Error cause: ${JSON.stringify(simError.cause, null, 2)}`);
      }
      throw simError;
    }
  } catch (error) {
    onStatus?.("Withdrawal failed with error:");
    onStatus?.(`${error instanceof Error ? error.message : String(error)}`);
    if (error instanceof Error && error.cause) {
      onStatus?.(`Error cause: ${JSON.stringify(error.cause, null, 2)}`);
    }
    throw error;
  }
}

// Helper function to serialize BigInt values in an object
export function serializeBigInts(obj: any): any {
  if (obj === null || obj === undefined) {
    return obj;
  }
  if (typeof obj === "bigint") {
    return obj.toString();
  }
  if (Array.isArray(obj)) {
    return obj.map(serializeBigInts);
  }
  if (typeof obj === "object") {
    const result: any = {};
    for (const [key, value] of Object.entries(obj)) {
      result[key] = serializeBigInts(value);
    }
    return result;
  }
  return obj;
}
