import { type Address } from "viem";

// *************** Contract addresses ***************

// EIP7702Proxy
export const EIP7702PROXY_TEMPLATE_ADDRESS = "0xcA271A94dd66982180960B579de6B3213084D67A" as const;

// NonceTracker used by EIP7702Proxy
export const NONCE_TRACKER_ADDRESS = "0x1e3C75E11F8c31ffe8BA28A648B1D58566df6d72" as const;

// Validator contract address, validates CBSW_IMPLEMENTATION_ADDRESS
export const VALIDATOR_ADDRESS = "0xA96fc9fA032e5f58E225D979f985D51BCb671eF8" as const;

// CoinbaseSmartWallet implementation address
export const CBSW_IMPLEMENTATION_ADDRESS = "0x3e0BecB45eBf7Bd1e3943b9521264Bc5B0bd8Ca9" as const;

// A mock UUPSUpgradeable implementation
export const FOREIGN_1967_IMPLEMENTATION = "0xbAaaB2feecd974717816FA5ac540D96ad12eb342" as const;

export const STORAGE_ERASER_ADDRESS = "0xA7aFC9Fe41cE8197596B6d3096BF3dcb4A61c122" as const;

// Standard EntryPoint address (same across networks)
export const ENTRYPOINT_ADDRESS =
  "0x5FF137D4b0FDCD49DcA30c7CF57E578a026d2789" as const;

  // Zero address
export const ZERO_ADDRESS = "0x0000000000000000000000000000000000000000" as const;


// *************** Contract constants ***************

// Implementation set typehash
export const IMPLEMENTATION_SET_TYPEHASH = "EIP7702ProxyImplementationSet(uint256 chainId,address proxy,uint256 nonce,address currentImplementation,address newImplementation,bytes callData,address validator)" as const;

// ERC1967 implementation slot storage location
export const ERC1967_IMPLEMENTATION_SLOT = "0x360894a13ba1a3210667c828492db98dca3e2076cc3735a920a3ca505d382bbc" as const;

// EIP-7702 magic prefix
export const MAGIC_PREFIX = "0xef0100" as const;
