pragma solidity 0.6.12;

import "@openzeppelin/contracts/access/Ownable.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721Enumerable.sol";
import "./interfaces/IGetStakeWithMultiplier.sol";

contract UnicStakingVotes is Ownable {
    IERC721Enumerable public stakingNftContract;
    IGetStakeWithMultiplier public stakingPoolContract;

    constructor(
        IERC721Enumerable _stakingNftContract,
        IGetStakeWithMultiplier _stakingPoolContract
    ) public {
        stakingNftContract = _stakingNftContract;
        stakingPoolContract = _stakingPoolContract;
    }

    function setStakingNftContract(IERC721Enumerable _stakingNftContract) external onlyOwner {
        stakingNftContract = _stakingNftContract;
    }

    function setStakingPoolContract(IGetStakeWithMultiplier _stakingPoolContract) external onlyOwner {
        stakingPoolContract = _stakingPoolContract;
    }

    function getStakedUnicByNftOwner(address owner) external view returns (uint256 unicWithMultiplierSum) {
        uint256 balanceOf = stakingNftContract.balanceOf(owner);

        unicWithMultiplierSum = 0; 

        for (uint256 i = 0; i < balanceOf; i++) {
            unicWithMultiplierSum += stakingPoolContract.getStakeWithMultiplier(stakingNftContract.tokenOfOwnerByIndex(owner, i));
        }
    } 
}