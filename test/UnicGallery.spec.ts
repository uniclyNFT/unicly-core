import chai, { expect } from 'chai'
import { BigNumber, Contract, constants, utils } from 'ethers'
import { solidity, MockProvider, createFixtureLoader, deployContract } from 'ethereum-waffle'

import { governanceFixture } from './fixtures'
import { expandTo18Decimals } from './utils'

chai.use(solidity)

describe('UnicGallery', () => {
  const provider = new MockProvider({
    ganacheOptions: {
      hardfork: 'istanbul',
      mnemonic: 'horn horn horn horn horn horn horn horn horn horn horn horn',
      gasLimit: 9999999,
    },
  })
  const [wallet, other0, other1] = provider.getWallets()
  const loadFixture = createFixtureLoader([wallet], provider)

  let unic: Contract
  let unicGallery: Contract
  beforeEach(async () => {
    const fixture = await loadFixture(governanceFixture)
    unic = fixture.unic
    unicGallery = fixture.unicGallery

    await unic.mint(wallet.address, 100)
    await unic.mint(other0.address, 100)
    await unic.mint(other1.address, 100)
  })

  it('enter', async () => {
    await expect(unicGallery.enter(100)).to.be.revertedWith('ERC20: transfer amount exceeds allowance')

    await unic.approve(unicGallery.address, 50)

    await expect(unicGallery.enter(100)).to.be.revertedWith('ERC20: transfer amount exceeds allowance')

    await unic.approve(unicGallery.address, 100)

    await unicGallery.enter(100)

    expect(await unicGallery.balanceOf(wallet.address)).to.be.eq(100)
  })

  it('leave', async () => {
    await unic.approve(unicGallery.address, 100)

    await unicGallery.enter(100)

    await expect(unicGallery.leave(200)).to.be.revertedWith('ERC20: burn amount exceeds balance')

    await unicGallery.leave(100)

    expect(await unicGallery.balanceOf(wallet.address)).to.be.eq(0)
  })

  it('multiple participants', async () => {

    await unic.connect(other0).approve(unicGallery.address, 100)
    await unic.connect(other1).approve(unicGallery.address, 100)

    // other0 enters and gets 20 shares. other1 enters and gets 10 shares.
    await unicGallery.connect(other0).enter(20)
    await unicGallery.connect(other1).enter(10)

    expect(await unicGallery.balanceOf(other0.address)).to.be.eq(20)
    expect(await unicGallery.balanceOf(other1.address)).to.be.eq(10)
    expect(await unic.balanceOf(unicGallery.address)).to.be.eq(30)

    // UnicGallery gets 20 more UNIC from an external source.
    await unic.transfer(unicGallery.address, 20)
    // other0 deposits 10 more UNIC. They should receive 10*30/50 = 6 shares.
    await unicGallery.connect(other0).enter(10)

    expect(await unicGallery.balanceOf(other0.address)).to.be.eq(26)
    expect(await unicGallery.balanceOf(other1.address)).to.be.eq(10)

    // other1 withdraws 5 shares. He should receive 5*60/36 = 8 shares
    await unicGallery.connect(other1).leave((5))

    expect(await unicGallery.balanceOf(other0.address)).to.be.eq(26)
    expect(await unicGallery.balanceOf(other1.address)).to.be.eq(5)

    expect(await unic.balanceOf(unicGallery.address)).to.be.eq(52)
    expect(await unic.balanceOf(other0.address)).to.be.eq(70)
    expect(await unic.balanceOf(other1.address)).to.be.eq(98)
  })
})