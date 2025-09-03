import { describe, expect, it, vi, beforeEach } from "vitest";

// Interfaces for type safety
interface ClarityResponse<T> {
  ok: boolean;
  value: T | number; // number for error codes
}

interface VictimClaim {
  amount: number;
  claimedBlock: number;
  expirationBlock: number;
  metadata: string;
}

interface AllocationRule {
  baseAmount: number;
  severityMultiplier: number;
  maxVictims: number;
  fundsAllocated: number;
}

interface IssuedVoucher {
  recipient: string;
  amount: number;
  disasterId: number;
  issueBlock: number;
}

interface ContractState {
  contractOwner: string;
  isPaused: boolean;
  totalIssued: number;
  maxPerVictim: number;
  minSeverityThreshold: number;
  victimClaims: Map<string, VictimClaim>; // Key: `${victim}_${disasterId}`
  allocationRules: Map<number, AllocationRule>;
  issuedVouchers: Map<number, IssuedVoucher>;
  voucherCounter: number;
}

// Mock trait implementations
class MockAidToken {
  mint(recipient: string, amount: number): ClarityResponse<boolean> {
    return { ok: true, value: true };
  }
  getBalance(principal: string): ClarityResponse<number> {
    return { ok: true, value: 10000 }; // Assume sufficient funds
  }
}

class MockVictimRegistry {
  isVerified(principal: string): ClarityResponse<boolean> {
    return { ok: true, value: true };
  }
  getVictimData(principal: string): ClarityResponse<{ hash: string; status: string }> {
    return { ok: true, value: { hash: "hash", status: "verified" } };
  }
}

class MockDisasterOracle {
  getDisasterStatus(id: number): ClarityResponse<{ active: boolean; severity: number; startBlock: number; endBlock: number }> {
    return { ok: true, value: { active: true, severity: 5, startBlock: 100, endBlock: 200 } };
  }
}

class MockTransferTracker {
  logEvent(principal: string, eventType: string, data: string): ClarityResponse<boolean> {
    return { ok: true, value: true };
  }
}

// Mock contract implementation
class VoucherIssuerMock {
  private state: ContractState = {
    contractOwner: "deployer",
    isPaused: false,
    totalIssued: 0,
    maxPerVictim: 1000,
    minSeverityThreshold: 3,
    victimClaims: new Map(),
    allocationRules: new Map(),
    issuedVouchers: new Map(),
    voucherCounter: 0,
  };

  private ERR_UNAUTHORIZED = 100;
  private ERR_INVALID_AMOUNT = 101;
  private ERR_NOT_VERIFIED = 102;
  private ERR_DISASTER_INACTIVE = 103;
  private ERR_EXCEEDED_LIMIT = 104;
  private ERR_PAUSED = 105;
  private ERR_INVALID_DISASTER = 106;
  private ERR_INVALID_RECIPIENT = 107;
  private ERR_INSUFFICIENT_FUNDS = 108;
  private ERR_ALREADY_CLAIMED = 109;
  private ERR_INVALID_EXPIRATION = 110;
  private ERR_METADATA_TOO_LONG = 111;
  private MAX_METADATA_LEN = 256;
  private DEFAULT_VOUCHER_EXPIRATION = 1440;

  private getClaimKey(victim: string, disasterId: number): string {
    return `${victim}_${disasterId}`;
  }

  private calculateAmount(disasterId: number, severity: number): number {
    const rules = this.state.allocationRules.get(disasterId);
    if (!rules) return 0;
    return rules.baseAmount + severity * rules.severityMultiplier;
  }

  setAllocationRule(
    caller: string,
    disasterId: number,
    baseAmount: number,
    severityMultiplier: number,
    maxVictims: number,
    fundsAllocated: number
  ): ClarityResponse<boolean> {
    if (caller !== this.state.contractOwner) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.allocationRules.set(disasterId, {
      baseAmount,
      severityMultiplier,
      maxVictims,
      fundsAllocated,
    });
    return { ok: true, value: true };
  }

  issueVoucher(
    caller: string,
    recipient: string,
    disasterId: number,
    metadata: string,
    tokenContract: MockAidToken,
    victimRegistry: MockVictimRegistry,
    disasterOracle: MockDisasterOracle,
    tracker: MockTransferTracker
  ): ClarityResponse<number> {
    if (this.state.isPaused) {
      return { ok: false, value: this.ERR_PAUSED };
    }
    if (caller !== this.state.contractOwner) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    const isVerified = victimRegistry.isVerified(recipient);
    if (!isVerified.ok || !isVerified.value) {
      return { ok: false, value: this.ERR_NOT_VERIFIED };
    }
    const disasterStatus = disasterOracle.getDisasterStatus(disasterId);
    if (!disasterStatus.ok) {
      return { ok: false, value: 999 };
    }
    const { active, severity } = disasterStatus.value;
    if (!active || severity < this.state.minSeverityThreshold) {
      return { ok: false, value: this.ERR_DISASTER_INACTIVE };
    }
    const claimKey = this.getClaimKey(recipient, disasterId);
    if (this.state.victimClaims.has(claimKey)) {
      return { ok: false, value: this.ERR_ALREADY_CLAIMED };
    }
    if (metadata.length > this.MAX_METADATA_LEN) {
      return { ok: false, value: this.ERR_METADATA_TOO_LONG };
    }
    const amount = this.calculateAmount(disasterId, severity);
    if (amount > this.state.maxPerVictim) {
      return { ok: false, value: this.ERR_EXCEEDED_LIMIT };
    }
    const balance = tokenContract.getBalance("contract");
    if (!balance.ok || balance.value < amount) {
      return { ok: false, value: this.ERR_INSUFFICIENT_FUNDS };
    }
    const mintResult = tokenContract.mint(recipient, amount);
    if (!mintResult.ok) {
      return { ok: false, value: this.ERR_INVALID_AMOUNT };
    }
    const currentBlock = 1000; // Mock block height
    const expiration = currentBlock + this.DEFAULT_VOUCHER_EXPIRATION;
    this.state.victimClaims.set(claimKey, {
      amount,
      claimedBlock: currentBlock,
      expirationBlock: expiration,
      metadata,
    });
    const voucherId = this.state.voucherCounter + 1;
    this.state.issuedVouchers.set(voucherId, {
      recipient,
      amount,
      disasterId,
      issueBlock: currentBlock,
    });
    this.state.voucherCounter = voucherId;
    this.state.totalIssued += amount;
    tracker.logEvent(caller, "VOUCHER_ISSUED", "data");
    return { ok: true, value: amount };
  }

  pauseContract(caller: string): ClarityResponse<boolean> {
    if (caller !== this.state.contractOwner) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.isPaused = true;
    return { ok: true, value: true };
  }

  unpauseContract(caller: string): ClarityResponse<boolean> {
    if (caller !== this.state.contractOwner) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.isPaused = false;
    return { ok: true, value: true };
  }

  setMaxPerVictim(caller: string, newMax: number): ClarityResponse<boolean> {
    if (caller !== this.state.contractOwner) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.maxPerVictim = newMax;
    return { ok: true, value: true };
  }

  setMinSeverityThreshold(caller: string, newThreshold: number): ClarityResponse<boolean> {
    if (caller !== this.state.contractOwner) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.minSeverityThreshold = newThreshold;
    return { ok: true, value: true };
  }

  transferOwnership(caller: string, newOwner: string): ClarityResponse<boolean> {
    if (caller !== this.state.contractOwner) {
      return { ok: false, value: this.ERR_UNAUTHORIZED };
    }
    this.state.contractOwner = newOwner;
    return { ok: true, value: true };
  }

  getVictimClaim(victim: string, disasterId: number): ClarityResponse<VictimClaim | null> {
    return { ok: true, value: this.state.victimClaims.get(this.getClaimKey(victim, disasterId)) ?? null };
  }

  getAllocationRule(disasterId: number): ClarityResponse<AllocationRule | null> {
    return { ok: true, value: this.state.allocationRules.get(disasterId) ?? null };
  }

  getIssuedVoucher(voucherId: number): ClarityResponse<IssuedVoucher | null> {
    return { ok: true, value: this.state.issuedVouchers.get(voucherId) ?? null };
  }

  getTotalIssued(): ClarityResponse<number> {
    return { ok: true, value: this.state.totalIssued };
  }

  getContractOwner(): ClarityResponse<string> {
    return { ok: true, value: this.state.contractOwner };
  }

  getIsPaused(): ClarityResponse<boolean> {
    return { ok: true, value: this.state.isPaused };
  }

  getMaxPerVictim(): ClarityResponse<number> {
    return { ok: true, value: this.state.maxPerVictim };
  }

  getMinSeverityThreshold(): ClarityResponse<number> {
    return { ok: true, value: this.state.minSeverityThreshold };
  }

  getVoucherCounter(): ClarityResponse<number> {
    return { ok: true, value: this.state.voucherCounter };
  }
}

// Test setup
const accounts = {
  deployer: "deployer",
  victim: "victim_1",
  unauthorized: "unauthorized",
};

describe("VoucherIssuer Contract", () => {
  let contract: VoucherIssuerMock;
  let tokenContract: MockAidToken;
  let victimRegistry: MockVictimRegistry;
  let disasterOracle: MockDisasterOracle;
  let tracker: MockTransferTracker;

  beforeEach(() => {
    contract = new VoucherIssuerMock();
    tokenContract = new MockAidToken();
    victimRegistry = new MockVictimRegistry();
    disasterOracle = new MockDisasterOracle();
    tracker = new MockTransferTracker();
    vi.resetAllMocks();
  });

  it("should allow owner to set allocation rule", () => {
    const result = contract.setAllocationRule(
      accounts.deployer,
      1,
      100,
      20,
      1000,
      100000
    );
    expect(result).toEqual({ ok: true, value: true });
    const rule = contract.getAllocationRule(1);
    expect(rule).toEqual({
      ok: true,
      value: { baseAmount: 100, severityMultiplier: 20, maxVictims: 1000, fundsAllocated: 100000 },
    });
  });

  it("should prevent unauthorized from setting allocation rule", () => {
    const result = contract.setAllocationRule(
      accounts.unauthorized,
      1,
      100,
      20,
      1000,
      100000
    );
    expect(result).toEqual({ ok: false, value: 100 });
  });

  it("should issue voucher to verified victim in active disaster", () => {
    contract.setAllocationRule(accounts.deployer, 1, 100, 20, 1000, 100000);
    const result = contract.issueVoucher(
      accounts.deployer,
      accounts.victim,
      1,
      "Aid for flood",
      tokenContract,
      victimRegistry,
      disasterOracle,
      tracker
    );
    expect(result).toEqual({ ok: true, value: 200 }); // 100 + 5*20
    const claim = contract.getVictimClaim(accounts.victim, 1);
    expect(claim).toEqual({
      ok: true,
      value: expect.objectContaining({ amount: 200, metadata: "Aid for flood" }),
    });
    const totalIssued = contract.getTotalIssued();
    expect(totalIssued).toEqual({ ok: true, value: 200 });
    const voucher = contract.getIssuedVoucher(1);
    expect(voucher).toEqual({
      ok: true,
      value: expect.objectContaining({ recipient: accounts.victim, amount: 200 }),
    });
  });

  it("should prevent issuance when paused", () => {
    contract.pauseContract(accounts.deployer);
    const result = contract.issueVoucher(
      accounts.deployer,
      accounts.victim,
      1,
      "Aid",
      tokenContract,
      victimRegistry,
      disasterOracle,
      tracker
    );
    expect(result).toEqual({ ok: false, value: 105 });
  });

  it("should prevent issuance to unverified victim", () => {
    vi.spyOn(victimRegistry, "isVerified").mockReturnValue({ ok: true, value: false });
    const result = contract.issueVoucher(
      accounts.deployer,
      accounts.victim,
      1,
      "Aid",
      tokenContract,
      victimRegistry,
      disasterOracle,
      tracker
    );
    expect(result).toEqual({ ok: false, value: 102 });
  });

  it("should prevent issuance for inactive disaster", () => {
    vi.spyOn(disasterOracle, "getDisasterStatus").mockReturnValue({
      ok: true,
      value: { active: false, severity: 5, startBlock: 100, endBlock: 200 },
    });
    const result = contract.issueVoucher(
      accounts.deployer,
      accounts.victim,
      1,
      "Aid",
      tokenContract,
      victimRegistry,
      disasterOracle,
      tracker
    );
    expect(result).toEqual({ ok: false, value: 103 });
  });

  it("should prevent issuance if metadata too long", () => {
    const longMetadata = "a".repeat(257);
    const result = contract.issueVoucher(
      accounts.deployer,
      accounts.victim,
      1,
      longMetadata,
      tokenContract,
      victimRegistry,
      disasterOracle,
      tracker
    );
    expect(result).toEqual({ ok: false, value: 111 });
  });

  it("should prevent duplicate claims", () => {
    contract.setAllocationRule(accounts.deployer, 1, 100, 20, 1000, 100000);
    contract.issueVoucher(
      accounts.deployer,
      accounts.victim,
      1,
      "Aid",
      tokenContract,
      victimRegistry,
      disasterOracle,
      tracker
    );
    const secondResult = contract.issueVoucher(
      accounts.deployer,
      accounts.victim,
      1,
      "Aid again",
      tokenContract,
      victimRegistry,
      disasterOracle,
      tracker
    );
    expect(secondResult).toEqual({ ok: false, value: 109 });
  });

  it("should allow owner to update max per victim", () => {
    const result = contract.setMaxPerVictim(accounts.deployer, 2000);
    expect(result).toEqual({ ok: true, value: true });
    expect(contract.getMaxPerVictim()).toEqual({ ok: true, value: 2000 });
  });

  it("should allow owner to transfer ownership", () => {
    const result = contract.transferOwnership(accounts.deployer, accounts.victim);
    expect(result).toEqual({ ok: true, value: true });
    expect(contract.getContractOwner()).toEqual({ ok: true, value: accounts.victim });
  });
});