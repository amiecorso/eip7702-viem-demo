import { type Abi } from "viem";

export const EIP7702ProxyAbi = [
  {
    type: "constructor",
    inputs: [
      {
        name: "implementation",
        type: "address",
        internalType: "address",
      },
      { name: "initializer", type: "bytes4", internalType: "bytes4" },
    ],
    stateMutability: "nonpayable",
  },
  { type: "fallback", stateMutability: "payable" },
  {
    type: "function",
    name: "initialize",
    inputs: [
      { name: "args", type: "bytes", internalType: "bytes" },
      { name: "signature", type: "bytes", internalType: "bytes" },
    ],
    outputs: [],
    stateMutability: "nonpayable",
  },
  {
    type: "error",
    name: "AddressEmptyCode",
    inputs: [{ name: "target", type: "address", internalType: "address" }],
  },
  { type: "error", name: "ECDSAInvalidSignature", inputs: [] },
  {
    type: "error",
    name: "ECDSAInvalidSignatureLength",
    inputs: [{ name: "length", type: "uint256", internalType: "uint256" }],
  },
  {
    type: "error",
    name: "ECDSAInvalidSignatureS",
    inputs: [{ name: "s", type: "bytes32", internalType: "bytes32" }],
  },
  { type: "error", name: "FailedCall", inputs: [] },
  { type: "error", name: "InvalidImplementation", inputs: [] },
  { type: "error", name: "InvalidInitializer", inputs: [] },
  { type: "error", name: "InvalidSignature", inputs: [] },
] as const satisfies Abi;

// Contract addresses for different networks
export const EIP7702ProxyAddresses = {
  baseSepolia: "0x0000000000000000000000000000000000000000", // TODO: Replace with actual address when deployed
  anvil: "0x261D8c5e9742e6f7f1076Fa1F560894524e19cad",
} as const;
