import { useState } from "react";

interface Props {
  isOpen: boolean;
  onClose: () => void;
  onRecover: () => Promise<void>;
  delegateIssue: boolean;
  implementationIssue: boolean;
  ownershipDisrupted: boolean;
}

export function RecoveryModal({
  isOpen,
  onClose,
  onRecover,
  delegateIssue,
  implementationIssue,
  ownershipDisrupted,
}: Props) {
  const [isRecovering, setIsRecovering] = useState(false);

  if (!isOpen) return null;

  // Check for unrecoverable state
  const isUnrecoverable = delegateIssue && ownershipDisrupted && !implementationIssue;

  const renderIssues = () => {
    const issues = [];
    if (delegateIssue) issues.push("delegate");
    if (implementationIssue) issues.push("implementation");
    if (ownershipDisrupted) issues.push("ownership");
    
    return issues.length > 1 
      ? `${issues.slice(0, -1).join(", ")} and ${issues.slice(-1)[0]} are incorrect`
      : `the ${issues[0]} is incorrect`;
  };

  const handleRecover = async () => {
    try {
      setIsRecovering(true);
      onClose(); // Close the modal first
      await onRecover(); // Then start the recovery process
    } catch (error) {
      console.error("Recovery failed:", error);
    } finally {
      setIsRecovering(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
      <div className="bg-gray-800 p-8 rounded-lg max-w-lg w-full mx-4">
        <h2 className="text-xl font-semibold text-red-400 mb-4">⚠️ Account State Issue Detected</h2>
        
        {isUnrecoverable ? (
          <div className="text-gray-300 mb-6">
            <p className="text-red-400 font-semibold mb-2">⛔️ Unrecoverable Account State</p>
            <p>
              Your account is in an unrecoverable state where both the delegate and ownership are disrupted, 
              but the implementation is still correct. To recover from this state, an intermediate 7702 delegate must be used to reset the ERC-1967 implementation
              to empty before atomically setting and initializing the actual CoinbaseSmartWallet implementation. Not yet implemented.
            </p>
            <p className="mt-4">
              To proceed, close this modal and disrupt the ERC-1967 implementation, then reattempt recovery.
            </p>
          </div>
        ) : (
          <p className="text-gray-300 mb-6">
            Your account is in an inconsistent state where {renderIssues()}. 
            {ownershipDisrupted && (
              <span className="block mt-2">
                You will need to create a new passkey to restore account access.
              </span>
            )}
          </p>
        )}

        <div className="flex justify-end gap-4">
          <button
            onClick={onClose}
            className="px-4 py-2 text-gray-400 hover:text-white"
          >
            {isUnrecoverable ? "Close" : "Cancel"}
          </button>
          {!isUnrecoverable && (
            <button
              onClick={handleRecover}
              disabled={isRecovering}
              className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
            >
              {isRecovering ? "Recovering..." : "Restore Account"}
            </button>
          )}
        </div>
      </div>
    </div>
  );
} 