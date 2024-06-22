import { SignerWithAddress } from "@nomicfoundation/hardhat-ethers/signers";
import { poseidonContract } from "circomlibjs";
import { ethers } from "hardhat";
import { Contract, parseEther, AbiCoder, Interface } from "ethers";
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

describe("Proof of Record - ZK Merkle Testing", function () {
  let Deployer: SignerWithAddress;

  let NotRealTokenContract: NotRealToken;
  let NotRealTokenAddress: string;

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
    NotRealTokenAddress = _token;

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

  describe("deposit testing", function () {
    it("should be able to deposit as a user with 10 tokens", async () => {
      const balanceBefore = await NotRealTokenContract.balanceOf(
        Deployer.address
      );

      // we need to approve the cyclone cash contract to move our not real tokens
      await NotRealTokenContract.approve(CycloneCashAddress, DEPOSIT_AMOUNT);

      // next, we need to a typescript representation of the merkle tree in our Cyclone Cash contract
      let leaves: [] = []; // our tree is currently empty
      const tree = new MerkleTree(8, leaves, {
        hashFunction: poseidonHash2, // the hash function our tree uses
        zeroElement:
          "2302824601438971867720504068764828943238518492587325167295657880505909878424", // ZERO_VALUE in MerkleTreeWithHistory.sol
      });

      // next the user generates their secret
      const secret =
        210881053148100735089756133441334702741123279382268018806244279187332357251n; // getRandomBigInt(256);

      const hashedSecret = poseidonHash([secret]);
      console.log(hashedSecret);
      console.log(secret);

      const abi = new AbiCoder();

      const tx = await CycloneCashContract.deposit(
        abi.encode(["uint256"], [hashedSecret])
      );

      const receipt = await tx.wait();

      if (!receipt) throw new Error("receipt was null!");
      const decodedLogs = receipt?.logs
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

      const newLeaves = decodedLogs
        .sort((a, b) => {
          return Number(a.args[1]) - Number(b.args[1]);
        })
        .map((e) => {
          return BigInt(e.args[0]).toString();
        });

      const balanceAfter = await NotRealTokenContract.balanceOf(
        Deployer.address
      );

      expect(balanceAfter).to.eq(balanceBefore - DEPOSIT_AMOUNT);

      const newTree = new MerkleTree(8, newLeaves, {
        hashFunction: poseidonHash2, // the hash function our tree uses
        zeroElement:
          "2302824601438971867720504068764828943238518492587325167295657880505909878424", // ZERO_VALUE in MerkleTreeWithHistory.sol
      });

      console.log(newLeaves[0]);
      console.log(newTree.root);
      const merkleProof = newTree.proof(newLeaves[0]);

      console.log(merkleProof);
    });
  });
});
