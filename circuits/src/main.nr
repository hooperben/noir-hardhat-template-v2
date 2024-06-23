use dep::std;

// Returns the merkle root of the tree from the provided leaf, path indices, siblings with poseidon hash.
// this was taken from the noir_merkleroot crate (https://github.com/tomoima525/noir-merkle-root) - dependencies in noir are a bit of a pain so I've just copied it here
fn compute_merkle_root(leaf: Field, path_indices: [Field; 8], siblings: [Field; 8]) -> Field {
    let n = siblings.len();
    let mut current = leaf;
    for i in 0..n {
        let is_right = (path_indices[i] == 1) as bool;
        let (hash_left, hash_right) = if is_right {
            (siblings[i], current)
         } else {
            (current, siblings[i])
         };
      current = std::hash::poseidon::bn254::hash_2([hash_left, hash_right]);
    };
    current
}

// this is our proving program
fn main(
    root: pub Field,
    withdrawal_address: pub Field,
    nullifier: pub Field,
    withdrawal_address_nullifier: Field,
    secret: Field, 
    leaf_index: Field,
    path_indices: [Field; 8],
    siblings: [Field; 8],
) {
    // we re compute our leaf node here with the users secret
    let leaf = std::hash::poseidon::bn254::hash_1([secret]);

    // then we recreate the whole tree
    let computed_root = compute_merkle_root(leaf, path_indices, siblings);

    // if the root of our computed tree matches the root passed in (this is a public variable), it's a valid proof
    assert(computed_root == root);

    // next, we check that the nullifier is structured correctly
    let computed_nullifier = std::hash::poseidon::bn254::hash_2([secret, leaf_index]);
    assert(computed_nullifier == nullifier);

    // finally, as part of this process we compute that the hashed input address = hash(address).
    // this is to avoid front running, i.e someone seeing this proof publicly, submitting it themselves and stealing the withdrawal
    // I think this can probably be done better? but if you know a better solution to, please hmu :)
    let computed_address_hash = std::hash::poseidon::bn254::hash_1([withdrawal_address]);
    assert(computed_address_hash == withdrawal_address_nullifier);
}

#[test]
fn test_merkle_proof() {
    let leaf = 20160893960736287353172201961072358781700170840597685064590079836896466519213;
    let path_indices = [0, 0, 0, 0, 0, 0, 0, 0];
    let siblings = [
        2302824601438971867720504068764828943238518492587325167295657880505909878424,
        19428256792156897017969362058752770906264853727489947143440068542948598352021,
        17853931724571662772332956499114693544766863748170224105043294543860231146517,
        16419682946791060480568640339254496257412952318236320492228438445644803673134,
        6116777126718568832700452889300770041780795070368971337256276093993272711696,
        12531059971824246620039700171281465527393705395806112443726758648373267687539,
        5843760801858568328900092091113985717963143128804361557752173071357002045108,
        1143408232830562712557958746360441814316737212400365135670159679457111832921,
    ];
    let root = compute_merkle_root(leaf, path_indices, siblings);
    assert(root == 14691715986578578124196886834842542390222215612570999607106757387957373345619);
}
