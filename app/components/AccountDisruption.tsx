import { useState, useEffect } from "react";
import { type Address, createPublicClient, http, encodeFunctionData } from "viem";
import { baseSepolia } from "@/app/lib/chains";
import { createEOAClient, type ExtendedAccount } from "@/app/lib/wallet-utils";
import { CBSW_IMPLEMENTATION_ADDRESS, STORAGE_ERASER_ADDRESS, FOREIGN_1967_IMPLEMENTATION } from "@/app/lib/constants";
import { AccountState } from "./AccountState";
import { checkContractState, getCurrentImplementation, getExpectedBytecode } from "@/app/lib/contract-utils";

// Helper to check if bytecode is correct
const isCorrectBytecode = (bytecode: string) => {
  const expectedBytecode = getExpectedBytecode();
  return bytecode.toLowerCase() === expectedBytecode.toLowerCase();
};

interface Props {
  account: ExtendedAccount;
  smartWalletAddress: Address;
  onDisruptionComplete: (type: 'delegate' | 'implementation' | 'ownership') => void;
  currentBytecode: string | null;
  currentSlotValue: string | null;
  onStateChange: (bytecode: string | null, slotValue: string | null, nextOwnerIndex?: bigint) => void;
}

export function AccountDisruption({
  account,
  smartWalletAddress,
  onDisruptionComplete,
  currentBytecode,
  currentSlotValue,
  onStateChange,
}: Props) {
  const [delegateLoading, setDelegateLoading] = useState(false);
  const [implementationLoading, setImplementationLoading] = useState(false);
  const [ownershipLoading, setOwnershipLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [isDelegateDisrupted, setIsDelegateDisrupted] = useState(false);
  const [nextOwnerIndex, setNextOwnerIndex] = useState<bigint>();

  useEffect(() => {
    const checkDelegateState = async () => {
      const publicClient = createPublicClient({
        chain: baseSepolia,
        transport: http(),
      });

      const state = await checkContractState(publicClient, account.address);
      onStateChange(state.bytecode, currentSlotValue, state.nextOwnerIndex);
      setIsDelegateDisrupted(state.isDelegateDisrupted);
      setNextOwnerIndex(state.nextOwnerIndex);
    };

    checkDelegateState();
  }, [account.address, currentSlotValue, onStateChange]); // Re-run when address or currentSlotValue changes

  useEffect(() => {
    const checkImplementationState = async () => {
      const publicClient = createPublicClient({
        chain: baseSepolia,
        transport: http(),
      });

      const implementation = await getCurrentImplementation(publicClient, account.address);
      onStateChange(currentBytecode, implementation, nextOwnerIndex);
    };

    checkImplementationState();
  }, [account.address, currentBytecode, nextOwnerIndex, onStateChange]); // Re-run when address, bytecode, or nextOwnerIndex changes

  // Add a new effect to update local state when props change
  useEffect(() => {
    const updateLocalState = async () => {
      const publicClient = createPublicClient({
        chain: baseSepolia,
        transport: http(),
      });

      const state = await checkContractState(publicClient, account.address);
      setIsDelegateDisrupted(state.isDelegateDisrupted);
      setNextOwnerIndex(state.nextOwnerIndex);
    };

    updateLocalState();
  }, [currentBytecode, currentSlotValue, account.address]); // Re-run when any of these props change

  // Function to check all relevant account states after disruption
  const checkState = async () => {
    const publicClient = createPublicClient({
      chain: baseSepolia,
      transport: http(),
    });

    const state = await checkContractState(publicClient, account.address);
    onStateChange(state.bytecode, state.implementation, state.nextOwnerIndex);
    setIsDelegateDisrupted(state.isDelegateDisrupted);
    setNextOwnerIndex(state.nextOwnerIndex);

    return state;
  };

  const handleDelegateForeign = async () => {
    try {
      setDelegateLoading(true);
      setError(null);

      // Create user's wallet client for signing
      const userWallet = createEOAClient(account);
      await checkState();

      // Get the relayer address
      const relayerAddress = (process.env.NEXT_PUBLIC_RELAYER_ADDRESS as `0x${string}`);
      console.log("Using relayer address:", relayerAddress);

      // Create public client for transaction monitoring
      const publicClient = createPublicClient({
        chain: baseSepolia,
        transport: http(),
      });

      // Create authorization signature for the smart wallet to change its delegate to the storage eraser
      console.log("\n=== Creating re-delegation authorization ===");
      console.log("Target delegate:", STORAGE_ERASER_ADDRESS);
      const authorization = await userWallet.signAuthorization({
        contractAddress: STORAGE_ERASER_ADDRESS,
        chainId: baseSepolia.id,
      });
      console.log("Created authorization:", {
        hasSignature: !!authorization,
        authorizationDetails: authorization,
        targetAddress: smartWalletAddress,
      });

      // Submit via relay endpoint
      console.log("Submitting authorization for re-delegation...");
      const response = await fetch("/api/relay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "submit7702Auth",
          targetAddress: account.address,
          authorizationList: [authorization],
        }, (_, value) => 
          typeof value === "bigint" ? value.toString() : value
        ),
      });

      if (!response.ok) {
        throw new Error("Failed to submit delegation via relay");
      }

      const { hash } = await response.json();
      console.log("Transaction submitted:", hash);

      // Wait for transaction confirmation
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      console.log("Transaction receipt:", receipt);

      await checkState();

      onDisruptionComplete('delegate');
    } catch (error: any) {
      console.error("Failed to delegate:", error);
      setError(error.message || "Failed to delegate to storage eraser");
    } finally {
      setDelegateLoading(false);
    }
  };

  const handleEraseStorage = async () => {
    try {
      setOwnershipLoading(true);
      setError(null);

      await checkState();

      // Create public client for transaction monitoring
      const publicClient = createPublicClient({
        chain: baseSepolia,
        transport: http(),
      });

      console.log("\n=== Erasing storage ===");
      console.log("Target account:", account.address);
      
      // Submit via relay endpoint
      const response = await fetch("/api/relay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          operation: "eraseStorage",
          targetAddress: account.address,
        }),
      });

      if (!response.ok) {
        throw new Error("Failed to submit erase storage via relay");
      }

      const { hash } = await response.json();
      console.log("Transaction submitted:", hash);

      // Wait for transaction confirmation
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      console.log("Transaction receipt:", receipt);

      const finalState = await checkState();

      // Check if nextOwnerIndex is now 0
      if (finalState.nextOwnerIndex !== BigInt(0)) {
        console.warn("⚠️ Warning: nextOwnerIndex was not reset to 0");
      }

      onDisruptionComplete('ownership');
      
    } catch (error: any) {
      console.error("Error erasing storage:", error);
      setError(error.message || "Failed to erase storage");
    } finally {
      setOwnershipLoading(false);
    }
  };

  const handleSetForeignImplementation = async () => {
    try {
      setImplementationLoading(true);
      
      const userWallet = createEOAClient(account);
      const initialState = await checkState();

      // Create public client for balance check and transaction monitoring
      const publicClient = createPublicClient({
        chain: baseSepolia,
        transport: http(),
      });

      // Check EOA balance and fund if needed
      const balance = await publicClient.getBalance({ address: account.address });
      const requiredBalance = BigInt(1000000000000000); // 0.001 ETH in wei
      if (balance < requiredBalance) {
        const fundingAmount = requiredBalance - balance;
        console.log(`Funding EOA with ${fundingAmount.toString()} wei...`);
        const fundResponse = await fetch("/api/relay", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            operation: "fund",
            targetAddress: account.address,
            value: fundingAmount.toString(),
          }),
        });
        
        if (!fundResponse.ok) {
          throw new Error("Failed to fund EOA wallet");
        }
        
        const { hash } = await fundResponse.json();
        await publicClient.waitForTransactionReceipt({ hash });
        
        const newBalance = await publicClient.getBalance({ address: account.address });
        console.log("New EOA balance:", newBalance.toString(), "wei");
      } else {
        console.log("EOA has sufficient balance, no funding needed");
      }

      // Submit upgradeToAndCall directly from the EOA
      console.log("\n=== Submitting upgradeToAndCall ===");
      console.log("Target implementation:", FOREIGN_1967_IMPLEMENTATION);
      
      const hash = await userWallet.sendTransaction({
        to: account.address,
        data: encodeFunctionData({
          abi: [{
            type: "function",
            name: "upgradeToAndCall",
            inputs: [
              { name: "newImplementation", type: "address" },
              { name: "data", type: "bytes" }
            ],
            outputs: [],
            stateMutability: "nonpayable"
          }],
          functionName: "upgradeToAndCall",
          args: [FOREIGN_1967_IMPLEMENTATION, "0x"]
        }),
        gas: BigInt(500000),
        maxFeePerGas: BigInt(1100000327),
        maxPriorityFeePerGas: BigInt(1100000025),
        value: BigInt(0)
      });
      
      console.log("Transaction submitted:", hash);

      // Wait for transaction confirmation
      const receipt = await publicClient.waitForTransactionReceipt({ hash });
      console.log("Transaction receipt:", receipt);

      // Check final state
      const finalState = await checkState();

      // For implementation change, check if ERC-1967 slot value changed
      if (finalState.implementation === initialState.implementation) {
        console.warn("⚠️ Warning: ERC-1967 slot value did not change after implementation change attempt");
      }

      onDisruptionComplete('implementation');
      
    } catch (error: any) {
      console.error("Error setting foreign implementation:", error);
      setError(error.message || "Failed to set foreign implementation");
    } finally {
      setImplementationLoading(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-4 mt-8 p-6 bg-gray-800 rounded-lg w-full max-w-5xl mx-auto">
      <h3 className="text-xl font-semibold text-red-400 mb-4">🛠️ Account Disruption Tools</h3>
      
      <div className="flex flex-col items-center gap-4 w-full">
        <div className="flex gap-4">
          <button
            onClick={handleDelegateForeign}
            disabled={delegateLoading || !currentBytecode || !isCorrectBytecode(currentBytecode)}
            className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 disabled:opacity-50"
          >
            {delegateLoading ? "Delegating..." : isDelegateDisrupted ? "Delegate is Foreign" : "7702-Delegate to Storage Eraser"}
          </button>

          <button
            onClick={handleSetForeignImplementation}
            disabled={implementationLoading || (!!currentSlotValue && currentSlotValue.toLowerCase() !== CBSW_IMPLEMENTATION_ADDRESS.toLowerCase())}
            className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 disabled:opacity-50"
          >
            {implementationLoading ? "Setting..." : (!!currentSlotValue && currentSlotValue.toLowerCase() !== CBSW_IMPLEMENTATION_ADDRESS.toLowerCase()) ? "Implementation is Foreign" : "Set Foreign ERC-1967 Implementation"}
          </button>

          <div className="relative group">
            <button
              onClick={handleEraseStorage}
              disabled={ownershipLoading || nextOwnerIndex === BigInt(0) || !isDelegateDisrupted}
              className="px-4 py-2 bg-red-500 text-white rounded hover:bg-red-600 disabled:opacity-50"
            >
              {ownershipLoading ? "Erasing..." : nextOwnerIndex === BigInt(0) ? "Storage Erased" : "Erase Owner Storage"}
            </button>
            {!isDelegateDisrupted && (
              <div className="absolute bottom-full left-1/2 transform -translate-x-1/2 mb-2 px-3 py-2 bg-gray-700 text-white text-sm rounded shadow-lg opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap">
                Only possible after 7702-delegation to storage eraser contract
              </div>
            )}
          </div>
        </div>

        <AccountState 
          currentBytecode={currentBytecode}
          currentSlotValue={currentSlotValue}
          nextOwnerIndex={nextOwnerIndex}
        />

        {error && (
          <div className="mt-4 text-red-400">
            Error: {error}
          </div>
        )}
      </div>
    </div>
  );
} 