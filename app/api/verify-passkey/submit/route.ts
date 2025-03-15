import { NextResponse } from "next/server";
import { type Hash, createWalletClient, http } from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { odysseyTestnet } from "../../../lib/chains";
import { ENTRYPOINT_ADDRESS } from "../../../lib/constants";
import { ENTRYPOINT_ABI } from "../../../lib/abi/EntryPoint";

export async function POST(request: Request) {
  try {
    const { userOp } = await request.json();

    // Create wallet client for the relayer
    const relayerAccount = privateKeyToAccount(
      process.env.RELAYER_PRIVATE_KEY as `0x${string}`
    );
    const walletClient = createWalletClient({
      account: relayerAccount,
      chain: odysseyTestnet,
      transport: http(),
    });

    // Submit the userOp
    const txHash = (await walletClient.writeContract({
      address: ENTRYPOINT_ADDRESS,
      abi: ENTRYPOINT_ABI,
      functionName: "handleOps",
      args: [[userOp], relayerAccount.address],
    })) as Hash;

    const userOpHash = (await walletClient.writeContract({
      address: ENTRYPOINT_ADDRESS,
      abi: ENTRYPOINT_ABI,
      functionName: "getUserOpHash",
      args: [userOp],
    })) as Hash;

    return NextResponse.json({ txHash, userOpHash });
  } catch (error) {
    console.error("Error in submit endpoint:", error);
    return new NextResponse(
      error instanceof Error ? error.message : "Unknown error",
      { status: 500 }
    );
  }
}
