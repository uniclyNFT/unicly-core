import chai, { expect } from 'chai'
import { createFixtureLoader, deployContract, MockProvider, solidity } from 'ethereum-waffle'
import { governanceFixture } from './fixtures'
import { Contract } from 'ethers'
import UnicStaking from '../build/UnicStaking.json'
import UnicStakingERC721 from '../build/UnicStakingERC721.json'
import UnicStakingRewardManager from '../build/UnicStakingRewardManager.json'
import MockERC20 from '../build/MockERC20.json'
import { mineBlocks } from './utils'

chai.use(solidity)

const overrides = {
  gasLimit: 9999999
}

describe.only('UnicStaking', () => {
  const provider = new MockProvider({
    ganacheOptions: {
      hardfork: 'istanbul',
      mnemonic: 'horn horn horn horn horn horn horn horn horn horn horn horn',
      gasLimit: 99999999,
    },
  })
  const [alice, gallery, minter] = provider.getWallets()
  const loadFixture = createFixtureLoader([alice], provider)

  let unic: Contract
  let nftCollection: Contract
  let staking: Contract
  let stakingRewardManager: Contract
  let uToken: Contract

  beforeEach(async () => {
    const fixture = await loadFixture(governanceFixture)
    unic = fixture.unic

    await unic.mint(minter.address, 100000000)

    nftCollection = await deployContract(alice, UnicStakingERC721, ['UnicStakingCollection', 'UNIC-721', 'https://721.unic.ly'], overrides)

    // in fact the staking would not only work for UNIC only but also for xUNIC or any other desired ERC-20 token
    staking = await deployContract(alice, UnicStaking, [unic.address, nftCollection.address, 1, 100], overrides)
    stakingRewardManager = await deployContract(alice, UnicStakingRewardManager, [staking.address])
    uToken = await deployContract(alice, MockERC20, ['Sample uToken', 'uSAMPLE', 10000000000], overrides)
  })

  it('first basic test (WIP...)', async () => {
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
});