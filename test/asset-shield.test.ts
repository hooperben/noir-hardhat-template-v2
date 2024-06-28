import { BarretenbergBackend } from "@noir-lang/backend_barretenberg";
import { Noir } from "@noir-lang/noir_js";
import { CompiledCircuit } from "@noir-lang/types";
import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { expect } from "chai";
import { poseidonContract } from "circomlibjs";
import { AbiCoder, Contract, Interface, parseEther } from "ethers";
import MerkleTree from "fixed-merkle-tree";
import { ethers } from "hardhat";
import { getAndBuildCircuit } from "../helpers/getAndBuildCircuit";
import {
  ensurePoseidon,
  poseidonHash,
  poseidonHash2,
} from "../helpers/poseidon";
import {
  AssetShield,
  AssetShield__factory,
  NotRealToken,
  NotRealToken__factory,
} from "../typechain-types";

const abi = new AbiCoder();

describe("AssetShield Testing", function () {
  let Deployer: SignerWithAddress;
  let Withdrawer: SignerWithAddress;

  let NotRealTokenContract: NotRealToken;

  let AssetShieldContract: AssetShield;
  let AssetShieldAddress: string;

  let circuit: CompiledCircuit;
  let noir: Noir;

  const DEPOSIT_AMOUNT = parseEther("10");

  before(async () => {
    [Deployer, Withdrawer] = await ethers.getSigners();
    // Firstly, we deploy all our of contracts
    // we need to deploy the poseidon hasher contract for the MerkleTreeWithHistory contract
    const hasherAbi = poseidonContract.generateABI(2);
    const HasherFactory = new ethers.ContractFactory(
      hasherAbi,
      poseidonContract.createCode(2),
      Deployer
    );
    const tx = await HasherFactory.deploy();
    await tx.waitForDeployment();
    const _hasher = await tx.getAddress();

    // next, we deploy our prover contract
    const UltraVerifier = await ethers.getContractFactory("UltraVerifier");
    const ultraVerifier = await UltraVerifier.deploy();
    await ultraVerifier.waitForDeployment();
    const _verifer = await ultraVerifier.getAddress();

    // next, we deploy our not real token contract
    const TokenFactory = await ethers.getContractFactory("NotRealToken");
    const token = await TokenFactory.deploy();
    await token.waitForDeployment();

    const _token = await token.getAddress();

    NotRealTokenContract = new Contract(
      _token,
      NotRealToken__factory.abi,
      Deployer
    ) as unknown as NotRealToken;

    // finally, we deploy the AssetShield contract
    const AssetShield = await ethers.getContractFactory("AssetShield");
    const assetShield = await AssetShield.deploy(_verifer, _token, _hasher);
    await assetShield.waitForDeployment();

    const _AssetShield = await assetShield.getAddress();

    AssetShieldContract = new Contract(
      _AssetShield,
      AssetShield__factory.abi,
      Deployer
    ) as unknown as AssetShield;
    AssetShieldAddress = _AssetShield;

    // next we initialise our Noir libraries to generate proofs
    circuit = await getAndBuildCircuit();

    const backend = new BarretenbergBackend(circuit);
    noir = new Noir(circuit, backend);

    // initialise our poseidon library
    await ensurePoseidon();
  });

  describe("AssetShield User Flow Testing", function () {
    it("should be able to deposit as a user with 10 tokens", async () => {
      const balanceBefore = await NotRealTokenContract.balanceOf(
        Deployer.address
      );

      // we need to approve the cyclone cash contract to move our not real tokens
      await NotRealTokenContract.approve(AssetShieldAddress, DEPOSIT_AMOUNT);

      // in order to create a deposit, the user creates a secret
      const secret =
        210881053148100735089756133441334702741123279382268018806244279187332357251n; // getRandomBigInt(256);

      // this secret is then hashed, and that is our leaf node value
      const hashedSecret = poseidonHash([secret]);

      // we call deposit on the contract with our generated leaf node, and that's the whole deposit flow!
      await AssetShieldContract.deposit(
        abi.encode(["uint256"], [hashedSecret])
      );

      const balanceAfter = await NotRealTokenContract.balanceOf(
        Deployer.address
      );

      // check that our deposit correctly decremented our user
      expect(balanceAfter).to.eq(balanceBefore - DEPOSIT_AMOUNT);

      // next, it's time for this user to create their withdrawal proof, and withdrawal their balance

      // first, we get all despoit events from the contract, to reconstruct the tree.
      const filter = AssetShieldContract.filters.NewLeaf();
      const events = await AssetShieldContract.queryFilter(filter);
      const parsedDepositLogs = events
        .map((log) => {
          try {
            const sm = new Interface(AssetShield__factory.abi);
            return sm.parseLog(log);
          } catch (error) {
            // This log was not from your contract, or not an event your contract emits
            return null;
          }
        })
        .filter((log) => log !== null);

      // next, we order the deposit logs by their index
      const leaves = parsedDepositLogs
        // these should be better than any but Log parsing sucks :(
        .sort((a: any, b: any) => {
          return Number(a.args._leafIndex) - Number(b.args._leafIndex);
        })
        .map((e: any) => {
          return BigInt(e.args._leaf).toString();
        });

      // then we construct our Typescript Version of our contracts tree
      const tree = new MerkleTree(8, leaves, {
        hashFunction: poseidonHash2, // the hash function our tree uses
        zeroElement:
          "21663839004416932945382355908790599225266501822907911457504978515578255421292", // TODO change to custom
      });

      console.log(await AssetShieldContract.roots(0));

      const test = abi.encode(
        ["uint256"],
        [await AssetShieldContract.roots(0)]
      );

      console.log(test.toString());

      // to check that our tree creation went well, we can check it with the current root
      const isKnownRoot = await AssetShieldContract.isKnownRoot(
        abi.encode(["uint256"], [tree.root])
      );

      expect(isKnownRoot).equal(true);

      // next, it's time to generate our zero knowledge proof that we can use to withdraw our funds
      // these are the inputs that our circuit accepts

      const leafIndex = leaves.indexOf(hashedSecret);
      const merkleProof = tree.proof(leaves[leafIndex]);
      const pathIndices = merkleProof.pathIndices;
      const siblings = merkleProof.pathElements.map((i) => i.toString());
      const root = tree.root;
      const withdrawalAddress = Withdrawer.address;
      const nullifier = poseidonHash([secret, leafIndex]);
      const withdrawalNullifierAddress = poseidonHash([withdrawalAddress]);

      const input = {
        root: root.toString(),
        withdrawal_address: withdrawalAddress,
        nullifier,
        withdrawal_address_nullifier: withdrawalNullifierAddress,
        secret: secret.toString(),
        leaf_index: leafIndex,
        path_indices: pathIndices,
        siblings,
      };

      const correctProof = await noir.generateProof(input);

      const isValidProof = await noir.verifyProof(correctProof);
      console.log(isValidProof);

      // finally, we can withdraw our funds
      const AssetShieldWithdrawer = AssetShieldContract.connect(Withdrawer);

      const withdrawerTokenBalanceBefore = await NotRealTokenContract.balanceOf(
        Withdrawer.address
      );

      await AssetShieldWithdrawer.withdrawal(
        correctProof.proof,
        correctProof.publicInputs
      );

      const withdrawerTokenBalanceAfter = await NotRealTokenContract.balanceOf(
        Withdrawer.address
      );

      expect(withdrawerTokenBalanceAfter).to.eq(
        withdrawerTokenBalanceBefore + DEPOSIT_AMOUNT
      );
    });
  });
});
