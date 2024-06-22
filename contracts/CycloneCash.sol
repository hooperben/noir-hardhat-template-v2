// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";

import "./MerkleTreeWithHistory.sol";

contract ProofOfRecord is MerkleTreeWithHistory {
    IERC20 public immutable token;

    uint256 public immutable DEPOSIT_AMOUNT = 10 * 10 ** 18;

    bytes32 public constant initial_leaf =
        0x220e4b4823da0db552468228884e3a4675fc1bee50cb697891977312ae922800;

    constructor(
        address _verifier,
        address _token,
        address _hasher
    ) MerkleTreeWithHistory(8, _hasher) {
        token = IERC20(_token);
    }

    function deposit(bytes32 _leaf) public {
        token.transferFrom(msg.sender, address(this), DEPOSIT_AMOUNT);

        // insert the leaf in our tree
        // _insert(_leaf);
    }
}
