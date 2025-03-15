import { getExpectedBytecode } from "../lib/contract-utils";
import { CBSW_IMPLEMENTATION_ADDRESS } from "../lib/constants";

interface Props {
  currentBytecode: string | null;
  currentSlotValue: string | null;
  nextOwnerIndex?: bigint;
}

// Helper to check if bytecode is correct (includes magic prefix)
const isCorrectBytecode = (bytecode: string) => {
  const expectedBytecode = getExpectedBytecode();
  return bytecode.toLowerCase() === expectedBytecode.toLowerCase();
};

export function AccountState({ currentBytecode, currentSlotValue, nextOwnerIndex }: Props) {
  return (
    <div className="mt-4 p-4 bg-gray-900/30 rounded-lg w-full">
      <h4 className="text-lg font-semibold text-blue-400 mb-2">Current EOA State:</h4>
      <div className="font-mono text-sm break-all">
        <p className="text-gray-400 mb-2">
          Bytecode: {
            currentBytecode 
              ? <span className={currentBytecode === "0x" || !isCorrectBytecode(currentBytecode) ? "text-red-400" : "text-green-400"}>
                  {currentBytecode}
                </span>
              : <span className="text-yellow-400">Not checked yet</span>
          }
        </p>
        <p className="text-gray-400 mb-2">
          Implementation Address: {
            currentSlotValue 
              ? <span className={currentSlotValue.toLowerCase() !== CBSW_IMPLEMENTATION_ADDRESS.toLowerCase() ? "text-red-400" : "text-green-400"}>
                  {currentSlotValue}
                </span>
              : <span className="text-yellow-400">Not checked yet</span>
          }
        </p>
        <p className="text-gray-400">
          Next Owner Index: {
            nextOwnerIndex !== undefined
              ? <span className={nextOwnerIndex === BigInt(0) ? "text-red-400" : "text-green-400"}>
                  {nextOwnerIndex.toString()}
                </span>
              : <span className="text-yellow-400">Not checked yet</span>
          }
        </p>
      </div>
    </div>
  );
} 