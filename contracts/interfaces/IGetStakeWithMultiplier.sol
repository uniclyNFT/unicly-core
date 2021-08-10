pragma solidity 0.6.12;

interface IGetStakeWithMultiplier {
    function getStakeWithMultiplier(uint256 nftId) external view returns (uint256);
}