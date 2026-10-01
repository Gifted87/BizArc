// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "@openzeppelin/contracts/utils/cryptography/EIP712.sol";
import "@openzeppelin/contracts/utils/cryptography/ECDSA.sol";

/**
 * @title DisbursalVault
 * @notice Hardened transient clearinghouse on Arc L1 enforcing on-chain vendor allowlists,
 *         spending caps, idempotency keys, and EIP-712 human approvals.
 *         Holds $0 at rest.
 */
contract DisbursalVault is AccessControl, EIP712 {
    bytes32 public constant EXECUTOR_ROLE = keccak256("EXECUTOR_ROLE");
    bytes32 public constant DISBURSAL_TYPEHASH = keccak256(
        "DisbursalApproval(bytes32 permissionRequestId,address vendor,uint256 amount,bytes32 idempotencyKey,uint256 nonce,uint256 deadline)"
    );

    IERC20 public immutable usdc;
    address public adminApprover;

    // --- On-Chain Guardrails ---
    mapping(address => bool) public approvedVendors;
    mapping(bytes32 => bool) public executedIdempotencyKeys;
    mapping(uint256 => bool) public usedNonces;

    uint256 public perTxCap;                  // Max per-tx limit without admin EIP-712 signature
    uint256 public dailyCap;                  // Max cumulative daily limit across all transactions
    uint256 public eip712ApprovalThreshold;  // Amount threshold above which EIP-712 signature is mandatory

    uint256 public currentDay;
    uint256 public dailySpent;

    event VendorStatusUpdated(address indexed vendor, bool approved);
    event SpendingCapsUpdated(uint256 perTxCap, uint256 dailyCap, uint256 eip712Threshold);
    event AdminApproverUpdated(address indexed previousAdmin, address indexed newAdmin);
    event DisbursalExecuted(
        bytes32 indexed permissionRequestId,
        address indexed vendor,
        uint256 amount,
        bytes32 idempotencyKey
    );
    event FundsRefunded(address indexed recipient, uint256 amount);

    constructor(
        address _usdc,
        address _admin,
        uint256 _perTxCap,
        uint256 _dailyCap,
        uint256 _eip712Threshold
    ) AccessControl() EIP712("DisbursalVault", "1") {
        require(_usdc != address(0), "Invalid USDC address");
        require(_admin != address(0), "Invalid admin address");
        require(_perTxCap <= _dailyCap, "perTxCap exceeds dailyCap");

        usdc = IERC20(_usdc);
        adminApprover = _admin;
        perTxCap = _perTxCap;
        dailyCap = _dailyCap;
        eip712ApprovalThreshold = _eip712Threshold;

        _grantRole(DEFAULT_ADMIN_ROLE, _admin);
    }

    function setVendorApproval(address vendor, bool approved) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(vendor != address(0), "Cannot approve zero address");
        approvedVendors[vendor] = approved;
        emit VendorStatusUpdated(vendor, approved);
    }

    function updateCaps(
        uint256 _perTxCap,
        uint256 _dailyCap,
        uint256 _threshold
    ) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_perTxCap <= _dailyCap, "perTxCap exceeds dailyCap");
        perTxCap = _perTxCap;
        dailyCap = _dailyCap;
        eip712ApprovalThreshold = _threshold;
        emit SpendingCapsUpdated(_perTxCap, _dailyCap, _threshold);
    }

    function setAdminApprover(address _newAdmin) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_newAdmin != address(0), "Cannot set zero address approver");
        address previous = adminApprover;
        adminApprover = _newAdmin;
        emit AdminApproverUpdated(previous, _newAdmin);
    }

    /**
     * @notice Executes a payment adhering strictly to on-chain guardrails
     * @param permissionRequestId Standardized permission request ID
     * @param vendor Approved vendor payout address
     * @param amount Payment amount in 6-decimal USDC
     * @param idempotencyKey Deterministic hash(vendor, invoiceId, amount)
     * @param nonce Replay protection nonce for EIP-712 signature
     * @param deadline Expiry timestamp for EIP-712 signature
     * @param adminSignature Cryptographic signature from admin (required if amount > threshold)
     */
    function executePayment(
        bytes32 permissionRequestId,
        address vendor,
        uint256 amount,
        bytes32 idempotencyKey,
        uint256 nonce,
        uint256 deadline,
        bytes calldata adminSignature
    ) external onlyRole(EXECUTOR_ROLE) {
        // 1. On-Chain Allowlist Check
        require(approvedVendors[vendor], "Vendor not on on-chain allowlist");
        require(vendor != address(0), "Cannot pay address(0)");
        require(amount > 0, "Zero disbursal amount");

        // 2. Idempotency Check
        require(!executedIdempotencyKeys[idempotencyKey], "Duplicate transaction blocked (Idempotency Key)");

        // 3. Daily Cap & Spending Roll Check
        uint256 today = block.timestamp / 1 days;
        if (today > currentDay) {
            currentDay = today;
            dailySpent = 0;
        }
        require(dailySpent + amount <= dailyCap, "Daily spending cap exceeded");

        // 4. On-Chain Approval & Per-Tx Guardrail
        if (amount > eip712ApprovalThreshold) {
            require(block.timestamp <= deadline, "EIP-712 signature expired");
            require(!usedNonces[nonce], "Signature nonce already used");
            usedNonces[nonce] = true;

            bytes32 structHash = keccak256(
                abi.encode(
                    DISBURSAL_TYPEHASH,
                    permissionRequestId,
                    vendor,
                    amount,
                    idempotencyKey,
                    nonce,
                    deadline
                )
            );
            bytes32 hash = _hashTypedDataV4(structHash);
            address signer = ECDSA.recover(hash, adminSignature);
            require(signer == adminApprover, "Invalid admin EIP-712 signature");
        } else {
            require(amount <= perTxCap, "Amount exceeds per-tx autonomous cap");
        }

        // 5. Backing and Execution
        require(usdc.balanceOf(address(this)) >= amount, "Disbursal vault unbacked");

        executedIdempotencyKeys[idempotencyKey] = true;
        dailySpent += amount;

        require(usdc.transfer(vendor, amount), "USDC transfer to vendor failed");

        emit DisbursalExecuted(permissionRequestId, vendor, amount, idempotencyKey);
    }

    /**
     * @notice Refunds excess or stranded funds back to corporate accounts
     */
    function refundExcess(address recipient, uint256 amount) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(recipient != address(0), "Invalid recipient");
        require(amount > 0, "Zero amount");
        require(usdc.balanceOf(address(this)) >= amount, "Insufficient vault balance");

        require(usdc.transfer(recipient, amount), "Refund transfer failed");
        emit FundsRefunded(recipient, amount);
    }
}
