import { useState, useCallback, useEffect } from "react";
import { type Address, type Hash, type Hex, createPublicClient, http } from "viem";
import {
  type P256Credential,
  toWebAuthnAccount,
  toCoinbaseSmartAccount,
  type UserOperation,
} from "viem/account-abstraction";
import { baseSepolia } from "../lib/chains";
import { serializeBigInts } from "../lib/relayer-utils";
import { type ExtendedAccount } from "../lib/wallet-utils";
import { checkAccountBalances, verifyPasskeyOwnership } from "../lib/contract-utils";
import { AccountRecovery } from "./AccountRecovery";

type VerificationStep = {
  status: string;
  isComplete: boolean;
  txHash?: Hash;
  userOpHash?: Hash;
  error?: string;
};

type Props = {
  smartWalletAddress: Address;
  passkey: P256Credential;
  account: ExtendedAccount;
  isDelegateDisrupted: boolean;
  isImplementationDisrupted: boolean;
  isOwnershipDisrupted: boolean;
  onRecoveryComplete: () => void;
  onStateChange: (bytecode: string | null, slotValue: string | null, nextOwnerIndex?: bigint) => void;
  onPasskeyStored: (passkey: P256Credential) => void;
};

const waitForTransaction = async (
  hash: Hash,
  chain: typeof baseSepolia
) => {
  const publicClient = createPublicClient({
    chain,
    transport: http(),
  });
  await publicClient.waitForTransactionReceipt({ hash });
};

function TransactionLink({ hash }: { hash: Hash }) {
  return (
    <a
      href={`${baseSepolia.blockExplorers.default.url}/tx/${hash}`}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-400 hover:text-blue-300 underline font-mono"
    >
      {hash}
    </a>
  );
}

function StepDisplay({ step }: { step: VerificationStep }) {
  return (
    <div className="mb-4 p-4 bg-gray-800 rounded-lg w-full max-w-5xl mx-auto">
      <div className="flex items-center gap-2">
        {step.isComplete ? (
          <span className="text-green-500">✓</span>
        ) : (
          <div className="w-4 h-4 border-2 border-t-blue-500 border-r-blue-500 border-b-blue-500 border-l-transparent rounded-full animate-spin" />
        )}
        <span className={step.isComplete ? "text-green-500" : "text-blue-500"}>
          {step.status}
        </span>
      </div>
      {step.txHash && (
        <div className="mt-2 ml-6">
          <span className="text-gray-400 mr-2">Transaction:</span>
          <div className="break-all">
            <TransactionLink hash={step.txHash} />
          </div>
        </div>
      )}
      {step.userOpHash && (
        <div className="mt-2 ml-6">
          <span className="text-gray-400 mr-2">UserOperation hash:</span>
          <div className="break-all">
            <code className="font-mono text-green-400">{step.userOpHash}</code>
          </div>
        </div>
      )}
      {step.error && (
        <div className="mt-2 ml-6 text-red-400">
          <span>Error: {step.error}</span>
        </div>
      )}
    </div>
  );
}

export function PasskeyVerification({
  smartWalletAddress,
  passkey,
  account,
  isDelegateDisrupted,
  isImplementationDisrupted,
  isOwnershipDisrupted,
  onRecoveryComplete,
  onStateChange,
  onPasskeyStored,
}: Props) {
  const [verifying, setVerifying] = useState(false);
  const [steps, setSteps] = useState<VerificationStep[]>([]);
  const [isVerified, setIsVerified] = useState(false);
  const chain = baseSepolia;

  // Reset verification state when component becomes visible again after disruption
  const isDisrupted = isDelegateDisrupted || isImplementationDisrupted || isOwnershipDisrupted;
  useEffect(() => {
    if (!isDisrupted) {
      setSteps([]);
      setIsVerified(false);
      setVerifying(false);
    }
  }, [isDisrupted]);

  const handleVerify = useCallback(async () => {
    try {
      setVerifying(true);
      setSteps([]);
      setIsVerified(false);

      console.log("Creating WebAuthn account from passkey...");
      const webAuthnAccount = toWebAuthnAccount({ credential: passkey });
      console.log("WebAuthn account public key:", webAuthnAccount.publicKey);

      const publicClient = createPublicClient({
        chain,
        transport: http(),
      });

      // Verify passkey ownership before proceeding
      console.log("Verifying passkey ownership...");
      const isOwner = await verifyPasskeyOwnership(publicClient, smartWalletAddress, passkey);
      console.log("Is passkey an owner?", isOwner);
      if (!isOwner) {
        throw new Error("This passkey is not registered as an owner of this wallet");
      }

      // For this demo, we know the passkey is always at index 0
      const ourOwnerIndex = 0;
      console.log("Using owner index:", ourOwnerIndex);

      // Verify the owner at this index matches our passkey
      console.log("Verifying owner at index matches our passkey...");
      const ownerAtIndex = await publicClient.readContract({
        address: smartWalletAddress,
        abi: [{
          type: "function",
          name: "ownerAtIndex",
          inputs: [{ type: "uint256", name: "index" }],
          outputs: [{ type: "bytes", name: "" }],
          stateMutability: "view",
        }],
        functionName: "ownerAtIndex",
        args: [BigInt(ourOwnerIndex)],
      });
      console.log("Owner bytes at index:", ownerAtIndex);

      // Convert our passkey's public key to the expected format
      // The passkey public key is already in uncompressed format: 04 | x | y
      // We need to remove the '0x' prefix from our passkey's public key
      const ourPasskeyBytes = `0x${passkey.publicKey.slice(2)}` as Hex;
      console.log("Our passkey bytes:", ourPasskeyBytes);

      // Compare the owner at index with our passkey
      const ownerMatches = ownerAtIndex === ourPasskeyBytes;
      console.log("Owner at index matches our passkey?", ownerMatches);

      if (!ownerMatches) {
        throw new Error("Owner index mismatch - the passkey is not at index 0");
      }

      addStep({
        status: "Checking account balances...",
        isComplete: false,
      });

      const { accountBalance, needsDeposit } = await checkAccountBalances(publicClient, smartWalletAddress);

      if (accountBalance === BigInt(0)) {
        updateStep(0, {
          status: "Funding smart account with 1 wei...",
          isComplete: false,
        });

        console.log("Smart account has no balance, sending 1 wei from relayer...");
        const response = await fetch("/api/relay", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            operation: "fund",
            targetAddress: smartWalletAddress,
            value: "1",
          }),
        });
        if (!response.ok) {
          throw new Error("Failed to fund smart account");
        }
        const { hash } = await response.json();
        console.log("Funding transaction hash:", hash);
        await waitForTransaction(hash as Hash, chain);
        console.log("Smart account funded with 1 wei");
      }

      updateStep(0, {
        status: "Smart account balance verified",
        isComplete: true,
      });

      if (needsDeposit) {
        console.log("Insufficient deposit, pre-funding required...");
        addStep({
          status: "Pre-funding smart account gas in EntryPoint...",
          isComplete: false,
        });

        const depositResponse = await fetch("/api/verify-passkey/deposit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ smartWalletAddress }),
        });

        if (!depositResponse.ok) {
          const error = await depositResponse.text();
          updateStep(1, { error, isComplete: true });
          return;
        }

        const { txHash: depositTxHash } = await depositResponse.json();
        console.log("Deposit transaction hash:", depositTxHash);
        updateStep(1, {
          status: "Waiting for EntryPoint pre-funding transaction...",
          isComplete: false,
          txHash: depositTxHash,
        });

        await waitForTransaction(depositTxHash, chain);
        const { entryPointDeposit: newDeposit } = await checkAccountBalances(publicClient, smartWalletAddress);
        console.log("New deposit balance:", newDeposit.toString(), "wei");

        updateStep(1, {
          status: "EntryPoint pre-funding complete",
          isComplete: true,
          txHash: depositTxHash,
        });
      }

      addStep({
        status: "Creating and signing userOp to transfer 1 wei to relayer...",
        isComplete: false,
      });

      console.log("Creating smart account client...");
      const smartAccount = await toCoinbaseSmartAccount({
        client: publicClient,
        owners: [webAuthnAccount],
        address: smartWalletAddress,
        ownerIndex: ourOwnerIndex,
      });

      console.log("Encoding transfer call...");
      const callData = await smartAccount.encodeCalls([
        {
          to: process.env.NEXT_PUBLIC_RELAYER_ADDRESS as Address,
          value: BigInt(1),
          data: "0x" as const,
        },
      ]);

      console.log("Getting nonce...");
      const nonce = await smartAccount.getNonce();
      console.log("Current nonce:", nonce.toString());

      console.log("Preparing userOperation...");
      const unsignedUserOp = {
        sender: smartAccount.address,
        nonce,
        initCode: "0x" as const,
        callData,
        callGasLimit: BigInt(1000000),
        verificationGasLimit: BigInt(1000000),
        preVerificationGas: BigInt(200000),
        maxFeePerGas: BigInt(20000000000),
        maxPriorityFeePerGas: BigInt(1000000000),
        paymasterAndData: "0x" as const,
        signature: "0x" as const,
      } as const;

      console.log("Signing userOperation...");
      const signature = await smartAccount.signUserOperation(unsignedUserOp);

      const userOp = { ...unsignedUserOp, signature } as UserOperation;

      updateStep(2, {
        status: "UserOperation created and signed",
        isComplete: true,
      });

      addStep({
        status: "Submitting userOperation...",
        isComplete: false,
      });

      const submitResponse = await fetch("/api/verify-passkey/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userOp: serializeBigInts(userOp),
        }),
      });

      if (!submitResponse.ok) {
        const error = await submitResponse.text();
        updateStep(3, { error, isComplete: true });
        return;
      }

      const { txHash, userOpHash } = await submitResponse.json();
      updateStep(3, {
        status: "Waiting for userOperation transaction...",
        isComplete: false,
        txHash,
        userOpHash,
      });

      await waitForTransaction(txHash, chain);
      updateStep(3, {
        status: "UserOperation submitted successfully",
        isComplete: true,
        txHash,
        userOpHash,
      });

      addStep({
        status: "Retrieving unused deposit...",
        isComplete: false,
      });

      const retrieveResponse = await fetch("/api/verify-passkey/retrieve", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          smartWalletAddress,
        }),
      });

      if (!retrieveResponse.ok) {
        const error = await retrieveResponse.text();
        updateStep(4, { error, isComplete: true });
        return;
      }

      const { txHash: retrieveTxHash } = await retrieveResponse.json();
      if (retrieveTxHash) {
        updateStep(4, {
          status: "Waiting for withdrawal transaction...",
          isComplete: false,
          txHash: retrieveTxHash,
        });

        await waitForTransaction(retrieveTxHash, chain);
        updateStep(4, {
          status: "Successfully retrieved unused deposit",
          isComplete: true,
          txHash: retrieveTxHash,
        });
      } else {
        updateStep(4, {
          status: "No unused deposit to retrieve",
          isComplete: true,
        });
      }
      setIsVerified(true);
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      addStep({
        status: "Verification failed",
        isComplete: true,
        error: errorMessage,
      });
    } finally {
      setVerifying(false);
    }
  }, [smartWalletAddress, passkey, chain]);

  const updateStep = (index: number, updates: Partial<VerificationStep>) => {
    setSteps((current) =>
      current.map((step, i) => (i === index ? { ...step, ...updates } : step))
    );
  };

  const addStep = (step: VerificationStep) => {
    setSteps((current) => [...current, step]);
  };

  return (
    <div className="flex flex-col items-center w-full max-w-5xl mx-auto mt-8">
      <AccountRecovery
        smartWalletAddress={smartWalletAddress}
        account={account}
        isDelegateDisrupted={isDelegateDisrupted}
        isImplementationDisrupted={isImplementationDisrupted}
        isOwnershipDisrupted={isOwnershipDisrupted}
        onRecoveryComplete={onRecoveryComplete}
        onStateChange={onStateChange}
        onPasskeyStored={onPasskeyStored}
      />

      {!isDisrupted && (
        <div className="flex flex-col items-center w-full mt-8">
          <button
            onClick={handleVerify}
            disabled={verifying}
            className="px-6 py-3 text-lg font-semibold text-white bg-blue-500 rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed mb-8 w-64"
          >
            {verifying ? "..." : "Transact using passkey"}
          </button>

          <div className="w-full space-y-4">
            {steps.map((step, index) => (
              <StepDisplay key={index} step={step} />
            ))}
          </div>

          {isVerified && steps.every((step) => step.isComplete && !step.error) && (
            <div className="mt-8 text-center text-green-500 font-semibold text-lg">
              ✅ Successfully submitted a userOp with passkey owner!
              <div className="mt-4 text-base text-gray-400">
                You can submit another transaction using the button above.
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

