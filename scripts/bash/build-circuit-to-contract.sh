cd circuits
nargo compile

bb write_vk -b ./target/circuits.json
bb contract

cp ./target/contract.sol ../contracts/circuits/UltraVerifier.sol
cd ..

echo 'succesfully created contract from circuit'
