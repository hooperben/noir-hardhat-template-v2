import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { poseidonContract } from "circomlibjs";
import { ethers } from "hardhat";
import {
  Contract,
  parseEther,
  AbiCoder,
  Interface,
  encodeBytes32String,
} from "ethers";
import {
  CycloneCash,
  CycloneCash__factory,
  NotRealToken,
  NotRealToken__factory,
} from "../typechain-types";
import MerkleTree from "fixed-merkle-tree";
import {
  ensurePoseidon,
  poseidonHash,
  poseidonHash2,
} from "../helpers/poseidon";
import { expect } from "chai";

const abi = new AbiCoder();

describe("CycloneCash Testing", function () {
  let Deployer: SignerWithAddress;

  let NotRealTokenContract: NotRealToken;

  let CycloneCashContract: CycloneCash;
  let CycloneCashAddress: string;

  const DEPOSIT_AMOUNT = parseEther("10");

  before(async () => {
    [Deployer] = await ethers.getSigners();
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

    // finally, we deploy the CycloneCash contract
    const CycloneCash = await ethers.getContractFactory("CycloneCash");
    const cycloneCash = await CycloneCash.deploy(_verifer, _token, _hasher);
    await cycloneCash.waitForDeployment();

    const _cycloneCash = await cycloneCash.getAddress();

    CycloneCashContract = new Contract(
      _cycloneCash,
      CycloneCash__factory.abi,
      Deployer
    ) as unknown as CycloneCash;
    CycloneCashAddress = _cycloneCash;

    // initialise our poseidon library
    await ensurePoseidon();
  });

  describe("CycloneCash User Flow Testing", function () {
    it("should be able to deposit as a user with 10 tokens", async () => {
      const balanceBefore = await NotRealTokenContract.balanceOf(
        Deployer.address
      );

      // we need to approve the cyclone cash contract to move our not real tokens
      await NotRealTokenContract.approve(CycloneCashAddress, DEPOSIT_AMOUNT);

      // in order to create a deposit, the user creates a secret
      const secret =
        210881053148100735089756133441334702741123279382268018806244279187332357251n; // getRandomBigInt(256);

      // this secret is then hashed, and that is our leaf node value
      const hashedSecret = poseidonHash([secret]);

      // we call deposit on the contract with our generated leaf node, and that's the whole deposit flow!
      await CycloneCashContract.deposit(
        abi.encode(["uint256"], [hashedSecret])
      );

      console.log(hashedSecret);
      console.log(`0x${BigInt(hashedSecret).toString(16)}`);

      const balanceAfter = await NotRealTokenContract.balanceOf(
        Deployer.address
      );

      // check that our deposit correctly decremented our user
      expect(balanceAfter).to.eq(balanceBefore - DEPOSIT_AMOUNT);

      // next, it's time for this user to create their withdrawal proof, and withdrawal their balance

      // first, we get all despoit events from the contract, to reconstruct the tree.
      const filter = CycloneCashContract.filters.Deposit();
      const events = await CycloneCashContract.queryFilter(filter);
      const parsedDepositLogs = events
        .map((log) => {
          try {
            const sm = new Interface(CycloneCash__factory.abi);
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

      console.log(leaves.length);

      // then we construct our Typescript Version of our contracts tree
      const tree = new MerkleTree(8, leaves, {
        hashFunction: poseidonHash2, // the hash function our tree uses
        zeroElement:
          "21663839004416932945382355908790599225266501822907911457504978515578255421292", // ZERO_VALUE in MerkleTreeWithHistory.sol
      });

      const formattedTreeRoot = `${BigInt(tree.root).toString(16)}`;

      console.log("known roots: ");
      console.log(await CycloneCashContract.roots(0));
      console.log(await CycloneCashContract.roots(1));

      console.log("ts root:");
      console.log(tree.root);

      console.log("abi");
      console.log(abi.encode(["uint256"], [tree.root]));

      // to check that our tree creation went well, we can check it with the current root
      const isKnownRoot = await CycloneCashContract.isKnownRoot(
        abi.encode(["uint256"], [tree.root])
      );
      console.log(isKnownRoot);
      // expect(tree.root).equal(BigInt(currentRoot));
    });
  });
});