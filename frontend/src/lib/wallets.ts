/* eslint-disable @typescript-eslint/no-explicit-any */

export interface WalletOption {
  id: string;
  name: string;
  icon?: string;
  provider: any;
}

declare global {
  interface Window {
    okxwallet?: any;
  }
}

const legacyName = (p: any): string => {
  if (p?.isOkxWallet || p?.isOKExWallet) return "OKX Wallet";
  if (p?.isRabby) return "Rabby";
  if (p?.isCoinbaseWallet) return "Coinbase Wallet";
  if (p?.isTrust || p?.isTrustWallet) return "Trust Wallet";
  if (p?.isMetaMask) return "MetaMask";
  return "Browser wallet";
};

/**
 * Finds every wallet in this browser. Modern wallets (MetaMask, OKX, Rabby, Coinbase, ...) announce themselves
 * with the EIP-6963 standard; older or stubborn ones are picked up from the globals they inject.
 */
export async function discoverWallets(waitMs = 500): Promise<WalletOption[]> {
  const found: WalletOption[] = [];
  const add = (o: WalletOption) => {
    if (!o.provider) return;
    if (found.some((f) => f.provider === o.provider || f.name.toLowerCase() === o.name.toLowerCase())) return;
    found.push(o);
  };

  const onAnnounce = (event: Event) => {
    const d = (event as CustomEvent).detail;
    if (d?.provider) add({ id: d.info?.rdns ?? d.info?.uuid ?? d.info?.name, name: d.info?.name ?? "Wallet", icon: d.info?.icon, provider: d.provider });
  };
  window.addEventListener("eip6963:announceProvider", onAnnounce);
  window.dispatchEvent(new Event("eip6963:requestProvider"));
  await new Promise((r) => setTimeout(r, waitMs));
  window.removeEventListener("eip6963:announceProvider", onAnnounce);

  // Fallbacks for wallets that do not announce themselves.
  if (window.okxwallet) add({ id: "okx", name: "OKX Wallet", provider: window.okxwallet });
  const eth = window.ethereum;
  if (eth) {
    const list: any[] = Array.isArray(eth.providers) && eth.providers.length ? eth.providers : [eth];
    list.forEach((p, i) => add({ id: `legacy-${i}`, name: legacyName(p), provider: p }));
  }
  return found;
}
