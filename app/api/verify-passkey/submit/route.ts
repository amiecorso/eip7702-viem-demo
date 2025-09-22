import { NextResponse } from "next/server";
import { type Hash, createPublicClient, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { chains } from "../../../lib/chains";
import { ENTRYPOINT_ADDRESS } from "../../../lib/constants";
import { ENTRYPOINT_ABI } from "../../../lib/abi/EntryPoint";

export async function POST(request: Request) {
  try {
    const { userOp } = await request.json();
    const publicClient = createPublicClient({
      chain: chains[process.env.SELECTED_CHAIN as keyof typeof chains ?? "baseSepolia"],
      transport: http(),
    });
    // Create wallet client for the relayer
    const relayerAccount = privateKeyToAccount(
      process.env.RELAYER_PRIVATE_KEY as `0x${string}`
    );
    const walletClient = createWalletClient({
      account: relayerAccount,
      chain: chains[process.env.SELECTED_CHAIN as keyof typeof chains ?? "baseSepolia"],
      transport: http(),
    });

    // Submit the userOp
    const txHash = (await walletClient.writeContract({
      address: ENTRYPOINT_ADDRESS,
      abi: ENTRYPOINT_ABI,
      functionName: "handleOps",
      args: [[userOp], relayerAccount.address],
    })) as Hash;

    const userOpHash = await publicClient.readContract({
      address: ENTRYPOINT_ADDRESS,
      abi: ENTRYPOINT_ABI,
      functionName: "getUserOpHash",
      args: [userOp],
    }) as Hash;

    return NextResponse.json({ txHash, userOpHash });
  } catch (error) {
    console.error("Error in submit endpoint:", error);
    return new NextResponse(
      error instanceof Error ? error.message : "Unknown error",
      { status: 500 }
    );
  }
}
