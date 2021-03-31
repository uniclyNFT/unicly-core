pragma solidity 0.6.12;

import "@openzeppelin/contracts/introspection/ERC165Checker.sol";
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/token/ERC721/IERC721.sol";
import "@openzeppelin/contracts/token/ERC1155/IERC1155.sol";
import "@openzeppelin/contracts/token/ERC1155/ERC1155Receiver.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "./interfaces/IUnicFactory.sol";

contract Converter is ERC20, ERC1155Receiver {
    using SafeMath for uint;

    // List of NFTs that have been deposited
    struct NFT {
    	address contractAddr;
    	uint256 tokenId;
        uint256 amount;
        bool claimed;
    }

    struct Bid {
    	address bidder;
    	uint256 amount;
        uint time;
    }

    mapping(uint256 => NFT) public nfts;
    // Current index and length of nfts
    uint256 public currentNFTIndex = 0;

    // If active, NFTs can’t be withdrawn
    bool public active = false;
    uint256 public totalBidAmount = 0;
    uint256 public unlockVotes = 0;
    uint256 public _threshold;
    address public issuer;
    string public _description;
    uint256 public cap;

    // Amount of uTokens each user has voted to unlock collection
    mapping(address => uint256) public unlockApproved;

    IUnicFactory public factory;

    // NFT index to Bid
    mapping(uint256 => Bid) public bids;
    // NFT index to address to amount
    mapping(uint256 => mapping(address => uint256)) public bidRefunds;
    uint public constant TOP_BID_LOCK_TIME = 3 days;

    event Deposited(uint256[] tokenIDs, uint256[] amounts, address contractAddr);
    event Refunded();
    event Issued();
    event BidCreated(address sender, uint256 nftIndex, uint256 bidAmount);
    event BidRemoved(address sender, uint256 nftIndex);
    event ClaimedNFT(address winner, uint256 nftIndex, uint256 tokenId);

    bytes private constant VALIDATOR = bytes('JCMY');

    constructor (uint256 totalSupply, uint8 decimals, string memory name, string memory symbol, uint256 threshold, string memory description, address _issuer, IUnicFactory _factory)
        public
        ERC20(name, symbol)
    {
        _setupDecimals(decimals);
        issuer = _issuer;
        _description = description;
        _threshold = threshold;
        factory = _factory;
        cap = totalSupply;
    }

    // deposits an nft using the transferFrom action of the NFT contractAddr
    function deposit(uint256[] calldata tokenIDs, uint256[] calldata amounts, address contractAddr) external {
        require(msg.sender == issuer, "Converter: Only issuer can deposit");
        require(tokenIDs.length <= 50, "Converter: A maximum of 50 tokens can be deposited in one go");
        require(tokenIDs.length > 0, "Converter: You must specify at least one token ID");

        if (ERC165Checker.supportsInterface(contractAddr, 0xd9b67a26)){
            IERC1155(contractAddr).safeBatchTransferFrom(msg.sender, address(this), tokenIDs, amounts, VALIDATOR);

            for (uint8 i = 0; i < 50; i++){
                if (tokenIDs.length == i){
                    break;
                }
                nfts[currentNFTIndex++] = NFT(contractAddr, tokenIDs[i], amounts[i], false);
            }
        }
        else if (ERC165Checker.supportsInterface(contractAddr, 0x80ac58cd)){
            for (uint8 i = 0; i < 50; i++){
                if (tokenIDs.length == i){
                    break;
                }
                IERC721(contractAddr).transferFrom(msg.sender, address(this), tokenIDs[i]);
                nfts[currentNFTIndex++] = NFT(contractAddr, tokenIDs[i], 1, false);
            }
        }

        emit Deposited(tokenIDs, amounts, contractAddr);
    }

    // Function that locks NFT collateral and issues the uTokens to the issuer
    function issue() external {
        require(msg.sender == issuer, "Converter: Only issuer can issue the tokens");
        require(active == false, "Converter: Token is already active");

        active = true;
        address feeTo = factory.feeTo();
        uint256 feeAmount = 0;
        if (feeTo != address(0)) {
            // 0.5% of uToken supply is sent to feeToAddress if fee is on
            feeAmount = cap.div(200);
            _mint(feeTo, feeAmount);
        }

        _mint(issuer, cap - feeAmount);

        emit Issued();
    }

    // Function that allows NFTs to be refunded (prior to issue being called)
    function refund(address _to) external {
        require(!active, "Converter: Contract is already active - cannot refund");
        require(msg.sender == issuer, "Converter: Only issuer can refund");

        // Only transfer maximum of 50 at a time to limit gas per call
        uint8 _i = 0;
        uint256 _index = currentNFTIndex;
        bytes memory data;

        while (_index > 0 && _i < 50){
            NFT memory nft = nfts[_index - 1];

            if (ERC165Checker.supportsInterface(nft.contractAddr, 0xd9b67a26)){
                IERC1155(nft.contractAddr).safeTransferFrom(address(this), _to, nft.tokenId, nft.amount, data);
            }
            else if (ERC165Checker.supportsInterface(nft.contractAddr, 0x80ac58cd)){
                IERC721(nft.contractAddr).safeTransferFrom(address(this), _to, nft.tokenId);
            }

            delete nfts[_index - 1];

            _index--;
            _i++;
        }

        currentNFTIndex = _index;

        emit Refunded();
    }

    function bid(uint256 nftIndex) external payable {
        require(unlockVotes < _threshold, "Converter: Release threshold has been met, no more bids allowed");
        Bid memory topBid = bids[nftIndex];
        require(topBid.bidder != msg.sender, "Converter: You have an active bid");
        require(topBid.amount < msg.value, "Converter: Bid too low");
        require(bidRefunds[nftIndex][msg.sender] == 0, "Converter: Collect bid refund");

        bids[nftIndex] = Bid(msg.sender, msg.value, getBlockTimestamp());
        bidRefunds[nftIndex][topBid.bidder] = topBid.amount;
        totalBidAmount += msg.value - topBid.amount;

        emit BidCreated(msg.sender, nftIndex, msg.value);
    }

    function unbid(uint256 nftIndex) external {
        Bid memory topBid = bids[nftIndex];
        bool isTopBidder = topBid.bidder == msg.sender;
        if (unlockVotes >= _threshold) {
            require(!isTopBidder, "Converter: Release threshold has been met, winner can't unbid");
        }

        if (isTopBidder) {
            require(topBid.time + TOP_BID_LOCK_TIME < getBlockTimestamp(), "Converter: Top bid locked");
            totalBidAmount -= topBid.amount;
            bids[nftIndex] = Bid(address(0), 0, getBlockTimestamp());
            (bool sent, bytes memory data) = msg.sender.call{value: topBid.amount}("");
            require(sent, "Converter: Failed to send Ether");

            emit BidRemoved(msg.sender, nftIndex);
        }
        else { 
            uint256 refundAmount = bidRefunds[nftIndex][msg.sender];
            require(refundAmount > 0, "Converter: no bid found");
            bidRefunds[nftIndex][msg.sender] = 0;
            (bool sent, bytes memory data) = msg.sender.call{value: refundAmount}("");
            require(sent, "Converter: Failed to send Ether");
        }
    }

    // Claim NFT if address is winning bidder
    function claim(uint256 nftIndex) external {
        require(unlockVotes >= _threshold, "Converter: Threshold not met");
        require(!nfts[nftIndex].claimed, "Converter: Already claimed");
        Bid memory topBid = bids[nftIndex];
        require(msg.sender == topBid.bidder, "Converter: Only winner can claim");

        nfts[nftIndex].claimed = true;
        NFT memory winningNFT = nfts[nftIndex];

        if (ERC165Checker.supportsInterface(winningNFT.contractAddr, 0xd9b67a26)){
            bytes memory data;
            IERC1155(winningNFT.contractAddr).safeTransferFrom(address(this), topBid.bidder, winningNFT.tokenId, winningNFT.amount, data);
        }
        else if (ERC165Checker.supportsInterface(winningNFT.contractAddr, 0x80ac58cd)){
            IERC721(winningNFT.contractAddr).safeTransferFrom(address(this), topBid.bidder, winningNFT.tokenId);
        }

        emit ClaimedNFT(topBid.bidder, nftIndex, winningNFT.tokenId);
    }

    // Approve collection unlock
    function approveUnlock(uint256 amount) external {
        require(unlockVotes < _threshold, "Converter: Threshold reached");
        _transfer(msg.sender, address(this), amount);

        unlockApproved[msg.sender] += amount;
        unlockVotes += amount;
    }

    // Unapprove collection unlock
    function unapproveUnlock(uint256 amount) external {
        require(unlockVotes < _threshold, "Converter: Threshold reached");
        require(unlockApproved[msg.sender] >= amount, "Converter: Not enough uTokens locked by user");
        unlockVotes -= amount;
        unlockApproved[msg.sender] -= amount;

        _transfer(address(this), msg.sender, amount);
    }

    // Claim ETH function
    function redeemETH(uint256 amount) external {
        require(unlockVotes >= _threshold, "Converter: Threshold not met");
        // Deposit uTokens
        if (amount > 0) {
            _transfer(msg.sender, address(this), amount);
        }
        // Combine approved balance + newly deposited balance
        uint256 finalBalance = amount + unlockApproved[msg.sender];
        // Remove locked uTokens tracked for user
        unlockApproved[msg.sender] = 0;

        // Redeem ETH corresponding to uToken amount
        (bool sent, bytes memory data) = msg.sender.call{value: totalBidAmount.mul(finalBalance).div(this.totalSupply())}("");
        require(sent, "Converter: Failed to send Ether");
    }

    function getBlockTimestamp() internal view returns (uint) {
        // solium-disable-next-line security/no-block-members
        return block.timestamp;
    }

    /**
     * ERC1155 Token ERC1155Receiver
     */
    function onERC1155Received(address _operator, address _from, uint256 _id, uint256 _value, bytes calldata _data) override external returns(bytes4) {
        if(keccak256(_data) == keccak256(VALIDATOR)){
            return 0xf23a6e61;
        }
    }

    function onERC1155BatchReceived(address _operator, address _from, uint256[] calldata _ids, uint256[] calldata _values, bytes calldata _data) override external returns(bytes4) {
        if(keccak256(_data) == keccak256(VALIDATOR)){
            return 0xbc197c81;
        }
    }

}
