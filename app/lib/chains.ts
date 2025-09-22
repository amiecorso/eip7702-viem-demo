import { Chain } from "viem";

export const chains = {
 baseSepolia: {
    id: 84532,
    name: "Base Sepolia",
    nativeCurrency: {
      decimals: 18,
      name: "ETH",
      symbol: "ETH",
    },
    rpcUrls: {
      default: {
        http: [process.env.BASE_SEPOLIA_RPC ?? "https://sepolia.base.org"],
      },
      public: {
        http: [process.env.BASE_SEPOLIA_RPC ?? "https://sepolia.base.org"],
      },
    },
    blockExplorers: {
      default: {
        name: "BaseScan",
        url: "https://sepolia.basescan.org",
      },
    },
    contracts: {
      multicall3: {
        address: "0xca11bde05977b3631167028862be2a173976ca11" as const,
      },
    },
  } as const satisfies Chain,

  baseMainnet: {
    id: 8453,
    name: "Base Mainnet",
    nativeCurrency: {
      decimals: 18,
      name: "ETH",
      symbol: "ETH",
    },
    rpcUrls: {
      default: {
        http: [process.env.BASE_MAINNET_RPC ?? "https://mainnet.base.org"],
      },
      public: {
        http: [process.env.BASE_MAINNET_RPC ?? "https://mainnet.base.org"],
      },
    },
    blockExplorers: {
      default: {
        name: "BaseScan",
        url: "https://basescan.org",
      },
    },
    contracts: {
      multicall3: {
        address: "0xca11bde05977b3631167028862be2a173976ca11" as const,
      },
    },
  } as const satisfies Chain,

  ethMainnet : {
    id: 1,
    name: "Eth Mainnet",
    nativeCurrency: {
      decimals: 18,
      name: "ETH",
      symbol: "ETH",
    },
    rpcUrls: {
      default: {
        http: [process.env.ETH_MAINNET_RPC ?? "https://mainnet.base.org"],
      },
      public: {
        http: [process.env.ETH_MAINNET_RPC ?? "https://mainnet.base.org"],
      },
    },
    blockExplorers: {
      default: {
        name: "Etherscan",
        url: "https://etherscan.org",
      },
    },
    contracts: {
      multicall3: {
        address: "0xca11bde05977b3631167028862be2a173976ca11" as const,
      },
    },
  } as const satisfies Chain
}
