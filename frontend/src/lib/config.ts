// The deployed Veilfall contract on Sepolia. Override with NEXT_PUBLIC_VEILFALL_ADDRESS in .env.local.
export const CONTRACT_ADDRESS: string =
  process.env.NEXT_PUBLIC_VEILFALL_ADDRESS || "0x551Ee3ad31E1EAa110509899c8B835C2e66f290d";

export const CHAIN_ID = 11155111;
export const CHAIN_ID_HEX = "0xaa36a7";
export const EXPLORER = "https://sepolia.etherscan.io";
export const FALLBACK_RPC = "https://ethereum-sepolia-rpc.publicnode.com";
export const SEATS = 5;
// Same safety margin Zama's tooling uses on top of estimated gas, plus the per-transaction cap.
export const GAS_MARGIN_PERCENT = 130n;
export const GAS_CAP = 16_000_000n;
