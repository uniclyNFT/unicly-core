import chai, { expect } from 'chai'
import { Contract, Wallet, providers } from 'ethers'
import { solidity, deployContract } from 'ethereum-waffle'

import Unic from '../build/Unic.json'
import Timelock from '../build/Timelock.json'
import GovernorAlpha from '../build/GovernorAlpha.json'
import UnicGallery from '../build/UnicGallery.json'

import { expandTo18Decimals, DELAY } from './utils'

chai.use(solidity)

interface GovernanceFixture {
  unic: Contract
  timelock: Contract
  governorAlpha: Contract
  unicGallery: Contract
}

export async function governanceFixture(
  [wallet]: Wallet[],
  provider: providers.Web3Provider
): Promise<GovernanceFixture> {
  // deploy UNIC
  //const { timestamp: now } = await provider.getBlock('latest')

  const timelockAddress = Contract.getContractAddress({ from: wallet.address, nonce: 1 })
  const unic = await deployContract(wallet, Unic, []);

  // deploy timelock, controlled by what will be the governor
  const governorAlphaAddress = Contract.getContractAddress({ from: wallet.address, nonce: 2 })
  const timelock = await deployContract(wallet, Timelock, [governorAlphaAddress, DELAY])
  expect(timelock.address).to.be.eq(timelockAddress)

  // deploy governorAlpha
  const governorAlpha = await deployContract(wallet, GovernorAlpha, [timelock.address, unic.address, wallet.address])
  expect(governorAlpha.address).to.be.eq(governorAlphaAddress)

  const galleryAddress = Contract.getContractAddress({ from: wallet.address, nonce: 3 })
  const unicGallery = await deployContract(wallet, UnicGallery, [unic.address])
  expect(unicGallery.address).to.be.eq(galleryAddress)

  return { unic, timelock, governorAlpha, unicGallery }
}
