import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, fhevm } from "hardhat";
import { MockCUSDT, SplitOrStealStaked } from "../types";
import { expect } from "chai";
import { FhevmType } from "@fhevm/hardhat-plugin";

const SPLIT = false;
const STEAL = true;
const STAKE = 10;
const START = 100;

describe("SplitOrStealStaked", function () {
  let alice: HardhatEthersSigner;
  let bob: HardhatEthersSigner;
  let token: MockCUSDT;
  let game: SplitOrStealStaked;
  let tokenAddress: string;
  let gameAddress: string;

  before(async function () {
    const s = await ethers.getSigners();
    alice = s[1];
    bob = s[2];
  });

  beforeEach(async function () {
    if (!fhevm.isMock) {
      console.warn(`This hardhat test suite cannot run on Sepolia Testnet`);
      this.skip();
    }
    token = (await (await ethers.getContractFactory("MockCUSDT")).deploy()) as MockCUSDT;
    tokenAddress = await token.getAddress();
    game = (await (await ethers.getContractFactory("SplitOrStealStaked")).deploy(tokenAddress)) as SplitOrStealStaked;
    gameAddress = await game.getAddress();
  });

  async function fund(who: HardhatEthersSigner, amount: number) {
    await (await token.mint(who.address, amount)).wait();
    await (await token.connect(who).setOperator(gameAddress, 2n ** 47n)).wait();
  }

  async function balance(who: HardhatEthersSigner): Promise<number> {
    const handle = await token.confidentialBalanceOf(who.address);
    if (handle === ethers.ZeroHash) return 0;
    return Number(await fhevm.userDecryptEuint(FhevmType.euint64, handle, tokenAddress, who));
  }

  async function play(id: number, who: HardhatEthersSigner, choice: boolean) {
    const enc = await fhevm.createEncryptedInput(gameAddress, who.address).addBool(choice).encrypt();
    await (await game.connect(who).play(id, enc.handles[0], enc.inputProof)).wait();
  }

  async function duel(a: boolean, b: boolean) {
    await fund(alice, START);
    await fund(bob, START);
    await (await game.connect(alice).createDuel(bob.address, STAKE)).wait();
    await play(1, alice, a);
    await play(1, bob, b);
    return { alice: await balance(alice), bob: await balance(bob) };
  }

  it("both split: stakes come back", async function () {
    expect(await duel(SPLIT, SPLIT)).to.deep.eq({ alice: START, bob: START });
  });

  it("alice steals, bob splits: alice wins bob's stake", async function () {
    expect(await duel(STEAL, SPLIT)).to.deep.eq({ alice: START + STAKE, bob: START - STAKE });
  });

  it("alice splits, bob steals: bob wins alice's stake", async function () {
    expect(await duel(SPLIT, STEAL)).to.deep.eq({ alice: START - STAKE, bob: START + STAKE });
  });

  it("both steal: the pot is forfeited", async function () {
    expect(await duel(STEAL, STEAL)).to.deep.eq({ alice: START - STAKE, bob: START - STAKE });
  });

  it("underfunded player: everyone is refunded what they paid", async function () {
    await fund(alice, START);
    await fund(bob, 5);
    await (await game.connect(alice).createDuel(bob.address, STAKE)).wait();
    await play(1, alice, STEAL);
    await play(1, bob, SPLIT);
    expect(await balance(alice)).to.eq(START);
    expect(await balance(bob)).to.eq(5);
  });

  it("refund after timeout if the opponent never plays, and late play is blocked", async function () {
    await fund(alice, START);
    await fund(bob, START);
    await (await game.connect(alice).createDuel(bob.address, STAKE)).wait();
    await play(1, alice, STEAL);
    expect(await balance(alice)).to.eq(START - STAKE);

    await expect(game.connect(alice).claimRefund(1)).to.be.revertedWith("Too early");

    await ethers.provider.send("evm_increaseTime", [24 * 3600 + 5]);
    await ethers.provider.send("evm_mine", []);
    await (await game.connect(alice).claimRefund(1)).wait();
    expect(await balance(alice)).to.eq(START);

    await expect(game.connect(alice).claimRefund(1)).to.be.revertedWith("Nothing to refund");
    const enc = await fhevm.createEncryptedInput(gameAddress, bob.address).addBool(true).encrypt();
    await expect(game.connect(bob).play(1, enc.handles[0], enc.inputProof)).to.be.revertedWith("Duel closed");
  });

  it("outsiders cannot play", async function () {
    const carol = (await ethers.getSigners())[3];
    await (await game.connect(alice).createDuel(bob.address, STAKE)).wait();
    const enc = await fhevm.createEncryptedInput(gameAddress, carol.address).addBool(true).encrypt();
    await expect(game.connect(carol).play(1, enc.handles[0], enc.inputProof)).to.be.revertedWith("Not a player");
  });
});