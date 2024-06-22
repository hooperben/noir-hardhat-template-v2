// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "./MerkleTreeWithHistory.sol";
import "./circuits/UltraVerifier.sol";

contract CycloneCash is MerkleTreeWithHistory {
    // the address of the ERC20 that can be deposited to this contract
    IERC20 public immutable token;
    // the token amount that can be deposited as part of the deposit() function
    uint256 public immutable DEPOSIT_AMOUNT = 10 * 10 ** 18; // 10 with 18 Decimals
    // this is our contract where we verify our ZK proofs
    UltraVerifier public verifier;

    // when a user withdraws, they use their note. This mapping keeps track of that
    mapping(bytes32 nullifier => bool used) nullifers;

    constructor(
        address _verifier,
        address _token,
        address _hasher // we use a poseidon hash function for our merkle tree, a separate contract handles this functionality
    ) MerkleTreeWithHistory(8, _hasher) {
        token = IERC20(_token);
        verifier = UltraVerifier(_verifier);
    }

    event Deposit(bytes32 indexed _leaf, uint256 indexed _leafIndex);

    function deposit(bytes32 _leaf) public {
        // transfer the tokens from the despositor to this contract
        token.transferFrom(msg.sender, address(this), DEPOSIT_AMOUNT);

        // insert our leaf in the tree
        _insert(_leaf);

        // emit an event that a deposit has taken place (we need these event details to constuct or proof to claim)
        emit Deposit(_leaf, nextIndex - 1);
    }
}
