// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "./MerkleTreeWithHistory.sol";
import "./circuits/UltraVerifier.sol";

contract AssetShield is MerkleTreeWithHistory {
    // the address of the ERC20 that can be deposited to this contract
    IERC20 public immutable token;
    // the token amount that can be deposited as part of the deposit() function
    uint256 public immutable DEPOSIT_AMOUNT = 10 * 10 ** 18; // 10 with 18 Decimals
    // this is our contract where we verify our ZK proofs
    UltraVerifier public verifier;

    // when a user withdraws, they use their note. This mapping keeps track of that
    mapping(bytes32 nullifier => bool used) nullifiers;

    constructor(
        address _verifier,
        address _token,
        address _hasher // we use a poseidon hash function for our merkle tree, a separate contract handles this functionality
    ) MerkleTreeWithHistory(8, _hasher) {
        token = IERC20(_token);
        verifier = UltraVerifier(_verifier);
    }

    event NewLeaf(bytes32 indexed _leaf, uint256 indexed _leafIndex);

    function deposit(bytes32 _leaf) public {
        // transfer the tokens from the despositor to this contract
        token.transferFrom(msg.sender, address(this), DEPOSIT_AMOUNT);

        // insert our leaf in the tree
        _insert(_leaf, bytes32(ZERO_VALUE));

        // we emit the leaf and the next index, which makes it easier to construct our
        // merkle tree proofs for the withdrawal process
        emit NewLeaf(_leaf, nextIndex - 2);
        emit NewLeaf(bytes32(ZERO_VALUE), nextIndex - 1);
    }

    event NullifierUsed(bytes32 nullifier);

    function withdrawal(
        bytes calldata _proof,
        bytes32[] calldata _publicInputs // [root, nullifier, receiver]
    ) public {
        // check the root that the user has provided is within our list of own roots
        require(isKnownRoot(_publicInputs[0]), "Invalid root");

        // check that this nullifier has not been used before
        require(!nullifiers[_publicInputs[1]], "Nullifier already used");

        // check their proof against our verifier contract
        bool validProof = verifier.verify(_proof, _publicInputs);
        require(validProof, "Invalid proof :(");

        // mark this nullifier as claimed
        nullifiers[_publicInputs[1]] = true;
        emit NullifierUsed(_publicInputs[1]);

        // send the withdrawing user their funds
        token.transfer(
            address(uint160(uint256(_publicInputs[2]))), // this is the withdrawal address (decoded from bytes32)
            DEPOSIT_AMOUNT
        );
    }
}
