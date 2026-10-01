export const ARC_CONSTANTS = {
  MAINNET: {
    chainId: 5042,
    rpcUrl: "https://rpc.mainnet.arc.io",
    wsUrl: "wss://rpc.mainnet.arc.io",
    explorerUrl: "https://explorer.arc.io",
  },
  TESTNET: {
    chainId: 5042002,
    rpcUrl: "https://rpc.testnet.arc.io",
    wsUrl: "wss://rpc.testnet.arc.io",
    explorerUrl: "https://explorer.testnet.arc.io",
    faucetUrl: "https://faucet.circle.com",
  },
  // Canonical Predeploys on Arc L1
  USDC_PREDEPLOY: "0x3600000000000000000000000000000000000000" as `0x${string}`,
  SYSTEM_EMITTER: "0xffffFFFfFFffffffffffffffFfFFFfffFFFfFFfE" as `0x${string}`,
  MULTICALL3_FROM: "0xca11bde05977b3631167028862be2a173976ca11" as `0x${string}`,

  // Protocol Requirements
  MIN_GAS_FLOOR_GWEI: 20n,
  MIN_GAS_FLOOR_WEI: 20_000_000_000n, // 20 Gwei floor required by Arc mempool
  CCTP_DOMAIN: 26,
  USDC_DECIMALS: 6,
  NATIVE_DECIMALS: 18,
  DECIMAL_CONVERSION_FACTOR: 10n ** 12n, // 10^18 / 10^6
} as const;
