pragma solidity 0.6.12;

import "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import "@openzeppelin/contracts/token/ERC20/SafeERC20.sol";
import "@openzeppelin/contracts/math/SafeMath.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
import "./UnicFarm.sol";

contract LockedLP is Ownable {
    using SafeMath for uint256;
    using SafeERC20 for IERC20;
 
    struct LockedInfo {
        uint256 amount;
        uint unlockDate;
    }

    // Limit locking functionality to collection issuer
    // LP token contract address to locked info
    mapping (address => LockedInfo) public locks;
    // pairs to creators
    mapping (address => address) public poolCreators;
    // creators to pairs
    mapping (address => address) public pairs;
    // Already staked amounts
    mapping (address => uint256) public staked;
    address public unic;
    address public farm;

    struct PoolInfo {
        IERC20 lpToken;           // Address of LP token contract.
        uint256 allocPoint;       // How many allocation points assigned to this pool. UNICs to distribute per block.
        uint256 lastRewardBlock;  // Last block number that UNICs distribution occurs.
        uint256 accUnicPerShare; // Accumulated UNICs per share, times 1e12. See UnicFarm contract.
        address uToken;
    }

    // Will be set by me for ease of use of this tool. Setting pool creator is the only thing owner can do.
    // Other people can fork this contract and use it themselves though.
    function setPoolCreator(address _pair, address _creator) external onlyOwner {
        require(poolCreators[_pair] == address(0), "LockedLP: Pool creator already set");
        poolCreators[_pair] = _creator;
        pairs[_creator] = _pair;
    }

    function lock(address _pair, uint256 _amount, uint _unlockDate) external {
        require(pairs[msg.sender] == _pair, "LockedLP: Pool creator only");
        require(getBlockTimestamp() < _unlockDate, "LockedLP: Unlock must be in future");
        LockedInfo storage info = locks[_pair];
        if (info.amount > 0) {
            require(getBlockTimestamp() < info.unlockDate, "LockedLP: Already past unlock date");
            IERC20(_pair).transferFrom(msg.sender, address(this), _amount);
            info.amount = info.amount.add(_amount);
        }
        else {
            IERC20(_pair).transferFrom(msg.sender, address(this), _amount);
            locks[_pair] = LockedInfo(_amount, _unlockDate);
        }
    }

    function unlock(address _pair) external {
        require(pairs[msg.sender] == _pair, "LockedLP: Pool creator only");
        LockedInfo storage info = locks[_pair];
        require(getBlockTimestamp() > info.unlockDate, "LockedLP: You have not reached the unlock date");
        require(staked[_pair] == 0, "LockedLP: Unstake first");
        uint256 transferAmount = info.amount;
        info.amount = 0;
        IERC20(_pair).transfer(msg.sender, transferAmount);
    }

    function stake(uint256 _pid) external {
        (IERC20 lpToken, , , , ) = UnicFarm(farm).poolInfo(_pid);
        address pair = address(lpToken);
        require(pairs[msg.sender] == pair, "LockedLP: Pool creator only");
        uint256 amount = (locks[pair]).amount.sub(staked[pair]);
        staked[pair] = staked[pair].add(amount);
        uint256 balance = UnicFarm(farm).pendingUnic(_pid, address(this));
        if (amount > 0) {
            lpToken.approve(farm, amount);
        }
        UnicFarm(farm).deposit(_pid, amount);
        if (balance > 0) {
            IERC20(unic).safeTransfer(poolCreators[pair], balance);
        }
    }

    function unstake(uint256 _pid) external {
        (IERC20 lpToken, , , , ) = UnicFarm(farm).poolInfo(_pid);
        address pair = address(lpToken);
        require(pairs[msg.sender] == pair, "LockedLP: Pool creator only");
        uint256 amount = staked[pair];
        uint256 balance = UnicFarm(farm).pendingUnic(_pid, address(this));
        UnicFarm(farm).withdraw(_pid, amount);
        if (balance > 0) {
            IERC20(unic).safeTransfer(poolCreators[pair], balance);
        }
        staked[pair] = 0;
    }

    function setUnlockDate(address _pair, uint _unlockDate) external {
        require(pairs[msg.sender] == _pair, "LockedLP: Pool creator only");
        LockedInfo storage info = locks[_pair];
        require(info.unlockDate < _unlockDate, "LockedLP: New unlock date must be after current unlock date");
        info.unlockDate = _unlockDate;
    }

    function getBlockTimestamp() internal view returns (uint) {
        // solium-disable-next-line security/no-block-members
        return block.timestamp;
    }

    constructor(
        address _unic,
        address _farm
    ) public {
        unic = _unic;
        farm = _farm;
    }
}
