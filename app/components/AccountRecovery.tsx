import { useState } from "react";
import { type Address, type Hash, createPublicClient, http, maxUint256 } from "viem";
import { type P256Credential, createWebAuthnCredential } from "viem/account-abstraction";
import { chains } from "../lib/chains";
import { createSetImplementationHash, type ExtendedAccount, createEOAClient, signSetImplementation, encodeInitializeArgs } from "../lib/wallet-utils";
import { EIP7702PROXY_TEMPLATE_ADDRESS, CBSW_IMPLEMENTATION_ADDRESS } from "../lib/constants";
import { getNonceFromTracker, checkContractState, getCurrentImplementation, verifyPasskeyOwnership } from "../lib/contract-utils";
import { RecoveryModal } from "./RecoveryModal";

type RecoveryStep = {
  status: string;
  isComplete: boolean;
  txHash?: Hash;
  error?: string;
};

type Props = {
  smartWalletAddress: Address;
  account: ExtendedAccount;
  isDelegateDisrupted: boolean;
  isImplementationDisrupted: boolean;
  isOwnershipDisrupted: boolean;
  onRecoveryComplete: () => void;
  onStateChange: (bytecode: string | null, slotValue: string | null, nextOwnerIndex?: bigint) => void;
  onPasskeyStored: (passkey: P256Credential) => void;
};

function TransactionLink({ hash }: { hash: Hash }) {
  return (
    <a
      href={`${chains[process.env.NEXT_PUBLIC_SELECTED_CHAIN as keyof typeof chains ?? "baseSepolia"].blockExplorers.default.url}/tx/${hash}`}
      target="_blank"
      rel="noopener noreferrer"
      className="text-blue-400 hover:text-blue-300 underline font-mono"
    >
      {hash}
    </a>
  );
}

function StepDisplay({ step }: { step: RecoveryStep }) {
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
      {step.error && (
        <div className="mt-2 ml-6 text-red-400">
          <span>Error: {step.error}</span>
        </div>
      )}
    </div>
  );
}

export function AccountRecovery({
  smartWalletAddress,
  account,
  isDelegateDisrupted,
  isImplementationDisrupted,
  isOwnershipDisrupted,
  onRecoveryComplete,
  onStateChange,
  onPasskeyStored,
}: Props) {
  const [recovering, setRecovering] = useState(false);
  const [steps, setSteps] = useState<RecoveryStep[]>([]);
  const [showRecoveryModal, setShowRecoveryModal] = useState(false);

  const isDisrupted = isDelegateDisrupted || isImplementationDisrupted || isOwnershipDisrupted;

  // Helper function to prepare initialization data for recovery
  // If ownership is not disrupted, we don't need to prepare any calldata for `setImplementation`
  // If ownership is disrupted, we need to prepare `initialize` calldata with the new passkey to pass through to `upgradeToAndCall`
  const prepareInitializationData = (recoveryPasskey?: P256Credential) => {
    if (!isOwnershipDisrupted || !recoveryPasskey) return "0x" as const;
    return encodeInitializeArgs([recoveryPasskey]);
  };

  const handleRecover = async () => {
    try {
      setRecovering(true);
      setSteps([]);
      setShowRecoveryModal(false);  // Close the modal before starting recovery

      // Create initial step based on what needs to be recovered
      const aspects = [];
      if (isDelegateDisrupted) aspects.push("delegate");
      if (isImplementationDisrupted) aspects.push("implementation");
      if (isOwnershipDisrupted) aspects.push("ownership");
      
      setSteps([{
        status: `Restoring ${aspects.join(", ")}...`,
        isComplete: false,
      }]);

      const userWallet = createEOAClient(account);
      const publicClient = createPublicClient({
        chain: chains[process.env.NEXT_PUBLIC_SELECTED_CHAIN as keyof typeof chains ?? "baseSepolia"],
        transport: http(),
      });

      // Create a new passkey if ownership is disrupted
      let recoveryPasskey: P256Credential | undefined;
      if (isOwnershipDisrupted) {
        recoveryPasskey = await createWebAuthnCredential({
          name: "Smart Wallet Owner",
        });
        if (!recoveryPasskey) {
          throw new Error("Failed to create new passkey");
        }
        onPasskeyStored(recoveryPasskey);
      }

      // Handle the three possible recovery flows
      if (isDelegateDisrupted && !isImplementationDisrupted) {
        // Delegate-only recovery
        const isEOASameAsRelayer = account.address.toLowerCase() === (process.env.NEXT_PUBLIC_RELAYER_ADDRESS as string).toLowerCase();
        const authorization = await userWallet.signAuthorization({
          contractAddress: EIP7702PROXY_TEMPLATE_ADDRESS,
          chainId: chains[process.env.NEXT_PUBLIC_SELECTED_CHAIN as keyof typeof chains ?? "baseSepolia"].id,
          executor: isEOASameAsRelayer ? account.address : undefined,
        });

        const response = await fetch("/api/relay", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            operation: "submit7702Auth",
            targetAddress: smartWalletAddress,
            authorizationList: [authorization],
          }, (_, value) => typeof value === "bigint" ? value.toString() : value),
        });

        if (!response.ok) throw new Error("Failed to reset delegate");
        const { hash } = await response.json();
        await publicClient.waitForTransactionReceipt({ hash });

        setSteps([{
          status: "Successfully restored delegate",
          isComplete: true,
          txHash: hash,
        }]);
      }
      else if (!isDelegateDisrupted && isImplementationDisrupted) {
        // Implementation-only recovery
        const currentImplementation = await getCurrentImplementation(publicClient, smartWalletAddress);
        const nonce = await getNonceFromTracker(publicClient, smartWalletAddress);
        const initArgs = prepareInitializationData(recoveryPasskey);

        const setImplementationHash = createSetImplementationHash(
          EIP7702PROXY_TEMPLATE_ADDRESS,
          CBSW_IMPLEMENTATION_ADDRESS,
          initArgs,
          nonce,
          currentImplementation,
          false,
          BigInt(chains[process.env.NEXT_PUBLIC_SELECTED_CHAIN as keyof typeof chains ?? "baseSepolia"].id),
          BigInt(maxUint256)
        );

        const signature = await signSetImplementation(userWallet, setImplementationHash);
        const response = await fetch("/api/relay", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            operation: "setImplementation",
            targetAddress: smartWalletAddress,
            signature,
            initArgs,
          }, (_, value) => typeof value === "bigint" ? value.toString() : value),
        });

        if (!response.ok) throw new Error("Failed to reset implementation");
        const { hash } = await response.json();
        await publicClient.waitForTransactionReceipt({ hash });

        setSteps([{
          status: `Successfully restored implementation${isOwnershipDisrupted ? " and ownership" : ""}`,
          isComplete: true,
          txHash: hash,
        }]);
      }
      else if (isDelegateDisrupted && isImplementationDisrupted) {
        // Combined recovery
        const isEOASameAsRelayer = account.address.toLowerCase() === (process.env.NEXT_PUBLIC_RELAYER_ADDRESS as string).toLowerCase();
        const authorization = await userWallet.signAuthorization({
          contractAddress: EIP7702PROXY_TEMPLATE_ADDRESS,
          chainId: chains[process.env.NEXT_PUBLIC_SELECTED_CHAIN as keyof typeof chains ?? "baseSepolia"].id,
          executor: isEOASameAsRelayer ? account.address : undefined,
        });

        const currentImplementation = await getCurrentImplementation(publicClient, smartWalletAddress);
        const nonce = await getNonceFromTracker(publicClient, smartWalletAddress);
        const initArgs = prepareInitializationData(recoveryPasskey);

        const setImplementationHash = createSetImplementationHash(
          EIP7702PROXY_TEMPLATE_ADDRESS,
          CBSW_IMPLEMENTATION_ADDRESS,
          initArgs,
          nonce,
          currentImplementation,
          false,
          BigInt(chains[process.env.NEXT_PUBLIC_SELECTED_CHAIN as keyof typeof chains ?? "baseSepolia"].id),
          BigInt(maxUint256)
        );

        const signature = await signSetImplementation(userWallet, setImplementationHash);
        const response = await fetch("/api/relay", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            operation: "upgradeEOA",
            targetAddress: smartWalletAddress,
            initArgs,
            signature,
            authorizationList: [authorization],
          }, (_, value) => typeof value === "bigint" ? value.toString() : value),
        });

        if (!response.ok) throw new Error("Failed to restore account");
        const { hash } = await response.json();
        await publicClient.waitForTransactionReceipt({ hash });

        setSteps([{
          status: `Successfully restored delegate and implementation${isOwnershipDisrupted ? " and ownership" : ""}`,
          isComplete: true,
          txHash: hash,
        }]);
      }

      // Verify the final state
      const state = await checkContractState(publicClient, smartWalletAddress);
      onStateChange(state.bytecode, state.implementation, state.nextOwnerIndex);

      // If we restored ownership, verify the new passkey
      if (isOwnershipDisrupted && recoveryPasskey) {
        const isOwner = await verifyPasskeyOwnership(publicClient, smartWalletAddress, recoveryPasskey);
        if (!isOwner) {
          throw new Error("Failed to verify new passkey ownership");
        }
      }

      onRecoveryComplete();
    } catch (error) {
      console.error("Recovery error:", error);
      setSteps(current => [
        ...current,
        {
          status: "Recovery failed",
          isComplete: true,
          error: error instanceof Error ? error.message : String(error),
        },
      ]);
    } finally {
      setRecovering(false);
    }
  };

  return (
    <div className="flex flex-col items-center w-full max-w-5xl mx-auto">
      {/* Only show the restore button if the account is disrupted */}
      {isDisrupted && (
        <button
          onClick={() => setShowRecoveryModal(true)}
          disabled={recovering}
          className="px-6 py-3 text-lg font-semibold text-white bg-blue-500 rounded-lg hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed mb-8 w-64"
        >
          {recovering ? "Restoring..." : "Restore Account"}
        </button>
      )}

      {/* Always show recovery steps if they exist */}
      {steps.length > 0 && (
        <div className="w-full space-y-4">
          {steps.map((step, index) => (
            <StepDisplay key={index} step={step} />
          ))}
        </div>
      )}

      <RecoveryModal
        isOpen={showRecoveryModal}
        onClose={() => setShowRecoveryModal(false)}
        onRecover={handleRecover}
        delegateIssue={isDelegateDisrupted}
        implementationIssue={isImplementationDisrupted}
        ownershipDisrupted={isOwnershipDisrupted}
      />
    </div>
  );
} 
