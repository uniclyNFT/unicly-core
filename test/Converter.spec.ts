import chai, { expect } from 'chai'
import { BigNumber, Contract, constants, utils } from 'ethers'
import { solidity, MockProvider, createFixtureLoader, deployContract } from 'ethereum-waffle'

import { expandTo18Decimals, mineBlock, mineBlocks } from './utils'

import UnicFactory from '../build/UnicFactory.json'
import Converter from '../build/Converter.json'
import MockERC721 from '../build/MockERC721.json'
import MockERC1155 from '../build/MockERC1155.json'

chai.use(solidity)

const overrides = {
  gasLimit: 9999999
}

let emptyArray: Array<number>
emptyArray = []

describe('Converter', () => {
    const provider = new MockProvider({
      ganacheOptions: {
        hardfork: 'istanbul',
        mnemonic: 'horn horn horn horn horn horn horn horn horn horn horn horn',
        gasLimit: 99999999,
      },
    })
    const [alice, bob, carol, minter] = provider.getWallets()
  
    let factory: Contract
    let converter: Contract
    let converter2: Contract
    let nft1: Contract
    let nft2: Contract
  
    beforeEach(async () => {
  
      factory = await deployContract(alice, UnicFactory, [alice.address], overrides)
      await factory.connect(bob).createUToken(1000, 18, 'Star Wars Collection', 'uSTAR', 950, 'Leia\'s Star Wars NFT Collection')
      const converterAddress = await factory.uTokens(0)
      converter = new Contract(converterAddress, JSON.stringify(Converter.abi), provider)

      await factory.connect(carol).createUToken(1000, 8, 'Unicly NFT Collection', 'uNIC', 950, 'Leia\'s Unicly NFT Collection')
      const converter2Address = await factory.uTokens(1)
      converter2 = new Contract(converter2Address, JSON.stringify(Converter.abi), provider)

      nft1 = await deployContract(minter, MockERC721, ['Star Wars NFTs', 'STAR'], overrides)
      nft2 = await deployContract(minter, MockERC1155, [], overrides)
      
      // 3 NFTs for Bob
      await nft1.connect(minter).mint(bob.address, 0)
      await nft1.connect(minter).mint(bob.address, 1)
      await nft1.connect(minter).mint(bob.address, 2)
      // 3 more NFTs for Bob
      await nft2.connect(minter).mint(bob.address, 0, 2, emptyArray)
      await nft2.connect(minter).mint(bob.address, 1, 1, emptyArray)

      await nft1.connect(bob).setApprovalForAll(converter.address, true)
      await nft2.connect(bob).setApprovalForAll(converter.address, true)

      // 3 NFTs for Carol
      await nft1.connect(minter).mint(carol.address, 3)
      await nft1.connect(minter).mint(carol.address, 4)
      await nft1.connect(minter).mint(carol.address, 5)
      // 3 more NFTs for Carol
      await nft2.connect(minter).mint(carol.address, 2, 2, emptyArray)
      await nft2.connect(minter).mint(carol.address, 3, 1, emptyArray)

      await nft1.connect(carol).setApprovalForAll(converter2.address, true)
      await nft2.connect(carol).setApprovalForAll(converter2.address, true)
    })
  
    it('state variables', async () => {
        // totalSupply is 0 until the issue function is called
        expect(await converter.totalSupply()).to.be.eq(0)
        expect(await converter.decimals()).to.be.eq(18)
        expect(await converter.name()).to.be.eq('Star Wars Collection')
        expect(await converter.symbol()).to.be.eq('uSTAR')
        expect(await converter._threshold()).to.be.eq(950)
        expect(await converter.issuer()).to.be.eq(bob.address)
        expect(await converter._description()).to.be.eq('Leia\'s Star Wars NFT Collection')
        expect(await converter.factory()).to.be.eq(factory.address)

        expect(await converter2.totalSupply()).to.be.eq(0)
        expect(await converter2.decimals()).to.be.eq(8)
        expect(await converter2.name()).to.be.eq('Unicly NFT Collection')
        expect(await converter2.symbol()).to.be.eq('uNIC')
        expect(await converter2._threshold()).to.be.eq(950)
        expect(await converter2.issuer()).to.be.eq(carol.address)
        expect(await converter2._description()).to.be.eq('Leia\'s Unicly NFT Collection')
        expect(await converter.factory()).to.be.eq(factory.address)
    })

    it('issue', async () => {
      await expect(converter.connect(alice).issue()).to.be.revertedWith('Converter: Only issuer can issue the tokens')

      await converter.connect(bob).issue()
      expect(await converter.balanceOf(bob.address)).to.be.eq(1000)
      expect(await converter.totalSupply()).to.be.eq(1000)

      await expect(converter.connect(bob).issue()).to.be.revertedWith('Converter: Token is already active')

      await converter2.connect(carol).issue()
      expect(await converter2.balanceOf(carol.address)).to.be.eq(1000)
      expect(await converter2.totalSupply()).to.be.eq(1000)

      expect(await converter.active()).to.be.eq(true)
      expect(await converter2.active()).to.be.eq(true)
    })

    it('issue after fee is on', async () => {
      await factory.connect(alice).setFeeTo(alice.address)

      await converter.connect(bob).issue()
      expect(await converter.balanceOf(alice.address)).to.be.eq(5)
      expect(await converter.balanceOf(bob.address)).to.be.eq(995)

      await converter2.connect(carol).issue()
      expect(await converter2.balanceOf(alice.address)).to.be.eq(5)
      expect(await converter2.balanceOf(carol.address)).to.be.eq(995)
    })

    it('deposit', async () => {
      expect(await nft1.isApprovedForAll(bob.address, converter.address)).to.be.eq(true)
      expect(await nft2.isApprovedForAll(bob.address, converter.address)).to.be.eq(true)
      expect(await nft1.isApprovedForAll(carol.address, converter2.address)).to.be.eq(true)
      expect(await nft2.isApprovedForAll(carol.address, converter2.address)).to.be.eq(true)

      expect(await nft1.balanceOf(bob.address)).to.be.eq(3)
      expect(await nft2.balanceOf(bob.address, 0)).to.be.eq(2)
      expect(await nft2.balanceOf(bob.address, 1)).to.be.eq(1)

      let bobTokenIds: Array<number>
      bobTokenIds = [0, 1, 2]
      await mineBlock(provider, (await provider.getBlock('latest')).timestamp + 1)
      await converter.connect(bob).deposit(bobTokenIds, emptyArray, nft1.address)
      expect(await converter.currentNFTIndex()).to.be.eq(3)
      await mineBlock(provider, (await provider.getBlock('latest')).timestamp + 1)

      bobTokenIds = [0, 1]

      let ERC1155Amounts: Array<number>
      ERC1155Amounts = [2, 1]
      await converter.connect(bob).deposit(bobTokenIds, ERC1155Amounts, nft2.address)
      expect(await converter.currentNFTIndex()).to.be.eq(5)
      await mineBlock(provider, (await provider.getBlock('latest')).timestamp + 1)

      expect(await nft1.balanceOf(bob.address)).to.be.eq(0)
      expect(await nft2.balanceOf(bob.address, 0)).to.be.eq(0)
      expect(await nft2.balanceOf(bob.address, 1)).to.be.eq(0)
      expect(await nft1.balanceOf(converter.address)).to.be.eq(3)
      expect(await nft2.balanceOf(converter.address, 0)).to.be.eq(2)
      expect(await nft2.balanceOf(converter.address, 1)).to.be.eq(1)

      // 1st token is token ID 0 for nft1
      expect((await converter.nfts(0)).tokenId).to.be.eq(0)
      // 4th token is token ID 0 for nft2
      expect((await converter.nfts(3)).tokenId).to.be.eq(0)
      // 4th token is ERC1155 and we sent 2 of them
      expect((await converter.nfts(3)).amount).to.be.eq(2)

      // Check that it works for other people and other NFTs too
      let carolTokenIds: Array<number>
      carolTokenIds = [3, 4, 5]
      await converter2.connect(carol).deposit(carolTokenIds, emptyArray, nft1.address)
      await mineBlock(provider, (await provider.getBlock('latest')).timestamp + 1)
      carolTokenIds = [2, 3]
      await converter2.connect(carol).deposit(carolTokenIds, ERC1155Amounts, nft2.address)
      expect(await converter2.currentNFTIndex()).to.be.eq(5)
    })

    it('refund', async () => {
      let bobTokenIds: Array<number>
      bobTokenIds = [0, 1, 2]
      await mineBlock(provider, (await provider.getBlock('latest')).timestamp + 1)
      await converter.connect(bob).deposit(bobTokenIds, emptyArray, nft1.address)
      expect(await converter.currentNFTIndex()).to.be.eq(3)
      await mineBlock(provider, (await provider.getBlock('latest')).timestamp + 1)

      bobTokenIds = [0, 1]
      let ERC1155Amounts: Array<number>
      ERC1155Amounts = [2, 1]
      await converter.connect(bob).deposit(bobTokenIds, ERC1155Amounts, nft2.address)
      expect(await converter.currentNFTIndex()).to.be.eq(5)
      await mineBlock(provider, (await provider.getBlock('latest')).timestamp + 1)

      await expect(converter.connect(carol).refund(carol.address)).to.be.revertedWith('Converter: Only issuer can refund')
      await converter.connect(bob).refund(bob.address)
      await mineBlock(provider, (await provider.getBlock('latest')).timestamp + 1)
      expect(await converter.currentNFTIndex()).to.be.eq(0)

      expect(await nft1.balanceOf(bob.address)).to.be.eq(3)
      expect(await nft2.balanceOf(bob.address, 0)).to.be.eq(2)
      expect(await nft2.balanceOf(bob.address, 1)).to.be.eq(1)
      expect(await nft1.balanceOf(converter.address)).to.be.eq(0)
      expect(await nft2.balanceOf(converter.address, 0)).to.be.eq(0)
      expect(await nft2.balanceOf(converter.address, 1)).to.be.eq(0)

      await converter.connect(bob).issue()
      expect(await converter.balanceOf(bob.address)).to.be.eq(1000)
      expect(await converter.totalSupply()).to.be.eq(1000)

      await expect(converter.connect(bob).refund(bob.address)).to.be.revertedWith('Converter: Contract is already active - cannot refund')
    })

    it('deposit after issue', async () => {
      let bobTokenIds: Array<number>
      bobTokenIds = [0, 1, 2]
      await mineBlock(provider, (await provider.getBlock('latest')).timestamp + 1)
      await converter.connect(bob).deposit(bobTokenIds, emptyArray, nft1.address)
      await mineBlock(provider, (await provider.getBlock('latest')).timestamp + 1)

      let carolTokenIds: Array<number>
      carolTokenIds = [3, 4, 5]
      await expect(converter.connect(carol).deposit(carolTokenIds, emptyArray, nft1.address)).to.be.revertedWith('Converter: Only issuer can deposit')

      await converter.connect(bob).issue()
      bobTokenIds = [0, 1]

      let ERC1155Amounts: Array<number>
      ERC1155Amounts = [2, 1]
      await converter.connect(bob).deposit(bobTokenIds, ERC1155Amounts, nft2.address)
      expect(await converter.currentNFTIndex()).to.be.eq(5)
      // 1st token is token ID 0 for nft1
      expect((await converter.nfts(0)).tokenId).to.be.eq(0)
      // 4th token is token ID 0 for nft2
      expect((await converter.nfts(3)).tokenId).to.be.eq(0)
      // 4th token is ERC1155 and we sent 2 of them
      expect((await converter.nfts(3)).amount).to.be.eq(2)
    })

    it('total bid amount', async () => {
      let bobTokenIds: Array<number>
      bobTokenIds = [0, 1, 2]
      await mineBlock(provider, (await provider.getBlock('latest')).timestamp + 1)
      await converter.connect(bob).deposit(bobTokenIds, emptyArray, nft1.address)
      await mineBlock(provider, (await provider.getBlock('latest')).timestamp + 1)

      await converter.connect(bob).issue()

      await converter.connect(bob).transfer(alice.address, 100)
      await converter.connect(bob).transfer(carol.address, 100)

      await converter.connect(bob).bid(0, { value: 50 })
      expect(await converter.totalBidAmount()).to.be.eq(50)
      await mineBlock(provider, (await provider.getBlock('latest')).timestamp + 1)

      await converter.connect(carol).bid(0, { value: 100 })
      expect(await converter.totalBidAmount()).to.be.eq(100)
      await mineBlock(provider, (await provider.getBlock('latest')).timestamp + 1)

      await converter.connect(bob).bid(1, { value: 25 })
      expect(await converter.totalBidAmount()).to.be.eq(125)
      await mineBlock(provider, (await provider.getBlock('latest')).timestamp + 1)

      await expect(converter.connect(alice).bid(0, { value: 100 })).to.be.revertedWith('Converter: Bid too low')
      await expect(converter.connect(carol).bid(0, { value: 125 })).to.be.revertedWith('Converter: You have an active bid')
      await expect(converter.connect(bob).bid(0, { value: 125 })).to.be.revertedWith('Converter: Collect bid refund')

      await expect(converter.connect(carol).unbid(0)).to.be.revertedWith('Converter: Top bid locked')
      await expect(converter.connect(alice).unbid(0)).to.be.revertedWith('Converter: no bid found')

      await converter.connect(bob).unbid(0)
      expect(await converter.totalBidAmount()).to.be.eq(125)

      await mineBlock(provider, (await provider.getBlock('latest')).timestamp + ((await converter.TOP_BID_LOCK_TIME()).toNumber() + 1))
      await converter.connect(carol).unbid(0)
      expect(await converter.totalBidAmount()).to.be.eq(25)
    })

    it('bid, unbid, and ETH balance changes correctly', async () => {
      let bobTokenIds: Array<number>
      bobTokenIds = [0, 1, 2]
      await mineBlock(provider, (await provider.getBlock('latest')).timestamp + 1)
      await converter.connect(bob).deposit(bobTokenIds, emptyArray, nft1.address)
      await mineBlock(provider, (await provider.getBlock('latest')).timestamp + 1)

      await converter.connect(bob).issue()

      await expect(await converter.connect(bob).bid(0, { value: 100 })).to.changeEtherBalance(bob, -100)
      await mineBlock(provider, (await provider.getBlock('latest')).timestamp + 1)
      await expect(await converter.connect(bob).bid(1, { value: 50 })).to.changeEtherBalance(bob, -50)
      expect((await converter.bids(0))[0]).to.be.eq(bob.address)
      expect((await converter.bids(0))[1]).to.be.eq(100)
      expect((await converter.bids(1))[0]).to.be.eq(bob.address)
      expect((await converter.bids(1))[1]).to.be.eq(50)
      await mineBlock(provider, (await provider.getBlock('latest')).timestamp + 1)
      await expect(await converter.connect(alice).bid(0, { value: 101 })).to.changeEtherBalance(alice, -101)
      await mineBlock(provider, (await provider.getBlock('latest')).timestamp + 1)
      await expect(await converter.connect(alice).bid(1, { value: 51 })).to.changeEtherBalance(alice, -51)
      expect(await converter.bidRefunds(0, bob.address)).to.be.eq(100)
      expect(await converter.bidRefunds(1, bob.address)).to.be.eq(50)
      await mineBlock(provider, (await provider.getBlock('latest')).timestamp + ((await converter.TOP_BID_LOCK_TIME()).toNumber() + 1))
      
      await expect(await converter.connect(bob).unbid(0)).to.changeEtherBalance(bob, 100)
      await expect(converter.connect(bob).unbid(0)).to.be.revertedWith('Converter: no bid found')
      await mineBlock(provider, (await provider.getBlock('latest')).timestamp + 1)
      await expect(await converter.connect(alice).unbid(0)).to.changeEtherBalance(alice, 101)
      await expect(converter.connect(alice).unbid(0)).to.be.revertedWith('Converter: no bid found')

      expect((await converter.bids(0))[1]).to.be.eq(0)
      expect(await converter.bidRefunds(0, bob.address)).to.be.eq(0)
    })

    it('approve and unapprove unlock', async () => {
      let bobTokenIds: Array<number>
      bobTokenIds = [0, 1, 2]
      await mineBlock(provider, (await provider.getBlock('latest')).timestamp + 1)
      await converter.connect(bob).deposit(bobTokenIds, emptyArray, nft1.address)
      await mineBlock(provider, (await provider.getBlock('latest')).timestamp + 1)

      await converter.connect(bob).issue()

      await converter.connect(bob).transfer(alice.address, 100)
      await converter.connect(bob).transfer(carol.address, 100)

      await converter.connect(bob).bid(0, { value: 50 })
      await expect(converter.connect(alice).approveUnlock(120)).to.be.revertedWith('ERC20: transfer amount exceeds balance')
      await converter.connect(alice).approveUnlock(30)
      expect(await converter.unlockApproved(alice.address)).to.be.eq(30)
      expect(await converter.unlockVotes()).to.be.eq(30)
      expect(await converter.balanceOf(alice.address)).to.be.eq(70)
      await converter.connect(alice).approveUnlock(70)
      expect(await converter.unlockApproved(alice.address)).to.be.eq(100)
      expect(await converter.unlockVotes()).to.be.eq(100)
      expect(await converter.balanceOf(alice.address)).to.be.eq(0)
      expect(await converter.balanceOf(converter.address)).to.be.eq(100)
      await converter.connect(carol).approveUnlock(50)
      expect(await converter.unlockApproved(carol.address)).to.be.eq(50)
      expect(await converter.unlockVotes()).to.be.eq(150)

      await expect(converter.connect(alice).unapproveUnlock(120)).to.be.revertedWith('Converter: Not enough uTokens locked by user')
      await converter.connect(alice).unapproveUnlock(70)
      expect(await converter.balanceOf(alice.address)).to.be.eq(70)
      expect(await converter.balanceOf(converter.address)).to.be.eq(80)
      expect(await converter.unlockVotes()).to.be.eq(80)
      expect(await converter.unlockApproved(alice.address)).to.be.eq(30)
      await expect(converter.connect(alice).unapproveUnlock(70)).to.be.revertedWith('Converter: Not enough uTokens locked by user')
    })

    it('threshold met', async () => {
      let bobTokenIds: Array<number>
      bobTokenIds = [0, 1, 2]
      await mineBlock(provider, (await provider.getBlock('latest')).timestamp + 1)
      await converter.connect(bob).deposit(bobTokenIds, emptyArray, nft1.address)
      await mineBlock(provider, (await provider.getBlock('latest')).timestamp + 1)

      await converter.connect(bob).issue()

      await converter.connect(bob).transfer(alice.address, 100)
      await converter.connect(bob).transfer(carol.address, 100)
      await mineBlock(provider, (await provider.getBlock('latest')).timestamp + 1)

      await converter.connect(bob).bid(0, { value: 50 })
      await converter.connect(bob).bid(1, { value: 10 })
      await converter.connect(carol).bid(1, { value: 30 })
      await converter.connect(bob).bid(2, { value: 20 })
      await converter.connect(alice).bid(2, { value: 60 })
      expect(await converter.totalBidAmount()).to.be.eq(140)
      await mineBlock(provider, (await provider.getBlock('latest')).timestamp + 1)
      await converter.connect(bob).approveUnlock(50)
      await converter.connect(carol).approveUnlock(90)
      await converter.connect(alice).approveUnlock(80)
      await expect(converter.connect(bob).claim(0)).to.be.revertedWith('Converter: Threshold not met')
      await expect(converter.connect(alice).redeemETH(20)).to.be.revertedWith('Converter: Threshold not met')

      await mineBlock(provider, (await provider.getBlock('latest')).timestamp + 1)
      await converter.connect(bob).approveUnlock(730)
      expect(await converter.unlockVotes()).to.be.eq(950)
      await expect(converter.connect(alice).claim(0)).to.be.revertedWith('Converter: Only winner can claim')
      await expect(converter.connect(carol).claim(2)).to.be.revertedWith('Converter: Only winner can claim')
      await expect(converter.connect(bob).claim(1)).to.be.revertedWith('Converter: Only winner can claim')
      await expect(converter.connect(bob).claim(2)).to.be.revertedWith('Converter: Only winner can claim')
      await mineBlock(provider, (await provider.getBlock('latest')).timestamp + 1)

      await converter.connect(bob).claim(0)
      expect(await nft1.balanceOf(bob.address)).to.be.eq(1)
      await converter.connect(carol).claim(1)
      // Carol has 3 NFTs from the nft1 contract outside of these bids
      expect(await nft1.balanceOf(carol.address)).to.be.eq(4)
      await converter.connect(alice).claim(2)
      expect(await nft1.balanceOf(alice.address)).to.be.eq(1)
      await mineBlock(provider, (await provider.getBlock('latest')).timestamp + 1)

      await expect(converter.connect(bob).claim(0)).to.be.revertedWith('Converter: Already claimed')

      await expect(converter.connect(alice).approveUnlock(10)).to.be.revertedWith('Converter: Threshold reached')
      await expect(converter.connect(alice).unapproveUnlock(80)).to.be.revertedWith('Converter: Threshold reached')
      await expect(converter.connect(alice).redeemETH(30)).to.be.revertedWith('ERC20: transfer amount exceeds balance')
      await expect(converter.connect(alice).unbid(2)).to.be.revertedWith('Converter: Release threshold has been met, winner can\'t unbid')

      await mineBlock(provider, (await provider.getBlock('latest')).timestamp + 1)
      // 140 * 80 / 1000 = 11.2
      expect(await converter.unlockApproved(alice.address)).to.be.eq(80)
      await expect(await converter.connect(alice).redeemETH(0)).to.changeEtherBalance(alice, 11)
      expect(await converter.unlockApproved(alice.address)).to.be.eq(0)
      // 140 * 20 / 1000 = 2.8
      expect(await converter.balanceOf(alice.address)).to.be.eq(20)
      await expect(await converter.connect(alice).redeemETH(20)).to.changeEtherBalance(alice, 2)
      expect(await converter.balanceOf(alice.address)).to.be.eq(0)
      expect(await converter.balanceOf(bob.address)).to.be.eq(20)
      // 140 * 800 / 1000 = 112
      await expect(await converter.connect(bob).redeemETH(20)).to.changeEtherBalance(bob, 112)
      expect(await converter.balanceOf(bob.address)).to.be.eq(0)
      expect(await converter.unlockApproved(bob.address)).to.be.eq(0)

      expect(await converter.balanceOf(carol.address)).to.be.eq(10)
      // 140 * 100 / 1000 = 14
      await expect(await converter.connect(carol).redeemETH(10)).to.changeEtherBalance(carol, 14)
      expect(await converter.unlockApproved(carol.address)).to.be.eq(0)
    })
})