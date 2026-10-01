// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/AccessControl.sol";
import "./interfaces/IERC4626Yield.sol";

/**
 * @title CentralTreasuryYieldVault
 * @notice Production Treasury Yield Engine on Arc L1.
 *         Segregates account shares, interacts with USYC (ERC-4626),
 *         and enforces immutable account-locked recalls (recipient cannot be parameterized).
 */
contract CentralTreasuryYieldVault is AccessControl {
    bytes32 public constant SWEEPER_ROLE = keccak256("SWEEPER_ROLE");
    bytes32 public constant DISBURSAL_ROLE = keccak256("DISBURSAL_ROLE");

    IERC20 public immutable usdc;           // Arc Predeploy 0x3600000000000000000000000000000000000000
    IERC4626Yield public immutable usyc;   // Hashnote USYC or MockUSYCVault

    // Corporate Account ID => Registered Company Wallet Address (Recalls ONLY go here)
    mapping(bytes32 => address) public registeredAccounts;
    // Corporate Account ID => USYC Shares owned
    mapping(bytes32 => uint256) public accountShares;
    uint256 public totalVaultShares;

    event AccountRegistered(bytes32 indexed accountId, address indexed wallet);
    event AccountDeregistered(bytes32 indexed accountId);
    event FundsSweptToYield(
        bytes32 indexed accountId,
        address indexed sourceWallet,
        uint256 usdcAmount,
        uint256 sharesMinted
    );
    event FundsRecalledFromYield(
        bytes32 indexed accountId,
        address indexed recipientWallet,
        uint256 usdcAmount,
        uint256 sharesBurned
    );

    constructor(address _usdc, address _usyc, address admin) {
        require(_usdc != address(0), "Invalid USDC address");
        require(_usyc != address(0), "Invalid USYC address");
        require(admin != address(0), "Invalid admin address");

        usdc = IERC20(_usdc);
        usyc = IERC4626Yield(_usyc);

        _grantRole(DEFAULT_ADMIN_ROLE, admin);
    }

    /**
     * @notice Registers or updates an operating account's designated payout wallet
     */
    function registerAccount(bytes32 accountId, address wallet) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(accountId != bytes32(0), "Invalid accountId");
        require(wallet != address(0), "Cannot register zero address");
        registeredAccounts[accountId] = wallet;
        emit AccountRegistered(accountId, wallet);
    }

    /**
     * @notice Deregisters an account once its share balance is zero
     */
    function deregisterAccount(bytes32 accountId) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(accountShares[accountId] == 0, "Account has active yield shares");
        delete registeredAccounts[accountId];
        emit AccountDeregistered(accountId);
    }

    /**
     * @notice Sweeps calculated idle funds from an account wallet into USYC
     * @dev Called exclusively by TreasurySweeperAgent using the account wallet's pre-approved allowance
     */
    function sweepFromAccount(
        bytes32 accountId,
        address accountWallet,
        uint256 usdcAmount
    ) external onlyRole(SWEEPER_ROLE) {
        require(registeredAccounts[accountId] == accountWallet, "Wallet not registered for account");
        require(usdcAmount > 0, "Zero sweep amount");

        // 1. Pull USDC from operating wallet using allowance
        require(usdc.transferFrom(accountWallet, address(this), usdcAmount), "USDC transferFrom failed");

        // 2. Deposit into USYC
        require(usdc.approve(address(usyc), usdcAmount), "USDC approve failed");
        uint256 sharesMinted = usyc.deposit(usdcAmount, address(this));
        require(sharesMinted > 0, "Zero shares minted");

        // 3. Update segregated account ledger
        accountShares[accountId] += sharesMinted;
        totalVaultShares += sharesMinted;

        emit FundsSweptToYield(accountId, accountWallet, usdcAmount, sharesMinted);
    }

    /**
     * @notice Recalls USDC from USYC back to the account's registered wallet
     * @dev Recipient CANNOT be parameterized; strictly enforced to registeredAccounts[accountId]
     */
    function recallForAccount(
        bytes32 accountId,
        uint256 usdcAmount
    ) external onlyRole(DISBURSAL_ROLE) {
        address targetWallet = registeredAccounts[accountId];
        require(targetWallet != address(0), "Account not registered");
        require(usdcAmount > 0, "Zero recall amount");

        uint256 currentAssets = getAccountAssets(accountId);
        require(currentAssets >= usdcAmount, "Insufficient account yield balance");

        // Verify available instant liquidity in USYC
        uint256 maxInstant = usyc.maxWithdraw(address(this));
        require(maxInstant >= usdcAmount, "Instant USYC liquidity limit exceeded");

        // Record balance before to guard against ERC-4626 rounding shortfall
        uint256 balanceBefore = usdc.balanceOf(targetWallet);

        // Execute ERC-4626 withdraw (specifies exact assets desired, rounds shares up in favor of vault)
        uint256 sharesBurned = usyc.withdraw(usdcAmount, targetWallet, address(this));

        // Precision check: verify actual amount received
        uint256 actualReceived = usdc.balanceOf(targetWallet) - balanceBefore;
        require(actualReceived >= usdcAmount, "Redemption precision shortfall");

        require(accountShares[accountId] >= sharesBurned, "Share calculation underflow");
        accountShares[accountId] -= sharesBurned;
        totalVaultShares -= sharesBurned;

        emit FundsRecalledFromYield(accountId, targetWallet, usdcAmount, sharesBurned);
    }

    /**
     * @notice Converts an account's USYC shares into underlying USDC valuation
     */
    function getAccountAssets(bytes32 accountId) public view returns (uint256) {
        uint256 shares = accountShares[accountId];
        if (shares == 0) return 0;
        return usyc.convertToAssets(shares);
    }
}
