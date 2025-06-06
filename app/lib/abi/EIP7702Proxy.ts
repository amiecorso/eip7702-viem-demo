import { type Abi } from "viem";

export const EIP7702ProxyAbi = [
  {
    "type": "constructor",
    "inputs": [
      {
        "name": "nonceTracker_",
        "type": "address",
        "internalType": "address"
      },
      { "name": "receiver", "type": "address", "internalType": "address" }
    ],
    "stateMutability": "nonpayable"
  },
  { "type": "fallback", "stateMutability": "payable" },
  {
    "type": "function",
    "name": "isValidSignature",
    "inputs": [
      { "name": "hash", "type": "bytes32", "internalType": "bytes32" },
      { "name": "signature", "type": "bytes", "internalType": "bytes" }
    ],
    "outputs": [{ "name": "", "type": "bytes4", "internalType": "bytes4" }],
    "stateMutability": "nonpayable"
  },
  {
    "type": "function",
    "name": "nonceTracker",
    "inputs": [],
    "outputs": [
      {
        "name": "",
        "type": "address",
        "internalType": "contract NonceTracker"
      }
    ],
    "stateMutability": "view"
  },
  {
    "type": "function",
    "name": "setImplementation",
    "inputs": [
      {
        "name": "newImplementation",
        "type": "address",
        "internalType": "address"
      },
      { "name": "callData", "type": "bytes", "internalType": "bytes" },
      { "name": "validator", "type": "address", "internalType": "address" },
      { "name": "expiry", "type": "uint256", "internalType": "uint256" },
      { "name": "signature", "type": "bytes", "internalType": "bytes" },
      {
        "name": "allowCrossChainReplay",
        "type": "bool",
        "internalType": "bool"
      }
    ],
    "outputs": [],
    "stateMutability": "nonpayable"
  },
  {
    "type": "event",
    "name": "Upgraded",
    "inputs": [
      {
        "name": "implementation",
        "type": "address",
        "indexed": true,
        "internalType": "address"
      }
    ],
    "anonymous": false
  },
  {
    "type": "error",
    "name": "AddressEmptyCode",
    "inputs": [
      { "name": "target", "type": "address", "internalType": "address" }
    ]
  },
  { "type": "error", "name": "ECDSAInvalidSignature", "inputs": [] },
  {
    "type": "error",
    "name": "ECDSAInvalidSignatureLength",
    "inputs": [
      { "name": "length", "type": "uint256", "internalType": "uint256" }
    ]
  },
  {
    "type": "error",
    "name": "ECDSAInvalidSignatureS",
    "inputs": [{ "name": "s", "type": "bytes32", "internalType": "bytes32" }]
  },
  {
    "type": "error",
    "name": "ERC1967InvalidImplementation",
    "inputs": [
      {
        "name": "implementation",
        "type": "address",
        "internalType": "address"
      }
    ]
  },
  { "type": "error", "name": "ERC1967NonPayable", "inputs": [] },
  { "type": "error", "name": "FailedCall", "inputs": [] },
  { "type": "error", "name": "InvalidSignature", "inputs": [] },
  { "type": "error", "name": "InvalidValidation", "inputs": [] },
  { "type": "error", "name": "SignatureExpired", "inputs": [] },
  { "type": "error", "name": "ZeroAddress", "inputs": [] }
] as const satisfies Abi;
