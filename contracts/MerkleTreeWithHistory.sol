// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

interface IHasher {
    function poseidon(
        bytes32[2] calldata inputs
    ) external pure returns (bytes32);
}

/**
 * @title MerkleTreeWithHistory
 * @notice This constract is a Merkle Tree With History based heavily on the tornado cash MerkleTreeWithHistory implementation,
 *         but with the Poseidon hash function instead of MiMCSponge.
 * @dev Don't use this in production - for demo purposes only
 */

contract MerkleTreeWithHistory {
    // the max value that can be hashed within our tree
    uint256 public constant FIELD_SIZE =
        21888242871839275222246405745257275088548364400416034343698204186575808495617;

    // our initial state - keccak256("livvy-dunne-just-rizzed-up-baby-gronk") % FIELD_SIZE
    uint256 public constant ZERO_VALUE =
        2302824601438971867720504068764828943238518492587325167295657880505909878424;

    IHasher public hasher;
    uint32 public levels;

    uint32 public currentRootIndex = 0;
    uint32 public nextIndex = 0;
    uint32 public constant ROOT_HISTORY_SIZE = 100;

    bytes32[] public filledSubtrees;
    bytes32[] public zeros;

    mapping(uint256 => bytes32) public roots;

    constructor(uint32 _treeLevels, address _hasher) {
        require(_treeLevels > 0, "_treeLevels should be greater than zero");
        require(_treeLevels < 32, "_treeLevels should be less than 32");
        levels = _treeLevels;

        hasher = IHasher(_hasher);

        bytes32 currentZero = bytes32(ZERO_VALUE);
        zeros.push(currentZero);
        filledSubtrees.push(currentZero);

        for (uint32 i = 1; i < levels; i++) {
            currentZero = hashLeftRight(currentZero, currentZero);
            zeros.push(currentZero);
            filledSubtrees.push(currentZero);
        }

        roots[0] = hashLeftRight(currentZero, currentZero);
    }

    function hashLeftRight(
        bytes32 _left,
        bytes32 _right
    ) public view returns (bytes32) {
        require(
            uint256(_left) < FIELD_SIZE,
            "_left should be inside the field"
        );
        require(
            uint256(_right) < FIELD_SIZE,
            "_right should be inside the field"
        );

        bytes32[2] memory input;
        input[0] = _left;
        input[1] = _right;

        return hasher.poseidon(input);
    }

    function _insert(
        bytes32 _leaf1,
        bytes32 _leaf2
    ) internal returns (uint32 index) {
        uint32 _nextIndex = nextIndex;
        require(
            _nextIndex != uint32(2) ** levels,
            "Merkle tree is full. No more leaves can be added"
        );
        uint32 currentIndex = _nextIndex / 2;
        bytes32 currentLevelHash = hashLeftRight(_leaf1, _leaf2);
        bytes32 left;
        bytes32 right;

        for (uint32 i = 1; i < levels; i++) {
            if (currentIndex % 2 == 0) {
                left = currentLevelHash;
                right = zeros[i];
                filledSubtrees[i] = currentLevelHash;
            } else {
                left = filledSubtrees[i];
                right = currentLevelHash;
            }
            currentLevelHash = hashLeftRight(left, right);
            currentIndex /= 2;
        }

        uint32 newRootIndex = (currentRootIndex + 1) % ROOT_HISTORY_SIZE;
        currentRootIndex = newRootIndex;
        roots[newRootIndex] = currentLevelHash;
        nextIndex = _nextIndex + 2;
        return _nextIndex;
    }

    function isKnownRoot(bytes32 _root) public view returns (bool) {
        if (_root == 0) {
            return false;
        }
        uint32 i = currentRootIndex;
        do {
            if (_root == roots[i]) {
                return true;
            }
            if (i == 0) {
                i = ROOT_HISTORY_SIZE;
            }
            i--;
        } while (i != currentRootIndex);
        return false;
    }

    function getLastRoot() public view returns (bytes32) {
        return roots[currentRootIndex];
    }
}
