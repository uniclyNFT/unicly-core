pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";

// Copied from SushiBar: https://github.com/sushiswap/sushiswap/blob/master/contracts/SushiBar.sol
// Modified by 0xLeia

// UnicGallery is the coolest gallery in town. You come in with some Unic, and leave with more! The longer you stay, the more Unic you get.
//
// This contract handles swapping to and from xUnic, UnicSwap's staking token.
contract UnicGallery is ERC20("UnicGallery", "xUNIC") {
    using SafeMath for uint256;
    IERC20 public unic;

    // Define the Unic token contract
    constructor(IERC20 _unic) public {
        unic = _unic;
    }

    // Enter the gallery. Pay some UNICs. Earn some shares.
    // Locks Unic and mints xUnic
    function enter(uint256 _amount) public {
        // Gets the amount of Unic locked in the contract
        uint256 totalUnic = unic.balanceOf(address(this));
        // Gets the amount of xUnic in existence
        uint256 totalShares = totalSupply();
        // If no xUnic exists, mint it 1:1 to the amount put in
        if (totalShares == 0 || totalUnic == 0) {
            _mint(msg.sender, _amount);
        } 
        // Calculate and mint the amount of xUnic the Unic is worth. The ratio will change overtime, as xUnic is burned/minted and Unic deposited + gained from fees / withdrawn.
        else {
            uint256 what = _amount.mul(totalShares).div(totalUnic);
            _mint(msg.sender, what);
        }
        // Lock the Unic in the contract
        unic.transferFrom(msg.sender, address(this), _amount);
    }

    // Leave the gallery. Claim back your UNICs.
    // Unclocks the staked + gained Unic and burns xUnic
    function leave(uint256 _share) public {
        // Gets the amount of xUnic in existence
        uint256 totalShares = totalSupply();
        // Calculates the amount of Unic the xUnic is worth
        uint256 what = _share.mul(unic.balanceOf(address(this))).div(totalShares);
        _burn(msg.sender, _share);
        unic.transfer(msg.sender, what);
    }
}