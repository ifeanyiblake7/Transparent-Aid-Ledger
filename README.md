# 🌟 Transparent Aid Ledger

Welcome to Transparent Aid Ledger, a Web3 solution built on the Stacks blockchain using Clarity smart contracts! This project addresses a critical real-world problem in disaster relief: corruption, inefficiency, and lack of transparency in cash aid distribution. By leveraging an immutable ledger and tokenized vouchers, we ensure that donations reach verified disaster victims directly, bypassing intermediaries and providing verifiable proof of fund usage. Donors can track every step, victims receive aid securely, and NGOs/governments gain auditable records to prevent fraud.

## ✨ Features

🔒 Immutable tracking of all aid transfers on the blockchain  
💸 Tokenized vouchers (as fungible tokens) for direct, redeemable aid  
✅ Victim verification to ensure aid goes to those in need  
📈 Donor dashboards for real-time transparency  
🚫 Anti-fraud mechanisms like unique voucher claims and expiration  
🔍 Auditable logs for compliance and reporting  
🌍 Integration with oracles for disaster event verification  
💼 Scalable for multiple disasters and global use

## 🛠 How It Works

**For Donors**  
- Contribute funds (in STX or via wrapped BTC) to the donation pool.  
- Receive a receipt token proving your contribution.  
- Track voucher issuance and redemptions in real-time via the audit log.  

**For Aid Organizations (e.g., NGOs)**  
- Register a disaster event with proof (via oracle).  
- Verify and onboard victims.  
- Issue tokenized vouchers directly to victims' wallets.  

**For Victims**  
- Get verified and receive vouchers in your Stacks wallet.  
- Redeem vouchers for cash or goods at partnered vendors.  
- Transfers are logged immutably, ensuring no double-spending.  

**Overall Flow**  
1. Donors fund the system.  
2. Oracles confirm disaster details.  
3. Victims are registered and verified.  
4. Vouchers are minted and distributed.  
5. Victims redeem, triggering immutable logs.  
6. All parties can query the ledger for transparency.  

This setup uses blockchain's immutability to create trust, reducing overhead and ensuring 100% of aid reaches victims.

## 📂 Smart Contracts Overview

The project is powered by 8 Clarity smart contracts, each handling a specific aspect for modularity and security. Contracts interact via traits (Clarity's interfaces) for seamless integration.

1. **AidToken.clar**: Implements SIP-10 fungible token standard for the vouchers. Handles minting, burning, and transfers of aid tokens.  

2. **DonorRegistry.clar**: Registers donors, tracks contributions, and issues receipt tokens. Includes functions for donation logging and querying contribution history.  

3. **VictimRegistry.clar**: Manages victim verification (e.g., via KYC-like proofs or NGO endorsements). Stores victim data hashes for privacy and allows status checks.  

4. **DisasterOracle.clar**: Integrates with external oracles to verify disaster events (e.g., location, severity). Triggers event registration and enables voucher issuance only for confirmed disasters.  

5. **VoucherIssuer.clar**: Mints and distributes vouchers to verified victims based on allocation rules. Enforces limits per victim and ties issuance to donor funds.  

6. **RedemptionEscrow.clar**: Handles voucher redemptions, holding funds in escrow until vendors confirm delivery. Burns redeemed tokens to prevent reuse.  

7. **TransferTracker.clar**: An immutable logger for all transfers, redemptions, and actions. Uses maps to store event histories, queryable by any party for transparency.  

8. **Governance.clar**: Manages system parameters (e.g., voucher expiration, fees). Allows authorized updates via multi-sig for security, and includes emergency pause functions.

These contracts ensure the system is decentralized, secure, and scalable. For example, the `AidToken` contract can be called by `VoucherIssuer` to mint tokens, while `TransferTracker` logs every interaction.

## 🚀 Getting Started

- **Setup**: Clone the repo, install Clarinet (Clarity dev tool), and deploy contracts to Stacks testnet.  
- **Example Usage**: Use `clarinet console` to test: Register a donor, verify a victim, issue a voucher, and redeem it.  
- **Tech Stack**: Clarity for contracts, Stacks.js for frontend integration, and IPFS for off-chain metadata storage.  

This project not only solves aid distribution issues but also empowers communities with transparent, direct relief. Let's build a better world! 🚀