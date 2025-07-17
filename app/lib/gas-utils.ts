// Gas cost utility functions with fixed assumptions for display
export const GAS_ASSUMPTIONS = {
  gasPrice: BigInt(2_000_000_000), // 2 gwei in wei
  ethPriceUSD: 2500, // $2,500 per ETH
} as const;

/**
 * Calculate gas cost in ETH and USD using fixed assumptions
 * @param gasUnits - Number of gas units used
 * @param gasPriceWei - Gas price in wei (optional, defaults to 2 gwei)
 * @returns Object with costs in ETH and USD
 */
export function calculateGasCost(
  gasUnits: bigint,
  gasPriceWei: bigint = GAS_ASSUMPTIONS.gasPrice
) {
  const totalCostWei = gasUnits * gasPriceWei;
  const costETH = Number(totalCostWei) / 1e18;
  const costUSD = costETH * GAS_ASSUMPTIONS.ethPriceUSD;

  return {
    wei: totalCostWei,
    eth: costETH,
    usd: costUSD,
    formatted: {
      eth: costETH.toFixed(6),
      usd: costUSD.toFixed(2),
      gwei: (Number(gasPriceWei) / 1e9).toFixed(1),
    }
  };
}

/**
 * Format gas estimate with ETH and USD costs
 * @param gasUnits - Number of gas units
 * @param gasPriceWei - Gas price in wei (optional, defaults to 2 gwei) 
 * @param breakdown - Optional breakdown of gas components
 * @returns Formatted string with gas info
 */
export function formatGasEstimate(
  gasUnits: bigint,
  gasPriceWei: bigint = GAS_ASSUMPTIONS.gasPrice,
  breakdown?: {
    call?: bigint;
    verification?: bigint;
    preVerification?: bigint;
  }
) {
  const cost = calculateGasCost(gasUnits, gasPriceWei);
  
  let result = `Gas: ${gasUnits.toString()} units`;
  
  if (breakdown) {
    result += ` (call: ${breakdown.call || 0}, verification: ${breakdown.verification || 0}, pre-verification: ${breakdown.preVerification || 0})`;
  }
  
  result += `\nEst. cost: ${cost.formatted.eth} ETH ($${cost.formatted.usd} USD)`;
  result += `\nGas price: ${cost.formatted.gwei} Gwei`;
  
  return result;
} 