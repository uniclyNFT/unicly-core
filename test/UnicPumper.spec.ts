import chai, { expect } from 'chai'
import { BigNumber, Contract, constants, utils } from 'ethers'
import { solidity, MockProvider, createFixtureLoader, deployContract } from 'ethereum-waffle'

import { governanceFixture } from './fixtures'
import { expandTo18Decimals, mineBlock } from './utils'

import UnicPumper from '../build/UnicPumper.json'
import MockERC20 from '../build/MockERC20.json'
import UnicSwapV2Pair from '../build/IUnicSwapV2Pair.json'
import UnicSwapV2Factory from '../build/UnicSwapV2Factory.json'

chai.use(solidity)

const overrides = {
  gasLimit: 9999999
}

describe('UnicPumper', () => {
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
  let factory: Contract
  let weth: Contract
  let token1: Contract
  let token2: Contract
  let unicPumper: Contract
  let unicWETH: Contract
  let wethToken1: Contract
  let wethToken2: Contract
  let token1Token2: Contract

  beforeEach(async () => {
    const fixture = await loadFixture(governanceFixture)
    unic = fixture.unic

    await unic.mint(minter.address, 100000000)

    factory = await deployContract(alice, UnicSwapV2Factory, [alice.address], overrides)
    weth = await deployContract(minter, MockERC20, ['WETH', 'WETH', 100000000], overrides)
    token1 = await deployContract(minter, MockERC20, ['TOKEN1', 'TOKEN1', 100000000], overrides)
    token2 = await deployContract(minter, MockERC20, ['TOKEN2', 'TOKEN2', 100000000], overrides)
    unicPumper = await deployContract(alice, UnicPumper, [factory.address, gallery.address, unic.address, weth.address], overrides)

    await mineBlock(provider, (await provider.getBlock('latest')).timestamp + 1)
  
    await factory.createPair(weth.address, unic.address)
    const unicWethAddress = await factory.allPairs(0)
    unicWETH = new Contract(unicWethAddress, JSON.stringify(UnicSwapV2Pair.abi), provider).connect(alice)

    await factory.createPair(weth.address, token1.address)
    const wethToken1Address = await factory.allPairs(1)
    wethToken1 = new Contract(wethToken1Address, JSON.stringify(UnicSwapV2Pair.abi), provider).connect(alice)

    await factory.createPair(weth.address, token2.address)
    const wethToken2Address = await factory.allPairs(2)
    wethToken2 = new Contract(wethToken2Address, JSON.stringify(UnicSwapV2Pair.abi), provider).connect(alice)

    await factory.createPair(token1.address, token2.address)
    const token1Token2Address = await factory.allPairs(3)
    token1Token2 = new Contract(token1Token2Address, JSON.stringify(UnicSwapV2Pair.abi), provider).connect(alice)

    // Setup
    await factory.connect(alice).setFeeTo(unicPumper.address)

    await weth.connect(minter).transfer(unicWETH.address, 10000000)
    await unic.connect(minter).transfer(unicWETH.address, 10000000)
    await unicWETH.connect(alice).mint(minter.address, overrides) 

    await weth.connect(minter).transfer(wethToken1.address, 10000000)
    await token1.connect(minter).transfer(wethToken1.address, 10000000)
    await wethToken1.connect(alice).mint(minter.address, overrides)

    await weth.connect(minter).transfer(wethToken2.address, 10000000)
    await token2.connect(minter).transfer(wethToken2.address, 10000000)
    await wethToken2.connect(alice).mint(minter.address, overrides)

    await token1.connect(minter).transfer(token1Token2.address, 10000000)
    await token2.connect(minter).transfer(token1Token2.address, 10000000)
    await token1Token2.connect(alice).mint(minter.address, overrides)

    await mineBlock(provider, (await provider.getBlock('latest')).timestamp + 1)
  })

  it('pump UNIC with token1Token2 pool', async () => {
    // Fake some revenue
    await token1.connect(minter).transfer(token1Token2.address, 100000)
    await token2.connect(minter).transfer(token1Token2.address, 100000)
    await token1Token2.connect(alice).sync()

    await token1.connect(minter).transfer(token1Token2.address, 10000000)
    await token2.connect(minter).transfer(token1Token2.address, 10000000)
    await token1Token2.connect(alice).mint(minter.address, overrides)

    // Pumper should have the LP now
    expect(await token1Token2.balanceOf(unicPumper.address)).to.be.eq(16528)

    await mineBlock(provider, (await provider.getBlock('latest')).timestamp + 1)

    // After calling convert, gallery should have UNIC value at ~1/6 of revenue
    await unicPumper.connect(alice).convert(token1.address, token2.address, overrides)
    expect(await unic.balanceOf(gallery.address)).to.be.eq(32965)
    expect(await token1Token2.balanceOf(unicPumper.address)).to.be.eq(0)
  })

  it('pump UNIC with UNIC-ETH pool', async () => {
    // This should also work for the UNIC-ETH pair
    await unic.connect(minter).transfer(unicWETH.address, 100000)
    await weth.connect(minter).transfer(unicWETH.address, 100000)
    await unicWETH.connect(alice).sync()

    await unic.connect(minter).transfer(unicWETH.address, 10000000)
    await weth.connect(minter).transfer(unicWETH.address, 10000000)
    await unicWETH.connect(alice).mint(minter.address, overrides)

    expect(await unicWETH.balanceOf(unicPumper.address)).to.be.eq(16528)

    await mineBlock(provider, (await provider.getBlock('latest')).timestamp + 1)

    await unicPumper.connect(alice).convert(unic.address, weth.address, overrides)
    expect(await unic.balanceOf(gallery.address)).to.be.eq(33266)
    expect(await unicWETH.balanceOf(unicPumper.address)).to.be.eq(0)
  })
})