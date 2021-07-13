pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

abstract contract EmergencyWithdrawable is Ownable {
    // for worst case scenarios or to recover funds from people sending to this contract by mistake
    function emergencyWithdrawETH() external payable onlyOwner {
        msg.sender.send(address(this).balance);
    }

    // for worst case scenarios or to recover funds from people sending to this contract by mistake
    function emergencyWithdrawTokens(IERC20 token) external onlyOwner {
        token.transfer(msg.sender, token.balanceOf(address(this)));
    }
}