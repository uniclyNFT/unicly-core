// SPDX-License-Identifier: MIT
pragma solidity 0.6.12;

import "@openzeppelin/contracts-upgradeable/access/OwnableUpgradeable.sol";
import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "./interfaces/IUnicFarm.sol";
import "./interfaces/IUnicGallery.sol";

contract UniclyXUnicVault is OwnableUpgradeable {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    address public constant XUNIC = address(0xA62fB0c2Fb3C7b27797dC04e1fEA06C0a2Db919a);
    address public constant UNIC = address(0x94E0BAb2F6Ab1F19F4750E42d7349f2740513aD5);
    address public constant UNIC_MASTERCHEF = address(0x4A25E4DF835B605A5848d2DB450fA600d96ee818);

    // Info of each user.
    struct UserInfo {
        uint256 amount; // How many LP tokens the user has provided.
        uint256 rewardDebt; // How much to remove when calculating user shares
    }

    // Info of each pool.
    struct PoolInfo {
        uint256 totalLPTokens; // The total LP tokens staked (we must keep this, see readme file)
        uint256 accXUNICPerShare; //Accumulated UNICs per share, times 1e12
    }

    // Info of each user that stakes LP tokens.
    mapping(uint256 => mapping(address => UserInfo)) public userInfo;

    // Info of each pool.
    mapping(uint256 => PoolInfo) public poolInfo;

    // Gas optimization for approving tokens to unic chef
    mapping(address => bool) public haveApprovedToken;

    address public devaddr;
    // For better precision
    uint256 public devFeeDenominator = 1000;
    // For gas optimization, do not update every pool in do hard work, only the ones that haven't been updated for ~12 hours
    uint256 public  minBlocksToUpdatePoolInDoHardWork = 3600;

    // Events
    event Deposit(address indexed user, uint256 indexed pid, uint256 amount);
    event Withdraw(address indexed user, uint256 indexed pid, uint256 amount);
    event EmergencyWithdraw(address indexed user, uint256 indexed pid, uint256 amount);
    event UpdatePool(uint256 pid);
    event Dev(address devaddr);
    event DoHardWork(uint256 numberOfUpdatedPools);

    function initialize(address _devaddr) external initializer {
        __Ownable_init();
        devaddr = _devaddr;
        IERC20(UNIC).approve(XUNIC, uint256(~0));
    }

    // Withdraw LP tokens from MasterChef.
    function withdraw(uint256 _pid, uint256 _amount) public {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];
        require(user.amount >= _amount, "withdraw: not good");
        updatePool(_pid);
        uint256 pending = (pool.accXUNICPerShare.mul(user.amount).div(1e12)).sub(user.rewardDebt);
        if (pending > 0) {
            safexUNICTransfer(msg.sender, pending);
        }
        if (_amount > 0) {
            user.amount = user.amount.sub(_amount);
            pool.totalLPTokens = pool.totalLPTokens.sub(_amount);
            IUnicFarm(UNIC_MASTERCHEF).withdraw(_pid, _amount);
            (IERC20 lpToken,,,,) = IUnicFarm(UNIC_MASTERCHEF).poolInfo(_pid);
            lpToken.safeTransfer(address(msg.sender), _amount);
        }
        user.rewardDebt = user.amount.mul(pool.accXUNICPerShare).div(1e12);
        emit Withdraw(msg.sender, _pid, _amount);
    }

    // Deposit LP tokens to MasterChef for unics allocation.
    function deposit(uint256 _pid, uint256 _amount) public {
        depositFor(_pid, _amount, msg.sender);
    }

    // Deposit LP tokens for someone else than msg.sender, mainly for zap functionality
    function depositFor(uint256 _pid, uint256 _amount, address _user) public {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][_user];
        updatePool(_pid);
        if (user.amount > 0) {
            uint256 pending = (pool.accXUNICPerShare.mul(user.amount).div(1e12)).sub(user.rewardDebt);
            if (pending > 0) {
                safexUNICTransfer(_user, pending);
            }
        }
        if (_amount > 0) {
            (IERC20 lpToken,,,,) = IUnicFarm(UNIC_MASTERCHEF).poolInfo(_pid);
            lpToken.safeTransferFrom(
                address(msg.sender),
                address(this),
                _amount
            );
            if (!haveApprovedToken[address(lpToken)]) {
                lpToken.approve(UNIC_MASTERCHEF, uint256(~0));
                haveApprovedToken[address(lpToken)] = true;
            }
            IUnicFarm(UNIC_MASTERCHEF).deposit(_pid, _amount);
            user.amount = user.amount.add(_amount);
            pool.totalLPTokens = pool.totalLPTokens.add(_amount);
        }
        user.rewardDebt = user.amount.mul(pool.accXUNICPerShare).div(1e12);
        emit Deposit(_user, _pid, _amount);
    }

    function doHardWork() public {
        uint256 numberOfUpdatedPools = 0;
        for (uint256 _pid = 0; _pid < IUnicFarm(UNIC_MASTERCHEF).poolLength(); _pid++) {
            if (poolInfo[_pid].totalLPTokens > 0) {
                (,,uint256 lastRewardBlock,,) = IUnicFarm(UNIC_MASTERCHEF).poolInfo(_pid);
                if (block.number - minBlocksToUpdatePoolInDoHardWork > lastRewardBlock) {
                    numberOfUpdatedPools = numberOfUpdatedPools.add(1);
                    updatePool(_pid);
                }
            }
        }
        emit DoHardWork(numberOfUpdatedPools);
    }

    function updatePool(uint256 _pid) public {
        PoolInfo storage pool = poolInfo[_pid];

        uint256 prevXUNICBalance = IERC20(XUNIC).balanceOf(address(this));
        IUnicFarm(UNIC_MASTERCHEF).deposit(_pid, 0);
        uint256 UNICBalance = IERC20(UNIC).balanceOf(address(this));
        if (UNICBalance > 0 && pool.totalLPTokens > 0) {
            IUnicGallery(XUNIC).enter(UNICBalance);
            uint256 addedXUNICs = IERC20(XUNIC).balanceOf(address(this)).sub(prevXUNICBalance);
            uint256 devAmount = addedXUNICs.mul(100).div(devFeeDenominator); // For better precision
            IERC20(XUNIC).transfer(devaddr, devAmount);
            addedXUNICs = addedXUNICs.sub(devAmount);
            pool.accXUNICPerShare = pool.accXUNICPerShare.add(addedXUNICs.mul(1e12).div(pool.totalLPTokens));
        }

        emit UpdatePool(_pid);
    }

    // Withdraw without caring about rewards. EMERGENCY ONLY.
    function emergencyWithdraw(uint256 _pid) external {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];
        uint256 amount = user.amount;
        user.amount = 0;
        user.rewardDebt = 0;
        pool.totalLPTokens = pool.totalLPTokens.sub(amount);
        IUnicFarm(UNIC_MASTERCHEF).withdraw(_pid, amount);
        (IERC20 lpToken,,,,) = IUnicFarm(UNIC_MASTERCHEF).poolInfo(_pid);
        lpToken.safeTransfer(address(msg.sender), amount);
        if (pool.totalLPTokens > 0) {
            // In case there are still users in that pool, we are using the claimed UNICs from `withdraw` to add to the share
            // In case there aren't anymore users in that pool, the next pool that will get updated will receive the claimed UNICs
            updatePool(_pid);
        }
        emit EmergencyWithdraw(msg.sender, _pid, amount);
    }

    // salvage purpose only for when stupid people send tokens here
    function withdrawToken(address tokenToWithdraw, uint256 amount) external onlyOwner {
        require(tokenToWithdraw != XUNIC, "Can't salvage xunic");
        IERC20(tokenToWithdraw).transfer(msg.sender, amount);
    }

    // Safe unic transfer function, just in case if rounding error causes pool to not have enough xUNICs.
    function safexUNICTransfer(address _to, uint256 _amount) internal {
        uint256 xUNICBal = IERC20(XUNIC).balanceOf(address(this));
        if (_amount > xUNICBal) {
            IERC20(XUNIC).transfer(_to, xUNICBal);
        } else {
            IERC20(XUNIC).transfer(_to, _amount);
        }
    }

    // Update dev address by the previous dev.
    function dev(address _devaddr) public {
        require(msg.sender == devaddr, "dev: wut?");
        devaddr = _devaddr;

        emit Dev(_devaddr);
    }

    // ------------- VIEW --------------

    // Current rate of xUNIC
    function getxUNICRate() public view returns (uint256) {
        uint256 xUNICBalance = IERC20(UNIC).balanceOf(XUNIC);
        uint256 xUNICSupply = IERC20(XUNIC).totalSupply();

        return xUNICBalance.mul(1e18).div(xUNICSupply);
    }

    function pendingxUNICs(uint256 _pid, address _user) public view returns (uint256) {
        PoolInfo memory pool = poolInfo[_pid];
        UserInfo memory user = userInfo[_pid][_user];

        // for frontend
        uint256 notClaimedUNICs = IUnicFarm(UNIC_MASTERCHEF).pendingUnic(_pid, address(this));
        if (notClaimedUNICs > 0) {
            uint256 xUNICRate = getxUNICRate();
            uint256 accXUNICPerShare = pool.accXUNICPerShare.add(notClaimedUNICs.mul(1e18).div(xUNICRate).mul(1e12).div(pool.totalLPTokens));
            return (accXUNICPerShare.mul(user.amount).div(1e12)).sub(user.rewardDebt);
        }
        uint256 pendingXUNICs = (pool.accXUNICPerShare.mul(user.amount).div(1e12)).sub(user.rewardDebt);
        return pendingXUNICs;
    }

}