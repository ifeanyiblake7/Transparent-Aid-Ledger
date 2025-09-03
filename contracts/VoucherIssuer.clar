;; VoucherIssuer.clar
;; Core contract for issuing tokenized vouchers in the Transparent Aid Ledger system.
;; This contract handles minting and distribution of aid vouchers (using SIP-10 fungible tokens)
;; to verified disaster victims. It integrates with VictimRegistry for verification,
;; DisasterOracle for event confirmation, AidToken for token minting, and TransferTracker for logging.
;; Ensures secure, transparent, and rule-based allocation to prevent fraud.

;; Traits for interacting with other contracts
(define-trait aid-token-trait
  (
    (mint (principal uint) (response bool uint))
    (transfer (uint principal principal (optional (buff 34))) (response bool uint))
    (get-balance (principal) (response uint uint))
    (burn (uint principal) (response bool uint))
  )
)

(define-trait victim-registry-trait
  (
    (is-verified (principal) (response bool uint))
    (get-victim-data (principal) (response {hash: (buff 32), status: (string-ascii 20)} uint))
    (mark-claimed (principal uint) (response bool uint))
  )
)

(define-trait disaster-oracle-trait
  (
    (get-disaster-status (uint) (response {active: bool, severity: uint, start-block: uint, end-block: uint} uint))
    (is-eligible (principal uint) (response bool uint))
  )
)

(define-trait transfer-tracker-trait
  (
    (log-event (principal (string-ascii 50) (buff 128)) (response bool uint))
  )
)

;; Constants
(define-constant ERR-UNAUTHORIZED u100)
(define-constant ERR-INVALID-AMOUNT u101)
(define-constant ERR-NOT-VERIFIED u102)
(define-constant ERR-DISASTER-INACTIVE u103)
(define-constant ERR-EXCEEDED-LIMIT u104)
(define-constant ERR-PAUSED u105)
(define-constant ERR-INVALID-DISASTER u106)
(define-constant ERR-INVALID-RECIPIENT u107)
(define-constant ERR-INSUFFICIENT-FUNDS u108)
(define-constant ERR-ALREADY-CLAIMED u109)
(define-constant ERR-INVALID-EXPIRATION u110)
(define-constant ERR-METADATA-TOO-LONG u111)
(define-constant MAX-METADATA-LEN u256)
(define-constant DEFAULT-VOUCHER-EXPIRATION u1440) ;; ~10 days in blocks (assuming 10-min blocks)

;; Data Variables
(define-data-var contract-owner principal tx-sender)
(define-data-var is-paused bool false)
(define-data-var total-issued uint u0)
(define-data-var max-per-victim uint u1000) ;; Default max voucher amount per victim
(define-data-var min-severity-threshold uint u3) ;; Minimum disaster severity to issue vouchers

;; Data Maps
(define-map victim-claims
  { victim: principal, disaster-id: uint }
  { amount: uint, claimed-block: uint, expiration-block: uint, metadata: (buff 256) }
)

(define-map allocation-rules
  { disaster-id: uint }
  { base-amount: uint, severity-multiplier: uint, max-victims: uint, funds-allocated: uint }
)

(define-map issued-vouchers
  { voucher-id: uint }
  { recipient: principal, amount: uint, disaster-id: uint, issue-block: uint }
)

(define-data-var voucher-counter uint u0)

;; Private Functions
(define-private (log-issuance (recipient principal) (amount uint) (disaster-id uint) (tracker <transfer-tracker-trait>))
  (let
    (
      (event-data (concat (concat (concat (as-max-len? (principal-to-ascii recipient) u128) (unwrap-panic (as-max-len? (int-to-ascii amount) u128))) (unwrap-panic (as-max-len? (int-to-ascii disaster-id) u128)))))
    )
    (contract-call? tracker log-event tx-sender "VOUCHER_ISSUED" event-data)
  )
)

(define-private (calculate-amount (disaster-id uint) (severity uint))
  (let
    (
      (rules (unwrap! (map-get? allocation-rules {disaster-id: disaster-id}) (err ERR-INVALID-DISASTER)))
    )
    (+ (get base-amount rules) (* severity (get severity-multiplier rules)))
  )
)

(define-private (check-funds (amount uint) (token-contract <aid-token-trait>))
  (let
    (
      (balance (unwrap! (contract-call? token-contract get-balance (as-contract tx-sender)) (err u999)))
    )
    (if (>= balance amount)
      (ok true)
      (err ERR-INSUFFICIENT-FUNDS)
    )
  )
)

;; Public Functions
(define-public (issue-voucher 
  (recipient principal) 
  (disaster-id uint) 
  (metadata (buff 256))
  (token-contract <aid-token-trait>)
  (victim-registry <victim-registry-trait>)
  (disaster-oracle <disaster-oracle-trait>)
  (tracker <transfer-tracker-trait>))
  (let
    (
      (is-verified (unwrap! (contract-call? victim-registry is-verified recipient) (err u999)))
      (disaster-status (unwrap! (contract-call? disaster-oracle get-disaster-status disaster-id) (err u999)))
      (severity (get severity disaster-status))
      (amount (calculate-amount disaster-id severity))
      (existing-claim (map-get? victim-claims {victim: recipient, disaster-id: disaster-id}))
      (expiration (+ block-height DEFAULT-VOUCHER-EXPIRATION))
    )
    (asserts! (not (var-get is-paused)) (err ERR-PAUSED))
    (asserts! (is-eq tx-sender (var-get contract-owner)) (err ERR-UNAUTHORIZED)) ;; Only owner can issue for now
    (asserts! is-verified (err ERR-NOT-VERIFIED))
    (asserts! (get active disaster-status) (err ERR-DISASTER-INACTIVE))
    (asserts! (>= severity (var-get min-severity-threshold)) (err ERR-DISASTER-INACTIVE))
    (asserts! (is-none existing-claim) (err ERR-ALREADY-CLAIMED))
    (asserts! (<= (len metadata) MAX-METADATA-LEN) (err ERR-METADATA-TOO-LONG))
    (try! (check-funds amount token-contract))
    (try! (as-contract (contract-call? token-contract mint recipient amount)))
    (map-set victim-claims
      {victim: recipient, disaster-id: disaster-id}
      {amount: amount, claimed-block: block-height, expiration-block: expiration, metadata: metadata}
    )
    (let ((voucher-id (+ (var-get voucher-counter) u1)))
      (map-set issued-vouchers {voucher-id: voucher-id} {recipient: recipient, amount: amount, disaster-id: disaster-id, issue-block: block-height})
      (var-set voucher-counter voucher-id)
    )
    (try! (log-issuance recipient amount disaster-id tracker))
    (var-set total-issued (+ (var-get total-issued) amount))
    (ok amount)
  )
)

(define-public (set-allocation-rule 
  (disaster-id uint) 
  (base-amount uint) 
  (severity-multiplier uint) 
  (max-victims uint) 
  (funds-allocated uint))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) (err ERR-UNAUTHORIZED))
    (map-set allocation-rules
      {disaster-id: disaster-id}
      {base-amount: base-amount, severity-multiplier: severity-multiplier, max-victims: max-victims, funds-allocated: funds-allocated}
    )
    (ok true)
  )
)

(define-public (pause-contract)
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) (err ERR-UNAUTHORIZED))
    (var-set is-paused true)
    (ok true)
  )
)

(define-public (unpause-contract)
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) (err ERR-UNAUTHORIZED))
    (var-set is-paused false)
    (ok true)
  )
)

(define-public (set-max-per-victim (new-max uint))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) (err ERR-UNAUTHORIZED))
    (var-set max-per-victim new-max)
    (ok true)
  )
)

(define-public (set-min-severity-threshold (new-threshold uint))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) (err ERR-UNAUTHORIZED))
    (var-set min-severity-threshold new-threshold)
    (ok true)
  )
)

(define-public (transfer-ownership (new-owner principal))
  (begin
    (asserts! (is-eq tx-sender (var-get contract-owner)) (err ERR-UNAUTHORIZED))
    (var-set contract-owner new-owner)
    (ok true)
  )
)

;; Read-Only Functions
(define-read-only (get-victim-claim (victim principal) (disaster-id uint))
  (map-get? victim-claims {victim: victim, disaster-id: disaster-id})
)

(define-read-only (get-allocation-rule (disaster-id uint))
  (map-get? allocation-rules {disaster-id: disaster-id})
)

(define-read-only (get-issued-voucher (voucher-id uint))
  (map-get? issued-vouchers {voucher-id: voucher-id})
)

(define-read-only (get-total-issued)
  (var-get total-issued)
)

(define-read-only (get-contract-owner)
  (var-get contract-owner)
)

(define-read-only (get-is-paused)
  (var-get is-paused)
)

(define-read-only (get-max-per-victim)
  (var-get max-per-victim)
)

(define-read-only (get-min-severity-threshold)
  (var-get min-severity-threshold)
)

(define-read-only (get-voucher-counter)
  (var-get voucher-counter)
)