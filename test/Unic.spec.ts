import chai, { expect } from 'chai'
import { BigNumber, Contract, constants, utils } from 'ethers'
import { solidity, MockProvider, createFixtureLoader, deployContract } from 'ethereum-waffle'
import { ecsign } from 'ethereumjs-util'

import { governanceFixture } from './fixtures'
import { expandTo18Decimals } from './utils'

import Unic from '../build/Unic.json'

chai.use(solidity)

const DOMAIN_TYPEHASH = utils.keccak256(
  utils.toUtf8Bytes('EIP712Domain(string name,uint256 chainId,address verifyingContract)')
)

const PERMIT_TYPEHASH = utils.keccak256(
  utils.toUtf8Bytes('Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)')
)

describe('Unic', () => {
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
  beforeEach(async () => {
    const fixture = await loadFixture(governanceFixture)
    unic = fixture.unic
  })

  it('nested delegation', async () => {
    await unic.mint(wallet.address, expandTo18Decimals(2))
    await unic.transfer(other0.address, expandTo18Decimals(1))
    await unic.transfer(other1.address, expandTo18Decimals(2))

    expect(await unic.balanceOf(other0.address)).to.be.eq(expandTo18Decimals(1))
    expect(await unic.balanceOf(other1.address)).to.be.eq(expandTo18Decimals(2))
    expect(await unic.balanceOf(wallet.address)).to.be.eq(expandTo18Decimals(0))

    let currectVotes0 = await unic.getCurrentVotes(other0.address)
    let currectVotes1 = await unic.getCurrentVotes(other1.address)
    expect(currectVotes0).to.be.eq(0)
    expect(currectVotes1).to.be.eq(0)

    await unic.connect(other0).delegate(other1.address)
    currectVotes1 = await unic.getCurrentVotes(other1.address)
    expect(currectVotes1).to.be.eq(expandTo18Decimals(1))

    await unic.connect(other1).delegate(other1.address)
    currectVotes1 = await unic.getCurrentVotes(other1.address)
    expect(currectVotes1).to.be.eq(expandTo18Decimals(1).add(expandTo18Decimals(2)))

    await unic.connect(other1).delegate(wallet.address)
    currectVotes1 = await unic.getCurrentVotes(other1.address)
    expect(currectVotes1).to.be.eq(expandTo18Decimals(1))
  })

  it('mints', async () => {
    const unic = await deployContract(wallet, Unic, [])
    const supply = await unic.totalSupply()

    // Check that I get my token because that's important to me
    expect(supply).to.be.eq(expandTo18Decimals(1));
    expect(await unic.balanceOf(wallet.address)).to.be.eq(expandTo18Decimals(1));

    await expect(unic.connect(other1).mint(other1.address, 1)).to.be.revertedWith('Ownable: caller is not the owner')

    // can mint until cap
    const mintCap = BigNumber.from(await unic.cap())
    const amount = mintCap.sub(expandTo18Decimals(1));
    await unic.mint(wallet.address, amount)
    expect(await unic.balanceOf(wallet.address)).to.be.eq(supply.add(amount))

    // cannot mint above cap
    await expect(unic.mint(wallet.address, expandTo18Decimals(1))).to.be.revertedWith('ERC20Capped: cap exceeded')
  })
})