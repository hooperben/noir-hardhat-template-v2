import { buildModule } from "@nomicfoundation/hardhat-ignition/modules";

const ProofOfRecordModule = buildModule("ProofOfRecordModule", (m) => {
  const ProofOfRecord = m.contract("ProofOfRecord");

  return { ProofOfRecord };
});

export default ProofOfRecordModule;
