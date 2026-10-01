// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "./interfaces/IERC4626Yield.sol";

/**
 * @title MockUSYCVault
 * @notice Realistic ERC-4626 simulation matching Hashnote USYC specification.
 *         Allows testnet deployment, sub-second redemption testing, and yield accrual simulation.
 */
contract MockUSYCVault is ERC20, IERC4626Yield {
    IERC20 public immutable underlyingAsset;
    uint256 public navExchangeRateMultiplier = 1e18; // 1.0 NAV base (18 decimals precision)

    constructor(address _asset) ERC20("Mock Hashnote US Yield Coin", "mUSYC") {
        require(_asset != address(0), "Invalid asset");
        underlyingAsset = IERC20(_asset);
    }

    function asset() external view override returns (address) {
        return address(underlyingAsset);
    }

    function decimals() public pure override returns (uint8) {
        return 6;
    }

    function totalAssets() public view override returns (uint256) {
        return underlyingAsset.balanceOf(address(this));
    }

    function convertToShares(uint256 assets) public view override returns (uint256) {
        if (assets == 0) return 0;
        return (assets * 1e18) / navExchangeRateMultiplier;
    }

    function convertToAssets(uint256 shares) public view override returns (uint256) {
        if (shares == 0) return 0;
        return (shares * navExchangeRateMultiplier) / 1e18;
    }

    function maxDeposit(address) external pure override returns (uint256) {
        return type(uint256).max;
    }

    function maxWithdraw(address owner) external view override returns (uint256) {
        uint256 ownerAssets = convertToAssets(balanceOf(owner));
        uint256 vaultTotal = totalAssets();
        return ownerAssets < vaultTotal ? ownerAssets : vaultTotal;
    }

    function maxRedeem(address owner) external view override returns (uint256) {
        return balanceOf(owner);
    }

    function previewDeposit(uint256 assets) external view override returns (uint256) {
        return convertToShares(assets);
    }

    function previewWithdraw(uint256 assets) external view override returns (uint256) {
        uint256 shares = (assets * 1e18 + (navExchangeRateMultiplier - 1)) / navExchangeRateMultiplier; // ceil
        return shares;
    }

    function deposit(uint256 assets, address receiver) external override returns (uint256 shares) {
        require(assets > 0, "Zero assets");
        require(receiver != address(0), "Invalid receiver");

        shares = convertToShares(assets);
        require(shares > 0, "Zero shares calculated");

        require(underlyingAsset.transferFrom(msg.sender, address(this), assets), "Asset transfer failed");
        _mint(receiver, shares);

        return shares;
    }

    function withdraw(
        uint256 assets,
        address receiver,
        address owner
    ) external override returns (uint256 shares) {
        require(assets > 0, "Zero assets");
        require(receiver != address(0), "Invalid receiver");

        // Round up shares in favor of the vault
        shares = (assets * 1e18 + (navExchangeRateMultiplier - 1)) / navExchangeRateMultiplier;

        if (msg.sender != owner) {
            _spendAllowance(owner, msg.sender, shares);
        }

        _burn(owner, shares);
        require(underlyingAsset.transfer(receiver, assets), "Asset transfer failed");

        return shares;
    }

    function redeem(
        uint256 shares,
        address receiver,
        address owner
    ) external override returns (uint256 assets) {
        require(shares > 0, "Zero shares");
        require(receiver != address(0), "Invalid receiver");

        // Round down assets in favor of the vault
        assets = (shares * navExchangeRateMultiplier) / 1e18;

        if (msg.sender != owner) {
            _spendAllowance(owner, msg.sender, shares);
        }

        _burn(owner, shares);
        require(underlyingAsset.transfer(receiver, assets), "Asset transfer failed");

        return assets;
    }

    /**
     * @notice Simulates T-Bill daily yield accrual by adjusting NAV exchange rate multiplier
     * @param basisPoints Basis points increase (e.g. 500 = +5.00%)
     */
    function accrueYield(uint256 basisPoints) external {
        navExchangeRateMultiplier = (navExchangeRateMultiplier * (10000 + basisPoints)) / 10000;
    }
}
