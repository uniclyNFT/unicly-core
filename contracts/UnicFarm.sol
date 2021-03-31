pragma solidity 0.6.12;


import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/utils/EnumerableSet.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./Unic.sol";
import "./Converter.sol";

// Copied from https://github.com/sushiswap/sushiswap/blob/master/contracts/MasterChef.sol
// Modified by 0xLeia

// UnicFarm is where liquidity providers on UnicSwap can stake their LP tokens for UNIC rewards
// The ownership of UnicFarm will be transferred to a governance smart contract once UNIC has been sufficiently distributed

contract UnicFarm is Ownable {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;

    // Info of each user.
    struct UserInfo {
        uint256 amount;     // How many LP tokens the user has provided.
        uint256 rewardDebt; // Reward debt. See explanation below.
        //
        // We do some fancy math here. Basically, any point in time, the amount of UNICs
        // entitled to a user but is pending to be distributed is:
        //
        //   pending reward = (user.amount * pool.accUnicPerShare) - user.rewardDebt
        //
        // Whenever a user deposits or withdraws LP tokens to a pool. Here's what happens:
        //   1. The pool's `accUnicPerShare` (and `lastRewardBlock`) gets updated.
        //   2. User receives the pending reward sent to his/her address.
        //   3. User's `amount` gets updated.
        //   4. User's `rewardDebt` gets updated.
    }

    // Info of each pool.
    struct PoolInfo {
        IERC20 lpToken;           // Address of LP token contract.
        uint256 allocPoint;       // How many allocation points assigned to this pool. UNICs to distribute per block.
        uint256 lastRewardBlock;  // Last block number that UNICs distribution occurs.
        uint256 accUnicPerShare; // Accumulated UNICs per share, times 1e12. See below.
        address uToken;
    }

    // The UNIC TOKEN!
    Unic public unic;
    // Dev address.
    address public devaddr;
    // Mint rate controllers
    uint256 public mintRateMultiplier;
    uint256 public mintRateDivider;
    // Blocks per tranche used to calculate current mint rate (6500 blocks per day * 30 = 195000)
    uint256 public blocksPerTranche;
    // Current tranche
    uint256 public tranche = 0;
    // Whitelist mapping of address to bool
    mapping(address => bool) public whitelist;
    // UNIC tokens created per block.
    uint256 public unicPerBlock;

    // Info of each pool.
    PoolInfo[] public poolInfo;
    // Info of each user that stakes LP tokens.
    mapping (uint256 => mapping (address => UserInfo)) public userInfo;
    // Total allocation points. Must be the sum of all allocation points in all pools.
    uint256 public totalAllocPoint = 0;
    // The block number when UNIC mining starts.
    uint256 public startBlock;

    event Deposit(address indexed user, uint256 indexed pid, uint256 amount);
    event Withdraw(address indexed user, uint256 indexed pid, uint256 amount);
    event EmergencyWithdraw(address indexed user, uint256 indexed pid, uint256 amount);

    // New events so that the graph works
    event Add(uint256 allocPoint, address lpToken, bool withUpdate);
    event Set(uint256 pid, uint256 allocPoint, bool withUpdate);
    event MassUpdatePools();
    event UpdatePool(uint256 pid);
    event Dev(address devaddr);

    constructor(
        Unic _unic,
        address _devaddr,
        uint256 _mintRateMultiplier,
        uint256 _mintRateDivider,
        uint256 _unicPerBlock,
        uint256 _startBlock,
        uint256 _blocksPerTranche
    ) public {
        unic = _unic;
        devaddr = _devaddr;
        mintRateMultiplier = _mintRateMultiplier;
        mintRateDivider = _mintRateDivider;
        unicPerBlock = _unicPerBlock;
        startBlock = _startBlock;
        blocksPerTranche = _blocksPerTranche;
    }

    function poolLength() external view returns (uint256) {
        return poolInfo.length;
    }

    // Add a new lp to the pool. Can only be called by the owner.
    // address(0) for uToken if there's no uToken involved. Input uToken address if there is.
    function add(uint256 _allocPoint, IERC20 _lpToken, bool _withUpdate, address _uToken) public onlyOwner {
        require(!whitelist[address(_lpToken)]);
        if (_withUpdate) {
            massUpdatePools();
        }
        uint256 lastRewardBlock = block.number > startBlock ? block.number : startBlock;
        totalAllocPoint = totalAllocPoint.add(_allocPoint);
        poolInfo.push(PoolInfo({
            lpToken: _lpToken,
            allocPoint: _allocPoint,
            lastRewardBlock: lastRewardBlock,
            accUnicPerShare: 0,
            uToken: _uToken
        }));

        whitelist[address(_lpToken)] = true;

        emit Add(_allocPoint, address(_lpToken), _withUpdate);
    }

    // Update the given pool's UNIC allocation point. Can only be called by the owner.
    function set(uint256 _pid, uint256 _allocPoint, bool _withUpdate) public onlyOwner {
        if (_withUpdate) {
            massUpdatePools();
        }
        totalAllocPoint = totalAllocPoint.sub(poolInfo[_pid].allocPoint).add(_allocPoint);
        poolInfo[_pid].allocPoint = _allocPoint;

        emit Set(_pid, _allocPoint, _withUpdate);
    }

    // Return rewards over the given _from to _to block.
    // Rewards accumulate for a maximum of 195000 blocks.
    function getRewards(uint256 _from, uint256 _to) public view returns (uint256) {
        uint256 lastTrancheBlock = startBlock.add(tranche.mul(blocksPerTranche));
        if (_to.sub(_from) > blocksPerTranche) {
            _from = _to.sub(blocksPerTranche);
        }

        if (_from > lastTrancheBlock) {
            return _to.sub(_from).mul(unicPerBlock);
        } else {
            // Use prior mint rate for blocks staked before last tranche block
            return lastTrancheBlock.sub(_from).mul(unicPerBlock).mul(mintRateDivider).div(mintRateMultiplier).add(
                _to.sub(lastTrancheBlock).mul(unicPerBlock)
            );
        }
    }

    // View function to see pending UNICs on frontend.
    function pendingUnic(uint256 _pid, address _user) external view returns (uint256) {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][_user];
        uint256 accUnicPerShare = pool.accUnicPerShare;
        uint256 lpSupply = pool.lpToken.balanceOf(address(this));
        if (block.number > pool.lastRewardBlock && lpSupply != 0) {
            uint256 unicReward = getRewards(pool.lastRewardBlock, block.number).mul(pool.allocPoint).div(totalAllocPoint);
            accUnicPerShare = accUnicPerShare.add(unicReward.mul(1e12).div(lpSupply));
        }
        return user.amount.mul(accUnicPerShare).div(1e12).sub(user.rewardDebt);
    }

    // Update reward variables for all pools. Be careful of gas spending!
    function massUpdatePools() public {
        uint256 length = poolInfo.length;
        for (uint256 pid = 0; pid < length; ++pid) {
            updatePool(pid);
        }

        emit MassUpdatePools();
    }

    // Update reward variables of the given pool to be up-to-date.
    function updatePool(uint256 _pid) public {
        PoolInfo storage pool = poolInfo[_pid];
        if (pool.uToken != address(0) && pool.allocPoint > 0) {
            if (Converter(pool.uToken).unlockVotes() >= Converter(pool.uToken)._threshold()) {
                totalAllocPoint = totalAllocPoint.sub(pool.allocPoint);
                pool.allocPoint = 0;
                emit Set(_pid, 0, false);
            }
        }
        if (block.number <= pool.lastRewardBlock) {
            return;
        }
        uint256 lpSupply = pool.lpToken.balanceOf(address(this));
        if (lpSupply == 0) {
            pool.lastRewardBlock = block.number;
            return;
        }
        // Update block rewards and tranche based on block height
        if (block.number >= startBlock.add(tranche.mul(blocksPerTranche)).add(blocksPerTranche)) {
            tranche++;
            unicPerBlock = unicPerBlock.mul(mintRateMultiplier).div(mintRateDivider);
        }
        uint256 unicReward = getRewards(pool.lastRewardBlock, block.number).mul(pool.allocPoint).div(totalAllocPoint);
        unic.mint(devaddr, unicReward.div(9));
        unic.mint(address(this), unicReward);
        pool.accUnicPerShare = pool.accUnicPerShare.add(unicReward.mul(1e12).div(lpSupply));
        pool.lastRewardBlock = block.number;

        emit UpdatePool(_pid);
    }

    // Deposit LP tokens to UnicFarm for UNIC allocation.
    function deposit(uint256 _pid, uint256 _amount) public {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];
        updatePool(_pid);
        if (user.amount > 0) {
            uint256 pending = user.amount.mul(pool.accUnicPerShare).div(1e12).sub(user.rewardDebt);
            if(pending > 0) {
                safeUnicTransfer(msg.sender, pending);
            }
        }
        if(_amount > 0) {
            pool.lpToken.safeTransferFrom(address(msg.sender), address(this), _amount);
            user.amount = user.amount.add(_amount);
        }
        user.rewardDebt = user.amount.mul(pool.accUnicPerShare).div(1e12);
        emit Deposit(msg.sender, _pid, _amount);
    }

    // Withdraw LP tokens from UnicFarm.
    function withdraw(uint256 _pid, uint256 _amount) public {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];
        require(user.amount >= _amount, "withdraw: not good");
        updatePool(_pid);
        uint256 pending = user.amount.mul(pool.accUnicPerShare).div(1e12).sub(user.rewardDebt);
        if(pending > 0) {
            safeUnicTransfer(msg.sender, pending);
        }
        if(_amount > 0) {
            user.amount = user.amount.sub(_amount);
            pool.lpToken.safeTransfer(address(msg.sender), _amount);
        }
        user.rewardDebt = user.amount.mul(pool.accUnicPerShare).div(1e12);
        emit Withdraw(msg.sender, _pid, _amount);
    }

    // Withdraw without caring about rewards. EMERGENCY ONLY.
    function emergencyWithdraw(uint256 _pid) public {
        PoolInfo storage pool = poolInfo[_pid];
        UserInfo storage user = userInfo[_pid][msg.sender];
        uint256 amount = user.amount;
        user.amount = 0;
        user.rewardDebt = 0;
        pool.lpToken.safeTransfer(address(msg.sender), amount);
        emit EmergencyWithdraw(msg.sender, _pid, amount);
    }

    // Safe unic transfer function, just in case if rounding error causes pool to not have enough UNICs.
    function safeUnicTransfer(address _to, uint256 _amount) internal {
        uint256 unicBal = unic.balanceOf(address(this));
        if (_amount > unicBal) {
            unic.transfer(_to, unicBal);
        } else {
            unic.transfer(_to, _amount);
        }
    }

    // Update dev address by the previous dev.
    function dev(address _devaddr) public {
        require(msg.sender == devaddr, "dev: wut?");
        devaddr = _devaddr;

        emit Dev(_devaddr);
    }

    // Set mint rate
    function setMintRules(uint256 _mintRateMultiplier, uint256 _mintRateDivider, uint256 _unicPerBlock, uint256 _blocksPerTranche) public onlyOwner {
        require(_mintRateDivider > 0, "no dividing by zero");
        require(_blocksPerTranche > 0, "zero blocks per tranche not allowed");
        mintRateMultiplier = _mintRateMultiplier;
        mintRateDivider = _mintRateDivider;
        unicPerBlock = _unicPerBlock;
        blocksPerTranche = _blocksPerTranche;
    }

    function setStartBlock(uint256 _startBlock) public onlyOwner {
        require(block.number < startBlock, "start block can not be modified after it has passed");
        require(block.number < _startBlock, "new start block needs to be in the future");
        startBlock = _startBlock;
    }
}
