import { NextResponse } from "next/server";
import { type Address, type Hash, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chains } from "../../../lib/chains";
import { ENTRYPOINT_ADDRESS } from "../../../lib/constants";
import { ENTRYPOINT_ABI } from "../../../lib/abi/EntryPoint";

export async function POST(request: Request) {
  try {
    const { smartWalletAddress } = await request.json();

    // Create wallet client for the relayer
    const relayerAccount = privateKeyToAccount(
      process.env.RELAYER_PRIVATE_KEY as `0x${string}`
    );
    const walletClient = createWalletClient({
      account: relayerAccount,
      chain: chains[process.env.SELECTED_CHAIN as keyof typeof chains ?? "baseSepolia"],
      transport: http(),
    });

    // Pre-fund the smart account's deposit in the EntryPoint
    const txHash = (await walletClient.writeContract({
      address: ENTRYPOINT_ADDRESS,
      abi: ENTRYPOINT_ABI,
      functionName: "depositTo",
      args: [smartWalletAddress as Address],
      value: BigInt(1e17), // 0.1 ETH
    })) as Hash;

    return NextResponse.json({ txHash });
  } catch (error) {
    console.error("Error in deposit endpoint:", error);
    return new NextResponse(
      error instanceof Error ? error.message : "Unknown error",
      { status: 500 }
    );
  }
}
