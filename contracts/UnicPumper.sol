pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "./UnicSwap/interfaces/IUnicSwapV2Factory.sol";
import "./UnicSwap/interfaces/IUnicSwapV2Pair.sol";

// COPIED FROM: https://github.com/sushiswap/sushiswap/blob/master/contracts/SushiMaker.sol
// Modified by 0xLeia
// UnicPumper generates rewards for xUNIC holders by trading tokens collected from fees for UNIC

contract UnicPumper {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    IUnicSwapV2Factory public factory;
    address public bar;
    address public unic;
    address public weth;

    constructor(IUnicSwapV2Factory _factory, address _bar, address _unic, address _weth) public {
        factory = _factory;
        unic = _unic;
        bar = _bar;
        weth = _weth;
    }

    function convert(address token0, address token1) public {
        // At least we try to make front-running harder to do.
        require(msg.sender == tx.origin, "do not convert from contract");
        IUnicSwapV2Pair pair = IUnicSwapV2Pair(factory.getPair(token0, token1));
        pair.transfer(address(pair), pair.balanceOf(address(this)));
        (uint amount0, uint amount1) = pair.burn(address(this));
        // First we convert everything to WETH
        uint256 wethAmount = _toWETH(token0, amount0) + _toWETH(token1, amount1);
        // Then we convert the WETH to Unic
        _toSUSHI(wethAmount);
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
    function _toSUSHI(uint256 amountIn) internal {
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
}