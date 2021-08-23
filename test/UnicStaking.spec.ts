import chai, { expect } from 'chai'
import { createFixtureLoader, deployContract, MockProvider, solidity } from 'ethereum-waffle'
import { governanceFixture } from './fixtures'
import { Contract } from 'ethers'
import keccak256 from 'keccak256'
import UnicStaking from '../build/UnicStaking.json'
import UnicStakingERC721 from '../build/UnicStakingERC721.json'
import UnicStakingRewardManager from '../build/UnicStakingRewardManager.json'
import MockERC20 from '../build/MockERC20.json'
import { mineBlocks } from './utils'

chai.use(solidity)

const overrides = {
  gasLimit: 9999999
}

describe('UnicStaking', () => {
  const provider = new MockProvider({
    ganacheOptions: {
      hardfork: 'istanbul',
      mnemonic: 'horn horn horn horn horn horn horn horn horn horn horn horn',
      gasLimit: 99999999,
    },
  })
  const [alice, nonOwner, minter, stakerHarold, stakerWilly, stakerJon] = provider.getWallets()
  const loadFixture = createFixtureLoader([alice], provider)

  let unic: Contract
  let nftCollection: Contract
  let staking: Contract
  let stakingRewardManager: Contract
  let uToken: Contract
  let uTokenFake: Contract

  beforeEach(async () => {
    const fixture = await loadFixture(governanceFixture)
    unic = fixture.unic

    await unic.mint(minter.address, 100000000)

    nftCollection = await deployContract(alice, UnicStakingERC721, ['UnicStakingCollection', 'UNIC-721', 'https://721.unic.ly'], overrides)

    // in fact the staking would not only work for UNIC only but also for xUNIC or any other desired ERC-20 token
    staking = await deployContract(alice, UnicStaking, [unic.address, nftCollection.address, 1, 100], overrides)
    stakingRewardManager = await deployContract(alice, UnicStakingRewardManager, [staking.address])
    uToken = await deployContract(alice, MockERC20, ['Sample uToken', 'uSAMPLE', 10000000000], overrides)
    uTokenFake = await deployContract(alice, MockERC20, ['Fake uToken', 'uFAKE', 10000000000], overrides)

    // grant the staking role to the minting contract
    await nftCollection.grantRole(keccak256('MINTER_ROLE'), staking.address);
  })

  it('simple staking scenario going through the basic happy path', async () => {
    await uToken.approve(stakingRewardManager.address, 1000);

    await staking.createPool(uToken.address);

    const startTime = Math.floor(Date.now() / 1000) + 60; // in one minute
    const endTime = startTime + 180; // in three more minutes
    const addRewardPoolReceipt = await (await stakingRewardManager.addRewardPool(uToken.address, startTime, endTime, 1000)).wait();
    const addEvent = addRewardPoolReceipt.events.find((e: any) => e.event === 'RewardPoolAdded');

    await mineBlocks(provider, endTime - 60, -1);

    await stakingRewardManager.distributeRewards(addEvent.args.poolId.toString());
    const addedToPool = (await staking.pools(uToken.address)).totalRewardAmount.toString();
    expect(addedToPool).to.equal('333');
  });

  it('should not allow creating a pool that for a token which exists already', async () => {
    await uToken.approve(stakingRewardManager.address, 1000);
    await staking.createPool(uToken.address);
    await expect(staking.createPool(uToken.address)).to.be.revertedWith('UnicStaking: Pool does already exist');
  });

  it('should only allow to set a lock multiplier for the owner', async () => {
    await staking.setLockMultiplier(30, 200);
    expect((await staking.lockMultipliers(30))[0]).to.be.eq(200);
    await expect(staking.connect(nonOwner).setLockMultiplier(10, 125)).to.be.revertedWith(
      'Ownable: caller is not the owner'
    );
  });

  it('should only allow to set the minimum stake amount for the owner', async () => {
    await staking.setMinStakeAmount(100);
    expect(await staking.minStakeAmount()).to.be.eq(100);
    await expect(staking.connect(nonOwner).setMinStakeAmount(200)).to.be.revertedWith(
      'Ownable: caller is not the owner'
    );
  });

  it('should not allow staking for non existing pools', async () => {
    await expect(staking.connect(nonOwner).stake(100, 30, uTokenFake.address)).to.be.revertedWith(
      'UnicStaking: Pool does not exist'
    )
  });

  it('should validate the min stake amount', async() => {
    await staking.createPool(uToken.address);
    await staking.setMinStakeAmount(200);
    await expect(staking.stake(100, 0, uToken.address)).to.be.revertedWith(
      'UnicStaking: Amount must be greater than or equal to min stake amount'
    );
  });

  it('should validate the number of lock days', async () => {
    await staking.createPool(uToken.address);
    await staking.setMinStakeAmount(10);
    await expect(staking.stake(30, 0, uToken.address)).to.be.revertedWith(
      'UnicStaking: Invalid number of lock days specified'
    );
  });

  it('should accept multiple stakers with different locks', async () => {
    await staking.createPool(uToken.address);
    await staking.setMinStakeAmount(100);
    await staking.setLockMultiplier(0, 100);
    await staking.setLockMultiplier(30, 120);

    await unic.transfer(stakerHarold.address, 1000);
    await unic.transfer(stakerWilly.address, 1000);
    await unic.transfer(stakerJon.address, 1000);

    await unic.connect(stakerHarold).approve(staking.address, 500);
    await unic.connect(stakerWilly).approve(staking.address, 1000);
    await unic.connect(stakerJon).approve(staking.address, 750);

    const stakedHarold = await staking.connect(stakerHarold).stake(500, 30, uToken.address);
    const stakedHaroldReceipt = await stakedHarold.wait();
    const haroldEvent = stakedHaroldReceipt.events.find((e: any) => e.event === 'Staked');
    const haroldNftId = haroldEvent.args.nftId;

    const stakedWilly = await staking.connect(stakerWilly).stake(1000, 0, uToken.address);
    const stakedWillyReceipt = await stakedWilly.wait();
    const willyEvent = stakedWillyReceipt.events.find((e: any) => e.event === 'Staked');
    const willyNftId = willyEvent.args.nftId;

    const stakedJon = await staking.connect(stakerJon).stake(750, 0, uToken.address);
    const stakedJonReceipt = await stakedJon.wait();
    const jonEvent = stakedJonReceipt.events.find((e: any) => e.event === 'Staked');
    const jonNftId = jonEvent.args.nftId;

    await uToken.approve(staking.address, 1000);
    await staking.addRewards(uToken.address, 1000);

    const currentBlock = await provider.getBlock('latest')
    await mineBlocks(provider, (currentBlock.timestamp + 1), currentBlock.number + 1);

    const pendingRewardHarold = (await staking.pendingReward(haroldNftId)).toString();
    expect(pendingRewardHarold).to.equal('255'); // 500 staked with multiplier count as 600

    const pendingRewardWilly = (await staking.pendingReward(willyNftId)).toString();
    expect(pendingRewardWilly).to.equal('425');

    const pendingRewardJon = (await staking.pendingReward(jonNftId)).toString();
    expect(pendingRewardJon).to.equal('319');
  });

  it('should only harvest one position', async () => {
    await staking.createPool(uToken.address);
    await staking.setMinStakeAmount(100);
    await staking.setLockMultiplier(0, 100);

    await unic.transfer(stakerHarold.address, 2000);
    await unic.connect(stakerHarold).approve(staking.address, 2000);

    const stakedHarold1 = await staking.connect(stakerHarold).stake(1000, 0, uToken.address);
    const stakedHaroldReceipt1 = await stakedHarold1.wait();
    const haroldEvent1 = stakedHaroldReceipt1.events.find((e: any) => e.event === 'Staked');
    const haroldNftId1 = haroldEvent1.args.nftId;

    const stakedHarold2 = await staking.connect(stakerHarold).stake(1000, 0, uToken.address);
    const stakedHaroldReceipt2 = await stakedHarold2.wait();
    const haroldEvent2 = stakedHaroldReceipt2.events.find((e: any) => e.event === 'Staked');
    const haroldNftId2 = haroldEvent2.args.nftId;

    await uToken.approve(staking.address, 1000);
    await staking.addRewards(uToken.address, 1000);

    const currentBlock = await provider.getBlock('latest')
    await mineBlocks(provider, (currentBlock.timestamp + 1), currentBlock.number + 1);

    const pendingRewardHarold1 = (await staking.pendingReward(haroldNftId1)).toString();
    expect(pendingRewardHarold1).to.equal('500');

    const pendingRewardHarold2 = (await staking.pendingReward(haroldNftId2)).toString();
    expect(pendingRewardHarold2).to.equal('500');

    // harold should not have any funds left after putting everything into staking
    expect((await unic.balanceOf(stakerHarold.address)).toString()).to.equal('0');
    // also harold should not have any uTokens (rewards)
    expect((await uToken.balanceOf(stakerHarold.address)).toString()).to.equal('0');

    // now let's harvest only one position for harold
    const harvested = await staking.connect(stakerHarold).harvest(haroldNftId1);
    await harvested.wait();

    // harold should now only have the harvested rewards as a balance
    expect((await uToken.balanceOf(stakerHarold.address)).toString()).to.equal('500');

    // pending reward should now be 0
    expect((await staking.connect(stakerHarold).pendingReward(haroldNftId1)).toString()).to.equal('0');
  });

  it('should return funds on withdrawal', async () => {
    await staking.createPool(uToken.address);
    await staking.setMinStakeAmount(100);
    await staking.setLockMultiplier(0, 100);
    await unic.transfer(stakerJon.address, 1000);

    let balance = (await unic.balanceOf(stakerJon.address)).toString();
    expect(balance).to.equal('1000');

    await unic.connect(stakerJon).approve(staking.address, 1000);
    const staked = await staking.connect(stakerJon).stake(1000, 0, uToken.address);
    const stakedReceipt = await staked.wait();

    balance = (await unic.balanceOf(stakerJon.address)).toString();
    expect(balance).to.equal('0');

    const stakedEvent = stakedReceipt.events.find((e: any) => e.event === 'Staked');
    const stakingNftId = stakedEvent.args.nftId;

    const currentBlock = await provider.getBlock('latest')
    await mineBlocks(provider, (currentBlock.timestamp + 1), currentBlock.number + 1);

    await nftCollection.connect(stakerJon).approve(staking.address, stakingNftId);
    const withdrawn = await staking.connect(stakerJon).withdraw(stakingNftId)
    await withdrawn.wait();

    balance = (await unic.balanceOf(stakerJon.address)).toString();
    expect(balance).to.equal('1000');
  });
});