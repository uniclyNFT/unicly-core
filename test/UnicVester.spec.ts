import chai, { expect } from 'chai'
import { BigNumber, Contract, constants, utils } from 'ethers'
import { solidity, MockProvider, createFixtureLoader, deployContract } from 'ethereum-waffle'

import { governanceFixture } from './fixtures'
import { expandTo18Decimals, mineBlock } from './utils'

import UnicVester from '../build/UnicVester.json'
import MockERC20 from '../build/MockERC20.json'
import UnicSwapV2Pair from '../build/IUnicSwapV2Pair.json'
import UnicSwapV2Factory from '../build/UnicSwapV2Factory.json'
import UnicFactory from '../build/UnicFactory.json'
import Converter from '../build/Converter.json'

chai.use(solidity)

const overrides = {
  gasLimit: 9999999
}

describe('UnicVester', () => {
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
  let unicFactory: Contract
  let weth: Contract
  let token1: Contract
  let unicVester: Contract
  let unicWETH: Contract
  let wethToken1: Contract

  beforeEach(async () => {
    const fixture = await loadFixture(governanceFixture)
    unic = fixture.unic

    await unic.mint(minter.address, 100000000)

    factory = await deployContract(alice, UnicSwapV2Factory, [alice.address], overrides)
    unicFactory = await deployContract(alice, UnicFactory, [alice.address], overrides)
    await unicFactory.connect(minter).createUToken(100000000, 18, 'Star Wars Collection', 'uSTAR', 50000000, 'Leia\'s Star Wars NFT Collection')
    const converterAddress = await unicFactory.uTokens(0)
    token1 = new Contract(converterAddress, JSON.stringify(Converter.abi), provider)

    weth = await deployContract(minter, MockERC20, ['WETH', 'WETH', 100000000], overrides)
    unicVester = await deployContract(alice, UnicVester, [factory.address, gallery.address, unic.address, weth.address], overrides)
    await unicFactory.connect(alice).setFeeTo(unicVester.address)
    await token1.connect(minter).issue()

    await mineBlock(provider, (await provider.getBlock('latest')).timestamp + 1)
  
    await factory.createPair(weth.address, unic.address)
    const unicWethAddress = await factory.allPairs(0)
    unicWETH = new Contract(unicWethAddress, JSON.stringify(UnicSwapV2Pair.abi), provider).connect(alice)

    await factory.createPair(weth.address, token1.address)
    const wethToken1Address = await factory.allPairs(1)
    wethToken1 = new Contract(wethToken1Address, JSON.stringify(UnicSwapV2Pair.abi), provider).connect(alice)

    // Setup
    await weth.connect(minter).transfer(unicWETH.address, 10000000)
    await unic.connect(minter).transfer(unicWETH.address, 10000000)
    await unicWETH.connect(alice).mint(minter.address, overrides) 

    await weth.connect(minter).transfer(wethToken1.address, 10000000)
    await token1.connect(minter).transfer(wethToken1.address, 10000000)
    await wethToken1.connect(alice).mint(minter.address, overrides)

    await mineBlock(provider, (await provider.getBlock('latest')).timestamp + 1)
  })

  it('pump UNIC with wethToken1 pool', async () => {
    expect(await token1.balanceOf(unicVester.address)).to.be.eq(500000)
    await unicVester.connect(alice).setSchedule(100)
    await unicVester.connect(alice).initialize(token1.address)
    let start = ((await unicVester.vestings(token1.address))[1]).toNumber()
    expect(await unicVester.vestingDuration()).to.be.eq(100)
    // amount
    expect((await unicVester.vestings(token1.address))[0]).to.be.eq(500000)
    await mineBlock(provider, (await provider.getBlock('latest')).timestamp + 50)

    await unicVester.connect(alice).swap(token1.address, overrides)
    expect((await unicVester.vestings(token1.address))[0]).to.be.eq(250000)
    expect(await unic.balanceOf(gallery.address)).to.be.eq(236718)
    expect((await unicVester.vestings(token1.address))[1]).to.be.eq(start + 50)

    await mineBlock(provider, (await provider.getBlock('latest')).timestamp + 50)
    await unicVester.connect(alice).swap(token1.address, overrides)
    expect(await unic.balanceOf(gallery.address)).to.be.eq(451974)
    expect((await unicVester.vestings(token1.address))[1]).to.be.eq(start + 100)

    await expect(unicVester.connect(alice).swap(token1.address, overrides)).to.be.revertedWith('UnicVester: Fully vested and swapped')
  })
})
