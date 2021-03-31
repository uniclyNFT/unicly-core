pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC721/ERC721.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract MockERC721 is ERC721, Ownable {
    constructor(
        string memory name,
        string memory symbol
    ) public ERC721(name, symbol) { }

    /**
    * @dev Mints a new NFT.
    * @param _to The address that will own the minted NFT.
    * @param _tokenId of the NFT to be minted by the msg.sender.
    */
    function mint (
        address _to,
        uint256 _tokenId
    )
        external
        onlyOwner
    {
        super._mint(_to, _tokenId);
    }
}