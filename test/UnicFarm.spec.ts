import chai, { expect } from 'chai'
import { BigNumber, Contract, constants, utils } from 'ethers'
import { solidity, MockProvider, createFixtureLoader, deployContract } from 'ethereum-waffle'

import { governanceFixture } from './fixtures'
import { expandTo18Decimals, mineBlock, mineBlocks } from './utils'

import UnicFarm from '../build/UnicFarm.json'
import MockERC20 from '../build/MockERC20.json'
import UnicFactory from '../build/UnicFactory.json'
import Converter from '../build/Converter.json'
import MockERC721 from '../build/MockERC721.json'

chai.use(solidity)

const overrides = {
  gasLimit: 9999999
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

describe('UnicFarm', () => {
  const provider = new MockProvider({
    ganacheOptions: {
      hardfork: 'istanbul',
      mnemonic: 'horn horn horn horn horn horn horn horn horn horn horn horn',
      gasLimit: 99999999,
    },
  })
  const [alice, bob, carol, dev, minter] = provider.getWallets()
  const loadFixture = createFixtureLoader([alice], provider)

  let factory: Contract
  let converter: Contract
  let nft1: Contract
  let unic: Contract
  let farm: Contract
  let lp: Contract
  let lp2: Contract

  beforeEach(async () => {
    const fixture = await loadFixture(governanceFixture)
    unic = fixture.unic

    lp = await deployContract(minter, MockERC20, ['LPToken', 'LP', 10000000000], overrides)
    await lp.connect(minter).transfer(alice.address, 1000)
    await lp.connect(minter).transfer(bob.address, 1000)
    await lp.connect(minter).transfer(carol.address, 1000)
    lp2 = await deployContract(minter, MockERC20, ['LPToken2', 'LP2', 10000000000], overrides)
    await lp2.connect(minter).transfer(alice.address, 1000)
    await lp2.connect(minter).transfer(bob.address, 1000)
    await lp2.connect(minter).transfer(carol.address, 1000)
  })

  it('set correct state variables', async () => {
    // 100 UNIC minted per block, start block is at 100
    // 195,000 blocks per tranche, mint rate is decreased by 4/5 each tranche
    farm = await deployContract(alice, UnicFarm, [unic.address, dev.address, 4, 5, 100, 100, 195000], overrides)
    await unic.connect(alice).transferOwnership(farm.address)

    expect(await farm.unic()).to.be.eq(unic.address)
    expect(await farm.devaddr()).to.be.eq(dev.address)
    expect(await unic.owner()).to.be.eq(farm.address)
  })

  it('should allow dev and only dev to update dev', async () => {
    // 100 UNIC minted per block, start block is at 100
    // 195,000 blocks per tranche, mint rate is decreased by 4/5 each tranche
    farm = await deployContract(alice, UnicFarm, [unic.address, dev.address, 4, 5, 100, 100, 195000], overrides)
    await unic.connect(alice).transferOwnership(farm.address)

    expect(await farm.devaddr()).to.be.eq(dev.address)
    await expect(farm.connect(alice).dev(alice.address)).to.be.revertedWith('dev: wut?')
    await farm.connect(dev).dev(bob.address)
    expect(await farm.devaddr()).to.be.eq(bob.address)
    await farm.connect(bob).dev(alice.address)
    expect(await farm.devaddr()).to.be.eq(alice.address)
  })

  it('should allow emergency withdraw', async () => {
    // 100 UNIC minted per block, start block is at 100
    // 195,000 blocks per tranche, mint rate is decreased by 4/5 each tranche
    farm = await deployContract(alice, UnicFarm, [unic.address, dev.address, 4, 5, 100, 100, 195000], overrides)
    await unic.connect(alice).transferOwnership(farm.address)

    await farm.connect(alice).add(100, lp.address, true, ZERO_ADDRESS)
    await lp.connect(bob).approve(farm.address, 1000)
    await farm.connect(bob).deposit(0, 100)
    expect(await lp.balanceOf(bob.address)).to.be.eq(900)
    await farm.connect(bob).emergencyWithdraw(0)
    expect(await lp.balanceOf(bob.address)).to.be.eq(1000)
  })

  it('UNIC can only be minted after startBlock', async () => {
    // 100 UNIC minted per block (unicPerBlock = 90), start block is at 100
    // 195,000 blocks per tranche, mint rate is decreased by 4/5 each tranche
    farm = await deployContract(alice, UnicFarm, [unic.address, dev.address, 4, 5, 90, 100, 195000], overrides)
    await unic.connect(alice).transferOwnership(farm.address)

    await farm.connect(alice).add(100, lp.address, true, ZERO_ADDRESS)
    await lp.connect(bob).approve(farm.address, 1000)
    await farm.connect(bob).deposit(0, 100)

    let currentBlock = await provider.getBlock('latest')
    // Get to block 90
    await mineBlocks(provider, (currentBlock.timestamp + 1), (89 - currentBlock.number))
    await farm.connect(bob).deposit(0, 0)

    expect(await unic.balanceOf(bob.address)).to.be.eq(0)

    currentBlock = await provider.getBlock('latest')
    // Get to block 95
    await mineBlocks(provider, (currentBlock.timestamp + 1), (94 - currentBlock.number))
    await farm.connect(bob).deposit(0, 0)

    expect(await unic.balanceOf(bob.address)).to.be.eq(0)

    currentBlock = await provider.getBlock('latest')
    // Get to block 100
    await mineBlocks(provider, (currentBlock.timestamp + 1), (99 - currentBlock.number))
    await farm.connect(bob).deposit(0, 0)

    expect(await unic.balanceOf(bob.address)).to.be.eq(0)

    currentBlock = await provider.getBlock('latest')
    // Get to block 101
    await farm.connect(bob).deposit(0, 0)

    expect(await unic.balanceOf(bob.address)).to.be.eq(90)

    currentBlock = await provider.getBlock('latest')
    // Get to block 105
    await mineBlocks(provider, (currentBlock.timestamp + 1), (104 - currentBlock.number))
    await farm.connect(bob).deposit(0, 0)

    expect(await unic.balanceOf(bob.address)).to.be.eq(450)
    expect(await unic.balanceOf(dev.address)).to.be.eq(50)
    // Total supply should be Leia's token plus newly minted tokens
    expect(await unic.totalSupply()).to.be.eq(expandTo18Decimals(1).add(BigNumber.from(500)))
  })

  it('should not distribute UNIC if nobody deposits', async () => {
    // 100 UNIC minted per block (unicPerBlock = 90), start block is at 200
    // 195,000 blocks per tranche, mint rate is decreased by 4/5 each tranche
    farm = await deployContract(alice, UnicFarm, [unic.address, dev.address, 4, 5, 90, 200, 195000], overrides)
    await unic.connect(alice).transferOwnership(farm.address)

    await farm.connect(alice).add(100, lp.address, true, ZERO_ADDRESS)
    await lp.connect(bob).approve(farm.address, 1000)

    let currentBlock = await provider.getBlock('latest')
    // Get to block 200
    await mineBlocks(provider, (currentBlock.timestamp + 1), (199 - currentBlock.number))
    
    // Total supply should only be Leia's token
    expect(await unic.totalSupply()).to.be.eq(expandTo18Decimals(1))

    currentBlock = await provider.getBlock('latest')
    // Get to block 205
    await mineBlocks(provider, (currentBlock.timestamp + 1), (204 - currentBlock.number))

    // Total supply should only be Leia's token
    expect(await unic.totalSupply()).to.be.eq(expandTo18Decimals(1))

    currentBlock = await provider.getBlock('latest')
    // Get to block 210
    await mineBlocks(provider, (currentBlock.timestamp + 1), (209 - currentBlock.number))

    await farm.connect(bob).deposit(0, 10)

    expect(await unic.totalSupply()).to.be.eq(expandTo18Decimals(1))
    expect(await unic.balanceOf(bob.address)).to.be.eq(0)
    expect(await unic.balanceOf(dev.address)).to.be.eq(0)
    expect(await lp.balanceOf(bob.address)).to.be.eq(990)

    currentBlock = await provider.getBlock('latest')
    // Get to block 220
    await mineBlocks(provider, (currentBlock.timestamp + 1), (219 - currentBlock.number))

    await farm.connect(bob).withdraw(0, 10)

    expect(await unic.totalSupply()).to.be.eq(expandTo18Decimals(1).add(BigNumber.from(1000)))
    expect(await unic.balanceOf(bob.address)).to.be.eq(900)
    expect(await unic.balanceOf(dev.address)).to.be.eq(100)
    expect(await lp.balanceOf(bob.address)).to.be.eq(1000)
  })

  it('should distribute UNIC properly for each staker', async () => {
    // 100 UNIC minted per block (unicPerBlock = 90), start block is at 300
    // 195,000 blocks per tranche, mint rate is decreased by 4/5 each tranche
    farm = await deployContract(alice, UnicFarm, [unic.address, dev.address, 4, 5, 90, 300, 195000], overrides)
    await unic.connect(alice).transferOwnership(farm.address)

    await farm.connect(alice).add(100, lp.address, true, ZERO_ADDRESS)

    await lp.connect(alice).approve(farm.address, 1000)
    await lp.connect(bob).approve(farm.address, 1000)
    await lp.connect(carol).approve(farm.address, 1000)

    let currentBlock = await provider.getBlock('latest')
    // Get to block 310
    await mineBlocks(provider, (currentBlock.timestamp + 1), (309 - currentBlock.number))
    
    // Total supply should only be Leia's token
    expect(await unic.totalSupply()).to.be.eq(expandTo18Decimals(1))

    // Alice deposits 10 LPs at block 310
    await farm.connect(alice).deposit(0, 10)

    currentBlock = await provider.getBlock('latest')
    // Get to block 314
    await mineBlocks(provider, (currentBlock.timestamp + 1), (313 - currentBlock.number))

    // Bob deposits 20 LPs at block 314
    await farm.connect(bob).deposit(0, 20)

    currentBlock = await provider.getBlock('latest')
    // Get to block 318
    await mineBlocks(provider, (currentBlock.timestamp + 1), (317 - currentBlock.number))

    // Carol deposits 30 LPs at block 318
    await farm.connect(carol).deposit(0, 30)

    // Alice deposits 10 more LPs at block 320. At this point:
    // Alice should have: 4*90 + 4*1/3*90 + 2*1/6*90 = 510
    // UnicFarm should have the remaining: 900 - 510 = 390

    currentBlock = await provider.getBlock('latest')
    // Get to block 320
    await mineBlocks(provider, (currentBlock.timestamp + 1), (319 - currentBlock.number))
    await farm.connect(alice).deposit(0, 10)

    expect(await unic.totalSupply()).to.be.eq(expandTo18Decimals(1).add(BigNumber.from(1000)))
    expect(await unic.balanceOf(alice.address)).to.be.eq(expandTo18Decimals(1).add(BigNumber.from(510)))
    expect(await unic.balanceOf(bob.address)).to.be.eq(0)
    expect(await unic.balanceOf(carol.address)).to.be.eq(0)
    expect(await unic.balanceOf(farm.address)).to.be.eq(390)
    expect(await unic.balanceOf(dev.address)).to.be.eq(100)

    // Bob withdraws 5 LPs at block 330. At this point:
    // Bob should have: 4*2/3*90 + 2*2/6*90 + 10*2/7*90 = 557
    currentBlock = await provider.getBlock('latest')
    // Get to block 330
    await mineBlocks(provider, (currentBlock.timestamp + 1), (329 - currentBlock.number))
    await farm.connect(bob).withdraw(0, 5)

    expect(await unic.totalSupply()).to.be.eq(expandTo18Decimals(1).add(BigNumber.from(2000)))
    expect(await unic.balanceOf(alice.address)).to.be.eq(expandTo18Decimals(1).add(BigNumber.from(510)))
    expect(await unic.balanceOf(bob.address)).to.be.eq(557)
    expect(await unic.balanceOf(carol.address)).to.be.eq(0)
    expect(await unic.balanceOf(farm.address)).to.be.eq(733)
    expect(await unic.balanceOf(dev.address)).to.be.eq(200)

    // Alice withdraws 20 LPs at block 340.
    // Bob withdraws 15 LPs at block 350.
    // Carol withdraws 30 LPs at block 360.
    currentBlock = await provider.getBlock('latest')
    // Get to block 340
    await mineBlocks(provider, (currentBlock.timestamp + 1), (339 - currentBlock.number))
    await farm.connect(alice).withdraw(0, 20)

    currentBlock = await provider.getBlock('latest')
    // Get to block 350
    await mineBlocks(provider, (currentBlock.timestamp + 1), (349 - currentBlock.number))
    await farm.connect(bob).withdraw(0, 15)

    currentBlock = await provider.getBlock('latest')
    // Get to block 360
    await mineBlocks(provider, (currentBlock.timestamp + 1), (359 - currentBlock.number))
    await farm.connect(carol).withdraw(0, 30)

    expect(await unic.totalSupply()).to.be.eq(expandTo18Decimals(1).add(BigNumber.from(5000)))
    // Alice should have: 510 + 10*2/7*90 + 10*2/6.5*90 = 1044 along with Leia's token
    expect(await unic.balanceOf(alice.address)).to.be.eq(expandTo18Decimals(1).add(BigNumber.from(1044)))
    // // Bob should have: 557 + 10*1.5/6.5 * 90 + 10*1.5/4.5*90 = 1064 (but rounds to 1065)
    expect(await unic.balanceOf(bob.address)).to.be.eq(1065)
    // Carol should have: 2*3/6*90 + 10*3/7*90 + 10*3/6.5*90 + 10*3/4.5*90 + 10*90 = 2391
    expect(await unic.balanceOf(carol.address)).to.be.eq(2391)
    expect(await unic.balanceOf(farm.address)).to.be.eq(0)
    expect(await unic.balanceOf(dev.address)).to.be.eq(500)

    expect(await lp.balanceOf(alice.address)).to.be.eq(1000)
    expect(await lp.balanceOf(alice.address)).to.be.eq(1000)
    expect(await lp.balanceOf(carol.address)).to.be.eq(1000)
  })

  it('should give proper UNIC allocation to each pool', async () => {
    // 100 UNIC minted per block (unicPerBlock = 90), start block is at 400
    // 195,000 blocks per tranche, mint rate is decreased by 4/5 each tranche
    farm = await deployContract(alice, UnicFarm, [unic.address, dev.address, 4, 5, 90, 400, 195000], overrides)
    await unic.connect(alice).transferOwnership(farm.address)

    await lp.connect(alice).approve(farm.address, 1000)
    await lp2.connect(bob).approve(farm.address, 1000)

    // Add first LP to the pool with allocation 1
    await farm.connect(alice).add(10, lp.address, true, ZERO_ADDRESS)

    let currentBlock = await provider.getBlock('latest')
    // Get to block 410
    await mineBlocks(provider, (currentBlock.timestamp + 1), (409 - currentBlock.number))
    await farm.connect(alice).deposit(0, 10)

    // Add LP2 to the pool with allocation 2 at block 420
    currentBlock = await provider.getBlock('latest')
    // Get to block 420
    await mineBlocks(provider, (currentBlock.timestamp + 1), (419 - currentBlock.number))
    await farm.connect(alice).add(20, lp2.address, true, ZERO_ADDRESS)

    // Alice should have 10*90 pending reward
    expect(await farm.pendingUnic(0, alice.address)).to.be.eq(900)

    // Bob deposits 5 LP2s at block 425
    currentBlock = await provider.getBlock('latest')
    // Get to block 425
    await mineBlocks(provider, (currentBlock.timestamp + 1), (424 - currentBlock.number))
    await farm.connect(bob).deposit(1, 5)

    // Alice should have 900 + 5*1/3*90 = 1050 pending reward
    expect(await farm.pendingUnic(0, alice.address)).to.be.eq(1050)

    currentBlock = await provider.getBlock('latest')
    // Get to block 430
    await mineBlocks(provider, (currentBlock.timestamp + 1), (430 - currentBlock.number))

    // At block 430, Bob should get 5*2/3*90 = 300. Alice should have 1200 pending UNIC total.
    expect(await farm.pendingUnic(0, alice.address)).to.be.eq(1200)
    expect(await farm.pendingUnic(1, bob.address)).to.be.eq(300)
  })

  it('should decrease mint rate every tranche', async () => {
    // 100 UNIC minted per block (unicPerBlock = 90), start block is at 500
    // 50 blocks per tranche, mint rate is decreased by 4/5 each tranche
    farm = await deployContract(alice, UnicFarm, [unic.address, dev.address, 4, 5, 90, 500, 50], overrides)
    await unic.connect(alice).transferOwnership(farm.address)

    await farm.connect(alice).add(100, lp.address, true, ZERO_ADDRESS)

    await lp.connect(alice).approve(farm.address, 1000)
    await lp.connect(bob).approve(farm.address, 1000)
    await lp.connect(carol).approve(farm.address, 1000)

    let currentBlock = await provider.getBlock('latest')
    // Get to block 540
    await mineBlocks(provider, (currentBlock.timestamp + 1), 539 - currentBlock.number)
    
    await farm.connect(alice).deposit(0, 10) // Block 540
    await farm.connect(bob).deposit(0, 20) // Block 541

    currentBlock = await provider.getBlock('latest')
    // Get to block 549
    await mineBlocks(provider, (currentBlock.timestamp + 1), (549 - currentBlock.number))

    // Alice should have 1*90 + 8/3*90 pending reward
    expect(await farm.pendingUnic(0, alice.address)).to.be.eq(330)
    // Bob should have 8*(2/3)*90 pending reward
    expect(await farm.pendingUnic(0, bob.address)).to.be.eq(480)

    // Update pool, block goes to 550
    await farm.connect(alice).deposit(0, 0)
    // Alice should have 1*90 + 9/3*90 = 360 UNIC plus Leia's token
    expect(await unic.balanceOf(alice.address)).to.be.eq(expandTo18Decimals(1).add(BigNumber.from(360)))
    // Bob should have 9*(2/3)*90 pending
    expect(await farm.pendingUnic(0, bob.address)).to.be.eq(540)
    expect(await unic.balanceOf(farm.address)).to.be.eq(540)
    expect(await unic.balanceOf(dev.address)).to.be.eq(100)

    // tranche went up, unicPerBlock went down
    expect(await farm.tranche()).to.be.eq(1)
    expect(await farm.unicPerBlock()).to.be.eq(72)

    currentBlock = await provider.getBlock('latest')
    // Get to block 560
    await mineBlocks(provider, (currentBlock.timestamp + 1), (559 - currentBlock.number))
    await farm.connect(alice).deposit(0, 0) // Block 560
    await farm.connect(bob).deposit(0, 0) // Blokck 561

    // Alice should have 360 + 10/3*72 = 600 UNIC plus Leia's token
    expect(await unic.balanceOf(alice.address)).to.be.eq(expandTo18Decimals(1).add(BigNumber.from(600)))
    // Bob should have 9*(2/3)*90 + 10*(2/3)*72 + 1*(2/3)*72 = 1068 UNIC
    expect(await unic.balanceOf(bob.address)).to.be.eq(1068)
    // Total supply should be Leia's token + 10*100 + 11*80
    expect(await unic.totalSupply()).to.be.eq(expandTo18Decimals(1).add(BigNumber.from(1880)))
    // Dev should have 100 + 11*72/9
    expect(await unic.balanceOf(dev.address)).to.be.eq(188)
    // Farm should have 1880 - 1068 - 600 - 188 = 24
    expect(await unic.balanceOf(farm.address)).to.be.eq(24)
  }),

  it('uToken pool', async () => {
    farm = await deployContract(alice, UnicFarm, [unic.address, dev.address, 4, 5, 90, 600, 50], overrides)
    await unic.connect(alice).transferOwnership(farm.address)

    factory = await deployContract(alice, UnicFactory, [alice.address], overrides)
    await factory.connect(bob).createUToken(1000, 18, 'Star Wars Collection', 'uSTAR', 950, 'Leia\'s Star Wars NFT Collection')
    const converterAddress = await factory.uTokens(0)
    converter = new Contract(converterAddress, JSON.stringify(Converter.abi), provider)

    nft1 = await deployContract(minter, MockERC721, ['Star Wars NFTs', 'STAR'], overrides)
    // 3 NFTs for Bob
    await nft1.connect(minter).mint(bob.address, 0)
    await nft1.connect(minter).mint(bob.address, 1)
    await nft1.connect(minter).mint(bob.address, 2)
    await nft1.connect(bob).setApprovalForAll(converter.address, true)
    await converter.connect(bob).issue()
    //await converter.connect(bob).approve(farm.address, 1000)
    await lp.connect(bob).approve(farm.address, 1000)
    
    // Add uToken address with whitelisted pool
    await farm.connect(alice).add(100, lp.address, true, converter.address)
    await farm.connect(alice).add(100, lp2.address, true, ZERO_ADDRESS)
    let currentBlock = await provider.getBlock('latest')
    // Get to block 650
    await mineBlocks(provider, (currentBlock.timestamp + 1), 649 - currentBlock.number)
    await farm.connect(bob).deposit(0, 10) // Block 650

    currentBlock = await provider.getBlock('latest')
    // Get to block 660
    await mineBlocks(provider, (currentBlock.timestamp + 1), (660 - currentBlock.number))
    // Bob should have 90*10/2 pending reward
    expect(await farm.pendingUnic(0, bob.address)).to.be.eq(450)

    await converter.connect(bob).approveUnlock(950)
    // Unlock votes is at threshold now
    expect(await converter.unlockVotes()).to.be.eq(950)
    await farm.connect(bob).deposit(0, 0) // This will call updatePool
    // allocPoint should be 0
    expect((await farm.poolInfo(0))[1]).to.be.eq(0)
    currentBlock = await provider.getBlock('latest')
    // Get to block 670
    await mineBlocks(provider, (currentBlock.timestamp + 1), (670 - currentBlock.number))
    expect(await unic.balanceOf(bob.address)).to.be.eq(0)
    expect(await farm.pendingUnic(0, bob.address)).to.be.eq(0)
  })
})