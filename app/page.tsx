"use client";

import { useState } from "react";
import { WalletManager } from "./components/WalletManager";
import { PasskeyVerification } from "./components/PasskeyVerification";
import { type ExtendedAccount } from "./lib/wallet-utils";
import { chains } from "./lib/chains";
import { type P256Credential } from "viem/account-abstraction";
import { AccountDisruption } from "./components/AccountDisruption";
import { CBSW_IMPLEMENTATION_ADDRESS } from "./lib/constants";
import { getExpectedBytecode } from "./lib/contract-utils";

export default function Home() {
  const [resetKey, setResetKey] = useState(0);
  const [walletAddress, setWalletAddress] = useState<string | null>(null);
  const [walletExplorerLink, setWalletExplorerLink] = useState<string | null>(null);
  const [upgradeTxHash, setUpgradeTxHash] = useState<string | null>(null);
  const [bytecode, setBytecode] = useState<string | null>(null);
  const [isUpgradeConfirmed, setIsUpgradeConfirmed] = useState(false);
  const [account, setAccount] = useState<ExtendedAccount | null>(null);
  const [passkey, setPasskey] = useState<P256Credential | null>(null);
  const [isDelegateDisrupted, setIsDelegateDisrupted] = useState(false);
  const [isImplementationDisrupted, setIsImplementationDisrupted] = useState(false);
  const [isOwnershipDisrupted, setIsOwnershipDisrupted] = useState(false);
  const [currentBytecode, setCurrentBytecode] = useState<string | null>(null);
  const [currentSlotValue, setCurrentSlotValue] = useState<string | null>(null);
  const [nextOwnerIndex, setNextOwnerIndex] = useState<bigint>();

  const handleReset = () => {
    setWalletAddress(null);
    setWalletExplorerLink(null);
    setUpgradeTxHash(null);
    setBytecode(null);
    setIsUpgradeConfirmed(false);
    setAccount(null);
    setPasskey(null);
    setIsDelegateDisrupted(false);
    setIsImplementationDisrupted(false);
    setIsOwnershipDisrupted(false);
    setCurrentBytecode(null);
    setCurrentSlotValue(null);
    setNextOwnerIndex(undefined);
    setResetKey((prev) => prev + 1);
  };

  const handleDisruptionComplete = (type: 'delegate' | 'implementation' | 'ownership') => {
    if (type === 'delegate') {
      setIsDelegateDisrupted(true);
    } else if (type === 'implementation') {
      setIsImplementationDisrupted(true);
    } else {
      setIsOwnershipDisrupted(true);
    }
  };

  const handleRecoveryComplete = () => {
    setIsDelegateDisrupted(false);
    setIsImplementationDisrupted(false);
    setIsOwnershipDisrupted(false);
  };

  const handleStateChange = (bytecode: string | null, slotValue: string | null, ownerIndex?: bigint) => {
    // Update current values if they're provided
    if (bytecode !== null) {
      setCurrentBytecode(bytecode);
      
      // Check if delegate is disrupted by comparing bytecode with expected format
      const expectedBytecode = getExpectedBytecode();
      const currentBytecode = bytecode.toLowerCase();
      const newDelegateDisrupted = currentBytecode !== "0x" && currentBytecode !== expectedBytecode;
      setIsDelegateDisrupted(newDelegateDisrupted);
    }

    if (slotValue !== null) {
      setCurrentSlotValue(slotValue);

      const newImplementationDisrupted = slotValue.toLowerCase() !== CBSW_IMPLEMENTATION_ADDRESS.toLowerCase();
      setIsImplementationDisrupted(newImplementationDisrupted);
    }

    if (ownerIndex !== undefined) {
      setNextOwnerIndex(ownerIndex);
      setIsOwnershipDisrupted(ownerIndex === BigInt(0));
    }
  };

  const handleUpgradeComplete = async (
    address: `0x${string}`,
    upgradeHash: string,
    code: string
  ) => {
    setUpgradeTxHash(upgradeHash);
    setBytecode(code);
    setIsUpgradeConfirmed(true);
    setCurrentBytecode(code);
  };

  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <div className="text-center mb-12">
        <h1 className="text-4xl font-bold mb-4">
          <a
            href="https://github.com/ethereum/EIPs/blob/master/EIPS/eip-7702.md"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 hover:text-blue-300 underline"
          >
            EIP-7702
          </a>{" "}
          Demo
        </h1>
        <p className="text-xl text-gray-400">
          Upgrade an EOA to a CoinbaseSmartWallet
        </p>
      </div>

      <div className="mb-8">
        <WalletManager
          onWalletCreated={(address, explorerLink) => {
            setWalletAddress(address);
            setWalletExplorerLink(explorerLink);
          }}
          onUpgradeComplete={handleUpgradeComplete}
          resetKey={resetKey}
          onAccountCreated={setAccount}
          onPasskeyStored={setPasskey}
        />
      </div>

      {walletAddress && (
        <div className="mb-4 w-full">
          <div className="p-4 bg-gray-800 rounded-lg w-full max-w-5xl mx-auto">
            <div className="flex items-center gap-2">
              <span className="text-green-500">✓</span>
              <span className="text-gray-400">New EOA Address:</span>
              <div className="break-all">
                {walletExplorerLink ? (
                  <a
                    href={walletExplorerLink}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-blue-400 hover:text-blue-300 underline font-mono"
                  >
                    {walletAddress}
                  </a>
                ) : (
                  <span className="text-green-500 font-mono">{walletAddress}</span>
                )}
              </div>
            </div>
          </div>
        </div>
      )}

      {upgradeTxHash && (
        <div className="mb-4 w-full">
          <div className="p-4 bg-gray-800 rounded-lg w-full max-w-5xl mx-auto">
            <div className="flex items-center gap-2">
              <span className="text-green-500">✓</span>
              <span className="text-gray-400">Upgrade Transaction:</span>
              <div className="break-all">
                <a
                  href={`${chains[process.env.NEXT_PUBLIC_SELECTED_CHAIN as keyof typeof chains ?? "baseSepolia"].blockExplorers.default.url}/tx/${upgradeTxHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-blue-400 hover:text-blue-300 underline font-mono"
                >
                  {upgradeTxHash}
                </a>
              </div>
            </div>
          </div>
        </div>
      )}

      {bytecode && (
        <div className="mb-4 w-full">
          <div className="p-4 bg-gray-800 rounded-lg w-full max-w-5xl mx-auto">
            <div className="flex items-center gap-2">
              <span className="text-green-500">✓</span>
              <span className="text-gray-400">EOA Bytecode:</span>
              <div className="break-all text-green-500 font-mono">
                {bytecode}
              </div>
            </div>
          </div>
        </div>
      )}

      {isUpgradeConfirmed && passkey && (
        <div className="mb-4 w-full">
          <div className="p-4 bg-gray-800 rounded-lg w-full max-w-5xl mx-auto">
            <div className="flex items-center gap-2 mb-2">
              <span className="text-green-500">✓</span>
              <span className="text-gray-400">Passkey Verification:</span>
              <div className="text-green-500">
                Successfully verified passkey as wallet owner
              </div>
            </div>
            <div className="ml-6 mt-2">
              <div className="text-gray-400 mb-1">Passkey Public Key:</div>
              <div className="break-all font-mono text-sm text-blue-400">
                {passkey.publicKey}
              </div>
            </div>
          </div>
        </div>
      )}

      {isUpgradeConfirmed && account && walletAddress && (
        <AccountDisruption
          account={account}
          smartWalletAddress={walletAddress as `0x${string}`}
          onDisruptionComplete={handleDisruptionComplete}
          currentBytecode={currentBytecode}
          currentSlotValue={currentSlotValue}
          onStateChange={handleStateChange}
        />
      )}

      {isUpgradeConfirmed && walletAddress && passkey && (
        <PasskeyVerification
          smartWalletAddress={walletAddress as `0x${string}`}
          passkey={passkey}
          account={account!}
          isDelegateDisrupted={isDelegateDisrupted}
          isImplementationDisrupted={isImplementationDisrupted}
          isOwnershipDisrupted={isOwnershipDisrupted}
          onRecoveryComplete={handleRecoveryComplete}
          onStateChange={handleStateChange}
          onPasskeyStored={setPasskey}
        />
      )}

      <div className="mt-8 mb-4 border-t border-gray-700 w-full max-w-2xl"></div>

      <button
        onClick={handleReset}
        className="mt-4 px-4 py-2 bg-green-500 text-white rounded hover:bg-green-600"
      >
        Reset Demo
      </button>
    </main>
  );
}
