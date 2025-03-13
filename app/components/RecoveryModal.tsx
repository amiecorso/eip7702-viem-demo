import { type Address } from "viem";
import { type ExtendedAccount } from "../lib/wallet-utils";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onRecover: () => Promise<void>;
  delegateIssue: boolean;
  implementationIssue: boolean;
}

export function RecoveryModal({
  isOpen,
  onClose,
  onRecover,
  delegateIssue,
  implementationIssue,
}: Props) {
  if (!isOpen) return null;

  const issues = [];
  if (delegateIssue) issues.push("incorrect delegate");
  if (implementationIssue) issues.push("incorrect implementation");

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-gray-800 p-8 rounded-lg max-w-lg w-full mx-4">
        <h2 className="text-xl font-semibold text-red-400 mb-4">⚠️ Account State Issue Detected</h2>
        
        <p className="text-gray-300 mb-6">
          Your account is in an inconsistent state with {issues.join(" and ")}. 
          Would you like to restore it to the correct state?
        </p>

        <div className="flex justify-end gap-4">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-400 hover:text-white"
          >
            Cancel
          </button>
          <button
            onClick={onRecover}
            className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600"
          >
            Restore Account
          </button>
        </div>
      </div>
    </div>
  );
} 