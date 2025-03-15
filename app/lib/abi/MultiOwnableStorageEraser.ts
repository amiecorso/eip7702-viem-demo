import { Abi } from "viem";

export const MULTI_OWNABLE_STORAGE_ERASER_ABI = [
    {
      "type": "function",
      "name": "eraseNextOwnerIndexStorage",
      "inputs": [],
      "outputs": [],
      "stateMutability": "nonpayable"
    }
  ] as const satisfies Abi;