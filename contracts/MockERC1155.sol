pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC1155/ERC1155.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract MockERC1155 is ERC1155("https://token-cdn-domain/{id}.json"), Ownable {
    /**
    * @dev Mints a new NFT.
    * @param _to The address that will own the minted NFT.
    * @param _tokenId of the NFT to be minted by the msg.sender.
    */
    function mint (
        address _to,
        uint256 _tokenId,
        uint256 amount,
        bytes memory data
    )
        external
        onlyOwner
    {
        super._mint(_to, _tokenId, amount, data);
    }
}