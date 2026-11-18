# Veilfall

**Mafia with no host.** Five players, one hidden Killer, one hidden Doctor, three Villagers. In normal Mafia a trusted moderator knows every role. In Veilfall the moderator is a smart contract that **cannot peek**: roles, night moves and votes stay encrypted on-chain using the [Zama Protocol](https://www.zama.org) (fully homomorphic encryption). Only outcomes ever come to light.

- **Play it:** `<LIVE_URL>`
- **Contract (Sepolia):** [`0x551Ee3ad31E1EAa110509899c8B835C2e66f290d`](https://sepolia.etherscan.io/address/0x551Ee3ad31E1EAa110509899c8B835C2e66f290d)
- **Video pitch:** `<VIDEO_URL>`
- **Built for:** Zama Developer Program Mainnet Season 5, Confidential Gaming

## Why this only works with confidentiality

On a normal blockchain every value is public. A hidden-role game cannot exist there: anyone could read every role from storage, and a night move or vote would be visible the moment it is sent. The usual workaround is a trusted server or a commit-reveal scheme that still needs a human to reveal secrets. Veilfall needs neither.

Here the contract *computes on encrypted data*. It decides who died tonight without ever learning who the Killer is, who the Doctor saved, or how anyone voted. Take the encryption away and the game is not weaker, it is gone.

## How a game plays

1. **Seal.** Five players join. On the fifth join the contract deals roles using on-chain encrypted randomness. Nobody, including the contract, can see who got what. Each player decrypts only their own role with a wallet signature.
2. **Night.** *Every living player acts every night*, whatever their role. Villagers submit decoys. The contract applies only the Killer's and Doctor's real moves, selected under encryption, so an observer cannot tell who matters or who did what.
3. **Reveal.** The contract produces an encrypted result. Anyone can ask Zama's network to decrypt that single result and submit it back, where its KMS signatures are verified on-chain. Only "who died, and as what" is published.
4. **Day.** Everyone casts an encrypted vote. Votes are tallied under encryption and only the winner of the vote is revealed. A tie eliminates nobody.
5. **End.** The Villagers win if the Killer dies. The Killer wins when two players remain. At the end every role is made publicly decryptable, so **anyone can verify the deal was fair**.

## What is encrypted, what is public

| Encrypted, even from the contract | Public |
|---|---|
| Every role until the game ends | Who is seated and who is alive |
| The Killer's target and the Doctor's save | Who has locked in this phase |
| Which actions were real and which were decoys | Who died, and the role they held |
| Every individual vote | The winner, then every role after the game |

## Design decisions

- **Everyone acts, always.** If only the Killer and Doctor acted at night, the transaction pattern would reveal them. Making every player act removes the leak.
- **Fairness.** Roles come from encrypted on-chain randomness (`FHE.randEuint16`), so no player or operator can pick or predict them. The post-game public decryption lets anyone audit the result.
- **No host can stall the game.** If a phase sits past a 10 minute deadline, anyone can call `forceResolve`. Missing players simply act as abstentions. Encrypted "has acted" flags make sure a stalled Killer or Doctor cannot accidentally default to seat 1.
- **Gas-aware.** Night and vote results are accumulated incrementally as each action arrives, so the final step is cheap.

## Repository layout

```
contracts/Veilfall.sol        the game (FHEVM, deployed on Sepolia)
test/Veilfall.ts              17 local tests (rules, stalls, edge cases)
test/VeilfallSepolia.ts       a full 5-player game on real Sepolia
deploy/02_deploy_veilfall.ts  deployment script
frontend/                     Next.js static site (wallet + Zama relayer SDK)
```

## Proof it runs on Sepolia

A complete game (create, five joins, roles dealt, night actions, reveal, votes, reveal, winner, public role verification) was played on the deployed contract by the Sepolia test. Selected transactions from that game:

- Create game: [`0x9838e8f1…`](https://sepolia.etherscan.io/tx/0x9838e8f109190a597dff227dbe916d055b88bc829a1a715340f89bed7f4e443f)
- Fifth join (roles dealt): [`0xd5952ea8…`](https://sepolia.etherscan.io/tx/0xd5952ea84af73ec1424f3b1cf701dc42cbe8ee29fc584a10817981290e2ae408)
- Night action (encrypted): [`0xfe3218f4…`](https://sepolia.etherscan.io/tx/0xfe3218f43b9a631f712c5c7f5781df53319b1e67d73fa6b885db165c080d072a)
- Reveal the night: [`0x269494c2…`](https://sepolia.etherscan.io/tx/0x269494c2fa657b9ad4eb1c7c96b99f0ca8b52c9e11bbea6bc23c379b3896da2e)
- Encrypted vote: [`0x31a809db…`](https://sepolia.etherscan.io/tx/0x31a809db2ff2cc58fa0974e944e923a13196940d4eb05c79f498c4849ab4ec50)
- Reveal the vote: [`0xbb7c3f96…`](https://sepolia.etherscan.io/tx/0xbb7c3f96053685936713b9d18190c234ca89bd31bbc1e69cab31640e8c04762b)

Open any night action or vote on Etherscan: the input is an encrypted handle and a proof, with nothing readable.

## Run it yourself

Contracts (Node 20+):

```
npm install
npx hardhat test test/Veilfall.ts
npx hardhat vars set MNEMONIC
npx hardhat deploy --network sepolia --tags Veilfall
```

Frontend:

```
cd frontend
npm install
npm run dev
```

Open http://localhost:3000. To point it at your own deployment, create `frontend/.env.local` with `NEXT_PUBLIC_VEILFALL_ADDRESS=0xYourAddress`. `npm run build` produces a static site in `frontend/out`.

## Playing

- **Solo:** *Play solo against 4 bots.* One wallet transfer funds four throwaway opponent wallets kept in your browser. The bots are real players sending real Sepolia transactions, and each decrypts only its own role. Because this browser holds the bots' keys, it could technically read their roles; the contract never lets one player read another's, and the game UI never looks. Keep the tab open while the bots play.
- **With friends:** create a game and share the `?game=ID` link. You need five wallets on Sepolia.
- **Demo:** *Try the simulated demo* is an in-memory simulation with no wallet. It is labelled "Simulation, not on-chain" in the UI.

## Known limits

- Fixed table of five players, three roles.
- Testnet only. The Sepolia public RPC can lag a few seconds behind, so the UI polls.
- Solo bots play randomly: they are opponents to make a table, not strategists.

## Built with

Zama FHEVM (`@fhevm/solidity`), the Zama relayer SDK, Hardhat, ethers v6, Next.js, React.
