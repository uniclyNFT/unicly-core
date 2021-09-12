// SPDX-License-Identifier: MIT
pragma solidity ^0.6.12;

import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";

import "./interfaces/IZap.sol";
import "./interfaces/IUniclyXUnicVault.sol";
import "./UnicSwap/interfaces/IUnicFarm.sol";
import "./UnicSwap/interfaces/IUnicSwapV2Pair.sol";
import "./UnicSwap/interfaces/IUnicSwapV2Router02.sol";

contract Zap is IZap, OwnableUpgradeable {
    using SafeMath for uint;
    using SafeERC20 for IERC20;

    /* ========== CONSTANT VARIABLES ========== */

    address private constant WETH = 0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2;
    address private constant USDT = 0xdAC17F958D2ee523a2206206994597C13D831ec7;
    address private constant USDC = 0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48;
    address private constant DAI = 0x6B175474E89094C44Da98b954EedeAC495271d0F;
    address private constant UNIC = 0x94E0BAb2F6Ab1F19F4750E42d7349f2740513aD5;

    IUnicFarm private constant UNIC_FARM = IUnicFarm(0x4A25E4DF835B605A5848d2DB450fA600d96ee818);
    IUnicSwapV2Router02 private constant UNIC_ROUTER = IUnicSwapV2Router02(0xE6E90bC9F3b95cdB69F48c7bFdd0edE1386b135a);
    IUnicSwapV2Router02 private constant UNI_ROUTER = IUnicSwapV2Router02(0x7a250d5630B4cF539739dF2C5dAcb4c659F2488D);

    /* ========== STATE VARIABLES ========== */

    mapping(address => bool) private notLP;
    mapping(address => bool) private uniclySupported;
    mapping(address => address) private routePairAddresses;
    mapping(address => bool) private haveApprovedToken;

    IUniclyXUnicVault private xUnicVault;

    /* ========== INITIALIZER ========== */

    function initialize(address _xUnicVault) external initializer {
        __Ownable_init();
        require(owner() != address(0), "Zap: owner must be set");

        setNotLP(WETH);
        setNotLP(USDT);
        setNotLP(USDC);
        setNotLP(DAI);
        setNotLP(UNIC);

        setUniclySupported(WETH);
        setUniclySupported(UNIC);

        xUnicVault = IUniclyXUnicVault(_xUnicVault);
    }

    receive() external payable {}

    /* ========== View Functions ========== */

    function isNotUniclySupported(address _address) public view returns (bool) {
        return !uniclySupported[_address];
    }

    function isLP(address _address) public view returns (bool) {
        return !notLP[_address];
    }

    function routePair(address _address) external view returns(address) {
        return routePairAddresses[_address];
    }

    /* ========== External Functions ========== */

    function zapInTokenAndDeposit(address _from, uint amount, uint _pid) external override {
        (IERC20 lpToken,,,,) = UNIC_FARM.poolInfo(_pid);
        zapInTokenFor(_from, amount, address(lpToken));
        _approveTokenIfNeeded(address(lpToken));
        uint depositAmount = lpToken.balanceOf(address(this));
        xUnicVault.depositFor(_pid, depositAmount, msg.sender);
    }

    function zapInAndDeposit(uint _pid) external override payable {
        (IERC20 lpToken,,,,) = UNIC_FARM.poolInfo(_pid);
        _swapETHToLP(address(lpToken), msg.value);
        _approveTokenIfNeeded(address(lpToken));
        uint depositAmount = lpToken.balanceOf(address(this));
        xUnicVault.depositFor(_pid, depositAmount, msg.sender);
    }

    /* ========== Private Functions ========== */

    function zapInTokenFor(address _from, uint amount, address _to) private {
        IERC20(_from).safeTransferFrom(msg.sender, address(this), amount);
        _approveTokenIfNeeded(_from);

        if (isLP(_to)) {
            IUnicSwapV2Pair pair = IUnicSwapV2Pair(_to);
            address token0 = pair.token0();
            address token1 = pair.token1();
            if (_from == token0 || _from == token1) {
                // swap half amount for other
                address other = _from == token0 ? token1 : token0;
                _approveTokenIfNeeded(other);
                uint sellAmount = amount.div(2);
                uint otherAmount = _swap(_from, sellAmount, other);
                UNIC_ROUTER.addLiquidity(_from, other, amount.sub(sellAmount), otherAmount, 0, 0, address(this), block.timestamp);
            } else {
                uint ethAmount = _swapTokenForETH(_from, amount);
                _swapETHToLP(_to, ethAmount);
            }
        } else {
            _swap(_from, amount, _to);
        }
    }

    function _swapETHToLP(address lp, uint amount) private {
        if (!isLP(lp)) {
            _swapETHForToken(lp, amount);
        } else {
            // lp
            IUnicSwapV2Pair pair = IUnicSwapV2Pair(lp);
            address token0 = pair.token0();
            address token1 = pair.token1();
            if (token0 == WETH || token1 == WETH) {
                address token = token0 == WETH ? token1 : token0;
                uint swapValue = amount.div(2);
                uint tokenAmount = _swapETHForToken(token, swapValue);

                _approveTokenIfNeeded(token);
                UNIC_ROUTER.addLiquidityETH{value : amount.sub(swapValue)}(token, tokenAmount, 0, 0, address(this), block.timestamp);
            } else {
                uint swapValue = amount.div(2);
                uint token0Amount = _swapETHForToken(token0, swapValue);
                uint token1Amount = _swapETHForToken(token1, amount.sub(swapValue));

                _approveTokenIfNeeded(token0);
                _approveTokenIfNeeded(token1);
                UNIC_ROUTER.addLiquidity(token0, token1, token0Amount, token1Amount, 0, 0, address(this), block.timestamp);
            }
        }
    }

    function _swapETHForToken(address token, uint value) private returns (uint) {
        address[] memory path;

        if (routePairAddresses[token] != address(0)) {
            path = new address[](3);
            path[0] = WETH;
            path[1] = routePairAddresses[token];
            path[2] = token;
        } else {
            path = new address[](2);
            path[0] = WETH;
            path[1] = token;
        }

        uint[] memory amounts = UNIC_ROUTER.swapExactETHForTokens{value : value}(0, path, address(this), block.timestamp);
        return amounts[amounts.length - 1];
    }

    function _swapTokenForETH(address token, uint amount) private returns (uint) {
        address[] memory path;
        if (routePairAddresses[token] != address(0)) {
            path = new address[](3);
            path[0] = token;
            path[1] = routePairAddresses[token];
            path[2] = WETH;
        } else {
            path = new address[](2);
            path[0] = token;
            path[1] = WETH;
        }

        uint[] memory amounts;
        if (isNotUniclySupported(token)) {
            amounts = UNI_ROUTER.swapExactTokensForETH(amount, 0, path, address(this), block.timestamp);
        } else {
            amounts = UNIC_ROUTER.swapExactTokensForETH(amount, 0, path, address(this), block.timestamp);
        }
        return amounts[amounts.length - 1];
    }

    function _swap(address _from, uint amount, address _to) private returns (uint) {
        address intermediate = routePairAddresses[_from];
        if (intermediate == address(0)) {
            intermediate = routePairAddresses[_to];
        }

        address[] memory path;
        if (intermediate != address(0) && (_from == WETH || _to == WETH)) {
            // [WETH, BUSD, VAI] or [VAI, BUSD, WETH]
            path = new address[](3);
            path[0] = _from;
            path[1] = intermediate;
            path[2] = _to;
        } else if (intermediate != address(0) && (_from == intermediate || _to == intermediate)) {
            // [VAI, BUSD] or [BUSD, VAI]
            path = new address[](2);
            path[0] = _from;
            path[1] = _to;
        } else if (intermediate != address(0) && routePairAddresses[_from] == routePairAddresses[_to]) {
            // [VAI, DAI] or [VAI, USDC]
            path = new address[](3);
            path[0] = _from;
            path[1] = intermediate;
            path[2] = _to;
        } else if (routePairAddresses[_from] != address(0) && routePairAddresses[_from] != address(0) && routePairAddresses[_from] != routePairAddresses[_to]) {
            // routePairAddresses[xToken] = xRoute
            // [VAI, BUSD, WETH, xRoute, xToken]
            path = new address[](5);
            path[0] = _from;
            path[1] = routePairAddresses[_from];
            path[2] = WETH;
            path[3] = routePairAddresses[_to];
            path[4] = _to;
        } else if (intermediate != address(0) && routePairAddresses[_from] != address(0)) {
            // [VAI, BUSD, WETH, BUNNY]
            path = new address[](4);
            path[0] = _from;
            path[1] = intermediate;
            path[2] = WETH;
            path[3] = _to;
        } else if (intermediate != address(0) && routePairAddresses[_to] != address(0)) {
            // [BUNNY, WETH, BUSD, VAI]
            path = new address[](4);
            path[0] = _from;
            path[1] = WETH;
            path[2] = intermediate;
            path[3] = _to;
        } else if (_from == WETH || _to == WETH) {
            // [WETH, BUNNY] or [BUNNY, WETH]
            path = new address[](2);
            path[0] = _from;
            path[1] = _to;
        } else {
            // [USDT, BUNNY] or [BUNNY, USDT]
            path = new address[](3);
            path[0] = _from;
            path[1] = WETH;
            path[2] = _to;
        }

        uint[] memory amounts = UNIC_ROUTER.swapExactTokensForTokens(amount, 0, path, address(this), block.timestamp);
        return amounts[amounts.length - 1];
    }

    function _approveTokenIfNeeded(address token) private {
        if (!haveApprovedToken[token]) {
            IERC20(token).safeApprove(address(UNIC_ROUTER), uint(- 1));
            IERC20(token).safeApprove(address(UNI_ROUTER), uint(- 1));
            IERC20(token).safeApprove(address(xUnicVault), uint(- 1));
            haveApprovedToken[token] = true;
        }
    }

    /* ========== RESTRICTED FUNCTIONS ========== */

    function setRoutePairAddress(address asset, address route) external onlyOwner {
        routePairAddresses[asset] = route;
    }

    function setUniclySupported(address token) public onlyOwner {
        uniclySupported[token] = true;
    }

    function setNotLP(address token) public onlyOwner {
        notLP[token] = true;
    }

    function withdraw(address token) external onlyOwner {
        if (token == address(0)) {
            payable(owner()).transfer(address(this).balance);
            return;
        }

        IERC20(token).transfer(owner(), IERC20(token).balanceOf(address(this)));
    }
}
