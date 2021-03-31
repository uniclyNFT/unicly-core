import chai, { expect } from 'chai'
import { BigNumber, Contract, constants, utils } from 'ethers'
import { solidity, MockProvider, createFixtureLoader, deployContract } from 'ethereum-waffle'

import UnicFactory from '../build/UnicFactory.json'

chai.use(solidity)

const overrides = {
  gasLimit: 9999999
}

const ZERO_ADDRESS = '0x0000000000000000000000000000000000000000'

describe('UnicFactory', () => {
    const provider = new MockProvider({
      ganacheOptions: {
        hardfork: 'istanbul',
        mnemonic: 'horn horn horn horn horn horn horn horn horn horn horn horn',
        gasLimit: 99999999,
      },
    })
    const [alice, bob, carol] = provider.getWallets()

    let factory: Contract

    beforeEach(async () => {

      factory = await deployContract(alice, UnicFactory, [alice.address], overrides)
    })

    it('fee to', async () => {
        expect(await factory.feeToSetter()).to.be.eq(alice.address)
        expect(await factory.feeTo()).to.be.eq(ZERO_ADDRESS)
        await factory.connect(alice).setFeeToSetter(bob.address)
        expect(await factory.feeToSetter()).to.be.eq(bob.address)
        expect(await factory.feeTo()).to.be.eq(ZERO_ADDRESS)
        await factory.connect(bob).setFeeTo(bob.address)
        expect(await factory.feeTo()).to.be.eq(bob.address)
    })

    it('create uTokens', async () => {
        expect(await factory.uTokensLength()).to.be.eq(0)

        await expect(factory.createUToken(1000, 3, 'Star Wars Collection', 'uSTAR', 950, 'Leia\'s Star Wars NFT Collection', overrides)).to.be.revertedWith('Unic: MIN PRECISION')
        await expect(factory.createUToken(1000, 18, 'Star Wars Collection', 'uSTAR', 1001, 'Leia\'s Star Wars NFT Collection', overrides)).to.be.revertedWith('Unic: THRESHOLD GREATER THAN SUPPLY')

        await factory.createUToken(1000, 18, 'Star Wars Collection', 'uSTAR', 950, 'Leia\'s Star Wars NFT Collection')
        const address = await factory.uTokens(0)
        expect(await factory.uTokensLength()).to.be.eq(1)
        expect(await factory.getUToken(address)).to.be.eq(0)

        await factory.createUToken(1000, 8, 'Unicly NFT Collection', 'uNIC', 950, 'Leia\'s Unicly NFT Collection')
        const address2 = await factory.uTokens(1)
        expect(await factory.uTokensLength()).to.be.eq(2)
        expect(await factory.getUToken(address2)).to.be.eq(1)
    })

    it('create uToken gas', async () => {
        expect(await factory.uTokensLength()).to.be.eq(0)

        const tx = await factory.createUToken(1000, 18, 'Star Wars Collection', 'uSTAR', 950, 'Leia\'s Star Wars NFT Collection')
        const receipt = await tx.wait()
        expect(await receipt.gasUsed).to.be.eq(3455680)
    })
})
