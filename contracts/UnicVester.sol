pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "./UnicSwap/interfaces/IUnicSwapV2Factory.sol";
import "./UnicSwap/interfaces/IUnicSwapV2Pair.sol";
import "@openzeppelin/contracts/access/Ownable.sol";

contract UnicVester is Ownable {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    IUnicSwapV2Factory public factory;
    address public bar;
    address public unic;
    address public weth;

    uint256 public vestingDuration;

    mapping(address => Schedule) public vestings;
    mapping(address => bool) public initialized;

    struct Schedule {
        uint256 amount;
        uint256 start;
        uint256 end;
    }

    constructor(IUnicSwapV2Factory _factory, address _bar, address _unic, address _weth) public {
        factory = _factory;
        unic = _unic;
        bar = _bar;
        weth = _weth;
    }

    // Initializes vesting schedule for new uToken
    function initialize(address token) onlyOwner public {
        require(!initialized[token], "UnicVester: Already initialized token");
        vestings[token] = Schedule(
            {
                amount: IERC20(token).balanceOf(address(this)),
                start: getBlockTimestamp(),
                end: getBlockTimestamp().add(vestingDuration)
            }
        );
    }

    // Set protocol's vesting schedule for future uTokens
    function setSchedule(uint256 _vestingDuration) onlyOwner public {
        vestingDuration = _vestingDuration;
    }
    
    function swap(address token) public {
        require(msg.sender == tx.origin, "do not convert from contract");

        Schedule storage vestingInfo = vestings[token];
        require(vestingInfo.start < vestingInfo.end, "UnicVester: Fully vested and swapped");
        uint256 currentTime = getBlockTimestamp();
        uint256 timeVested = currentTime.sub(vestingInfo.start);
        if(currentTime > vestingInfo.end) {
            timeVested = vestingInfo.end.sub(vestingInfo.start);
        }
        uint256 amountVested = vestingInfo.amount.mul(timeVested).div(vestingInfo.end.sub(vestingInfo.start));
        if (amountVested > IERC20(token).balanceOf(address(this))) {
            amountVested = IERC20(token).balanceOf(address(this));
        }
        vestingInfo.start = currentTime;
        if(vestingInfo.amount < amountVested) {
            vestingInfo.amount = 0;
        }
        else {
            vestingInfo.amount = vestingInfo.amount.sub(amountVested);
        }
        uint256 wethAmount = _toWETH(token, amountVested);
        _toUNIC(wethAmount);
    }

    // Converts token passed as an argument to WETH
    function _toWETH(address token, uint amountIn) internal returns (uint256) {
        // If the passed token is Unic, don't convert anything
        if (token == unic) {
            _safeTransfer(token, bar, amountIn);
            return 0;
        }
        // If the passed token is WETH, don't convert anything
        if (token == weth) {
            _safeTransfer(token, factory.getPair(weth, unic), amountIn);
            return amountIn;
        }
        // If the target pair doesn't exist, don't convert anything
        IUnicSwapV2Pair pair = IUnicSwapV2Pair(factory.getPair(token, weth));
        if (address(pair) == address(0)) {
            return 0;
        }
        // Choose the correct reserve to swap from
        (uint reserve0, uint reserve1,) = pair.getReserves();
        address token0 = pair.token0();
        (uint reserveIn, uint reserveOut) = token0 == token ? (reserve0, reserve1) : (reserve1, reserve0);
        // Calculate information required to swap
        uint amountInWithFee = amountIn.mul(997);
        uint amountOut = amountInWithFee.mul(reserveOut) / reserveIn.mul(1000).add(amountInWithFee);
        (uint amount0Out, uint amount1Out) = token0 == token ? (uint(0), amountOut) : (amountOut, uint(0));
        _safeTransfer(token, address(pair), amountIn);
        pair.swap(amount0Out, amount1Out, factory.getPair(weth, unic), new bytes(0));
        return amountOut;
    }

    // Converts WETH to Unic
    function _toUNIC(uint256 amountIn) internal {
        IUnicSwapV2Pair pair = IUnicSwapV2Pair(factory.getPair(weth, unic));
        // Choose WETH as input token
        (uint reserve0, uint reserve1,) = pair.getReserves();
        address token0 = pair.token0();
        (uint reserveIn, uint reserveOut) = token0 == weth ? (reserve0, reserve1) : (reserve1, reserve0);
        // Calculate information required to swap
        uint amountInWithFee = amountIn.mul(997);
        uint numerator = amountInWithFee.mul(reserveOut);
        uint denominator = reserveIn.mul(1000).add(amountInWithFee);
        uint amountOut = numerator / denominator;
        (uint amount0Out, uint amount1Out) = token0 == weth ? (uint(0), amountOut) : (amountOut, uint(0));
        // Swap WETH for Unic
        pair.swap(amount0Out, amount1Out, bar, new bytes(0));
    }

    // Wrapper for safeTransfer
    function _safeTransfer(address token, address to, uint256 amount) internal {
        IERC20(token).safeTransfer(to, amount);
    }

    function getBlockTimestamp() internal view returns (uint) {
        // solium-disable-next-line security/no-block-members
        return block.timestamp;
    }
}
