import { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/signers";
import { ethers, fhevm } from "hardhat";
import { SplitOrSteal, SplitOrSteal__factory } from "../types";
import { expect } from "chai";
import { FhevmType } from "@fhevm/hardhat-plugin";

type Signers = {
  alice: HardhatEthersSigner;
  bob: HardhatEthersSigner;
  carol: HardhatEthersSigner;
};

const SPLIT = false;
const STEAL = true;

describe("SplitOrSteal", function () {
  let signers: Signers;
  let game: SplitOrSteal;
  let gameAddress: string;

  before(async function () {
    const s = await ethers.getSigners();
    signers = { alice: s[1], bob: s[2], carol: s[3] };
  });

  beforeEach(async function () {
    if (!fhevm.isMock) {
      console.warn(`This hardhat test suite cannot run on Sepolia Testnet`);
      this.skip();
    }
    const factory = (await ethers.getContractFactory("SplitOrSteal")) as SplitOrSteal__factory;
    game = (await factory.deploy()) as SplitOrSteal;
    gameAddress = await game.getAddress();
  });

  async function play(id: number, who: HardhatEthersSigner, choice: boolean) {
    const enc = await fhevm.createEncryptedInput(gameAddress, who.address).addBool(choice).encrypt();
    await (await game.connect(who).play(id, enc.handles[0], enc.inputProof)).wait();
  }

  async function result(id: number, who: HardhatEthersSigner): Promise<number> {
    const handle = await game.resultOf(id, who.address);
    const clear = await fhevm.userDecryptEuint(FhevmType.euint8, handle, gameAddress, who);
    return Number(clear);
  }

  async function runDuel(a: boolean, b: boolean) {
    await (await game.connect(signers.alice).createDuel(signers.bob.address)).wait();
    await play(1, signers.alice, a);
    await play(1, signers.bob, b);
    return { alice: await result(1, signers.alice), bob: await result(1, signers.bob) };
  }

  it("both split: each gets half", async function () {
    expect(await runDuel(SPLIT, SPLIT)).to.deep.eq({ alice: 1, bob: 1 });
  });

  it("alice steals, bob splits: alice takes all", async function () {
    expect(await runDuel(STEAL, SPLIT)).to.deep.eq({ alice: 2, bob: 0 });
  });

  it("alice splits, bob steals: bob takes all", async function () {
    expect(await runDuel(SPLIT, STEAL)).to.deep.eq({ alice: 0, bob: 2 });
  });

  it("both steal: nobody gets anything", async function () {
    expect(await runDuel(STEAL, STEAL)).to.deep.eq({ alice: 0, bob: 0 });
  });

  it("rejects outsiders and double plays", async function () {
    await (await game.connect(signers.alice).createDuel(signers.bob.address)).wait();
    const enc = await fhevm.createEncryptedInput(gameAddress, signers.carol.address).addBool(true).encrypt();
    await expect(game.connect(signers.carol).play(1, enc.handles[0], enc.inputProof)).to.be.revertedWith("Not a player");

    await play(1, signers.alice, SPLIT);
    const enc2 = await fhevm.createEncryptedInput(gameAddress, signers.alice.address).addBool(true).encrypt();
    await expect(game.connect(signers.alice).play(1, enc2.handles[0], enc2.inputProof)).to.be.revertedWith(
      "Already played",
    );
  });

  it("a player cannot decrypt the other player's result", async function () {
    await (await game.connect(signers.alice).createDuel(signers.bob.address)).wait();
    await play(1, signers.alice, STEAL);
    await play(1, signers.bob, SPLIT);
    const bobHandle = await game.resultOf(1, signers.bob.address);
    await expect(fhevm.userDecryptEuint(FhevmType.euint8, bobHandle, gameAddress, signers.alice)).to.be.rejected;
  });
});