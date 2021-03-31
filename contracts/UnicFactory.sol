pragma solidity 0.6.12;

import {Converter} from "./Converter.sol";
import './interfaces/IUnicFactory.sol';
import "@openzeppelin/contracts/math/SafeMath.sol";

contract UnicFactory is IUnicFactory {
    using SafeMath for uint;
    
    // Address that receives fees
    address public override feeTo;
    
    // Address that gets to set the feeTo address
    address public override feeToSetter;
    
    // List of uToken addresses
    address[] public override uTokens;
    
    mapping(address => uint) public override getUToken;
    
    event TokenCreated(address indexed caller, address indexed uToken);
    
    function uTokensLength() external override view returns (uint) {
        return uTokens.length;
    }
    
    // Constructor just needs to know who gets to set feeTo address and default fee amount`
    constructor(address _feeToSetter) public {
        feeToSetter = _feeToSetter;
    }
    
    function createUToken(uint256 totalSupply, uint8 decimals, string calldata name, string calldata symbol, uint256 threshold, string calldata description) external override returns (address) {
        require(totalSupply > 0, 'Unic: MIN SUPPLY');
        require(decimals >= 4, 'Unic: MIN PRECISION');
        require(bytes(name).length < 32, 'Unic: MAX NAME');
        require(bytes(symbol).length < 16, 'Unic: MAX TICKER');
        require(threshold > 0 && threshold <= totalSupply, 'Unic: THRESHOLD GREATER THAN SUPPLY');
        require(bytes(description).length < 256, 'Unic: MAX DESCRIPTION');
                
        address issuer = msg.sender;
        Converter converter = new Converter(totalSupply, decimals, name, symbol, threshold, description, issuer, this);
        // Populate mapping
        getUToken[address(converter)] = uTokens.length;
        // Add to list
        uTokens.push(address(converter));
        emit TokenCreated(msg.sender, address(converter));
        
        return address(converter);
    }
    
    function setFeeTo(address _feeTo) external override {
        require(msg.sender == feeToSetter, 'Unic: FORBIDDEN');
        feeTo = _feeTo;
    }
    
    function setFeeToSetter(address _feeToSetter) external override {
        require(msg.sender == feeToSetter, 'Unic: FORBIDDEN');
        feeToSetter = _feeToSetter;
    }
}